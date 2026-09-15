import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { MAX_BOOK_BYTES, makeSections, requireThat } from './core';
import { MODEL, MAX_MODEL_BYTES, CONTEXT_TOKENS } from './modelSpec';
import { inferenceThreads } from './performance';
import { Exclusive, cancelled } from './busy';
import type { Completion, Device, LocalFile } from './device.types';

type Engine = {
  loadModel(files:File[],opts:Record<string,unknown>):Promise<unknown>;
  createChatCompletion(opts:Record<string,unknown>):Promise<{choices:{finish_reason:string;message:{content:string}}[]}>;
  exit():Promise<void>;
  isMultithread?():boolean;
};
type Parser = { parse:(bytes:Uint8Array,name:string,signal?:AbortSignal,progress?:(message:string)=>void,saveVisual?:(visual:import('./core').SourceVisual)=>Promise<void>)=>Promise<import('./parserBridge').ParsedDocument> };
declare global { interface Window { __LM_WLLAMA__?:new (paths:Record<string,string>,options?:object)=>Engine; __LM_PARSER__?:Parser; } }
const MODEL_KEY='@model-v1';
let dbPromise:Promise<IDBDatabase>|undefined;
function db() {
  if(!dbPromise) dbPromise=new Promise((resolve,reject)=>{
    requireThat(typeof indexedDB!=='undefined','This browser does not provide private storage.');
    const r=indexedDB.open('localmind-private-library',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('records');
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
  return dbPromise;
}
async function transaction<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore)=>IDBRequest|void):Promise<T> {
  const d=await db();return new Promise((resolve,reject)=>{
    const t=d.transaction('records',mode); const r=run(t.objectStore('records'));
    t.oncomplete=()=>resolve(r?.result as T);
    t.onerror=()=>reject(t.error||new Error('Private storage failed. Check free space.'));
    t.onabort=()=>reject(t.error||new Error('Private storage save was interrupted.'));
  });
}
const store={
  get:<T,>(key:string)=>transaction<T|undefined>('readonly',s=>s.get(key)),
  put:(key:string,value:unknown)=>transaction<void>('readwrite',s=>s.put(value,key)),
  list:<T,>(prefix:string)=>transaction<T[]>('readonly',s=>s.getAll(IDBKeyRange.bound(prefix,prefix+'\uffff'))),
  removePrefix:(prefix:string)=>transaction<void>('readwrite',s=>s.delete(IDBKeyRange.bound(prefix,prefix+'\uffff'))),
};
const scripts=new Map<string,Promise<void>>();
function script(path:string):Promise<void> {
  if(!scripts.has(path)) scripts.set(path,new Promise((resolve,reject)=>{
    const tag=document.createElement('script');tag.type='module';tag.src=path;
    tag.onload=()=>resolve();tag.onerror=()=>{scripts.delete(path);tag.remove();reject(new Error('Offline AI application files are missing. Connect once and select “Check and save offline app files”.'));};
    document.head.appendChild(tag);
  })); return scripts.get(path)!;
}
async function files() {
  requireThat(window.isSecureContext && navigator.storage?.getDirectory,'Local AI needs HTTPS or localhost and a browser supporting device file storage.');
  const root=await navigator.storage.getDirectory(); return root.getDirectoryHandle('localmind-ai',{create:true});
}
async function fileOf(f:LocalFile):Promise<File> {
  requireThat(f.file,'Choose a file from this device. Remote book URLs cannot be used for private parsing.');
  requireThat(f.file.size>0 && f.file.size<=MAX_BOOK_BYTES,'Choose a nonempty book up to 35 MB.');return f.file;
}
type Installed={file:string;name:string;bytes:number;hash:string};
let engine:Engine|undefined, loaded:string|undefined;
const lock=new Exclusive();
async function close() { if(engine) {const e=engine;engine=undefined;loaded=undefined;await e.exit();} }
async function install(stream:ReadableStream<Uint8Array>,name:string,progress:(n:number)=>void,signal?:AbortSignal,expected?:{bytes:number;sha256:string}) {
  const folder=await files(); const temp=`model-${crypto.randomUUID()}.gguf`;
  const out=await (await folder.getFileHandle(temp,{create:true})).createWritable();
  const reader=stream.getReader(),hash=sha256.create();let size=0,head:number[]=[];
  try {
    while(true) {
      cancelled(signal);const {done,value}=await reader.read();if(done)break;
      size+=value.length;requireThat(size<=MAX_MODEL_BYTES,'This model exceeds the supported 1.8 GB file limit.');
      if(head.length<4)head.push(...value.slice(0,4-head.length)); hash.update(value);
      await out.write(value as Uint8Array<ArrayBuffer>);progress(Math.min(0.98,size/(expected?.bytes||MAX_MODEL_BYTES)));
    }
    requireThat(String.fromCharCode(...head)==='GGUF','This file is not a GGUF model.');
    const digest=bytesToHex(hash.digest());
    if(expected) requireThat(size===expected.bytes && digest===expected.sha256,'Model download did not pass the size/checksum check. Previous model retained.');
    cancelled(signal);await out.close();
    const old=await store.get<Installed>(MODEL_KEY);await close();
    await store.put(MODEL_KEY,{file:temp,name,bytes:size,hash:digest});
    if(old?.file) await folder.removeEntry(old.file).catch(()=>{});
    progress(1);
  } catch(e) { await reader.cancel().catch(()=>{}); await out.abort().catch(()=>{});await folder.removeEntry(temp).catch(()=>{});throw e; }
  finally {reader.releaseLock();}
}
let activeThreads=1;
async function complete(req:Completion) {
 req.progress?.("Waiting for the local model…");
 return lock.queue(async()=>{
  cancelled(req.signal); const info=await store.get<Installed>(MODEL_KEY);
  requireThat(info,'Download or import a local model in Offline AI first.');
  if(!engine || loaded!==info.file) {
    req.progress?.("Loading the model on this device…");
    await close(); await script('/private-assets/runtime-loader.js');
    requireThat(window.__LM_WLLAMA__,'The browser AI runtime could not be loaded.');
    const instance=new window.__LM_WLLAMA__({default:'/private-assets/wllama/esm/wasm/wllama.wasm'});
    try {
      const blob=await (await (await files()).getFileHandle(info.file)).getFile();
      activeThreads=inferenceThreads(globalThis.crossOriginIsolated,typeof SharedArrayBuffer!=='undefined',navigator.hardwareConcurrency);
      await instance.loadModel([blob],{n_ctx:CONTEXT_TOKENS,n_threads:activeThreads,n_gpu_layers:0});
      if(instance.isMultithread?.()===false)activeThreads=1;
      engine=instance;loaded=info.file;
    } catch(e) {await instance.exit().catch(()=>{});throw e;}
  }
  cancelled(req.signal);
  const abort=new AbortController();const cancel=()=>abort.abort();req.signal.addEventListener('abort',cancel);
  const started=Date.now();
  const report=()=>req.progress?.(`Generating with ${activeThreads} CPU thread${activeThreads===1?'':'s'} · ${Math.floor((Date.now()-started)/1000)}s`);
  report();const ticker=setInterval(report,1000);
  const timer=setTimeout(()=>abort.abort(),180000);
  try {
    // Context overflow is rejected by the runtime; never trim a stored module silently.
    const result=await engine!.createChatCompletion({messages:[{role:'system',content:req.system},{role:'user',content:req.prompt}],
      max_tokens:req.maxTokens,temperature:req.temperature,stream:false,abortSignal:abort.signal,
      chat_template_kwargs:{enable_thinking:false},response_format:{type:'json_schema',json_schema:{name:'study',schema:req.schema,strict:true}}});
    cancelled(req.signal); requireThat(!abort.signal.aborted,'Local AI timed out. No partial answer was saved.');
    const choice=result.choices[0];requireThat(choice && choice.finish_reason!=='length','The response was incomplete. Try fewer questions or a shorter module.');
    return JSON.parse(choice.message.content);
  } catch(e) {
    if(abort.signal.aborted&&!req.signal.aborted)throw new Error('Local AI timed out. No incomplete response was saved. Completed lesson parts and quiz questions are retained; generate again to resume.');
    throw e;
  } finally {clearInterval(ticker);clearTimeout(timer);req.signal.removeEventListener('abort',cancel);}
 },req.signal);
}
const implementation:Device={...store, complete,
 async parse(f, signal, progress, saveVisual) {
  const file=await fileOf(f); await script('/private-assets/parser.js');requireThat(window.__LM_PARSER__,'Local book parser is missing.');
  const bytes=new Uint8Array(await file.arrayBuffer());const hash=bytesToHex(sha256(bytes));
  const parsed=await window.__LM_PARSER__.parse(bytes,f.name,signal,progress,saveVisual?visual=>saveVisual(visual,hash):undefined);
  return {hash,sections:makeSections(parsed.items),warnings:parsed.warnings,visuals:parsed.visuals};
 },
 async downloadBook(url,headers,name,signal) {
  const r=await fetch(url,{headers,signal,cache:'no-store'});requireThat(r.ok,`Book download failed (${r.status}). Refresh the available books.`);
  requireThat(Number(r.headers.get('content-length')||0)<=MAX_BOOK_BYTES,'This book is too large.');
  requireThat(r.body,'Book download did not contain data.'); const reader=r.body.getReader();const parts:Uint8Array<ArrayBuffer>[]=[];let bytes=0;
  try {while(true){cancelled(signal);const x=await reader.read();if(x.done)break;bytes+=x.value.length;requireThat(bytes<=MAX_BOOK_BYTES,'This book exceeds 35 MB.');parts.push(x.value as Uint8Array<ArrayBuffer>);}}finally{await reader.cancel().catch(()=>{});}
  const file=new File(parts,name);return {name,uri:'device-selected',file,size:file.size};
 },
 async releaseFile(){/* A browser File is released by garbage collection. */},
 async status(){const m=await store.get<Installed>(MODEL_KEY);if(!m)return {installed:false};try {const f=await (await (await files()).getFileHandle(m.file)).getFile();return {installed:f.size===m.bytes,name:m.name,bytes:m.bytes,hash:m.hash,threads:activeThreads,loaded:loaded===m.file};}catch{return {installed:false};}},
 download:(progress,signal)=>lock.run(async()=>{cancelled(signal);const r=await fetch(MODEL.url,{signal,credentials:'omit',referrerPolicy:'no-referrer'});requireThat(r.ok && r.body,'Model download failed. The existing model is unchanged.');await install(r.body,MODEL.name,progress,signal,MODEL);}),
 importModel:(f,progress,signal)=>lock.run(async()=>{requireThat(f.file && /\.gguf$/i.test(f.name),'Choose a .gguf file');requireThat(f.file.size<=MAX_MODEL_BYTES,'Choose a GGUF under 1.8 GB.');await install(f.file.stream(),f.name,progress,signal);}),
 removeModel:()=>lock.run(async()=>{const m=await store.get<Installed>(MODEL_KEY);await close();await store.removePrefix(MODEL_KEY);if(m)await(await files()).removeEntry(m.file).catch(()=>{});}),
 async prepareOffline(){
   requireThat(window.isSecureContext && 'serviceWorker' in navigator,'Use HTTPS or localhost to install offline application files.');
   await navigator.storage.persist?.();
   const registration=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});
   await registration.update();
   const worker=registration.installing || registration.waiting || registration.active;
   requireThat(worker,'Offline application worker could not start.');
   if(!['installed','activated'].includes(worker.state)) await new Promise<void>((resolve,reject)=>{
     const timer=setTimeout(()=>{worker.removeEventListener('statechange',changed);reject(new Error('Offline preparation timed out. Check your connection and retry.'));},120000);
     const changed=()=>{if(['installed','activated'].includes(worker.state)){clearTimeout(timer);worker.removeEventListener('statechange',changed);resolve();}else if(worker.state==='redundant'){clearTimeout(timer);worker.removeEventListener('statechange',changed);reject(new Error('Offline preparation failed. Your previous offline copy is unchanged.'));}};
     worker.addEventListener('statechange',changed);changed();
   });
   return await new Promise<string>((resolve,reject)=>{
     const channel=new MessageChannel();
     const timer=setTimeout(()=>{channel.port1.close();reject(new Error('Offline files could not be saved yet. Check your connection and retry.'));},120000);
     channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();e.data.ok?resolve('Application files saved. Keep this browser profile and sign-in; then reopen the same address offline.'):reject(new Error(e.data.error||'Offline files were not completely saved.'));};
     worker.postMessage({type:'PREPARE_OFFLINE'},[channel.port2]);
   });
 }
};
export async function device():Promise<Device>{return implementation;}
