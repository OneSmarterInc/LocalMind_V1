import * as FS from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { AppState, Platform } from 'react-native';
import * as ExpoDevice from 'expo-device';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { getBackendDevicesInfo, initLlama, type LlamaContext } from 'llama.rn';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { toByteArray } from 'base64-js';
import { randomUUID } from 'expo-crypto';
import { parseNative } from './parserBridge';
import { MAX_BOOK_BYTES, makeReadingSections, requireThat } from './core';
import { CONTEXT_TOKENS, MAX_MODEL_BYTES, PHONE_MODELS, QUALITY_MODEL_MEMORY, type ModelSpec } from './modelSpec';
import { Exclusive, cancelled } from './busy';
import { nativeInferenceThreads } from './performance';
import type { Completion, Device } from './device.types';
import { backgroundWork } from './backgroundWork.native';

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
/** Total memory. Android: from the kernel, readable by any app. iOS blocks
 * /proc, so it reports through expo-device (the same physical RAM figure).
 * Undefined when neither is readable. */
async function memoryBytes(){
 try{const text=await FS.readAsStringAsync('file:///proc/meminfo');const kb=text.match(/MemTotal:\s+(\d+)\s*kB/);if(kb)return Number(kb[1])*1024;}catch{/* iOS: no /proc */}
 const total=ExpoDevice.totalMemory;return typeof total==='number' && total>0?total:undefined;
}
/** Unknown memory gets the fast model: it runs everywhere; quality is a choice. */
async function recommendedModel(){const memory=await memoryBytes();return {memory,id:memory!==undefined && memory>=QUALITY_MODEL_MEMORY?'quality':'fast'};}
async function accept(uri:string,name:string,progress:(n:number)=>void,signal?:AbortSignal,expected?:ModelSpec){
 const result=await verify(uri);requireThat(result.magic==='GGUF','Choose a real GGUF model file.');
 requireThat(result.bytes>0 && result.bytes<=MAX_MODEL_BYTES,'Choose a model under 1.8 GB.');
 if(expected)requireThat(result.bytes===expected.bytes && result.md5===expected.md5,'The downloaded model checksum did not match. The previous model was retained.');
 cancelled(signal);const old=await store.get<Installed>(MODEL_KEY);await close();
 // A verified download keeps the published SHA-256 as its identity (the MD5 of
 // those exact bytes is pinned next to it); an imported file is identified by its MD5.
 await store.put(MODEL_KEY,{uri,name,bytes:result.bytes,hash:expected?expected.sha256:`md5:${result.md5}`});
 if(old?.uri && old.uri!==uri)await FS.deleteAsync(old.uri,{idempotent:true}).catch(()=>{});progress(1);
}
/** Recover the JSON object from what a small model actually wrote.
 *
 * Qwen3 is a reasoning model and, when the schema grammar does not bind every
 * token, it wraps its answer: a ``<think>`` block, a markdown fence, or a
 * sentence of preamble. Parsing the raw text then failed with "Unexpected
 * character: `" or "Unexpected character: T" and the whole generation was
 * thrown away. The server's provider has always stripped these; the device
 * path did not. Nothing here repairs malformed JSON — it only finds where the
 * object starts and ends. */
export function extractJsonObject(raw:string){
 const text=raw.replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/<think>[\s\S]*$/i,'');
 // Candidates in order of trust: the text as written, then the contents of a
 // markdown fence. Taking the fence first would corrupt an answer that merely
 // quotes back-ticked code inside a string value.
 const candidates=[text];
 const fenced=text.match(/```(?:json)?\s*([\s\S]*?)```/i);
 if(fenced)candidates.push(fenced[1]);
 let failure:unknown;
 for(const candidate of candidates){
  const open=candidate.indexOf('{'),close=candidate.lastIndexOf('}');
  if(open<0||close<=open)continue;
  try{return JSON.parse(candidate.slice(open,close+1));}catch(e){failure=e;}
 }
 requireThat(false,failure?`The local model's answer could not be read: ${failure instanceof Error?failure.message:String(failure)}`:'The local model did not return a structured answer.');
}
type Accel={model:string;choice:'gpu'|'cpu';gpuTps?:number;cpuTps?:number;note?:string};
/** Android: llama.rn's GPU path (OpenCL) targets Qualcomm Adreno. Other phone
 * GPUs (Mali, PowerVR) are not candidates, so they are never forced onto the GPU.
 * iOS: every supported iPhone has Metal, which llama.rn uses for the GPU. The
 * one-time speed check below still decides, so the GPU is kept only when faster. */
async function gpuCandidate(){
 if(Platform.OS==='ios')return true;
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
 if(await gpuCandidate()){
  progress?.('Checking the fastest way to run the model on this phone (one time only)…');
  let gpuTps=0,cpuTps=0;
  try{gpuTps=await speed(options,99);}catch{gpuTps=0;}
  try{cpuTps=await speed(options,0);}catch{cpuTps=0;}
  result=gpuTps>cpuTps*1.1?{model:m.hash,choice:'gpu',gpuTps,cpuTps,note:`GPU chosen: ${gpuTps.toFixed(1)} vs ${cpuTps.toFixed(1)} tokens/s on CPU.`}
   :{model:m.hash,choice:'cpu',gpuTps,cpuTps,note:`CPU chosen: as fast or faster than the GPU on this phone (${cpuTps.toFixed(1)} vs ${gpuTps.toFixed(1)} tokens/s).`};
 }
 await store.put(ACCEL_KEY,result);return result;
}
/** Generation continues while the person uses other apps (backgroundWork).
 * Android keeps running under a foreground-service notification, GPU included.
 * iOS 26+ keeps running under a continued-processing task. iOS allows Metal in
 * the background only with background GPU access, so without it the model is
 * reloaded on the CPU while LocalMind is off screen and returns to the GPU for
 * the next answer once LocalMind is back.
 * Where iOS gives no background time (older iOS, or iOS ended the task), the
 * current answer stops before the app is suspended and starts again by itself
 * when LocalMind is opened: nothing saved is lost and nothing needs pressing. */
const iosBackgroundRules=Platform.OS==='ios';
const offScreen=()=>iosBackgroundRules && AppState.currentState==='background';
/** Thrown inside one attempt when the answer must be restarted, never shown. */
class Interrupted extends Error {}
function waitForForeground(signal:AbortSignal,progress?:(message:string)=>void){
 return new Promise<void>((resolve,reject)=>{
  if(!offScreen()){resolve();return;}
  progress?.('Paused while LocalMind is in the background. It continues by itself when you return.');
  const finish=()=>{subscription.remove();signal.removeEventListener('abort',abort);};
  const subscription=AppState.addEventListener('change',state=>{if(state==='active'){finish();resolve();}});
  const abort=()=>{finish();reject(new Error('Cancelled. Earlier saved material is unchanged.'));};
  signal.addEventListener('abort',abort);
 });
}
const KEEP_AWAKE_TAG='localmind-generation';
async function complete(req:Completion){
 await backgroundWork.enter();
 try{
  return await lock.queue(async()=>{
   for(;;){
    if(offScreen() && !backgroundWork.mayRunInBackground())await waitForForeground(req.signal,req.progress);
    try{return await answerOnce(req);}
    catch(e){if(e instanceof Interrupted && !req.signal.aborted)continue;throw e;}
   }
  },req.signal);
 }finally{backgroundWork.leave();}
}
let loadedLayers=-1;
async function answerOnce(req:Completion){
 cancelled(req.signal);const m=await store.get<Installed>(MODEL_KEY);requireThat(m,'Download or import a model in Offline AI first.');
 requireThat(m.uri.startsWith('file://'),'AI models must be stored locally.');
 // Reload when the model changed, or when the GPU/CPU choice must change:
 // off screen without background GPU access (iOS), or back on screen after that.
 const savedAccel=context&&loaded===m.uri?await store.get<Accel>(ACCEL_KEY):undefined;
 const gpuPreferred=savedAccel?.model===m.hash && savedAccel.choice==='gpu';
 const gpuAllowedNow=!offScreen() || backgroundWork.gpuInBackground();
 const layersWanted=gpuPreferred && gpuAllowedNow?99:0;
 if(context && loaded===m.uri && gpuPreferred && loadedLayers!==layersWanted)await close();
 if(!context||loaded!==m.uri){await close();await info(m.uri);const cores=Number((globalThis as typeof globalThis & {navigator?:{hardwareConcurrency?:number}}).navigator?.hardwareConcurrency);const threads=nativeInferenceThreads(cores);
  const options={model:m.uri,n_ctx:CONTEXT_TOKENS,n_threads:threads,use_mlock:false};
  // The one-time speed check needs the GPU, so it only runs on screen. Off
  // screen before it has run, use the CPU without recording a choice.
  const saved=await store.get<Accel>(ACCEL_KEY);
  const accel=offScreen()?(saved?.model===m.hash?saved:{model:m.hash,choice:'cpu' as const}):await chooseAccelerator(m,options,req.progress);cancelled(req.signal);
  const wantGpu=accel.choice==='gpu' && (!offScreen() || backgroundWork.gpuInBackground());
  if(accel.choice==='gpu' && !wantGpu)req.progress?.('Continuing on the CPU while LocalMind is in the background…');
  if(wantGpu){
   try {context=await initLlama({...options,n_gpu_layers:99});loadedLayers=99;}
   catch {cancelled(req.signal);context=await initLlama({...options,n_gpu_layers:0});loadedLayers=0;await store.put(ACCEL_KEY,{...accel,choice:'cpu',note:'GPU loading failed, so this phone now uses its CPU.'});}
  } else {context=await initLlama({...options,n_gpu_layers:0});loadedLayers=0;}
  loaded=m.uri;
 }
 cancelled(req.signal);
 req.progress?.('Reading the material on this phone…');backgroundWork.progress(0,'Reading the material…');
 const started=Date.now();
 const messages=[{role:'system',content:req.system},{role:'user',content:req.prompt}];
 // Render once without letting the completion chat-template path override grammar
 // settings. The postinstall patch also preserves grammar/stops across the native
 // 0.10.0 rewind; formatting the prompt alone cannot fix that runtime defect.
 const render=async(turns:typeof messages)=>(await context!.getFormattedChat(turns,undefined,{enable_thinking:false})).prompt;
 const prompt=await render(messages);
 const tokenized=await context.tokenize(prompt);
 requireThat(tokenized.tokens.length+req.maxTokens+48<=CONTEXT_TOKENS,'This prompt exceeds local model memory. Choose a shorter module.');
 // Abort only when the model stops producing text, never because a slow phone
 // is still working: up to 4 minutes to read the prompt, then 60 seconds of
 // silence between tokens. A fixed 3-minute cap aborted slower phones mid-answer.
 let expired=false,tokens=0,timer:ReturnType<typeof setTimeout>|undefined;const cancel=()=>{
  // llama.rn 0.10.0's JSI implementation returns void despite its Promise type.
  // The async wrapper handles void, rejected promises and synchronous throws.
  void (async()=>{await context?.stopCompletion();})().catch(()=>{});
 };
 const arm=(ms:number)=>{clearTimeout(timer);timer=setTimeout(()=>{expired=true;cancel();},ms);};
 // iOS only: stop this answer (to restart it) when LocalMind leaves the screen
 // without background time, or while it is using a GPU iOS will not allow in
 // the background, or when iOS ends the background task early.
 let interrupted=false;
 const interrupt=()=>{interrupted=true;cancel();};
 const onScreenChange=(state:string)=>{
  if(state!=='background')return;
  if(!backgroundWork.mayRunInBackground())interrupt();
  else if(context?.gpu && !backgroundWork.gpuInBackground())interrupt();
 };
 const appState=iosBackgroundRules?AppState.addEventListener('change',onScreenChange):undefined;
 const stopExpired=iosBackgroundRules?backgroundWork.onExpired(()=>{if(offScreen())interrupt();}):undefined;
 const checkInterrupted=()=>{if(interrupted)throw new Interrupted('restart');};
 // The screen must not lock during a long generation: a locked screen counts
 // as leaving LocalMind, which on older iPhones pauses the work.
 await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(()=>{});
 arm(240000);req.signal.addEventListener('abort',cancel);
 try {
  cancelled(req.signal);
  if(offScreen())onScreenChange('background');checkInterrupted();
  // grammar_lazy: false keeps the schema binding from the first token even if
  // the runtime would otherwise defer it.
  const schema=JSON.stringify(req.schema);
  const watch=()=>{arm(60000);tokens++;if(tokens%25===0){const percent=Math.min(99,Math.round(tokens/req.maxTokens*100));req.progress?.(`Writing on this phone… ${percent}%`);backgroundWork.progress(tokens/req.maxTokens,`Writing… ${percent}%`);}};
  const ask=async(text:string,temperature:number)=>{
   const base={prompt:text,n_predict:req.maxTokens,temperature,stop:['<|im_end|>','<|eot_id|>','</s>']};
   // Fail closed: a runtime/schema error must never silently disable grounding.
   const input=await context!.tokenize(text);
   requireThat(input.tokens.length+req.maxTokens+48<=CONTEXT_TOKENS,'This prompt exceeds local model memory. Choose a shorter module.');
   return await context!.completion({...base,json_schema:schema,grammar_lazy:false},watch);
  };
  let res=await ask(prompt,req.temperature);
  cancelled(req.signal);checkInterrupted();requireThat(!expired && !('stopped_limit' in res && res.stopped_limit),'Local AI did not finish. No partial answer was saved.');
  let restored:unknown;
  try{restored=extractJsonObject(res.text);}
  catch(first){
   // One correction pass at temperature 0, the same recovery the server's
   // provider makes, with the rejection reason in the conversation.
   console.info('[LocalMind AI] unusable output',{reason:first instanceof Error?first.message:String(first),sample:res.text.slice(0,240)});
   cancelled(req.signal);req.progress?.('Rewriting the answer in the required format…');
   tokens=0;arm(240000);
   res=await ask(await render([...messages,{role:'assistant',content:res.text.slice(0,600)},
    {role:'user',content:'That reply could not be read. Reply again with the JSON object only: no explanation, no reasoning, no markdown fences, nothing before or after it.'}]),0);
   cancelled(req.signal);checkInterrupted();requireThat(!expired && !('stopped_limit' in res && res.stopped_limit),'Local AI did not finish. No partial answer was saved.');
   restored=extractJsonObject(res.text);
  }
  console.info('[LocalMind AI]',{runtime:'native',runtimePatch:'grammar-stops-v1',validation:'json-parsed',accelerator:context.gpu?'gpu':'cpu',elapsedMs:Date.now()-started,outputCharacters:res.text.length});
  return restored;
 }catch(e){if(interrupted&&!req.signal.aborted)throw new Interrupted('restart');if(expired&&!req.signal.aborted)throw new Error('Local AI stopped responding. No incomplete response was saved. Completed lesson parts and quiz questions are retained; generate again to resume.');throw e;}finally{clearTimeout(timer);req.signal.removeEventListener('abort',cancel);appState?.remove();stopExpired?.();deactivateKeepAwake(KEEP_AWAKE_TAG);}
}
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
 async models(){const r=await recommendedModel();return {models:PHONE_MODELS,recommended:r.id,memoryBytes:r.memory};},
 download:(progress,signal,modelId)=>lock.run(async()=>{
  const wanted=modelId??(await recommendedModel()).id;
  const MODEL=PHONE_MODELS.find(m=>m.id===wanted)??PHONE_MODELS[0];
  await FS.makeDirectoryAsync(root,{intermediates:true});
  // Keep one unfinished download per published model. A dropped connection,
  // Cancel, or closing the app keeps the bytes; the next Download continues.
  const saved=await store.get<{uri:string;sha256:string}>(PARTIAL_KEY);
  let uri=saved?.sha256===MODEL.sha256?saved.uri:'';
  if(!uri){if(saved)await FS.deleteAsync(saved.uri,{idempotent:true}).catch(()=>{});uri=`${root}${randomUUID()}.gguf.part`;await store.put(PARTIAL_KEY,{uri,sha256:MODEL.sha256});}
  const discard=async()=>{await FS.deleteAsync(uri,{idempotent:true}).catch(()=>{});await store.removePrefix(PARTIAL_KEY);};
  const size=async()=>{const i=await FS.getInfoAsync(uri);return i.exists && !i.isDirectory?i.size:0;};
  let offset=await size();
  // Android resumes with a byte-range request from the saved size. iOS starts
  // again rather than risk appending at the wrong position, but downloads in a
  // background URLSession, so switching apps or locking the phone does not
  // interrupt it the way it would a foreground transfer.
  if(offset>MODEL.bytes || (offset>0 && Platform.OS!=='android')){await FS.deleteAsync(uri,{idempotent:true});offset=0;}
  if(offset<MODEL.bytes){
   const resume=offset>0?String(offset):undefined;
   const task=FS.createDownloadResumable(MODEL.url,uri,Platform.OS==='ios'?{sessionType:FS.FileSystemSessionType.BACKGROUND}:{},p=>progress(Math.min(0.97,p.totalBytesWritten/MODEL.bytes*0.97)),resume);
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
