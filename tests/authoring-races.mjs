import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..');
const require=createRequire(path.join(root,'frontend/package.json'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lm-authoring-races-'));
await require('esbuild').build({entryPoints:[path.join(root,'frontend/src/authoring/local.ts')],outfile:path.join(tmp,'local.cjs'),bundle:true,platform:'node',format:'cjs',plugins:[{name:'fixtures',setup(b){
 b.onResolve({filter:/^(expo-crypto|@\/api\/client|@\/private\/device)$/},a=>({path:a.path,namespace:'fixture'}));
 b.onResolve({filter:/^\.\/device$/},a=>({path:'@/private/device',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='expo-crypto'?"export {randomUUID} from 'node:crypto';":a.path==='@/private/device'?"export async function device(){return globalThis.testDevice;}":"export const BASE_URL='test';export const currentSession=()=>1;export class SessionChangedError extends Error{};export class ApiError extends Error{};export const api=(...args)=>globalThis.testApi(...args);"}));
}}]});
const {LocalAuthoring}=require(path.join(tmp,'local.cjs'));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function setup(){
 const records=new Map();
 globalThis.testDevice={get:async k=>structuredClone(records.get(k)),put:async(k,v)=>{await Promise.resolve();records.set(k,structuredClone(v));},status:async()=>({installed:true}),list:async()=>[]};
 const service=new LocalAuthoring('owner');
 const lesson={introduction:'Saved lesson',sections:[],takeaways:[]};
 await service.seedLocal('module',{snapshot:{module_id:'module',document_id:'book',title:'Module',source:'Photosynthesis happens in chloroplasts. Plants convert light into stored energy.',revision:'v1'},lesson});
 return {service,lesson};
}
test('sync response cannot roll back generation completed while request was pending',async()=>{
 const {service,lesson}=await setup(),started=deferred(),response=deferred();
 globalThis.testApi=async()=>{started.resolve();return response.promise;};
 const share=service.share('module','lesson');await started.promise;
 const latest=await service.read('module');
 const questions=[{id:'new-question',question:'New quiz'}];
 await service.mergeGenerated('module',{...latest,questions},'quiz');
 response.resolve({revision:'v2'});await share;
 const saved=await service.read('module');
 assert.deepEqual(saved.questions,questions);assert.deepEqual(saved.lesson,lesson);
 assert.equal(saved.snapshot.revision,'v2');assert.equal(saved.state,'synced');
});
test('generation writes preserve synchronized revision and other content',async()=>{
 const {service,lesson}=await setup();const stale=await service.read('module');
 globalThis.testApi=async()=>({revision:'v2'});await service.share('module','lesson');
 await service.mergeGenerated('module',{...stale,questions:[{id:'q'}]},'quiz');
 const saved=await service.read('module');assert.equal(saved.state,'synced');assert.equal(saved.snapshot.revision,'v2');assert.deepEqual(saved.lesson,lesson);
});
test('direct lesson/quiz generation cannot overlap the shared module checkpoint',async()=>{
 const {service}=await setup(),started=deferred(),release=deferred();
 service.library.generateLesson=async()=>{started.resolve();await release.promise;return {lesson:{introduction:'Done',sections:[],takeaways:[]}};};
 const first=service.generate('module','lesson',new AbortController().signal,()=>{});await started.promise;
 await assert.rejects(service.generate('module','quiz',new AbortController().signal,()=>{},1),/operation in progress/);
 release.resolve();await first;assert.equal((await service.read('module')).run,undefined);
});
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));
