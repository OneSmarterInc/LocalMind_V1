type SavedDraft={lesson?:unknown;questions?:unknown[]};
/** Persistence belongs to the module generator. Read fresh state on each restart. */
export async function runMissingBatch(options:{ids:string[];kind:'lesson'|'quiz';signal:AbortSignal;read:(id:string)=>Promise<SavedDraft|undefined>;generate:(id:string,kind:'lesson'|'quiz',signal:AbortSignal,progress:(message:string)=>void)=>Promise<unknown>;progress:(message:string)=>void}){
 const ids=[...new Set(options.ids)];
 for(let n=0;n<ids.length;n++){
  if(options.signal.aborted)throw Error('Generation cancelled. Completed modules are retained.');
  const draft=await options.read(ids[n]);
  if(!draft)throw Error('A saved module is missing. Save the book sources again.');
  if(options.kind==='lesson'?draft.lesson:draft.questions?.length)continue;
  await options.generate(ids[n],options.kind,options.signal,message=>options.progress(`Module ${n+1}/${ids.length} · ${message}`));
 }
}
