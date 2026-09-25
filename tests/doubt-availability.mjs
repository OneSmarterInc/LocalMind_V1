import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'frontend/package.json'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lm-doubt-availability-'));
await require('esbuild').build({stdin:{contents:"export {generationJobs} from './src/private/jobs';export {Library} from './src/private/library';export {answerCourse} from './src/private/courseDoubt';",resolveDir:path.join(root,'frontend')},outfile:path.join(tmp,'service.cjs'),bundle:true,platform:'node',format:'cjs',plugins:[{name:'fixtures',setup(b){
 const fixtures={
 'expo-crypto':"export {randomUUID} from 'node:crypto';",
 '@/api/client':"export const BASE_URL='test';export const currentSession=()=>1;export class SessionChangedError extends Error{};export class ApiError extends Error{};export const api=(...args)=>globalThis.testApi(...args);",
 '@/offline/coursework':"export const saveCourseDoubt=async()=>{};export const courseDoubtHistory=async()=>[];",
 '@/offline/store':"export const offlineScope=()=> 'owner';export const readEntry=async()=>globalThis.testModule;",
 '@/offline/connectivity':"export const isOnline=()=>true;",
 './device':"export async function device(){return globalThis.testDevice;}"
 };
 b.onResolve({filter:/.*/},a=>Object.hasOwn(fixtures,a.path)?{path:a.path,namespace:'fixture'}:undefined);
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:fixtures[a.path]}));
}}]});
const {generationJobs,Library,answerCourse}=require(path.join(tmp,'service.cjs'));
const source='Photosynthesis happens in chloroplasts.';
globalThis.testModule={id:'module',availability:'open',source_text:source};
let calls=0;
globalThis.testDevice={get:async()=>undefined,list:async()=>[],removePrefix:async()=>{},put:async()=>{},complete:async()=>{calls++;return {answer:source,quote:source,supported:true};}};
const block=()=>{let finish;generationJobs.enqueue({scope:'staff',bookId:'book',sectionId:'section',kind:'staff-batch',label:'Content'},()=>new Promise(r=>{finish=r;}));return async()=>{finish();await generationJobs.cancelBook('staff','book');};};
test('course and private doubts reject before inference during generation, then work after it stops',async()=>{
 const library=new Library('owner');library.book=async()=>({sections:[{id:'section',title:'Biology',source}]});library.chats=async()=>[];
 globalThis.testApi=async()=>globalThis.testModule;
 const unblock=block(),signal=new AbortController().signal;
 await assert.rejects(answerCourse('owner','module','Where?',undefined,signal),/Content generation/);
 await assert.rejects(library.ask('book','section','Where?',signal),/Content generation/);
 assert.equal(calls,0);await unblock();
 await answerCourse('owner','module','Where?',undefined,signal);
 await library.ask('book','section','Where?',signal);assert.equal(calls,2);
});
test('generation starting during the course-access request cannot slip a doubt into inference',async()=>{
 let finish,started;const ready=new Promise(r=>{started=r;});
 globalThis.testApi=async()=>{started();await new Promise(r=>{finish=r;});return globalThis.testModule;};
 const before=calls,pending=answerCourse('owner','module','Where?',undefined,new AbortController().signal);await ready;
 const unblock=block();finish();await assert.rejects(pending,/Content generation/);assert.equal(calls,before);await unblock();
});
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));
