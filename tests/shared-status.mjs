import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..');
const require=createRequire(path.join(root,'frontend/package.json'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lm-shared-status-'));
await require('esbuild').build({entryPoints:[path.join(root,'frontend/src/authoring/local.ts')],outfile:path.join(tmp,'local.cjs'),bundle:true,platform:'node',format:'cjs',plugins:[{name:'fixtures',setup(b){
 b.onResolve({filter:/^(expo-crypto|@\/api\/client|@\/private\/device)$/},a=>({path:a.path,namespace:'fixture'}));
 b.onResolve({filter:/^\.\/device$/},a=>({path:'@/private/device',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='expo-crypto'?"export {randomUUID} from 'node:crypto';":a.path==='@/private/device'?"export async function device(){return globalThis.testDevice;}":"export const BASE_URL='test';export const currentSession=()=>1;export class SessionChangedError extends Error{};export class ApiError extends Error{};export const api=(...args)=>globalThis.testApi(...args);"}));
}}]});
await require('esbuild').build({entryPoints:[path.join(root,'frontend/src/authoring/batch.ts')],outfile:path.join(tmp,'batch.cjs'),bundle:true,platform:'node',format:'cjs'});
const {draftStatus,syncedBy}=require(path.join(tmp,'local.cjs'));
const {runMissingBatch}=require(path.join(tmp,'batch.cjs'));
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));
const snapshot=(institution)=>({module_id:'m',document_id:'b',title:'M',source:'s',revision:'v1',institution});
const quiz={id:'q1',status:'draft',questions:[{}]};
test('content synchronized by someone else is reported with their name',()=>{
 const draft={snapshot:snapshot({lesson:{introduction:'x'},quiz,lesson_by:'Asha Rao',quiz_by:'Ravi Iyer'})};
 assert.equal(draftStatus(draft,'lesson'),'Synchronized by Asha Rao');
 assert.equal(draftStatus(draft,'quiz'),'Synchronized by Ravi Iyer');
});
test('unknown author falls back to a neutral label',()=>{
 assert.equal(draftStatus({snapshot:snapshot({lesson:null,quiz})},'quiz'),'Synchronized by another user');
 assert.equal(syncedBy('  '),'Synchronized by another user');
});
test('nothing local and nothing at the institution stays undefined',()=>{
 assert.equal(draftStatus({snapshot:snapshot({lesson:null,quiz:null})},'lesson'),undefined);
 assert.equal(draftStatus(undefined,'quiz'),undefined);
});
test('local content keeps its existing statuses',()=>{
 const draft={snapshot:snapshot({lesson:{introduction:'server'},quiz:null,lesson_by:'Asha Rao'}),lesson:{introduction:'mine'}};
 assert.equal(draftStatus(draft,'lesson'),'Ready for review');
});
test('batch skips modules already synchronized and generates the rest',async()=>{
 const calls=[];
 await runMissingBatch({ids:['a','b','c'],kind:'quiz',signal:new AbortController().signal,read:async()=>({}),progress:()=>{},
  generate:async id=>{calls.push(id);},isShared:(id,kind)=>kind==='quiz'&&id==='b'});
 assert.deepEqual(calls,['a','c']);
});
test('batch without a shared check behaves as before',async()=>{
 const calls=[];
 await runMissingBatch({ids:['a','b'],kind:'lesson',signal:new AbortController().signal,read:async()=>({}),progress:()=>{},generate:async id=>{calls.push(id);}});
 assert.deepEqual(calls,['a','b']);
});
