/** Leave capacity for the UI; isolation is required for shared WASM memory. */
export function inferenceThreads(isolated:boolean, sharedMemory:boolean, cores:number):number {
  return isolated && sharedMemory ? Math.max(1, Math.min(4, Math.floor((Number.isFinite(cores) ? cores : 2) / 2))) : 1;
}
export type Checkpoint<T> = {id:string;parts:T[]};
/** Save validated parts only. A final version is published separately by the caller. */
export async function resumeParts<T>(options:{
  checkpoint:Checkpoint<T>;total:number;signal:AbortSignal;
  generate:(index:number,parts:T[])=>Promise<T>;
  save:(checkpoint:Checkpoint<T>)=>Promise<void>;
  progress?:(done:number)=>void;
}):Promise<T[]> {
  const {checkpoint,total,signal,generate,save,progress}=options;
  progress?.(checkpoint.parts.length);
  while(checkpoint.parts.length<total){
    if(signal.aborted)throw Error('Cancelled. Completed parts are saved; generate again to resume.');
    const part=await generate(checkpoint.parts.length,checkpoint.parts);
    if(signal.aborted)throw Error('Cancelled. Completed parts are saved; generate again to resume.');
    const next={id:checkpoint.id,parts:[...checkpoint.parts,part]};
    await save(next);checkpoint.parts=next.parts;progress?.(checkpoint.parts.length);
  }
  return checkpoint.parts;
}
