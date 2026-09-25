/** Refuse overlapping model/download operations; always release after errors. */
export class Exclusive {
  private busy=false;
  private waiting:(()=>void)[]=[];
  async queue<T>(fn:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
    cancelled(signal);
    return await new Promise<T>((resolve,reject)=>{
      const abort=()=>{const index=this.waiting.indexOf(start);if(index>=0){this.waiting.splice(index,1);reject(new Error('Cancelled'));}};
      const start=()=>{signal?.removeEventListener('abort',abort);this.busy=true;void(async()=>{try{cancelled(signal);resolve(await fn());}catch(e){reject(e);}finally{this.release();}})();};
      if(this.busy){this.waiting.push(start);signal?.addEventListener('abort',abort);}else start();
    });
  }
  private release(){this.busy=false;this.waiting.shift()?.();}
  async run<T>(fn:()=>Promise<T>):Promise<T> {
    if(this.busy) throw new Error('The local AI is busy. Finish or cancel the current task first.');
    this.busy=true;
    try { return await fn(); } finally { this.release(); }
  }
}
export function cancelled(signal?:AbortSignal) { if(signal?.aborted) throw new Error('Cancelled. Earlier saved material is unchanged.'); }
