import type {Document} from '@/api/types';
import {LocalAuthoring} from './local';
import {device} from '@/private/device';
import {generationJobs} from '@/private/jobs';
import {jobScope} from '@/private/useGenerationJobs';
import {Library} from '@/private/library';
export type Preparation={lesson?:string;quiz?:string;error?:string};
export type PreparationMap=Record<string,Preparation>;
const key=(service:LocalAuthoring,doc:Document)=>`${service.library.prefix}automatic:${doc.id}:${doc.content_version}`;
export async function preparation(service:LocalAuthoring,doc:Document){return await(await device()).get<PreparationMap>(key(service,doc))||{};}
/** One book job, sequential module operations, with durable progress and isolated failures. */
export async function prepareAutomatically(service:LocalAuthoring,doc:Document){
 const store=await device();service.library.guard();
 if(!(await store.status()).installed)return false;
 const scope=jobScope(new Library(service.library.owner).prefix);
 if(generationJobs.snapshot().some(j=>j.scope===scope&&j.bookId===doc.id&&j.kind==='staff-auto'&&['queued','running'].includes(j.state)))return true;
 const modules=(doc.chapters||[]).flatMap(c=>c.modules).filter(m=>m.id);
 const states=await preparation(service,doc);
 const save=async()=>{service.library.guard();await store.put(key(service,doc),states);};
 for(const m of modules)states[m.id!]={lesson:m.lesson_status==='ready'?'Shared':'Queued',quiz:['ready','held','checking','dismissed'].includes(m.quiz_status||'')?'Shared':'Queued'};
 await save();
 generationJobs.enqueue({scope,bookId:doc.id,sectionId:doc.id,kind:'staff-auto',label:`${doc.title} · lessons and quizzes`},async(signal,progress)=>{
  const saved=await service.drafts();
  for(const m of modules){
   if(signal.aborted)throw Error('Preparation cancelled. Saved drafts are retained.');
   const state=states[m.id!];
   if(state.lesson==='Shared'&&state.quiz==='Shared')continue;
   if(m.source_missing||!m.source_text?.trim()){state.lesson='No source text';state.quiz='No source text';await save();continue;}
   // Front matter is retained in the outline, but is not enough grounded material for generation.
   if(m.source_text.trim().length<80){state.lesson='Brief source — review';state.quiz='Brief source — review';await save();continue;}
   try{
    const id=saved.find(d=>d.snapshot.remote_id===m.id)?.snapshot.module_id||m.id!;
    let draft=await service.ensure(id);
    if(draft.snapshot.source!==m.source_text)throw Error('Source changed. Open the module and refresh its source before generating.');
    for(const kind of ['lesson','quiz'] as const){
     if(signal.aborted)throw Error('Preparation cancelled.');
     if(state[kind]==='Shared')continue;
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
  const failed=Object.values(states).filter(s=>s.lesson==='Failed'||s.quiz==='Failed').length;
  if(failed)throw Error(`${failed} module(s) need attention. Completed drafts are saved; open the affected modules to retry.`);
 });return true;
}
