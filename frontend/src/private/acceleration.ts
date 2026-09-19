/** GPU status is based on runtime evidence, never just navigator.gpu existing. */
export type Acceleration = { accelerator:'gpu'|'cpu'|'unconfirmed'; gpuLayers?:number; accelerationNote?:string };
export function offloadedLayers(args:unknown[]):number|undefined {
  for(const arg of args) {
    if(typeof arg!=='string')continue;
    const match=arg.match(/offloaded\s+(\d+)\/\d+\s+layers to GPU/i);
    if(match)return Number(match[1]);
  }
}
export async function loadAccelerated<T>(options:{
  create:(observe:(...args:unknown[])=>void)=>T;
  load:(engine:T,layers:number)=>Promise<unknown>;
  dispose:(engine:T)=>Promise<void>;
  signal:AbortSignal;
  gpuAvailable:boolean;
  progress?:(message:string)=>void;
}):Promise<{engine:T;status:Acceleration}> {
  let fallback=false;
  for(const layers of options.gpuAvailable?[99,0]:[0]) {
    options.signal.throwIfAborted();
    let observed:number|undefined;
    const engine=options.create((...args)=>{const value=offloadedLayers(args);if(value!==undefined)observed=value;});
    try {
      options.progress?.(layers?'Loading the model on this device’s GPU…':'Loading the model on this device’s CPU…');
      await options.load(engine,layers);
      options.signal.throwIfAborted();
      const accelerator=layers===0||observed===0?'cpu':observed!==undefined?'gpu':'unconfirmed';
      return {engine,status:{accelerator,gpuLayers:observed,accelerationNote:
        accelerator==='gpu'?undefined:accelerator==='unconfirmed'?'GPU requested; the runtime did not confirm layer offloading.':
        fallback?'GPU loading failed. Using this device’s CPU. Close GPU-heavy applications and reload to retry.':
        'GPU unavailable to this runtime. Check browser hardware acceleration, browser updates and graphics drivers.'}};
    } catch(error) {
      await options.dispose(engine).catch(()=>{});
      options.signal.throwIfAborted();
      if(!layers)throw error;
      fallback=true;
    }
  }
  throw new Error('Local model could not be loaded.');
}
export function accelerationLabel(status:Acceleration,threads?:number):string {
  if(status.accelerator==='gpu')return `GPU${status.gpuLayers?` · ${status.gpuLayers} layers`:''}`;
  if(status.accelerator==='unconfirmed')return 'GPU requested (unconfirmed)';
  return `CPU${threads?` · ${threads} thread${threads===1?'':'s'}`:''}`;
}
