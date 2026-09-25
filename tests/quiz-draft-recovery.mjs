import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'frontend/package.json'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lm-quiz-recovery-'));
await require('esbuild').build({entryPoints:[path.join(root,'frontend/src/authoring/quizzes.ts')],outfile:path.join(tmp,'quizzes.cjs'),bundle:true,platform:'node',format:'cjs',plugins:[{name:'fixtures',setup(b){
 const fixtures={
  'expo-crypto':"export {randomUUID} from 'node:crypto';",
  '@/api/client':"export class ApiError extends Error{};export const api=(...args)=>globalThis.testApi(...args);",
  '@/private/device':"export async function device(){return globalThis.testDevice;}",
  './local':"export class LocalAuthoring{constructor(){this.library={prefix:'test:',guard(){},book:async()=>({importedAt:'2026-09-01'}),generateQuiz:(...args)=>globalThis.generateQuiz(...args)};}async isRemoved(){return false;}}",
  '@/private/library':"export const fingerprint=x=>x;",
 };
 b.onResolve({filter:/.*/},a=>Object.hasOwn(fixtures,a.path)?{path:a.path,namespace:'fixture'}:undefined);
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:fixtures[a.path]}));
}}]});
const {LocalQuizzes}=require(path.join(tmp,'quizzes.cjs'));
const question=(id,sectionId='s1')=>({id,sectionId,module_id:'m1',question:`Question ${id}`,options:['a','b','c','d'],answer:0,explanation:'Explanation',quote:'Source'});
function setup(override={}){
 const records=new Map();let puts=0;
 const row={id:'draft',createdAt:'2026-09-01',title:'Quiz',count:3,book:'book',sources:[{module_id:'m1',document_id:'doc',source:'Source'}],parts:[{section:'s1',module:'m1',count:3}],done:0,questions:[],state:'draft',...override};
 records.set('test:quiz-draft:draft',row);
 globalThis.testDevice={get:async k=>structuredClone(records.get(k)),put:async(k,v)=>{puts++;records.set(k,structuredClone(v));},list:async()=>[structuredClone(records.get('test:quiz-draft:draft'))],status:async()=>({installed:true})};
 globalThis.testApi=async()=>({quiz_id:'remote'});
 return {service:new LocalQuizzes('owner'),stored:()=>records.get('test:quiz-draft:draft'),puts:()=>puts};
}
test('partial model result retains questions and remains resumable',async()=>{
 const f=setup();globalThis.generateQuiz=async()=>({questions:[question('one')]});
 await assert.rejects(f.service.generate('draft',new AbortController().signal,()=>{}),/saved|retained/i);
 assert.equal(f.stored().questions.length,1);assert.equal(f.stored().done,0);
 const calls=[];globalThis.generateQuiz=async(...args)=>{calls.push(args);return {questions:[question('two'),question('three')]};};
 const done=await f.service.generate('draft',new AbortController().signal,()=>{});
 assert.equal(calls[0][2],2);assert.deepEqual(calls[0][6],['Question one']);
 assert.equal(done.questions.length,3);assert.equal(done.done,1);
 assert.equal((await f.service.approve('draft')).state,'synced');
});
test('previously stuck draft becomes visible as resumable without losing later completed sections',async()=>{
 const later=question('later','s2');const f=setup({count:4,done:2,parts:[{section:'s1',module:'m1',count:3},{section:'s2',module:'m1',count:1}],questions:[question('one'),later]});
 assert.equal((await f.service.list())[0].done,0);
 const sections=[];globalThis.generateQuiz=async(book,section,count)=>{sections.push(section);assert.equal(count,2);return {questions:[question('two'),question('three')]};};
 const done=await f.service.generate('draft',new AbortController().signal,()=>{});
 assert.deepEqual(sections,['s1']);assert.equal(done.done,2);assert.equal(done.questions.length,4);assert.deepEqual(done.questions[1],later);
});
test('complete drafts still approve without regeneration',async()=>{
 const f=setup({done:1,questions:[question('one'),question('two'),question('three')]});
 assert.equal((await f.service.approve('draft')).state,'synced');assert.equal(f.stored().quizId,'remote');
});
test('listing legacy metadata cannot overwrite generation saved during its lookup',async()=>{
 const f=setup({createdAt:undefined});let started,release;
 const waiting=new Promise(resolve=>{started=resolve;});
 f.service.authoring.library.book=async()=>{started();return new Promise(resolve=>{release=resolve;});};
 const listing=f.service.list();await waiting;
 await globalThis.testDevice.put('test:quiz-draft:draft',{...f.stored(),questions:[question('new')],done:0});
 release({importedAt:'2026-09-01'});await listing;
 assert.deepEqual(f.stored().questions,[question('new')]);
});
test('cancellation and duplicate model output preserve previous questions',async()=>{
 const f=setup({questions:[question('one')]});const abort=new AbortController();abort.abort();
 await assert.rejects(f.service.generate('draft',abort.signal,()=>{}),/cancelled/i);
 globalThis.generateQuiz=async()=>({questions:[question('one')]});
 await assert.rejects(f.service.generate('draft',new AbortController().signal,()=>{}),/repeated/i);
 assert.deepEqual(f.stored().questions,[question('one')]);
});
test('offline approval retains reviewed content for a later synchronization',async()=>{
 const f=setup({done:1,questions:[question('one'),question('two'),question('three')]});
 globalThis.testApi=async()=>{throw Error('Network unavailable');};
 const pending=await f.service.approve('draft');assert.equal(pending.state,'pending');assert.equal(pending.questions.length,3);
 globalThis.testApi=async(path,options)=>{assert.equal(options.body.reviewed,true);assert.deepEqual(options.body.questions,pending.questions);return {quiz_id:'remote'};};
 const synced=await f.service.flush('draft');assert.equal(synced.state,'synced');assert.equal(synced.error,undefined);
});
test('repeated short responses make bounded progress without an automatic retry loop',async()=>{
 const f=setup();let calls=0;globalThis.generateQuiz=async()=>({questions:[question(String(++calls))]});
 for(let i=1;i<=2;i++){
  await assert.rejects(f.service.generate('draft',new AbortController().signal,()=>{}),/saved/i);
  assert.equal(calls,i);assert.equal(f.stored().questions.length,i);assert.equal(f.stored().done,0);
 }
 const done=await f.service.generate('draft',new AbortController().signal,()=>{});
 assert.equal(calls,3);assert.equal(done.done,1);assert.equal(done.questions.length,3);
});
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));
