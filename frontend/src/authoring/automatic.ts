import type {Document} from '@/api/types';
import {LocalAuthoring,isFrontMatter} from './local';
import {device} from '@/private/device';
import {generationJobs} from '@/private/jobs';
import {jobScope} from '@/private/useGenerationJobs';
import {Library} from '@/private/library';
import {control,controlKey,isHeld,notifyControls} from './bookControl';
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
 // "Pause all" is saved on the device: reopening the book must not restart it.
 if(await isHeld(service.library.prefix,doc.id))return false;
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
  const quizShared=['ready','held','checking','dismissed'].includes(m.quiz_status||'')||!!m.shared_quiz_id;
  // 'Generating' left over from a previous run means that run was interrupted
  // (tab closed, app reloaded) — nothing is generating now. Reset it to
  // 'Queued' so it is picked up again, rather than stranding the module in a
  // state nothing will ever move it out of.
  const carry=(v?:string)=>v==='Generating'?'Queued':v;  // 'Paused' is kept: the person chose it.
  states[m.id!]={
   lesson:lessonShared?'Shared':previous?.lesson==='Failed'?'Failed':carry(previous?.lesson)||'Queued',
   quiz:quizShared?'Shared':previous?.quiz==='Failed'?'Failed':carry(previous?.quiz)||'Queued',
   ...(previous?.error&&!(lessonShared&&quizShared)?{error:previous.error}:{}),
  };
 }
 await save();
 const ctl=control(controlKey(scope,doc.id));
 for(const m of modules){const st=states[m.id!];if((st.lesson==='Paused'||st.quiz==='Paused')&&!ctl.priority.includes(m.id!))ctl.paused.add(m.id!);}
 generationJobs.enqueue({scope,bookId:doc.id,documentId:doc.id,sectionId:doc.id,kind:'staff-auto',label:`${doc.title} · lessons and quizzes`},async(signal,progress)=>{
  const saved=await service.drafts();
  // Nothing left to do for a kind, or it already failed. A failed module is NOT
  // retried automatically: it failed for a reason another identical attempt
  // will not change. Open the module (or press Retry) to try again deliberately.
  const settled=(v?:string)=>v==='Shared'||v==='Ready for review'||v==='Failed'||v==='No source text'||v==='Front matter'||v==='Brief source — review';
  const pending=(m:typeof modules[number])=>{const st=states[m.id!];return !(settled(st.lesson)&&settled(st.quiz));};
  const attempted=new Set<string>();
  // Priority first ("Generate now"), then book order, skipping paused modules.
  const pick=()=>{
   while(ctl.priority.length){const m=modules.find(x=>x.id===ctl.priority[0]);if(m&&pending(m))return m;ctl.priority.shift();}
   return modules.find(m=>pending(m)&&!ctl.paused.has(m.id!)&&!attempted.has(m.id!));
  };
  const markPaused=async()=>{let changed=false;for(const id of ctl.paused){const st=states[id];if(!st)continue;for(const k of ['lesson','quiz'] as const)if(!settled(st[k])&&st[k]!=='Paused'){st[k]='Paused';changed=true;}}if(changed)await save();};
  const runModule=async(m:typeof modules[number],sig:AbortSignal)=>{
   const state=states[m.id!];
   for(const k of ['lesson','quiz'] as const)if(state[k]==='Paused')state[k]='Queued';
   if(m.source_missing||!m.source_text?.trim()){state.lesson='No source text';state.quiz='No source text';await save();return;}
   // Front matter is read, never taught.
   if(isFrontMatter(m.title,m.source_text)){state.lesson='Front matter';state.quiz='Front matter';await save();return;}
   if(m.source_text.trim().length<80){state.lesson='Brief source — review';state.quiz='Brief source — review';await save();return;}
   try{
    const id=saved.find(d=>d.snapshot.remote_id===m.id)?.snapshot.module_id||m.id!;
    let draft=await service.ensure(id);
    if(draft.snapshot.source!==m.source_text)throw Error('Source changed. Open the module and refresh its source before generating.');
    for(const kind of ['lesson','quiz'] as const){
     if(sig.aborted)throw Error('Preparation paused.');
     if(settled(state[kind]))continue;
     draft=(await service.read(id))!;
     if(kind==='lesson'?draft.lesson:draft.questions?.length){state[kind]='Ready for review';await save();continue;}
     try{
      state[kind]='Generating';await save();progress(`${m.title} · ${kind}`);
      // Resumes from the saved checkpoint: finished parts are never generated twice.
      await service.generate(id,kind,sig,progress,Math.max(1,Math.min(5,Math.floor(m.source_text.trim().length/800))));
      state[kind]='Ready for review';
     }catch(e){if(sig.aborted)throw e;state[kind]='Failed';state.error=String(e instanceof Error?e.message:e);}
     await save();
    }
   }catch(e){if(sig.aborted)throw e;state.lesson=state.lesson==='Queued'?'Failed':state.lesson;state.quiz=state.quiz==='Queued'?'Failed':state.quiz;state.error=String(e instanceof Error?e.message:e);await save();}
  };
  try{
   while(true){
    if(signal.aborted||await service.isRemoved(doc.id))throw Error('Preparation cancelled. Saved drafts are retained.');
    await markPaused();
    const m=pick();if(!m)break;
    ctl.priority=ctl.priority.filter(x=>x!==m.id);attempted.add(m.id!);
    const inner=new AbortController();const follow=()=>inner.abort();signal.addEventListener('abort',follow,{once:true});
    ctl.current={moduleId:m.id!,controller:inner};notifyControls();
    let reason:string|undefined;
    try{await runModule(m,inner.signal);}
    catch(e){if(signal.aborted||!inner.signal.aborted)throw e;}
    finally{signal.removeEventListener('abort',follow);reason=ctl.current?.reason;ctl.current=undefined;notifyControls();}
    if(!signal.aborted&&inner.signal.aborted){
     // Stopped between saved parts: keep the checkpoint and decide what happens next.
     const st=states[m.id!];
     for(const k of ['lesson','quiz'] as const)if(!settled(st[k]))st[k]=reason==='pause'?'Paused':'Queued';
     if(reason!=='pause')attempted.delete(m.id!);
     await save();
    }
   }
  }finally{ctl.current=undefined;notifyControls();}
  // Failures are RECORDED, never thrown: throwing restarted the whole book in a loop.
  await save();
 });return true;
}
