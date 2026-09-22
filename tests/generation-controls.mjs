import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..');
const require=createRequire(path.join(root,'frontend/package.json'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lm-generation-controls-'));
for(const [name,file] of Object.entries({jobs:'private/jobs',remaining:'private/remaining',automatic:'authoring/automatic',batch:'authoring/batch'})){
 await require('esbuild').build({entryPoints:[path.join(root,`frontend/src/${file}.ts`)],outfile:path.join(tmp,`${name}.cjs`),bundle:true,platform:'node',format:'cjs',plugins:name==='automatic'?[{name:'fixtures',setup(b){
 b.onResolve({filter:/^(\.\/local|@\/private\/(device|jobs|useGenerationJobs|library))$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path.endsWith('/device')?'export async function device(){return globalThis.store;}':a.path.endsWith('/jobs')?'export const generationJobs=globalThis.queue;':a.path.endsWith('/useGenerationJobs')?'export const jobScope=p=>p;':a.path.endsWith('/library')?'export class Library {prefix="scope";}':'export const isFrontMatter=()=>false;'}));
 }}]:[]});
}
const {JobQueue}=require(path.join(tmp,'jobs.cjs'));
const {generateRemaining}=require(path.join(tmp,'remaining.cjs'));
const tick=()=>new Promise(r=>setImmediate(r));
async function until(check){for(let i=0;i<100;i++){if(check())return;await tick();}assert.fail('Job did not settle');}
const meta=(bookId='book')=>({scope:'scope',bookId,documentId:bookId,sectionId:bookId,kind:'staff-auto',label:bookId,moduleIds:['a','b','c']});
const abortable=signal=>new Promise((resolve,reject)=>{if(signal.aborted)reject(Error('stopped'));else signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true});});
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));

test('stop active and pending modules without stopping the rest of the book',async()=>{
 const q=new JobQueue(1),calls=[];
 const id=q.enqueue(meta(),async(s,p,run)=>{for(const m of ['a','b','c'])await run(m,async signal=>{calls.push(m);if(m==='a')await abortable(signal);});});
 q.cancelModule(id,'b');q.cancelModule(id,'a');
 await until(()=>q.list('scope')[0].state==='completed');
 assert.deepEqual(calls,['a','c']);assert.equal(q.hasContentGeneration(),false);
});
test('stop book aborts its current module and allows another book to start',async()=>{
 const q=new JobQueue(1),calls=[];
 const id=q.enqueue(meta(),async(s,p,run)=>{await run('a',abortable);calls.push('wrong');});
 q.enqueue(meta('other'),async()=>{calls.push('other');});q.cancel(id);
 await until(()=>q.list('scope')[1].state==='completed');
 assert.deepEqual(calls,['other']);assert.equal(q.list('scope')[0].state,'cancelled');
});
test('queued cancellation persists preference and never runs the job',async()=>{
 const q=new JobQueue(1);let release;let stopped=false;let ran=false;
 q.enqueue(meta('first'),()=>new Promise(r=>{release=r;}));
 const id=q.enqueue(meta(),async()=>{ran=true;},async()=>{stopped=true;});q.cancel(id);await tick();release();await tick();
 assert.equal(stopped,true);assert.equal(ran,false);assert.equal(q.list('scope')[1].cancelling,false);
});
test('module cancellation is scoped to its job',async()=>{
 const q=new JobQueue(2);let otherSignal;
 const a=q.enqueue(meta(),async(s,p,run)=>run('a',abortable));
 const b=q.enqueue(meta('other'),async(s,p,run)=>run('a',signal=>{otherSignal=signal;return abortable(signal);}));
 q.cancelModule(a,'a');await tick();assert.equal(otherSignal.aborted,false);q.cancel(b);await tick();
});
test('private remaining generation skips saved work and resumes only missing kinds',async()=>{
 const calls=[];const library={book:async()=>({sections:[{id:'a',source:'text',title:'A'},{id:'b',source:'text',title:'B'}]}),lessons:async id=>[],quizzes:async()=>[],generateLesson:async(b,id)=>calls.push(`lesson:${id}`),generateQuiz:async(b,id)=>calls.push(`quiz:${id}`)};
 library.lessons=async(b,id)=>id==='a'?[{}]:[];library.quizzes=async(b,id)=>id==='b'?[{}]:[];
 await generateRemaining(library,'book',['a','b'],new AbortController().signal,()=>{},async(id,run)=>run(new AbortController().signal));
 assert.deepEqual(calls,['quiz:a','lesson:b']);
});
test('automatic stop persists across reopening; explicit restart retains completed lessons',async()=>{
 const data=new Map();globalThis.store={get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v)),status:async()=>({installed:true})};
 globalThis.queue=new JobQueue(1);
 const {prepareAutomatically,preparation}=require(path.join(tmp,'automatic.cjs'));
 const source='Source content '.repeat(20),drafts={a:{snapshot:{module_id:'a',source},lesson:{}},b:{snapshot:{module_id:'b',source}}};
 let block=true;const calls=[];
 const service={library:{owner:'user',prefix:'authoring:',guard(){}},isRemoved:async()=>false,drafts:async()=>Object.values(drafts),ensure:async id=>drafts[id],read:async id=>drafts[id],generate:async(id,kind,signal)=>{calls.push(`${id}:${kind}`);if(block)await abortable(signal);if(kind==='lesson')drafts[id].lesson={};else drafts[id].questions=[{}];}};
 const doc={id:'book',content_version:1,title:'Book',chapters:[{modules:['a','b'].map(id=>({id,title:id,source_text:source}))}]};
 await prepareAutomatically(service,doc);await until(()=>calls.length===1);globalThis.queue.cancel(1);
 await until(()=>!globalThis.queue.list('scope')[0].cancelling);
 assert.equal(await prepareAutomatically(service,doc),false);
 assert.equal((await preparation(service,doc)).a.quiz,'Stopped');
 block=false;await prepareAutomatically(service,doc,{manual:true});
 await until(()=>globalThis.queue.list('scope').at(-1).state==='completed');
 assert.deepEqual(calls,['a:quiz','a:quiz','b:lesson','b:quiz']);
 assert.equal((await preparation(service,doc)).b.quiz,'Ready for review');
});

test('private batch stop keeps finished lesson and restart generates the missing quiz',async()=>{
 const q=new JobQueue(1),saved={},calls=[];let block=true;
 const lib={book:async()=>({sections:[{id:'a',title:'A',source:'text'}]}),lessons:async()=>saved.lesson?[{}]:[],quizzes:async()=>saved.quiz?[{}]:[],generateLesson:async()=>{calls.push('lesson');saved.lesson=true;},generateQuiz:async(b,id,n,signal)=>{calls.push('quiz');if(block)await abortable(signal);saved.quiz=true;}};
 const run=(signal,progress,module)=>generateRemaining(lib,'book',['a'],signal,progress,module);
 const id=q.enqueue({...meta(),kind:'private-batch'},run);await until(()=>calls.length===2);q.cancel(id);
 await until(()=>!q.list('scope')[0].cancelling);assert.equal(saved.lesson,true);assert.equal(saved.quiz,undefined);
 block=false;q.enqueue({...meta(),kind:'private-batch'},run);await until(()=>q.list('scope').at(-1).state==='completed');
 assert.deepEqual(calls,['lesson','quiz','quiz']);
});
test('staff missing batch honors a pending module stop and retains saved work',async()=>{
 const {runMissingBatch}=require(path.join(tmp,'batch.cjs'));const q=new JobQueue(1),calls=[];let release;
 const id=q.enqueue(meta(),async(signal,progress,runModule)=>runMissingBatch({ids:['a','b','c'],kind:'lesson',signal,progress,runModule,read:async id=>id==='c'?{lesson:{}}:{},generate:async id=>{calls.push(id);await new Promise(r=>{release=r;});}}));
 await until(()=>!!release);q.cancelModule(id,'b');release();await until(()=>q.list('scope')[0].state==='completed');assert.deepEqual(calls,['a']);
});
test('whole private book and individual module writes never overlap',async()=>{
 const q=new JobQueue(2),calls=[];let release;
 q.enqueue({...meta(),kind:'private-batch'},()=>new Promise(r=>{release=r;}));
 q.enqueue({...meta(),sectionId:'a',kind:'lesson'},async()=>{calls.push('module');});
 assert.deepEqual(calls,[]);release();await until(()=>calls.length===1);
});
