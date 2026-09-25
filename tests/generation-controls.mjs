// Items 18 and 22: the book queues itself; "Generate now" runs a module next,
// Pause skips or stops a module, and "Pause all" holds the book. Every case
// resumes from the saved checkpoint, so no part is ever generated twice.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'frontend/package.json'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lm-generation-controls-'));
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));
const esbuild=require('esbuild');
await esbuild.build({entryPoints:[path.join(root,'frontend/src/private/jobs.ts')],outfile:path.join(tmp,'jobs.cjs'),bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
const fixtures={
 './local':'export const isFrontMatter=()=>false;export class LocalAuthoring{}',
 '@/private/device':'export async function device(){return globalThis.store;}',
 '@/private/jobs':'export const generationJobs=globalThis.queue;',
 '@/private/useGenerationJobs':'export const jobScope=p=>p;',
 '@/private/library':'export class Library{constructor(){this.prefix="scope";}}',
};
await esbuild.build({stdin:{contents:"export * from './src/authoring/automatic';export * from './src/authoring/bookControl';",resolveDir:path.join(root,'frontend'),loader:'ts'},
 outfile:path.join(tmp,'auto.cjs'),bundle:true,platform:'node',format:'cjs',logLevel:'silent',
 plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(fixtures,a.path)?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:fixtures[a.path]}));}}]});
const {JobQueue}=require(path.join(tmp,'jobs.cjs'));

const SRC='A process is a program in execution. '.repeat(10);
const tick=()=>new Promise(r=>setImmediate(r));
async function until(check,msg='condition'){for(let i=0;i<400;i++){if(check())return;await tick();}assert.fail(`Timed out waiting for ${msg}`);}

function setup(ids=['m1','m2','m3']){
 const records=new Map();
 globalThis.store={get:async k=>records.get(k),put:async(k,v)=>{records.set(k,structuredClone(v));},status:async()=>({installed:true})};
 globalThis.queue=new JobQueue(2,true);
 delete require.cache[path.join(tmp,'auto.cjs')];
 const auto=require(path.join(tmp,'auto.cjs'));
 const saved={},made={},waiters=[],order=[];
 const part=signal=>new Promise((resolve,reject)=>{
  if(signal.aborted)return reject(new Error('stopped'));
  const w={resolve,reject};waiters.push(w);
  signal.addEventListener('abort',()=>{const i=waiters.indexOf(w);if(i>=0)waiters.splice(i,1);reject(new Error('stopped'));},{once:true});
 });
 const service={
  library:{owner:'owner',prefix:'scope',guard(){}},
  isRemoved:async()=>false, drafts:async()=>[],
  ensure:async()=>({snapshot:{source:SRC}}),
  read:async id=>({snapshot:{source:SRC},lesson:saved[`${id}:lesson`]===3?{}:undefined,questions:saved[`${id}:quiz`]===3?[1]:undefined}),
  // Three parts per kind; resumes from the saved count, like the real checkpoint.
  generate:async(id,kind,signal)=>{const k=`${id}:${kind}`;order.push(k);for(let p=saved[k]||0;p<3;p++){await part(signal);saved[k]=p+1;made[k]=(made[k]||0)+1;}},
 };
 const doc={id:'book',title:'Book',content_version:1,chapters:[{modules:ids.map(id=>({id,title:id.toUpperCase(),source_text:SRC,lesson_status:'none',quiz_status:'none'}))}]};
 const key=auto.controlKey('scope','book');
 const advance=async(n=1)=>{for(let i=0;i<n;i++){await until(()=>waiters.length>0,'a part to start');waiters.shift().resolve();await tick();}};
 const job=()=>globalThis.queue.list('scope').filter(j=>j.kind==='staff-auto').at(-1);
 const finish=async()=>{while(job()&&['queued','running'].includes(job().state)){if(waiters.length)waiters.shift().resolve();await tick();}};
 return {auto,service,doc,key,saved,made,order,advance,finish,job,waiters};
}
const noPartTwice=made=>{for(const [k,n] of Object.entries(made))assert.equal(n,3,`${k} generated ${n} parts, expected exactly 3`);};

test('opening a book queues every module in order and generates each part once',async()=>{
 const t=setup();
 assert.equal(await t.auto.prepareAutomatically(t.service,t.doc),true);
 await t.finish();
 assert.deepEqual(t.order,['m1:lesson','m1:quiz','m2:lesson','m2:quiz','m3:lesson','m3:quiz']);
 noPartTwice(t.made);
 const states=await t.auto.preparation(t.service,t.doc);
 assert.ok(Object.values(states).every(s=>s.lesson==='Ready for review'&&s.quiz==='Ready for review'));
});

test('Generate now runs a later module next; the running one resumes from its saved part',async()=>{
 const t=setup();
 await t.auto.prepareAutomatically(t.service,t.doc);
 await t.advance(1);                          // m1 lesson: 1 of 3 parts saved
 assert.equal(t.auto.currentModule(t.key),'m1');
 t.auto.generateNow(t.key,'m3');
 await until(()=>t.auto.currentModule(t.key)==='m3','m3 to start');
 await t.finish();
 assert.deepEqual(t.order.slice(0,4),['m1:lesson','m3:lesson','m3:quiz','m1:lesson'],'m3 ran before m1 continued');
 assert.equal(t.saved['m1:lesson'],3);
 noPartTwice(t.made);
});

test('pausing the running module stops it at its saved part, the book carries on, and Resume continues it',async()=>{
 const t=setup();
 await t.auto.prepareAutomatically(t.service,t.doc);
 await t.advance(2);                          // m1 lesson: 2 of 3 saved
 t.auto.pauseModule(t.key,'m1');
 await t.finish();
 let states=await t.auto.preparation(t.service,t.doc);
 assert.equal(states.m1.lesson,'Paused');assert.equal(states.m1.quiz,'Paused');
 assert.equal(states.m2.quiz,'Ready for review');assert.equal(states.m3.quiz,'Ready for review');
 assert.equal(t.saved['m1:lesson'],2,'the two finished parts are kept');
 t.auto.generateNow(t.key,'m1');              // Resume
 await t.auto.prepareAutomatically(t.service,t.doc);
 await t.finish();
 states=await t.auto.preparation(t.service,t.doc);
 assert.equal(states.m1.lesson,'Ready for review');assert.equal(states.m1.quiz,'Ready for review');
 noPartTwice(t.made);
});

test('a paused module that was only waiting never starts until resumed',async()=>{
 const t=setup();
 await t.auto.prepareAutomatically(t.service,t.doc);
 t.auto.pauseModule(t.key,'m2');
 await t.finish();
 assert.ok(!t.order.some(k=>k.startsWith('m2')),'m2 did not run');
 const states=await t.auto.preparation(t.service,t.doc);
 assert.equal(states.m2.lesson,'Paused');
 assert.equal(states.m3.lesson,'Ready for review');
});

test('Pause all holds the book: it stops, keeps saved parts, and reopening does not restart it',async()=>{
 const t=setup();
 await t.auto.prepareAutomatically(t.service,t.doc);
 await t.advance(4);                          // m1 lesson done, m1 quiz 1 of 3
 await t.auto.setHeld('scope','book',true);
 await globalThis.queue.cancelDocument('scope','book');
 assert.equal(t.job().state,'cancelled');
 assert.equal(await t.auto.prepareAutomatically(t.service,t.doc),false,'held book does not restart');
 await t.auto.setHeld('scope','book',false);  // Resume all
 assert.equal(await t.auto.prepareAutomatically(t.service,t.doc),true);
 await t.finish();
 assert.equal(t.saved['m1:quiz'],3);
 noPartTwice(t.made);
});

test('Generate now on a finished module is ignored and the queue simply continues',async()=>{
 const t=setup(['m1','m2']);
 await t.auto.prepareAutomatically(t.service,t.doc);
 await t.finish();
 const before=t.order.length;
 t.auto.generateNow(t.key,'m1');
 await t.auto.prepareAutomatically(t.service,t.doc);
 await t.finish();
 assert.equal(t.order.length,before,'nothing was generated again');
});
