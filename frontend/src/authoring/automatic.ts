import type {Document} from '@/api/types';
import {LocalAuthoring,isFrontMatter} from './local';
import {device} from '@/private/device';
import {generationJobs} from '@/private/jobs';
import {jobScope} from '@/private/useGenerationJobs';
import {Library} from '@/private/library';
export type Preparation={lesson?:string;quiz?:string;error?:string};
export type PreparationMap=Record<string,Preparation>;
const key=(service:LocalAuthoring,doc:Document)=>`${service.library.prefix}automatic:${doc.id}:${doc.content_version}`;
export async function preparation(service:LocalAuthoring,doc:Document){return await(await device()).get<PreparationMap>(key(service,doc))||{};}

/** Clear a module's recorded failure so a deliberate retry can succeed.
 *
 * Automatic preparation never retries a failed module by design, so the
 * verdict has to be erased when someone retries from the module's own screen —
 * otherwise the readiness table keeps showing "Failed" even after the module
 * generates fine. Takes the document so the exact state key is derived rather
 * than guessed: the device store's list() returns values without their keys,
 * so sweeping blindly is not possible.
 */
export async function clearFailure(service:LocalAuthoring,doc:Document,moduleId:string){
 const store=await device();
 const map=await preparation(service,doc);
 const entry=map[moduleId];
 if(!entry||(entry.lesson!=='Failed'&&entry.quiz!=='Failed'))return;
 map[moduleId]={
  ...entry,
  ...(entry.lesson==='Failed'?{lesson:'Queued'}:{}),
  ...(entry.quiz==='Failed'?{quiz:'Queued'}:{}),
  error:undefined,
 };
 service.library.guard();
 await store.put(key(service,doc),map);
}

/** One book job, sequential module operations, with durable progress and isolated failures. */
export async function prepareAutomatically(service:LocalAuthoring,doc:Document){
 const store=await device();service.library.guard();
 if(await service.isRemoved(doc.id)||!(await store.status()).installed)return false;
 const scope=jobScope(new Library(service.library.owner).prefix);
 if(generationJobs.snapshot().some(j=>j.scope===scope&&(j.bookId===doc.id||j.documentId===doc.id)&&['queued','running'].includes(j.state)))return true;
 const modules=(doc.chapters||[]).flatMap(c=>c.modules).filter(m=>m.id);
 const states=await preparation(service,doc);
 const save=async()=>{service.library.guard();await store.put(key(service,doc),states);};
 // Seed each module's state, PRESERVING what a previous run concluded.
 //
 // This used to overwrite every entry unconditionally, which threw away
 // 'Failed' and its error and put the module back to 'Queued' — so the next
 // run generated it again from scratch, every time, for ever. A module that
 // cannot be prepared must stay failed until someone retries it deliberately.
 // 'Shared' still wins whenever the institution now has the content, because
 // that is newer information than anything held locally.
 for(const m of modules){
  const previous=states[m.id!];
  const lessonShared=m.lesson_status==='ready';
  const quizShared=['ready','held','checking','dismissed'].includes(m.quiz_status||'');
  // 'Generating' left over from a previous run means that run was interrupted
  // (tab closed, app reloaded) — nothing is generating now. Reset it to
  // 'Queued' so it is picked up again, rather than stranding the module in a
  // state nothing will ever move it out of.
  const carry=(v?:string)=>v==='Generating'?'Queued':v;
  states[m.id!]={
   lesson:lessonShared?'Shared':previous?.lesson==='Failed'?'Failed':carry(previous?.lesson)||'Queued',
   quiz:quizShared?'Shared':previous?.quiz==='Failed'?'Failed':carry(previous?.quiz)||'Queued',
   ...(previous?.error&&!(lessonShared&&quizShared)?{error:previous.error}:{}),
  };
 }
 await save();
 generationJobs.enqueue({scope,bookId:doc.id,documentId:doc.id,sectionId:doc.id,kind:'staff-auto',label:`${doc.title} · lessons and quizzes`},async(signal,progress)=>{
  const saved=await service.drafts();
  for(const m of modules){
   if(signal.aborted||await service.isRemoved(doc.id))throw Error('Preparation cancelled. Saved drafts are retained.');
   const state=states[m.id!];
   // Nothing left to do for this module, or it already failed. A failed module
   // is NOT retried automatically: it failed for a reason that another
   // identical attempt will not change (usually too little source text), and
   // retrying it on every pass is what made the app look like it regenerated
   // modules by itself. Open the module and generate to retry deliberately.
   const settled=(v?:string)=>v==='Shared'||v==='Ready for review'||v==='Failed'||v==='No source text'||v==='Front matter'||v==='Brief source — review';
   if(settled(state.lesson)&&settled(state.quiz))continue;
   if(m.source_missing||!m.source_text?.trim()){state.lesson='No source text';state.quiz='No source text';await save();continue;}
   // Front matter is read, never taught. Skipping it here is what stops a
   // chapter-objectives module reporting as Failed for the rest of time.
   if(isFrontMatter(m.title,m.source_text)){state.lesson='Front matter';state.quiz='Front matter';await save();continue;}
   // Front matter is retained in the outline, but is not enough grounded material for generation.
   if(m.source_text.trim().length<80){state.lesson='Brief source — review';state.quiz='Brief source — review';await save();continue;}
   try{
    const id=saved.find(d=>d.snapshot.remote_id===m.id)?.snapshot.module_id||m.id!;
    let draft=await service.ensure(id);
    if(draft.snapshot.source!==m.source_text)throw Error('Source changed. Open the module and refresh its source before generating.');
    for(const kind of ['lesson','quiz'] as const){
     if(signal.aborted)throw Error('Preparation cancelled.');
     // Skip anything already concluded for this kind, not just 'Shared'. A
     // lesson that failed must not be retried just because the quiz beside it
     // is still pending.
     if(settled(state[kind]))continue;
     draft=(await service.read(id))!;
     if(kind==='lesson'?draft.lesson:draft.questions?.length){state[kind]='Ready for review';await save();continue;}
     try{
      state[kind]='Generating';await save();progress(`${m.title} · ${kind}`);
      await service.generate(id,kind,signal,progress,Math.max(1,Math.min(5,Math.floor(m.source_text.trim().length/800))));
      state[kind]='Ready for review';
     }catch(e){if(signal.aborted)throw e;state[kind]='Failed';state.error=String(e instanceof Error?e.message:e);}
     await save();
    }
   }catch(e){if(signal.aborted)throw e;state.lesson=state.lesson==='Queued'?'Failed':state.lesson;state.quiz=state.quiz==='Queued'?'Failed':state.quiz;state.error=String(e instanceof Error?e.message:e);await save();}
  }
  // Failures are RECORDED, never thrown.
  //
  // This used to throw so the count surfaced in the UI. The caller's .catch
  // cleared its "already started this book" guard, its effect re-ran, and the
  // whole book started preparing again — which failed again, which cleared the
  // guard again. A single unprepared module put the app in a permanent
  // regeneration loop that looked like modules regenerating by themselves.
  //
  // Nothing is hidden by returning quietly: each module's own state already
  // holds 'Failed' plus its error, and the readiness table renders both.
  await save();
 });return true;
}
