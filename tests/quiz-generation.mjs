import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'frontend/package.json'));
const build=await require('esbuild').build({entryPoints:[path.join(root,'frontend/src/private/library.ts')],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'fixtures',setup(b){
 const fixtures={
  'expo-crypto':"export {randomUUID} from 'node:crypto';",
  '@/api/client':"export const BASE_URL='test';export const currentSession=()=>globalThis.session;export class SessionChangedError extends Error{};",
  './device':"export async function device(){return globalThis.testDevice;}",
 };
 b.onResolve({filter:/.*/},a=>Object.hasOwn(fixtures,a.path)?{path:a.path,namespace:'fixture'}:undefined);
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:fixtures[a.path]}));
}}]});
const module={exports:{}};new Function('require','module','exports',build.outputFiles[0].text)(require,module,module.exports);
const {Library}=module.exports;
const source='A firewall filters network traffic using security rules. Encryption protects stored information from unauthorized readers.';
const question=(n=1,quote='A firewall filters network traffic using security rules.')=>({question:`What protection does the firewall provide in example ${n}?`,options:['Traffic filtering','Data printing','File deletion','Image editing'],answer:0,explanation:'A firewall applies security rules to network traffic.',quote});
function setup(complete,sourceText=source){
 globalThis.session=1;const records=new Map(),calls=[];
 globalThis.testDevice={status:async()=>({installed:true,name:'model'}),get:async k=>structuredClone(records.get(k)),put:async(k,v)=>records.set(k,structuredClone(v)),removePrefix:async prefix=>{for(const k of records.keys())if(k.startsWith(prefix))records.delete(k);},complete:async req=>{calls.push(req);return complete(req,calls.length);}};
 const make=()=>{const service=new Library('owner');service.book=async()=>({sections:[{id:'s',title:'Security',source:sourceText}]});return service;};
 return {service:make(),make,records,calls,run(count=3,signal=new AbortController().signal){return this.service.generateQuiz('book','s',count,signal,()=>{});}};
}
test('valid batch generates three grounded questions in one call',async()=>{
 const f=setup(()=>({questions:[question(1),question(2),question(3)]}));const result=await f.run();assert.equal(result.questions.length,3);assert.equal(f.calls.length,1);
});
test('bad batch items retain good items and switch to individual repairs',async()=>{
 const f=setup((req,n)=>n===1?{questions:[question(1),{...question(2),options:['same','same','same','same']},question(1)]}:question(n));
 const result=await f.run();assert.equal(result.questions.length,3);assert.equal(f.calls.length,3);assert.ok(f.calls[1].schema.properties.question);assert.match(f.calls[1].prompt,/Correct this problem/);
});
test('truncated batch falls back to individual output with sufficient token headroom',async()=>{
 const f=setup((req,n)=>{if(n===1)throw Error('The response was incomplete');return question(n);});
 assert.equal((await f.run()).questions.length,3);assert.equal(f.calls.length,4);assert.equal(f.calls[1].maxTokens,650);
});
test('rejections advance to later source passages',async()=>{
 const passages=Array.from({length:4},(_,n)=>`Passage ${n}: `+'Network safety matters. '.repeat(145)).join('\n');
 const f=setup(req=>req.prompt.includes('Passage 3:')?question(1,'Network safety matters.'):{},passages);
 const result=await f.run(1);assert.equal(result.questions.length,1);assert.ok(f.calls.length>1);assert.ok(f.calls.some(c=>c.prompt.includes('Passage 3:')));
});
test('system errors fail immediately with their real reason, not thin-source blame',async()=>{
 for(const message of ['Out of memory','Inference timed out','Storage quota exceeded']){
  const f=setup(()=>{throw Error(message);});await assert.rejects(f.run(),{message});assert.equal(f.calls.length,1);
 }
});
test('permanently invalid output has a bounded request budget',async()=>{
 const f=setup(()=>({}));await assert.rejects(f.run(),/without a valid question after 6 attempts/);assert.equal(f.calls.length,6);
});
test('abort after a model response does not save its output',async()=>{
 const controller=new AbortController(),f=setup(()=>{controller.abort();return question();});
 await assert.rejects(f.run(1,controller.signal),/Cancelled/);assert.equal(f.records.size,0);
});
test('saved questions survive interruption and resume through a new service instance offline',async()=>{
 const f=setup((req,n)=>{if(n===1)return {questions:[question(1)]};throw Error('Inference timed out');});
 await assert.rejects(f.run(),/timed out/);assert.equal([...f.records.values()][0].parts.length,1);
 f.service=f.make();globalThis.testDevice.complete=async()=>({questions:[question(2),question(3)]});
 const result=await f.run();assert.equal(result.questions.length,3);assert.deepEqual(result.questions.map(q=>q.question),[1,2,3].map(n=>question(n).question));
});
test('storage failures cannot be swallowed as invalid model output',async()=>{
 const f=setup(()=>({questions:[question(1),question(2),question(3)]}));globalThis.testDevice.put=async()=>{throw Error('Disk full');};
 await assert.rejects(f.run(),/Disk full/);assert.equal(f.calls.length,1);
});
test('account changes during inference prevent any checkpoint write',async()=>{
 const f=setup(()=>{globalThis.session=2;return question();});await assert.rejects(f.run(1));assert.equal(f.records.size,0);
});

test('context overflow splits the source and retries with a smaller individual response',async()=>{
 const longSource=source.repeat(25),f=setup((req,n)=>{if(n===1)throw Error('Prompt exceeds model context');return question();},longSource);
 assert.equal((await f.run(1)).questions.length,1);assert.equal(f.calls.length,2);
 assert.ok(f.calls[1].prompt.length<f.calls[0].prompt.length);
});
test('persistent context overflow terminates after two reductions',async()=>{
 const f=setup(()=>{throw Error('Prompt exceeds model context');});await assert.rejects(f.run(),/exceeds model context/);assert.equal(f.calls.length,3);
});
