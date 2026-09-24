import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { MAX_BOOK_BYTES, makeReadingSections, requireThat } from './core';
import { MODEL, MAX_MODEL_BYTES, CONTEXT_TOKENS } from './modelSpec';
import { exceedsContext, CONTEXT_OVERFLOW_MESSAGE } from './promptBudget';
import { PARSER_ASSET } from './generated/parserAsset';
import { loadAccelerated, accelerationLabel, type Acceleration } from './acceleration';
import { inferenceThreads } from './performance';
import { Exclusive, cancelled } from './busy';
import type { Completion, Device, LocalFile } from './device.types';
import {downloadModelParts,downloadModelStream,RangeUnsupported} from './download';

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
/* ---------------------------------------------------------------------------
 * Book reading without a connection.
 *
 * The parser (PDF/DOCX reader, OCR worker and English OCR data in one file) needs
 * nothing from the network once it is loaded, but loading it does. The service
 * worker keeps it only on HTTPS or localhost: browsers refuse service workers on a
 * plain-http LAN address, which is exactly how a campus server is usually reached.
 * So a copy is also kept in IndexedDB, which every origin has, and used when the
 * normal load fails. The file name carries the first 20 hex digits of its SHA-256
 * (see scripts/prepare-private-assets.mjs); a copy is saved and used only when its
 * bytes produce that same digest, so a proxy error page or a stale file can never
 * be run as the parser.
 * ------------------------------------------------------------------------- */
const PARSER_COPY_KEY='@parser-copy-v1';
type ParserCopy={asset:string;code:string};
const parserDigest=(asset:string)=>/parser-([a-f0-9]{20})\.js$/.exec(asset)?.[1];
const matchesAsset=(code:string,asset:string)=>{const want=parserDigest(asset);return !!want&&bytesToHex(sha256(new TextEncoder().encode(code))).slice(0,20)===want;};
/** Save this build's parser for offline use. Cheap when it is already saved. */
async function saveParserCopy():Promise<void>{
  const saved=await store.get<ParserCopy>(PARSER_COPY_KEY).catch(()=>undefined);
  if(saved?.asset===PARSER_ASSET)return;
  const r=await fetch(PARSER_ASSET,{cache:'no-cache'});requireThat(r.ok,`The book reader could not be downloaded (${r.status}).`);
  const code=await r.text();requireThat(matchesAsset(code,PARSER_ASSET),'The downloaded book reader did not pass its integrity check. Nothing was saved.');
  await store.put(PARSER_COPY_KEY,{asset:PARSER_ASSET,code} satisfies ParserCopy);
}
function blobScript(code:string):Promise<void>{
  const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
  return new Promise<void>((resolve,reject)=>{
    const tag=document.createElement('script');tag.type='module';tag.src=url;
    tag.onload=()=>{URL.revokeObjectURL(url);resolve();};
    tag.onerror=()=>{URL.revokeObjectURL(url);tag.remove();reject(new Error('The saved book reader could not start.'));};
    document.head.appendChild(tag);
  });
}
async function loadParser():Promise<Parser>{
  if(window.__LM_PARSER__)return window.__LM_PARSER__;
  try{await script(PARSER_ASSET);}
  catch(networkError){
    const saved=await store.get<ParserCopy>(PARSER_COPY_KEY).catch(()=>undefined);
    if(!saved||saved.asset!==PARSER_ASSET||!matchesAsset(saved.code,PARSER_ASSET))
      throw new Error('The book reader is not saved on this device yet. Open LocalMind once while connected, then import again.',{cause:networkError});
    await blobScript(saved.code);
  }
  const parser=window.__LM_PARSER__;requireThat(parser,'Local book parser is missing.');return parser;
}
async function files() {
  requireThat(window.isSecureContext && navigator.storage?.getDirectory,'Local AI needs HTTPS or localhost and a browser supporting device file storage.');
  const root=await navigator.storage.getDirectory(); return root.getDirectoryHandle('localmind-ai',{create:true});
}
/** Optional model folder chosen by the user (File System Access API, Chrome and
 * Edge on desktop). The handle is kept in IndexedDB; the browser stores it
 * with its permission. Without a folder, the browser's private storage is used. */
const FOLDER_KEY='@model-folder-v1';
type Permission='granted'|'denied'|'prompt';
type FolderHandle=FileSystemDirectoryHandle&{queryPermission?(o:{mode:'readwrite'}):Promise<Permission>;requestPermission?(o:{mode:'readwrite'}):Promise<Permission>};
type Picker=(o:{id?:string;mode?:'readwrite';startIn?:string})=>Promise<FolderHandle>;
const canChooseFolder=()=>typeof window!=='undefined'&&typeof (window as unknown as {showDirectoryPicker?:Picker}).showDirectoryPicker==='function';
async function permission(h:FolderHandle):Promise<Permission>{return h.queryPermission?await h.queryPermission({mode:'readwrite'}):'granted';}
class FolderAccessNeeded extends Error{constructor(){super('Allow access to your model folder in Offline AI, or switch back to browser storage.');}}
async function modelFolder():Promise<FolderHandle|undefined>{return store.get<FolderHandle>(FOLDER_KEY);}
/** The directory holding (or about to hold) the model for ``location``. */
async function dirFor(location?:'browser'|'folder'):Promise<FileSystemDirectoryHandle>{
  if(location!=='folder')return files();
  const h=await modelFolder();if(!h||await permission(h)!=='granted')throw new FolderAccessNeeded();return h;
}
/** New installs go wherever the user last chose. */
async function target():Promise<{dir:FileSystemDirectoryHandle;location:'browser'|'folder'}>{
  return (await modelFolder())?{dir:await dirFor('folder'),location:'folder'}:{dir:await files(),location:'browser'};
}
async function fileOf(f:LocalFile):Promise<File> {
  requireThat(f.file,'Choose a file from this device. Remote book URLs cannot be used for private parsing.');
  requireThat(f.file.size>0 && f.file.size<=MAX_BOOK_BYTES,'Choose a nonempty book up to 100 MB.');return f.file;
}
type Installed={file:string;name:string;bytes:number;hash:string;location?:'browser'|'folder'};
let engine:Engine|undefined, loaded:string|undefined;
const lock=new Exclusive();
async function close() { if(engine) {const e=engine;engine=undefined;loaded=undefined;await e.exit();} }
async function install(stream:ReadableStream<Uint8Array>,name:string,progress:(n:number)=>void,signal?:AbortSignal,expected?:{bytes:number;sha256:string}) {
  const {dir:folder,location}=await target(); const temp=`model-${crypto.randomUUID()}.gguf`;
  const out=await (await folder.getFileHandle(temp,{create:true})).createWritable();
  const reader=stream.getReader(),hash=sha256.create();let size=0,head:number[]=[];
  const abort=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
  try {
    while(true) {
      cancelled(signal);const {done,value}=await reader.read();if(done)break;
      size+=value.length;requireThat(size<=MAX_MODEL_BYTES,'This model exceeds the supported 1.8 GB file limit.');
      if(head.length<4)head.push(...value.slice(0,4-head.length)); hash.update(value);
      await out.write(value as Uint8Array<ArrayBuffer>);progress(Math.min(0.98,size/(expected?.bytes||MAX_MODEL_BYTES)));
    }
    cancelled(signal);requireThat(String.fromCharCode(...head)==='GGUF','This file is not a GGUF model.');
    const digest=bytesToHex(hash.digest());
    if(expected) requireThat(size===expected.bytes && digest===expected.sha256,'Model download did not pass the size/checksum check. Previous model retained.');
    cancelled(signal);await out.close();
    const old=await store.get<Installed>(MODEL_KEY);await close();
    // In a user-visible folder, give the file its real name when the browser
    // can rename (FileSystemHandle.move); otherwise keep the unique temp name.
    let file=temp;
    if(location==='folder'&&old?.file!==name){
      const handle=await folder.getFileHandle(temp) as FileSystemFileHandle&{move?(name:string):Promise<void>};
      if(handle.move)try{await folder.removeEntry(name).catch(()=>{});await handle.move(name);file=name;}catch{/* keep temp name */}
    }
    await store.put(MODEL_KEY,{file,name,bytes:size,hash:digest,location});
    if(old?.file&&!(old.file===file&&(old.location||'browser')===location)) await (await dirFor(old.location).catch(()=>undefined))?.removeEntry(old.file).catch(()=>{});
    progress(1);
  } catch(e) { await reader.cancel().catch(()=>{}); await out.abort().catch(()=>{});await folder.removeEntry(temp).catch(()=>{});throw e; }
  finally {signal?.removeEventListener('abort',abort);reader.releaseLock();}
}
async function download(progress:(n:number)=>void,signal?:AbortSignal){
 const run=()=>lock.run(async()=>{
  cancelled(signal);const folder=(await target()).dir,partialName=`download-${MODEL.sha256}`;
  const partial=await folder.getDirectoryHandle(partialName,{create:true});
  try{
   try{
    const blob=await downloadModelParts({url:MODEL.url,bytes:MODEL.bytes,signal,progress,
     read:async index=>{try{return await(await partial.getFileHandle(String(index))).getFile();}catch(e){if(e instanceof DOMException&&e.name==='NotFoundError')return undefined;throw e;}},
     write:async(index,bytes)=>{const handle=await partial.getFileHandle(String(index),{create:true}),out=await handle.createWritable();try{await out.write(bytes as Uint8Array<ArrayBuffer>);await out.close();}catch(e){await out.abort().catch(()=>{});throw e;}return handle.getFile();}
    });
    await install(blob.stream(),MODEL.name,n=>progress(0.85+n*0.15),signal,MODEL);
   }catch(e){
    if(!(e instanceof RangeUnsupported))throw e;
    await downloadModelStream({url:MODEL.url,signal,consume:stream=>install(stream,MODEL.name,progress,signal,MODEL)});
   }
   await folder.removeEntry(partialName,{recursive:true}).catch(()=>{});
  }catch(e){
   if(e instanceof Error&&/checksum|not a GGUF/.test(e.message))await folder.removeEntry(partialName,{recursive:true}).catch(()=>{});
   if(e instanceof Error&&/quota|disk.*full/i.test(e.name+' '+e.message))throw new Error('Insufficient device storage for the model. Free space and retry; your installed model is unchanged. Download and verification can temporarily need two model copies.');
   throw e;
  }
 });
 // Coordinate OPFS chunk writes across tabs as well as within this application.
 if(navigator.locks)return navigator.locks.request('localmind-model-download',{signal},run);
 return run();
}
let activeThreads=1;
let acceleration:Acceleration={accelerator:'cpu'};
async function complete(req:Completion) {
 req.progress?.("Waiting for the local model…");
 return lock.queue(async()=>{
  cancelled(req.signal); const info=await store.get<Installed>(MODEL_KEY);
  requireThat(info,'Download or import a local model in Offline AI first.');
  if(!engine || loaded!==info.file) {
    req.progress?.("Loading the model on this device…");
    await close(); await script('/private-assets/runtime-loader.js');
    requireThat(window.__LM_WLLAMA__,'The browser AI runtime could not be loaded.');
    const blob=await (await (await dirFor(info.location)).getFileHandle(info.file)).getFile();
    activeThreads=inferenceThreads(globalThis.crossOriginIsolated,typeof SharedArrayBuffer!=='undefined',navigator.hardwareConcurrency);
    const result=await loadAccelerated({
      signal:req.signal,gpuAvailable:'gpu' in navigator,progress:req.progress,
      create:observe=>new window.__LM_WLLAMA__!({default:'/private-assets/wllama/esm/wasm/wllama.wasm'},
        {logger:{debug:observe,log:observe,warn:observe,error:observe}}),
      load:(instance,layers)=>instance.loadModel([blob],{n_ctx:CONTEXT_TOKENS,n_threads:activeThreads,n_gpu_layers:layers}),
      dispose:instance=>instance.exit(),
    });
    engine=result.engine;acceleration=result.status;loaded=info.file;
    if(engine.isMultithread?.()===false)activeThreads=1;
  }
  cancelled(req.signal);
  // The native runtime tokenizes and rejects oversize prompts; wllama aborts
  // in WebAssembly instead, leaving a dead engine. Reject before calling it.
  requireThat(!exceedsContext(req.system,req.prompt,req.maxTokens),CONTEXT_OVERFLOW_MESSAGE);
  const abort=new AbortController();const cancel=()=>abort.abort();req.signal.addEventListener('abort',cancel);
  const started=Date.now();
  const report=()=>req.progress?.(`Generating with ${accelerationLabel(acceleration,activeThreads)} · ${Math.floor((Date.now()-started)/1000)}s`);
  report();const ticker=setInterval(report,1000);
  const timer=setTimeout(()=>abort.abort(),180000);
  try {
    // Context overflow is rejected by the runtime; never trim a stored module silently.
    const result=await engine!.createChatCompletion({messages:[{role:'system',content:req.system},{role:'user',content:req.prompt}],
      max_tokens:req.maxTokens,temperature:req.temperature,stream:false,abortSignal:abort.signal,
      chat_template_kwargs:{enable_thinking:false},response_format:{type:'json_schema',json_schema:{name:'study',schema:req.schema,strict:true}}});
    cancelled(req.signal); requireThat(!abort.signal.aborted,'Local AI timed out. No partial answer was saved.');
    const choice=result.choices[0];requireThat(choice && choice.finish_reason!=='length','The response was incomplete. Try fewer questions or a shorter module.');
    const restored=JSON.parse(choice.message.content);
    console.info('[LocalMind AI]',{runtime:'browser',...acceleration,elapsedMs:Date.now()-started,threads:activeThreads,outputCharacters:choice.message.content.length});
    return restored;
  } catch(e) {
    // A runtime failure (not a cancel, timeout or invalid output) can leave the
    // WebAssembly instance unusable. Drop it so the next call reloads the model.
    if(!abort.signal.aborted&&!req.signal.aborted&&!(e instanceof SyntaxError)&&!/incomplete/i.test(e instanceof Error?e.message:String(e)))await close().catch(()=>{});
    if(abort.signal.aborted&&!req.signal.aborted)throw new Error('Local AI timed out. No incomplete response was saved. Completed lesson parts and quiz questions are retained; generate again to resume.');
    throw e;
  } finally {clearInterval(ticker);clearTimeout(timer);req.signal.removeEventListener('abort',cancel);}
 },req.signal);
}
async function storage(){
  const h=await modelFolder(),estimate=await navigator.storage?.estimate?.().catch(()=>undefined);
  const persistent=await navigator.storage?.persisted?.().catch(()=>undefined);
  const needsPermission=h?await permission(h).then(p=>p!=='granted').catch(()=>true):false;
  return {location:h?'folder' as const:'browser' as const,folderName:h?.name,needsPermission,canChooseFolder:canChooseFolder(),persistent,usedBytes:estimate?.usage,quotaBytes:estimate?.quota};
}
const implementation:Device={...store, complete,
 async parse(f, signal, progress, saveVisual) {
  const file=await fileOf(f); const parser=await loadParser();
  const bytes=new Uint8Array(await file.arrayBuffer());const hash=bytesToHex(sha256(bytes));
  const parsed=await parser.parse(bytes,f.name,signal,progress,saveVisual?visual=>saveVisual(visual,hash):undefined);
  return {hash,sections:makeReadingSections(parsed.items),warnings:parsed.warnings,visuals:parsed.visuals};
 },
 async downloadBook(url,headers,name,signal) {
  const r=await fetch(url,{headers,signal,cache:'no-store'});requireThat(r.ok,`Book download failed (${r.status}). Refresh the available books.`);
  requireThat(Number(r.headers.get('content-length')||0)<=MAX_BOOK_BYTES,'This book is too large.');
  requireThat(r.body,'Book download did not contain data.'); const reader=r.body.getReader();const parts:Uint8Array<ArrayBuffer>[]=[];let bytes=0;
  try {while(true){cancelled(signal);const x=await reader.read();if(x.done)break;bytes+=x.value.length;requireThat(bytes<=MAX_BOOK_BYTES,'This book exceeds 100 MB.');parts.push(x.value as Uint8Array<ArrayBuffer>);}}finally{await reader.cancel().catch(()=>{});}
  const file=new File(parts,name);return {name,uri:'device-selected',file,size:file.size};
 },
 async releaseFile(){/* A browser File is released by garbage collection. */},
 async status(){const m=await store.get<Installed>(MODEL_KEY);if(!m)return {installed:false};const location=m.location||'browser';try {const f=await (await (await dirFor(m.location)).getFileHandle(m.file)).getFile();return {installed:f.size===m.bytes,location,name:m.name,bytes:m.bytes,hash:m.hash,threads:activeThreads,...(loaded===m.file?acceleration:{}),loaded:loaded===m.file};}catch(e){return {installed:false,location,needsPermission:e instanceof FolderAccessNeeded};}},
 download,
 importModel:(f,progress,signal)=>lock.run(async()=>{requireThat(f.file && /\.gguf$/i.test(f.name),'Choose a .gguf file');requireThat(f.file.size<=MAX_MODEL_BYTES,'Choose a GGUF under 1.8 GB.');await install(f.file.stream(),f.name,progress,signal);}),
 removeModel:()=>lock.run(async()=>{const m=await store.get<Installed>(MODEL_KEY);await close();await store.removePrefix(MODEL_KEY);if(m)await(await dirFor(m.location).catch(()=>undefined))?.removeEntry(m.file).catch(()=>{});}),
 storage,
 async chooseModelFolder(progress,signal){
  requireThat(canChooseFolder(),'This browser cannot save to a folder you choose. Chrome or Edge on a computer can; other browsers keep the model in their private storage.');
  // Must run straight from the click: the picker needs the user's gesture.
  const picker=(window as unknown as {showDirectoryPicker:Picker}).showDirectoryPicker;
  const h=await picker({id:'localmind-model',mode:'readwrite',startIn:'documents'});
  requireThat(await (h.requestPermission?h.requestPermission({mode:'readwrite'}):Promise.resolve('granted'))==='granted','Folder access was not allowed. The model stays in browser storage.');
  await lock.run(async()=>{
   const old=await store.get<Installed>(MODEL_KEY),previous=await modelFolder();
   if(old){
    // Copy with the same size/checksum verification as a download, then keep
    // the new folder. The previous copy is removed only after success, and a
    // failure restores the previous location exactly.
    const source=await (await (await dirFor(old.location)).getFileHandle(old.file)).getFile();
    await store.put(FOLDER_KEY,h);
    try{await install(source.stream(),old.name,progress,signal,{bytes:old.bytes,sha256:old.hash});}
    catch(e){if(previous)await store.put(FOLDER_KEY,previous);else await store.removePrefix(FOLDER_KEY);throw e;}
   }else await store.put(FOLDER_KEY,h);
  });
  return storage();
 },
 async grantModelFolder(){const h=await modelFolder();if(!h)return false;return (await (h.requestPermission?h.requestPermission({mode:'readwrite'}):Promise.resolve('granted')))==='granted';},
 async useBrowserStorage(progress,signal){
  await lock.run(async()=>{
   const old=await store.get<Installed>(MODEL_KEY),h=await modelFolder();
   if(old?.location==='folder'&&h){
    const source=await (await (await dirFor('folder')).getFileHandle(old.file)).getFile();
    await store.removePrefix(FOLDER_KEY);
    try{await install(source.stream(),old.name,progress,signal,{bytes:old.bytes,sha256:old.hash});}
    catch(e){await store.put(FOLDER_KEY,h);throw e;}
    await h.removeEntry(old.file).catch(()=>{});
   }else await store.removePrefix(FOLDER_KEY);
  });
  return storage();
 },
 async prepareOffline(){
   // The book reader copy works on every origin, including plain-http LAN addresses.
   if(!window.isSecureContext || !('serviceWorker' in navigator)){
     await saveParserCopy();
     return 'Book reading is saved on this device, so books can be imported without a connection. Reopening the whole app offline needs HTTPS or localhost.';
   }
   await saveParserCopy().catch(()=>{/* the service worker below also caches it */});
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
     channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();if(e.data.ok)resolve('Application files saved. Keep this browser profile and sign-in; then reopen the same address offline.');else reject(new Error(e.data.error||'Offline files were not completely saved.'));};
     worker.postMessage({type:'PREPARE_OFFLINE'},[channel.port2]);
   });
 }
};
export async function device():Promise<Device>{return implementation;}
