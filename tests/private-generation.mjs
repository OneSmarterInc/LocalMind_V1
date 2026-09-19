import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'frontend/package.json'));
const {build}=require('esbuild');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lm-generation-'));
await build({entryPoints:[path.join(root,'frontend/src/private/library.ts')],outfile:path.join(tmp,'library.cjs'),bundle:true,platform:'node',format:'cjs',plugins:[{name:'device-fixture',setup(b){
 b.onResolve({filter:/^(expo-crypto|@\/api\/client|\.\/device)$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='expo-crypto'?"export {randomUUID} from 'node:crypto';":a.path==='./device'?"export async function device(){return globalThis.testDevice;}":"export const BASE_URL='test';export const currentSession=()=>1;export class SessionChangedError extends Error{}",loader:'js'}));
}}]});
const {Library,fingerprint}=require(path.join(tmp,'library.cjs'));
const bookId='a'.repeat(64);
let records,requests,respond;
async function setup(source){
 records=new Map();requests=[];
 globalThis.testDevice={get:async k=>structuredClone(records.get(k)),put:async(k,v)=>records.set(k,structuredClone(v)),removePrefix:async p=>{for(const k of records.keys())if(k.startsWith(p))records.delete(k);},list:async p=>[...records].filter(([k])=>k.startsWith(p)).map(([,v])=>structuredClone(v)),status:async()=>({installed:true,hash:'model'}),complete:async req=>{requests.push(req);return respond(req);}};
 const lib=new Library('tester');await lib.seed({id:bookId,title:'Book',importedAt:'2026-01-01',warnings:[],sections:[{id:'s1',title:'Module',source,readingUnit:true}]});return lib;
}
const mcq=(req,name)=>({question:name,options:['A','B','C','D'],answer:0,explanation:'From the source.',quote:req.schema.properties.quote.enum[0]});
const lesson=req=>({introduction:'Introduction',sections:[{heading:'Explanation',content:'Explanation of the passage.',quote:req.schema.properties.sections.items.properties.quote.enum[0]}],takeaways:['Takeaway']});
const source=Array.from({length:90},(_,i)=>`Fact ${i}: This source describes a distinct concept and its practical meaning.`).join('\n');
test('bounded duplicate retries save a labelled partial quiz without inventing questions',async()=>{
 const lib=await setup(source);respond=req=>req.schema.properties.questions?{questions:[]}:mcq(req,'First question');
 const result=await lib.generateQuiz(bookId,'s1',2,new AbortController().signal,()=>{});
 assert.equal(result.questions.length,1);assert.equal(result.requestedCount,2);
 assert.equal(new Set(result.questions.map(q=>q.question)).size,1);
 assert.ok(requests.length<=12,'duplicate retries must remain bounded');
 assert.equal((await lib.quizzes(bookId,'s1'))[0].requestedCount,2);
 assert.ok(result.questions.every(q=>source.includes(q.quote)));
});
test('larger lesson passages reduce calls while retaining every source character',async()=>{
 const lib=await setup(source);respond=lesson;
 await lib.generateLesson(bookId,'s1',new AbortController().signal);
 const passages=requests.map(r=>r.prompt.split('STORED BOOK REFERENCE:\n')[1]);
 assert.equal(passages.join('').replace(/\s/g,''),source.replace(/\s/g,''));
 assert.ok(requests.length<=Math.ceil(source.length/1400));
});
test('existing small-passage lesson checkpoints resume without regenerating saved work',async()=>{
 const lib=await setup('One complete source sentence.');respond=lesson;
 const passages=['One complete source sentence.'];
 const key=`${lib.prefix}work:${bookId}:checkpoint:lesson:s1:${fingerprint(JSON.stringify({version:1,passages,title:'Module',model:'model'}))}:`;
 const saved={introduction:'Saved',sections:[{heading:'Saved',content:'Saved content',quote:passages[0]}],takeaways:['Saved']};
 records.set(key,{id:'checkpoint',parts:[saved]});
 const result=await lib.generateLesson(bookId,'s1',new AbortController().signal);
 assert.equal(requests.length,0);assert.equal(result.lesson.introduction,'Saved');
});
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));

test('an exhausted section can recover using other text from its own module',async()=>{
 const opening='Chapter objectives describe the topics to learn.';
 const other='Ransomware encrypts files and demands payment for recovery.';
 const lib=await setup(opening);
 respond=req=>req.prompt.includes(other)?mcq(req,'What does ransomware do?'):mcq(req,'What are the chapter objectives?');
 const quiz=await lib.generateQuiz(bookId,'s1',1,new AbortController().signal,()=>{},()=>{},['What are the chapter objectives?'],opening+'\n'+other);
 assert.equal(quiz.questions.length,1);
 assert.equal(quiz.questions[0].question,'What does ransomware do?');
 assert.equal(requests.length,3);
});

test('private quizzes never borrow another module automatically',async()=>{
 const opening='Chapter objectives describe the topics to learn.';
 const lib=await setup(opening);
 const book=await lib.book(bookId);book.sections.push({id:'s2',title:'Other module',source:'UNRELATED SECRET TOPIC'});await lib.seed(book);
 respond=req=>mcq(req,'Repeated question');
 await assert.rejects(lib.generateQuiz(bookId,'s1',1,new AbortController().signal,()=>{},()=>{},['Repeated question']),/No question could be generated/);
 assert.ok(requests.every(r=>!r.prompt.includes('UNRELATED SECRET TOPIC')));
 assert.equal((await lib.quizzes(bookId,'s1')).length,0);
});

test('an entirely rejected three-question batch does not retry every empty slot',async()=>{
 const lib=await setup(source);
 respond=()=>({questions:[]});
 await assert.rejects(lib.generateQuiz(bookId,'s1',3,new AbortController().signal,()=>{}),/No question could be generated/);
 assert.equal(requests.length,6,'two rounds, each with one batch and two targeted repairs');
 assert.equal((await lib.quizzes(bookId,'s1')).length,0);
});
