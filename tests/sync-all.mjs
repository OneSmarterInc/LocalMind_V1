import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..');
const require=createRequire(path.join(root,'frontend/package.json'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lm-sync-all-'));
await require('esbuild').build({stdin:{contents:"export * from './src/authoring/syncAll';export {LocalAuthoring} from './src/authoring/local';",resolveDir:path.join(root,'frontend'),loader:'ts'},outfile:path.join(tmp,'sync.cjs'),bundle:true,platform:'node',format:'cjs',plugins:[{name:'fixtures',setup(b){
 b.onResolve({filter:/^(expo-crypto|@\/api\/client|@\/private\/device)$/},a=>({path:a.path,namespace:'fixture'}));
 b.onResolve({filter:/^\.\/device$/},a=>({path:'@/private/device',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='expo-crypto'?"export {randomUUID} from 'node:crypto';":a.path==='@/private/device'?"export async function device(){return globalThis.testDevice;}":"export const BASE_URL='test';export const currentSession=()=>1;export class SessionChangedError extends Error{};export class ApiError extends Error{};export const api=(...args)=>globalThis.testApi(...args);"}));
}}]});
const {LocalAuthoring,planSyncAll,runSyncAll,selectionReady,describePlan,describeResult}=require(path.join(tmp,'sync.cjs'));
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));
function store(){
 const records=new Map();
 globalThis.testDevice={get:async k=>structuredClone(records.get(k)),put:async(k,v)=>{records.set(k,structuredClone(v));},status:async()=>({installed:true}),
  list:async prefix=>[...records.entries()].filter(([k])=>k.startsWith(prefix)).map(([,v])=>structuredClone(v))};
 return records;
}
const lesson={introduction:'Intro',sections:[],takeaways:[]};
const questions=[{question:'Q?',options:['a','b','c','d'],answer:0,explanation:'e',quote:'q',sectionId:'s',id:'1'}];
const snap=(id,book='book')=>({module_id:id,document_id:book,title:'Module '+id,source:'s',revision:'v1'});
async function seed(){
 const records=store(),service=new LocalAuthoring('owner');
 await service.seedLocal('ready',{snapshot:snap('ready'),lesson,questions});
 await service.seedLocal('running',{snapshot:snap('running'),lesson,run:{kind:'quiz',book:'x',done:0,lessonParts:[],questions:[]}});
 await service.seedLocal('empty',{snapshot:snap('empty')});
 await service.seedLocal('other',{snapshot:snap('other','book2'),lesson});
 await service.seedLocal('removed',{snapshot:snap('removed','gone'),lesson});
 await service.markRemoved('gone');
 return {records,service};
}
test('plans generated, unsent drafts only, scoped to one book',async()=>{
 await seed();
 const items=await planSyncAll('owner',{documentId:'book'});
 assert.deepEqual(items.map(i=>`${i.kind}:${i.id}`).sort(),['lesson:ready','lesson:running','quiz:ready']);
 assert.equal(describePlan(items),'2 lessons, 1 module quiz');
 const all=await planSyncAll('owner',{});
 assert.ok(all.some(i=>i.id==='other'));
 assert.ok(!all.some(i=>i.id==='removed'),'removed or archived books are skipped');
});
test('sends every item, reports failures without stopping, and a second run finds nothing',async()=>{
 await seed();
 const sent=[];
 globalThis.testApi=async(url,init)=>{sent.push(init.body.kind);if(init.body.kind==='quiz'&&url.includes('/running/'))throw new Error('offline');return {revision:'v2',quiz_id:'q'};};
 const items=await planSyncAll('owner',{documentId:'book'});
 const steps=[];
 const r=await runSyncAll('owner',items,(d,t)=>steps.push(`${d}/${t}`));
 assert.equal(r.synced,3);assert.equal(r.failed.length,0);assert.equal(r.waiting.length,0);
 assert.deepEqual(steps.at(-1),'3/3');
 assert.deepEqual(await planSyncAll('owner',{documentId:'book'}),[]);
 assert.match(describeResult(r),/^3 synchronized$/);
});
test('connection failures are reported as waiting, not lost',async()=>{
 await seed();
 globalThis.testApi=async()=>{throw new Error('offline');};
 const r=await runSyncAll('owner',await planSyncAll('owner',{documentId:'book'}));
 assert.equal(r.synced,0);
 assert.ok(r.waiting.length+r.failed.length>=1);
 assert.match(describeResult(r),/0 synchronized/);
});
test('multi-module quiz drafts are ready only when complete',()=>{
 const row={state:'draft',done:2,parts:[{},{}],questions:[{},{}],count:2};
 assert.equal(selectionReady(row),true);
 assert.equal(selectionReady({...row,done:1}),false);
 assert.equal(selectionReady({...row,questions:[{}]}),false);
 assert.equal(selectionReady({...row,state:'synced'}),false);
});
