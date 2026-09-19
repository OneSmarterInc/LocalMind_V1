import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'frontend/package.json'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lm-reliability-'));
for(const [name,source] of [['download','private/download'],['recovery','offline/recovery']])await require('esbuild').build({entryPoints:[path.join(root,`frontend/src/${source}.ts`)],outfile:path.join(tmp,`${name}.cjs`),bundle:true,platform:'node',format:'cjs'});
const {downloadModelParts,downloadModelStream,RangeUnsupported}=require(path.join(tmp,'download.cjs'));
const {RecoveryProbe}=require(path.join(tmp,'recovery.cjs'));
await require('esbuild').build({entryPoints:[path.join(root,'frontend/src/api/client.ts')],outfile:path.join(tmp,'api.cjs'),bundle:true,platform:'node',format:'cjs',plugins:[{name:'api-fixtures',setup(b){
 const fixtures={
  'expo-constants':'export default {};',
  'react-native':"export const Platform={OS:'web'};",
  '@/offline/connectivity':"export const configurePing=()=>{};export const reportOffline=()=>globalThis.connectivityEvents.push(false);export const reportOnline=()=>globalThis.connectivityEvents.push(true);",
  '@/offline/store':"export const offlineScope=()=> 'owner';export const readEntry=async()=>globalThis.savedApiResponse;export const writeEntry=async()=>{};",
  './storage':'export const getItem=async()=>null;export const migrateLegacy=async()=>null;export const setItem=async()=>{};'
 };
 b.onResolve({filter:/^(expo-constants|react-native|@\/offline\/(connectivity|store)|\.\/storage)$/},a=>({path:a.path,namespace:'api-fixture'}));
 b.onLoad({filter:/.*/,namespace:'api-fixture'},a=>({loader:'js',contents:fixtures[a.path]}));
}}]});
const {api,tokenStore}=require(path.join(tmp,'api.cjs'));
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function fixture(){
 const parts=new Map(),requests=[],source=new TextEncoder().encode('GGUFabcdefgh');let failAt=-1;
 const options={url:'https://model.invalid/pinned',bytes:source.length,partBytes:4,progress:()=>{},read:async i=>parts.get(i),write:async(i,b)=>{const blob=new Blob([b]);parts.set(i,blob);return blob;},wait:async()=>{},request:async(url,opts)=>{
  const [start,end]=opts.headers.Range.slice(6).split('-').map(Number);requests.push(start);
  if(start===failAt)throw Error('network');
  return new Response(source.slice(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${source.length}`}});
 }};return {parts,requests,options,failAt:n=>{failAt=n;}};
}
test('interrupted download resumes only missing parts after a new invocation',async()=>{
 const f=fixture();f.failAt(4);await assert.rejects(downloadModelParts(f.options),/Saved parts are retained/);
 assert.equal(f.parts.size,1);assert.deepEqual(f.requests,[0,4,4,4]);
 f.failAt(-1);f.requests.length=0;const blob=await downloadModelParts(f.options);
 assert.deepEqual(f.requests,[4,8]);assert.equal(await blob.text(),'GGUFabcdefgh');
});
test('wrong-size saved part is downloaded again',async()=>{
 const f=fixture();f.parts.set(0,new Blob(['x']));await downloadModelParts(f.options);assert.deepEqual(f.requests,[0,4,8]);
});
test('cancellation retains saved parts and does not retry',async()=>{
 const f=fixture(),abort=new AbortController();f.options.signal=abort.signal;
 f.options.progress=()=>abort.abort();await assert.rejects(downloadModelParts(f.options),/Cancel/i);assert.equal(f.parts.size,1);assert.deepEqual(f.requests,[0]);
});
test('servers ignoring Range are never accepted as a valid part',async()=>{
 const f=fixture();let calls=0;f.options.request=async()=>{calls++;return new Response('GGUFabcdefgh');};
 await assert.rejects(downloadModelParts(f.options),RangeUnsupported);assert.equal(calls,1);assert.equal(f.parts.size,0);
});
test('wrong ranges and oversized chunks fail with bounded retries',async()=>{
 for(const headers of [{'Content-Range':'bytes 4-7/12'},{}]){
  const f=fixture();let calls=0;f.options.request=async()=>{calls++;return new Response('too many bytes',{status:206,headers});};
  await assert.rejects(downloadModelParts(f.options));assert.equal(calls,3);assert.equal(f.parts.size,0);
 }
});
test('storage quota failure is not retried as a network failure',async()=>{
 const f=fixture();f.options.write=async()=>{throw new DOMException('Disk full','QuotaExceededError');};
 await assert.rejects(downloadModelParts(f.options),/Disk full/);assert.equal(f.requests.length,1);
});
test('non-range fallback streams bytes through the verifying consumer',async()=>{
 let body,calls=0;
 await downloadModelStream({url:'https://model.invalid/pinned',request:async()=>{calls++;return new Response('GGUFabcdefgh');},consume:async stream=>{body=await new Response(stream).text();}});
 assert.equal(body,'GGUFabcdefgh');assert.equal(calls,1);
});
test('fallback preserves validation failures and does not retry',async()=>{
 let calls=0;
 await assert.rejects(downloadModelStream({url:'https://model.invalid/pinned',request:async()=>{calls++;return new Response('invalid');},consume:async()=>{throw Error('checksum mismatch');}}),/checksum mismatch/);
 assert.equal(calls,1);
});
test('fallback times out a stalled request without an unbounded retry',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let aborted=false;
 const pending=downloadModelStream({url:'https://model.invalid/pinned',request:async(_,opts)=>new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>{aborted=true;reject(Error('timeout'));})),consume:async()=>{assert.fail('No response to consume');}});
 const rejected=assert.rejects(pending,/timeout/);t.mock.timers.tick(60000);await rejected;assert.equal(aborted,true);
});
test('health recovery is single-flight, backs off, and stops on success',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0,recovered=0,release;
 const probe=new RecoveryProbe(()=>'/health',()=>recovered++,()=>{calls++;return new Promise(r=>{release=r;});},()=>0.5);
 probe.start();probe.start();t.mock.timers.tick(5000);await flush();assert.equal(calls,1);
 t.mock.timers.tick(30000);await flush();assert.equal(calls,1);
 release({ok:false});await flush();t.mock.timers.tick(9999);await flush();assert.equal(calls,1);
 t.mock.timers.tick(1);await flush();assert.equal(calls,2);release({ok:true});await flush();
 t.mock.timers.tick(120000);await flush();assert.equal(calls,2);assert.equal(recovered,1);probe.stop();
});
test('late health response cannot revive a stopped probe',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let release,recovered=0;
 const probe=new RecoveryProbe(()=>'/health',()=>recovered++,()=>new Promise(r=>{release=r;}),()=>0.5);
 probe.start();t.mock.timers.tick(5000);await flush();probe.stop();release({ok:true});await flush();assert.equal(recovered,0);
});
test('default health transport preserves the browser fetch receiver',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let recovered=0;
 t.mock.method(globalThis,'fetch',async function(){assert.equal(this,globalThis);return new Response('ok');});
 const probe=new RecoveryProbe(()=>'/health',()=>recovered++);probe.start();t.mock.timers.tick(6000);await flush();
 assert.equal(recovered,1);probe.stop();
});
test('slow endpoint times out without taking the whole application offline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});globalThis.connectivityEvents=[];
 t.mock.method(globalThis,'fetch',(_,opts)=>new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(Error('aborted')))));
 const rejected=assert.rejects(api('/slow/',{timeoutMs:10}),e=>e.code==='TIMEOUT');t.mock.timers.tick(10);await rejected;
 assert.deepEqual(globalThis.connectivityEvents,[]);
});
test('network failure still returns cached learning content',async t=>{
 globalThis.connectivityEvents=[];globalThis.savedApiResponse={title:'Saved lesson'};
 t.mock.method(globalThis,'fetch',async()=>{throw Error('offline');});
 try{assert.deepEqual(await api('/student/modules/'),{title:'Saved lesson'});assert.deepEqual(globalThis.connectivityEvents,[false]);}
 finally{globalThis.savedApiResponse=undefined;}
});
test('gateway failure never announces a false recovery before going offline',async t=>{
 globalThis.connectivityEvents=[];t.mock.method(globalThis,'fetch',async()=>new Response('',{status:503}));
 await assert.rejects(api('/unavailable/'),e=>e.code==='NETWORK');assert.deepEqual(globalThis.connectivityEvents,[false]);
});
test('response from a previous account cannot announce connectivity recovery',async t=>{
 globalThis.connectivityEvents=[];let resolve;
 t.mock.method(globalThis,'fetch',()=>new Promise(r=>{resolve=r;}));
 const rejected=assert.rejects(api('/stale/'),/account.*changed/);await tokenStore.set(null);resolve(new Response('{}'));await rejected;
 assert.deepEqual(globalThis.connectivityEvents,[]);
});
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));
