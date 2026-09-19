import {cancelled} from './busy';
export const MODEL_PART_BYTES=8*1024*1024;
export class RangeUnsupported extends Error {}
/** Parts are scoped by the pinned digest. The installer verifies the complete
 * SHA-256 before changing the installed model pointer. */
export async function downloadModelParts(options:{
 url:string;bytes:number;signal?:AbortSignal;progress:(fraction:number)=>void;
 read:(index:number)=>Promise<Blob|undefined>;write:(index:number,bytes:Uint8Array)=>Promise<Blob>;
 request?:typeof fetch;partBytes?:number;wait?:(ms:number,signal?:AbortSignal)=>Promise<void>;
}):Promise<Blob>{
 const {url,bytes,signal,read,write,progress}=options;
 const partBytes=options.partBytes||MODEL_PART_BYTES,parts:Blob[]=[];
 const request=options.request||fetch;
 const wait=options.wait||((ms,signal)=>new Promise<void>((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new Error('Download cancelled. Saved parts are retained.'));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 }));
 for(let start=0,index=0;start<bytes;start+=partBytes,index++){
  cancelled(signal);const end=Math.min(bytes,start+partBytes)-1,length=end-start+1;
  let part=await read(index);
  if(part?.size!==length){
   for(let attempt=0;attempt<3;attempt++){
    cancelled(signal);const controller=new AbortController(),abort=()=>controller.abort();
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    let timer=setTimeout(abort,60000);
    try{
     const response=await request(url,{headers:{Range:`bytes=${start}-${end}`},signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});
     if(response.status===200){await response.body?.cancel();throw new RangeUnsupported('This host requires a non-resumable download.');}
     if(response.status!==206){await response.body?.cancel();throw new Error(`Model download returned HTTP ${response.status}.`);}
     const range=response.headers.get('content-range');
     if(range&&range!==`bytes ${start}-${end}/${bytes}`){await response.body?.cancel();throw new Error('Model server returned the wrong byte range.');}
     if(!response.body)throw new Error('Model download contained no data.');
     const reader=response.body.getReader(),buffer=new Uint8Array(length);let size=0;
     try{while(true){cancelled(signal);clearTimeout(timer);timer=setTimeout(abort,60000);const item=await reader.read();if(item.done)break;if(size+item.value.length>length)throw new Error('Model part exceeded its expected size.');buffer.set(item.value,size);size+=item.value.length;}}
     finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
     if(size!==length)throw new Error('Model part was interrupted.');
     cancelled(signal);part=await write(index,buffer);break;
    }catch(e){
     cancelled(signal);
     if(e instanceof RangeUnsupported||e instanceof Error&&/quota|disk.*full/i.test(e.name+' '+e.message))throw e;
     if(attempt===2)throw new Error(`Model download paused. Saved parts are retained; choose Download again to resume. ${e instanceof Error?e.message:String(e)}`);
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    await wait((1000*2**attempt)*(0.8+Math.random()*0.4),signal);
   }
  }
  if(!part||part.size!==length)throw new Error('Model part could not be saved.');
  parts.push(part);progress(Math.min(0.85,(end+1)/bytes*0.85));
 }
 cancelled(signal);return new Blob(parts);
}

/** Compatibility for hosts/proxies that ignore Range. Stream to the same
 * checksum-verifying installer, with a bounded inactivity timeout, not RAM. */
export async function downloadModelStream(options:{url:string;signal?:AbortSignal;consume:(stream:ReadableStream<Uint8Array>)=>Promise<void>;request?:typeof fetch}){
 const {url,signal,consume}=options,controller=new AbortController();
 const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
 let timer:ReturnType<typeof setTimeout>|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 const arm=()=>{clearTimeout(timer);timer=setTimeout(abort,60000);};
 try{
  cancelled(signal);arm();
  const response=await(options.request||fetch)(url,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});
  if(!response.ok||!response.body){await response.body?.cancel();throw new Error(`Model download returned HTTP ${response.status}.`);}
  reader=response.body.getReader();
  const stream=new ReadableStream<Uint8Array>({
   async pull(target){try{cancelled(signal);arm();const item=await reader!.read();clearTimeout(timer);if(item.done)target.close();else target.enqueue(item.value);}catch(e){target.error(e);}},
   cancel(){abort();return reader!.cancel();}
  });
  await consume(stream);cancelled(signal);
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);abort();await reader?.cancel().catch(()=>{});reader?.releaseLock();}
}
