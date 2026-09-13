/** Refuse overlapping model/download operations; always release after errors. */
export class Exclusive {
  private busy=false;
  async run<T>(fn:()=>Promise<T>):Promise<T> {
    if(this.busy) throw new Error('The local AI is busy. Finish or cancel the current task first.');
    this.busy=true;
    try { return await fn(); } finally { this.busy=false; }
  }
}
export function cancelled(signal?:AbortSignal) { if(signal?.aborted) throw new Error('Cancelled. Earlier saved material is unchanged.'); }
