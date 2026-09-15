import * as FS from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { initLlama, type LlamaContext } from 'llama.rn';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { toByteArray } from 'base64-js';
import { randomUUID } from 'expo-crypto';
import { parseNative } from './parserBridge';
import { MAX_BOOK_BYTES, makeSections, requireThat } from './core';
import { CONTEXT_TOKENS, MAX_MODEL_BYTES, MODEL } from './modelSpec';
import { Exclusive, cancelled } from './busy';
import type { Completion, Device, LocalFile } from './device.types';

const root=`${FS.documentDirectory}localmind-private/`, MODEL_KEY='@model-v1';
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
async function hashFile(uri:string,progress:(n:number)=>void=()=>{},signal?:AbortSignal){
 const i=await info(uri), hash=sha256.create();let first:Uint8Array|undefined;
 for(let position=0;position<i.size;position+=1024*1024){cancelled(signal);const part=await FS.readAsStringAsync(uri,{encoding:FS.EncodingType.Base64,position,length:Math.min(1024*1024,i.size-position)});const bytes=toByteArray(part);if(!first)first=bytes.slice(0,4);hash.update(bytes);progress(Math.min(0.99,(position+bytes.length)/i.size));}
 return {hash:bytesToHex(hash.digest()),bytes:i.size,magic:String.fromCharCode(...(first||[]))};
}
type Installed={uri:string;name:string;bytes:number;hash:string};
let context:LlamaContext|undefined,loaded:string|undefined;
const lock=new Exclusive();
async function close(){if(context){const c=context;context=undefined;loaded=undefined;await c.release();}}
async function accept(uri:string,name:string,progress:(n:number)=>void,signal?:AbortSignal,expected?:typeof MODEL){
 const result=await hashFile(uri,progress,signal);requireThat(result.magic==='GGUF','Choose a real GGUF model file.');
 requireThat(result.bytes>0 && result.bytes<=MAX_MODEL_BYTES,'Choose a model under 1.8 GB.');
 if(expected)requireThat(result.bytes===expected.bytes && result.hash===expected.sha256,'The downloaded model checksum did not match. The previous model was retained.');
 cancelled(signal);const old=await store.get<Installed>(MODEL_KEY);await close();
 await store.put(MODEL_KEY,{uri,name,bytes:result.bytes,hash:result.hash});
 if(old?.uri)await FS.deleteAsync(old.uri,{idempotent:true}).catch(()=>{});progress(1);
}
async function complete(req:Completion){return lock.queue(async()=>{
 cancelled(req.signal);const m=await store.get<Installed>(MODEL_KEY);requireThat(m,'Download or import a model in Offline AI first.');
 requireThat(m.uri.startsWith('file://'),'AI models must be stored locally.');
 if(!context||loaded!==m.uri){await close();await info(m.uri);context=await initLlama({model:m.uri,n_ctx:CONTEXT_TOKENS,n_threads:2,n_gpu_layers:0,use_mlock:false});loaded=m.uri;}
 cancelled(req.signal);
 const messages=[{role:'system',content:req.system},{role:'user',content:req.prompt}];
 const formatted=await context.getFormattedChat(messages,undefined,{enable_thinking:false});
 const tokenized=await context.tokenize(formatted.prompt);
 requireThat(tokenized.tokens.length+req.maxTokens+48<=CONTEXT_TOKENS,'This prompt exceeds local model memory. Choose a shorter module.');
 let expired=false;const cancel=()=>{void context?.stopCompletion().catch(()=>{});};
 const timer=setTimeout(()=>{expired=true;cancel();},180000);req.signal.addEventListener('abort',cancel);
 try {
  cancelled(req.signal);
  const res=await context.completion({messages,n_predict:req.maxTokens,temperature:req.temperature,enable_thinking:false,
   response_format:{type:'json_object',schema:req.schema},stop:['<|im_end|>','<|eot_id|>','</s>']});
  cancelled(req.signal);requireThat(!expired && !('stopped_limit' in res && res.stopped_limit),'Local AI did not finish. No partial answer was saved.');return JSON.parse(res.text);
 }catch(e){if(expired&&!req.signal.aborted)throw new Error('Local AI timed out. No incomplete response was saved. Completed lesson parts and quiz questions are retained; generate again to resume.');throw e;}finally{clearTimeout(timer);req.signal.removeEventListener('abort',cancel);}
},req.signal);}
const implementation:Device={...store,complete,
 async parse(f, signal, progress, saveVisual){
  const i=await info(f.uri);requireThat(i.size<=MAX_BOOK_BYTES,'Import a book up to 35 MB.');
  const base64=await FS.readAsStringAsync(f.uri,{encoding:FS.EncodingType.Base64});
  const hash=bytesToHex(sha256(toByteArray(base64)));const parsed=await parseNative(f.name,base64,signal,progress,saveVisual?visual=>saveVisual(visual,hash):undefined);
  return {hash,sections:makeSections(parsed.items),warnings:parsed.warnings,visuals:parsed.visuals};
 },
 async downloadBook(url,headers,name,signal){
  const uri=`${FS.cacheDirectory}private-book-${randomUUID()}`;
  const task=FS.createDownloadResumable(url,uri,{headers},p=>{if(p.totalBytesWritten>MAX_BOOK_BYTES)void task.cancelAsync();});
  const cancel=()=>{void task.cancelAsync();};signal.addEventListener('abort',cancel);
  try{cancelled(signal);const r=await task.downloadAsync();cancelled(signal);requireThat(r && r.status===200,'Book download failed. Refresh the catalogue.');const i=await info(uri);requireThat(i.size<=MAX_BOOK_BYTES,'Book exceeds 35 MB.');return {name,uri,size:i.size};}
  catch(e){await FS.deleteAsync(uri,{idempotent:true}).catch(()=>{});throw e;}finally{signal.removeEventListener('abort',cancel);}
 },
 async releaseFile(f){if(f.uri.startsWith(`${FS.cacheDirectory}private-book-`))await FS.deleteAsync(f.uri,{idempotent:true});},
 async status(){const m=await store.get<Installed>(MODEL_KEY);if(!m)return {installed:false};const i=await FS.getInfoAsync(m.uri);return {installed:i.exists && !i.isDirectory && i.size===m.bytes,name:m.name,bytes:m.bytes,hash:m.hash,loaded:loaded===m.uri};},
 download:(progress,signal)=>lock.run(async()=>{
  await FS.makeDirectoryAsync(root,{intermediates:true});const uri=`${root}${randomUUID()}.gguf`;
  const task=FS.createDownloadResumable(MODEL.url,uri,{},p=>progress(Math.min(0.85,p.totalBytesWritten/MODEL.bytes*0.85)));
  const cancel=()=>{void task.cancelAsync();};signal.addEventListener('abort',cancel);
  try{cancelled(signal);const r=await task.downloadAsync();requireThat(r && r.status===200,'The model download failed.');await accept(uri,MODEL.name,p=>progress(0.85+p*0.15),signal,MODEL);}
  catch(e){await FS.deleteAsync(uri,{idempotent:true}).catch(()=>{});throw e;}finally{signal.removeEventListener('abort',cancel);}
 }),
 importModel:(f,progress,signal)=>lock.run(async()=>{
  requireThat(/\.gguf$/i.test(f.name),'Choose a GGUF model.');const i=await info(f.uri);requireThat(i.size<=MAX_MODEL_BYTES,'Choose a model under 1.8 GB.');
  await FS.makeDirectoryAsync(root,{intermediates:true});const uri=`${root}${randomUUID()}.gguf`;
  try{cancelled(signal);await FS.copyAsync({from:f.uri,to:uri});await accept(uri,f.name,progress,signal);}catch(e){await FS.deleteAsync(uri,{idempotent:true}).catch(()=>{});throw e;}
 }),
 removeModel:()=>lock.run(async()=>{const m=await store.get<Installed>(MODEL_KEY);await close();await store.removePrefix(MODEL_KEY);if(m)await FS.deleteAsync(m.uri,{idempotent:true});}),
 async prepareOffline(){return 'Use an installed release build, not an Expo Go/development session. The release includes its application files. Keep your sign-in, downloaded model and books on this device.';}
};
export async function device():Promise<Device>{return implementation;}
