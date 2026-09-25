/** How many CPU threads wllama gets for on-device generation.
 *
 * Threading needs cross-origin isolation and SharedArrayBuffer; without both,
 * wllama runs single-threaded and there is nothing to tune. When they are
 * present we scale with the machine rather than pinning everyone at a flat 4:
 * a capable laptop should use more of what it has, a small one should not be
 * starved.
 *
 * Two constraints shape the formula and neither is arbitrary. First, leave a
 * couple of cores for the browser UI and the OS, or the page stutters while it
 * generates — so we reserve, rather than take half. Second, wllama's WASM
 * threading gives diminishing returns as threads climb, because coordinating
 * shared memory costs more the wider it spreads; past roughly 8 it is usually
 * slower, not faster. So the result is capped at 8.
 *
 *   cores  ->  threads
 *     2          1     (reserve wins; leaves 1 for the UI)
 *     4          2
 *     6          4
 *     8          6
 *    12          8
 *    16+         8     (cap)
 *
 * ``reserve`` and ``cap`` are arguments so this can be tuned or tested without
 * touching the call site.
 */
export function inferenceThreads(isolated:boolean, sharedMemory:boolean, cores:number, reserve=2, cap=8):number {
  if (!isolated || !sharedMemory) return 1;
  const total = Number.isFinite(cores) && cores > 0 ? Math.floor(cores) : 2;
  return Math.max(1, Math.min(cap, total - reserve));
}
/** Native runtimes do not always expose hardwareConcurrency. Use a conservative
 * four-thread fallback on modern phones/laptops, while still reserving cores and
 * capping inference so the UI and OS remain responsive. */
export function nativeInferenceThreads(cores?:number):number {
  const total=Number.isFinite(cores)&&Number(cores)>0?Math.floor(Number(cores)):6;
  return Math.max(2,Math.min(6,total-2));
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
