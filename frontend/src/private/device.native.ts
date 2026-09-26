import * as FS from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import { getBackendDevicesInfo, initLlama, type LlamaContext } from 'llama.rn';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { toByteArray } from 'base64-js';
import { randomUUID } from 'expo-crypto';
import { parseNative } from './parserBridge';
import { MAX_BOOK_BYTES, makeReadingSections, requireThat } from './core';
import { CONTEXT_TOKENS, MAX_MODEL_BYTES, MODEL } from './modelSpec';
import { Exclusive, cancelled } from './busy';
import { nativeInferenceThreads } from './performance';
import type { Completion, Device } from './device.types';

const root=`${FS.documentDirectory}localmind-private/`, MODEL_KEY='@model-v1';
// PARTIAL_KEY: the unfinished download kept between attempts. ACCEL_KEY: the
// CPU/GPU choice measured once per installed model on this phone.
const PARTIAL_KEY='@model-partial-v1', ACCEL_KEY='@model-accel-v1';
let database:Promise<SQLite.SQLiteDatabase>|undefined;
async function db(){
 if(!database)database=(async()=>{const d=await SQLite.openDatabaseAsync('localmind-private.db');await d.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS private_records (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)');return d;})();return database;
}
const store={
 async get<T>(key:string){const r=await(await db()).getFirstAsync<{value:string}>('SELECT value FROM private_records WHERE key=?',key);return r?JSON.parse(r.value) as T:undefined;},
 async put(key:string,value:unknown){await(await db()).runAsync('INSERT INTO private_records(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,JSON.stringify(value));},
 async list<T>(prefix:string){const r=await(await db()).getAllAsync<{value:string}>('SELECT value FROM private_records WHERE substr(key,1,?)=? ORDER BY key',prefix.length,prefix);return r.map(v=>JSON.parse(v.value) as T);},
 async removePrefix(prefix:string){await(await db()).runAsync('DELETE FROM private_records WHERE substr(key,1,?)=?',prefix.length,prefix);},
};
async function info(uri:string){const i=await FS.getInfoAsync(uri);requireThat(i.exists && !i.isDirectory,'The local file is missing.');return i;}
type Installed={uri:string;name:string;bytes:number;hash:string};
let context:LlamaContext|undefined,loaded:string|undefined;
const lock=new Exclusive();
async function close(){if(context){const c=context;context=undefined;loaded=undefined;await c.release();}}
/** Verify with the platform's native MD5 (seconds) instead of SHA-256 in
 * JavaScript (minutes on a phone, which looked like a hang after 85%). */
async function verify(uri:string){
 const i=await FS.getInfoAsync(uri,{md5:true});requireThat(i.exists && !i.isDirectory,'The local file is missing.');
 const head=toByteArray(await FS.readAsStringAsync(uri,{encoding:FS.EncodingType.Base64,position:0,length:4}));
 return {bytes:i.size,md5:(i.md5||'').toLowerCase(),magic:String.fromCharCode(...head)};
}
async function accept(uri:string,name:string,progress:(n:number)=>void,signal?:AbortSignal,expected?:typeof MODEL){
 const result=await verify(uri);requireThat(result.magic==='GGUF','Choose a real GGUF model file.');
 requireThat(result.bytes>0 && result.bytes<=MAX_MODEL_BYTES,'Choose a model under 1.8 GB.');
 if(expected)requireThat(result.bytes===expected.bytes && result.md5===expected.md5,'The downloaded model checksum did not match. The previous model was retained.');
 cancelled(signal);const old=await store.get<Installed>(MODEL_KEY);await close();
 // A verified download keeps the published SHA-256 as its identity (the MD5 of
 // those exact bytes is pinned next to it); an imported file is identified by its MD5.
 await store.put(MODEL_KEY,{uri,name,bytes:result.bytes,hash:expected?expected.sha256:`md5:${result.md5}`});
 if(old?.uri && old.uri!==uri)await FS.deleteAsync(old.uri,{idempotent:true}).catch(()=>{});progress(1);
}
type Accel={model:string;choice:'gpu'|'cpu';gpuTps?:number;cpuTps?:number;note?:string};
/** llama.rn's GPU path (OpenCL) targets Qualcomm Adreno. Other phone GPUs
 * (Mali, PowerVR) are not candidates, so they are never forced onto the GPU. */
async function adrenoAvailable(){
 try{return (await getBackendDevicesInfo()).some(d=>/gpu/i.test(d.type) && /adreno/i.test(d.deviceName));}catch{return false;}
}
async function speed(options:object,layers:number){
 const c=await initLlama({...options,n_gpu_layers:layers} as Parameters<typeof initLlama>[0]);
 try{
  if(layers>0 && !c.gpu)return 0;
  const r=await c.completion({messages:[{role:'user',content:'Write one short sentence about reading.'}],n_predict:32,temperature:0,enable_thinking:false});
  return r.timings?.predicted_per_second||0;
 }finally{await c.release().catch(()=>{});}
}
/** Decide once per installed model: GPU only where it is supported and measurably faster. */
async function chooseAccelerator(m:Installed,options:object,progress?:(message:string)=>void):Promise<Accel>{
 const saved=await store.get<Accel>(ACCEL_KEY);if(saved?.model===m.hash)return saved;
 let result:Accel={model:m.hash,choice:'cpu',note:'Running on this phone’s CPU.'};
 if(await adrenoAvailable()){
  progress?.('Checking the fastest way to run the model on this phone (one time only)…');
  let gpuTps=0,cpuTps=0;
  try{gpuTps=await speed(options,99);}catch{gpuTps=0;}
  try{cpuTps=await speed(options,0);}catch{cpuTps=0;}
  result=gpuTps>cpuTps*1.1?{model:m.hash,choice:'gpu',gpuTps,cpuTps,note:`GPU chosen: ${gpuTps.toFixed(1)} vs ${cpuTps.toFixed(1)} tokens/s on CPU.`}
   :{model:m.hash,choice:'cpu',gpuTps,cpuTps,note:`CPU chosen: as fast or faster than the GPU on this phone (${cpuTps.toFixed(1)} vs ${gpuTps.toFixed(1)} tokens/s).`};
 }
 await store.put(ACCEL_KEY,result);return result;
}
async function complete(req:Completion){return lock.queue(async()=>{
 cancelled(req.signal);const m=await store.get<Installed>(MODEL_KEY);requireThat(m,'Download or import a model in Offline AI first.');
 requireThat(m.uri.startsWith('file://'),'AI models must be stored locally.');
 if(!context||loaded!==m.uri){await close();await info(m.uri);const cores=Number((globalThis as typeof globalThis & {navigator?:{hardwareConcurrency?:number}}).navigator?.hardwareConcurrency);const threads=nativeInferenceThreads(cores);
  const options={model:m.uri,n_ctx:CONTEXT_TOKENS,n_threads:threads,use_mlock:false};
  const accel=await chooseAccelerator(m,options,req.progress);cancelled(req.signal);
  if(accel.choice==='gpu'){
   try {context=await initLlama({...options,n_gpu_layers:99});}
   catch {cancelled(req.signal);context=await initLlama({...options,n_gpu_layers:0});await store.put(ACCEL_KEY,{...accel,choice:'cpu',note:'GPU loading failed, so this phone now uses its CPU.'});}
  } else context=await initLlama({...options,n_gpu_layers:0});
  loaded=m.uri;
 }
 cancelled(req.signal);
 req.progress?.('Reading the material on this phone…');
 const started=Date.now();
 const messages=[{role:'system',content:req.system},{role:'user',content:req.prompt}];
 const formatted=await context.getFormattedChat(messages,undefined,{enable_thinking:false});
 const tokenized=await context.tokenize(formatted.prompt);
 requireThat(tokenized.tokens.length+req.maxTokens+48<=CONTEXT_TOKENS,'This prompt exceeds local model memory. Choose a shorter module.');
 // Abort only when the model stops producing text, never because a slow phone
 // is still working: up to 4 minutes to read the prompt, then 60 seconds of
 // silence between tokens. A fixed 3-minute cap aborted slower phones mid-answer.
 let expired=false,tokens=0,timer:ReturnType<typeof setTimeout>|undefined;const cancel=()=>{void context?.stopCompletion().catch(()=>{});};
 const arm=(ms:number)=>{clearTimeout(timer);timer=setTimeout(()=>{expired=true;cancel();},ms);};
 arm(240000);req.signal.addEventListener('abort',cancel);
 try {
  cancelled(req.signal);
  const res=await context.completion({messages,n_predict:req.maxTokens,temperature:req.temperature,enable_thinking:false,
   response_format:{type:'json_object',schema:req.schema},stop:['<|im_end|>','<|eot_id|>','</s>']},()=>{
    arm(60000);tokens++;if(tokens%25===0)req.progress?.(`Writing on this phone… ${Math.min(99,Math.round(tokens/req.maxTokens*100))}%`);
   });
  cancelled(req.signal);requireThat(!expired && !('stopped_limit' in res && res.stopped_limit),'Local AI did not finish. No partial answer was saved.');const restored=JSON.parse(res.text);
  console.info('[LocalMind AI]',{runtime:'native',accelerator:context.gpu?'gpu':'cpu',elapsedMs:Date.now()-started,outputCharacters:res.text.length});
  return restored;
 }catch(e){if(expired&&!req.signal.aborted)throw new Error('Local AI stopped responding. No incomplete response was saved. Completed lesson parts and quiz questions are retained; generate again to resume.');throw e;}finally{clearTimeout(timer);req.signal.removeEventListener('abort',cancel);}
},req.signal);}
const implementation:Device={...store,complete,
 async parse(f, signal, progress, saveVisual){
  const i=await info(f.uri);requireThat(i.size<=MAX_BOOK_BYTES,'Import a book up to 100 MB.');
  const base64=await FS.readAsStringAsync(f.uri,{encoding:FS.EncodingType.Base64});
  const hash=bytesToHex(sha256(toByteArray(base64)));const parsed=await parseNative(f.name,base64,signal,progress,saveVisual?visual=>saveVisual(visual,hash):undefined);
  return {hash,sections:makeReadingSections(parsed.items),warnings:parsed.warnings,visuals:parsed.visuals};
 },
 async downloadBook(url,headers,name,signal){
  const uri=`${FS.cacheDirectory}private-book-${randomUUID()}`;
  const task=FS.createDownloadResumable(url,uri,{headers},p=>{if(p.totalBytesWritten>MAX_BOOK_BYTES)void task.cancelAsync();});
  const cancel=()=>{void task.cancelAsync();};signal.addEventListener('abort',cancel);
  try{cancelled(signal);const r=await task.downloadAsync();cancelled(signal);requireThat(r && r.status===200,'Book download failed. Refresh the catalogue.');const i=await info(uri);requireThat(i.size<=MAX_BOOK_BYTES,'Book exceeds 100 MB.');return {name,uri,size:i.size};}
  catch(e){await FS.deleteAsync(uri,{idempotent:true}).catch(()=>{});throw e;}finally{signal.removeEventListener('abort',cancel);}
 },
 async releaseFile(f){if(f.uri.startsWith(`${FS.cacheDirectory}private-book-`))await FS.deleteAsync(f.uri,{idempotent:true});},
 async status(){const m=await store.get<Installed>(MODEL_KEY);if(!m)return {installed:false};const i=await FS.getInfoAsync(m.uri);return {installed:i.exists && !i.isDirectory && i.size===m.bytes,name:m.name,bytes:m.bytes,hash:m.hash,loaded:loaded===m.uri,...(context&&loaded===m.uri?{accelerator:context.gpu?'gpu' as const:'cpu' as const,accelerationNote:(await store.get<Accel>(ACCEL_KEY))?.note}: {})};},
 download:(progress,signal)=>lock.run(async()=>{
  await FS.makeDirectoryAsync(root,{intermediates:true});
  // Keep one unfinished download per published model. A dropped connection,
  // Cancel, or closing the app keeps the bytes; the next Download continues.
  const saved=await store.get<{uri:string;sha256:string}>(PARTIAL_KEY);
  let uri=saved?.sha256===MODEL.sha256?saved.uri:'';
  if(!uri){if(saved)await FS.deleteAsync(saved.uri,{idempotent:true}).catch(()=>{});uri=`${root}${randomUUID()}.gguf.part`;await store.put(PARTIAL_KEY,{uri,sha256:MODEL.sha256});}
  const discard=async()=>{await FS.deleteAsync(uri,{idempotent:true}).catch(()=>{});await store.removePrefix(PARTIAL_KEY);};
  const size=async()=>{const i=await FS.getInfoAsync(uri);return i.exists && !i.isDirectory?i.size:0;};
  let offset=await size();
  // Android resumes with a byte-range request from the saved size. Other
  // platforms start again rather than risk appending at the wrong position.
  if(offset>MODEL.bytes || (offset>0 && Platform.OS!=='android')){await FS.deleteAsync(uri,{idempotent:true});offset=0;}
  if(offset<MODEL.bytes){
   const resume=offset>0?String(offset):undefined;
   const task=FS.createDownloadResumable(MODEL.url,uri,{},p=>progress(Math.min(0.97,p.totalBytesWritten/MODEL.bytes*0.97)),resume);
   const cancel=()=>{void task.cancelAsync();};signal.addEventListener('abort',cancel);
   try{
    cancelled(signal);const r=await task.downloadAsync();cancelled(signal);
    requireThat(r,'Download paused. Choose Download again to continue.');
    // 200 on a resumed request means the host ignored the range and sent the
    // whole file again after the saved part: that copy is unusable.
    if(resume && r.status===200){await discard();throw new Error('The download host restarted the file. Choose Download again to start over.');}
    requireThat(r.status===(resume?206:200),`The model download failed (HTTP ${r.status}).`);
   }catch(e){
    if(e instanceof Error && /restarted the file/.test(e.message))throw e;
    const at=Math.round(await size()/MODEL.bytes*100);
    if(signal.aborted)throw new Error(`Download paused at ${at}%. Choose Download again to continue.`);
    throw new Error(`Download paused at ${at}% (${e instanceof Error?e.message:String(e)}). Choose Download again to continue from there.`);
   }finally{signal.removeEventListener('abort',cancel);}
  }
  progress(0.98);
  const final=uri.replace(/\.part$/,'');
  try{
   requireThat(await size()===MODEL.bytes,'The downloaded model is incomplete. Choose Download again to continue.');
   if(final!==uri){await FS.deleteAsync(final,{idempotent:true});await FS.moveAsync({from:uri,to:final});}
   await accept(final,MODEL.name,p=>progress(0.98+p*0.02),signal,MODEL);
   await store.removePrefix(PARTIAL_KEY);
  }catch(e){await FS.deleteAsync(final,{idempotent:true}).catch(()=>{});await discard();throw e;}
 }),
 importModel:(f,progress,signal)=>lock.run(async()=>{
  requireThat(/\.gguf$/i.test(f.name),'Choose a GGUF model.');const i=await info(f.uri);requireThat(i.size<=MAX_MODEL_BYTES,'Choose a model under 1.8 GB.');
  await FS.makeDirectoryAsync(root,{intermediates:true});const uri=`${root}${randomUUID()}.gguf`;
  try{cancelled(signal);await FS.copyAsync({from:f.uri,to:uri});await accept(uri,f.name,progress,signal);}catch(e){await FS.deleteAsync(uri,{idempotent:true}).catch(()=>{});throw e;}
 }),
 removeModel:()=>lock.run(async()=>{const m=await store.get<Installed>(MODEL_KEY);await close();await store.removePrefix(MODEL_KEY);if(m)await FS.deleteAsync(m.uri,{idempotent:true});}),
 async prepareOffline(){return 'Use an installed release build, not an Expo Go/development session. The release includes its application files. Keep your sign-in, downloaded model and books on this device.';},
 async storage(){return {location:'app' as const,path:root,canChooseFolder:false,persistent:true};},
};
export async function device():Promise<Device>{return implementation;}
