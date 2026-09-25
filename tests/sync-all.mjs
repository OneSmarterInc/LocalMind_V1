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
// Generation that stays in progress until the test aborts it.
function hangingModel(){
 const started=[];
 globalThis.testDevice.complete=req=>new Promise((_,reject)=>{started.push(1);req.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});});
 globalThis.testDevice.status=async()=>({installed:true,name:'m',hash:'h'});
 return started;
}
test('while a quiz is still generating, its finished lesson synchronizes and the quiz waits',async()=>{
 const {service}=await seed();
 globalThis.testApi=async()=>({revision:'v2',quiz_id:'q'});
 const started=hangingModel(),stop=new AbortController();
 const running=service.generate('ready','quiz',stop.signal,()=>{}).catch(()=>{});
 for(let i=0;i<50&&!service.generatingKind('ready');i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(service.generatingKind('ready'),'quiz');
 const items=await planSyncAll('owner',{documentId:'book'});
 assert.ok(items.some(i=>i.id==='ready'&&i.kind==='lesson'),'finished lesson is included');
 assert.ok(!items.some(i=>i.id==='ready'&&i.kind==='quiz'),'quiz being written is left out');
 const r=await runSyncAll('owner',items);
 assert.ok(r.synced>=1);assert.equal(r.failed.length,0);
 stop.abort();await running;
 assert.equal(service.generatingKind('ready'),undefined);
});
test('an item that starts generating after the plan is skipped, not sent half-written',async()=>{
 const {service}=await seed();
 const sent=[];globalThis.testApi=async(url,init)=>{sent.push(init.body.kind+':'+url);return {revision:'v2',quiz_id:'q'};};
 const items=await planSyncAll('owner',{documentId:'book'});
 assert.ok(items.some(i=>i.id==='ready'&&i.kind==='quiz'));
 hangingModel();const stop=new AbortController();
 const running=service.generate('ready','quiz',stop.signal,()=>{}).catch(()=>{});
 for(let i=0;i<50&&!service.generatingKind('ready');i++)await new Promise(r=>setTimeout(r,5));
 const r=await runSyncAll('owner',items);
 assert.deepEqual(r.skipped.map(i=>`${i.kind}:${i.id}`),['quiz:ready']);
 assert.ok(!sent.some(s=>s.startsWith('quiz:')&&s.includes('/ready/')),'nothing sent for the generating quiz');
 assert.match(describeResult(r),/1 skipped because generation started on them/);
 stop.abort();await running;
});
