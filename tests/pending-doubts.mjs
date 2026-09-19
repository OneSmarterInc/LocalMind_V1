import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'frontend/package.json'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lm-pending-'));
await require('esbuild').build({stdin:{contents:"export * from './src/private/pendingDoubts';export {generationJobs} from './src/private/jobs';",resolveDir:path.join(root,'frontend')},outfile:path.join(tmp,'service.cjs'),bundle:true,platform:'node',format:'cjs',plugins:[{name:'fixtures',setup(b){
 const fixtures={'./device':'export async function device(){return globalThis.testDevice;}', './useGenerationJobs':'export const jobScope=p=>p;'};
 b.onResolve({filter:/.*/},a=>Object.hasOwn(fixtures,a.path)?{path:a.path,namespace:'fixture'}:undefined);
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:fixtures[a.path]}));
}}]});
const {queueDoubt,pendingDoubt,generationJobs}=require(path.join(tmp,'service.cjs'));
const store=new Map();globalThis.testDevice={get:async k=>store.get(k),put:async(k,v)=>store.set(k,v),removePrefix:async p=>{for(const k of store.keys())if(k.startsWith(p))store.delete(k);}};
const library={prefix:'account-one:',guard(){}};
const settle=()=>new Promise(r=>setImmediate(r));
test('question is durable while answer runs and survives a different page reader',async()=>{
 let finish;await queueDoubt(library,'book','module','Why?',()=>new Promise(r=>{finish=r;}));await settle();
 assert.equal((await pendingDoubt({...library},'book','module')).question,'Why?');
 assert.equal((await pendingDoubt(library,'book','module')).state,'running');
 assert.equal(await pendingDoubt({prefix:'account-two:',guard(){}},'book','module'),null);
 finish();await settle();assert.equal(await pendingDoubt(library,'book','module'),null);
});
test('failure preserves the question and retry clears it only after success',async()=>{
 await queueDoubt(library,'book','module','Saved question',async()=>{throw Error('Model unavailable');});await settle();
 const saved=await pendingDoubt(library,'book','module');assert.equal(saved.state,'interrupted');assert.match(saved.error,/Model unavailable/);
 await queueDoubt(library,'book','module',saved.question,async()=>{});await settle();assert.equal(await pendingDoubt(library,'book','module'),null);
});
test('rapid double click cannot overwrite a running question',async()=>{
 let finish,calls=0;const run=()=>{calls++;return new Promise(r=>{finish=r;});};
 await Promise.all([queueDoubt(library,'book','module','First',run),queueDoubt(library,'book','module','Second',run)]);await settle();
 assert.equal(calls,1);assert.equal((await pendingDoubt(library,'book','module')).question,'First');finish();await settle();
});
test('persisted running record after application restart is recoverable as interrupted',async()=>{
 store.set('account-one:work:book:pending-doubt:module',{question:'Restore me',state:'running',createdAt:new Date().toISOString()});
 assert.equal((await pendingDoubt(library,'book','module')).state,'interrupted');store.clear();
});
test('queued and running cancellation settle with consistent status',async()=>{
 generationJobs.enqueue({scope:'cancel',bookId:'c',sectionId:'a',kind:'doubt',label:'q'},signal=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('cancel')));}));
 const first=generationJobs.list('cancel')[0];generationJobs.cancel(first.id);await settle();
 assert.equal(generationJobs.list('cancel')[0].note,'Cancelled');assert.equal(generationJobs.list('cancel')[0].cancelling,false);
});
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));
