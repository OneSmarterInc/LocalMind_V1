import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'frontend/package.json'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lm-coursework-'));
const fixtures={
 'expo-crypto':'export const randomUUID=()=>`id-${++globalThis.seq}`;',
 '@/api/client':`export const api=(...a)=>globalThis.request(...a);export const BASE_URL='test';export const currentSession=()=>globalThis.session;export class SessionChangedError extends Error{};export class ApiError extends Error{};`,
 '@/private/device':'export const device=async()=>globalThis.disk;',
 '@/private/library':'export const fingerprint=x=>x;',
 './store':`export const offlineScope=()=>globalThis.owner;export const readEntry=async()=>globalThis.packs;export const META={version:'version',lastSync:'lastSync'};export const replaceEntries=async x=>{globalThis.downloaded=x;};export const writeEntry=async()=>{};`,
 './connectivity':'export const isOnline=()=>globalThis.online;export const onConnectivityChange=()=>()=>{};',
 './staffBundle':'export const staffBundle=async()=>({});',
 'react':'export const useEffect=()=>{};export const useState=()=>[];'
};
const plugin={name:'fixtures',setup(b){b.onResolve({filter:/.*/},a=>fixtures[a.path]?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:fixtures[a.path],loader:'js'}));}};
await require('esbuild').build({entryPoints:[path.join(root,'frontend/src/offline/coursework.ts')],outfile:path.join(tmp,'course.cjs'),bundle:true,platform:'node',plugins:[plugin]});
const course=require(path.join(tmp,'course.cjs'));
const tick=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
function reset(){globalThis.seq=0;globalThis.session=1;globalThis.owner='student';globalThis.online=false;const rows=new Map();globalThis.disk={get:async k=>rows.get(k),put:async(k,v)=>rows.set(k,v),list:async p=>[...rows].filter(([k])=>k.startsWith(p)).map(([,v])=>v)};const question={id:'q1',type:'mcq',question:'Q',correct_answer:'A'};globalThis.packs={quiz:{quiz:{id:'quiz',title:'Quiz',results_release:'immediate',pass_percentage:65},questions:[question],marking:[question],grant:'signed',attempts_used:0}};return rows;}
test('blocked upload cannot delay durable submission; repeats retain original answers',async()=>{
 const rows=reset();const start=await course.startCourseAttempt('quiz');
 rows.set('course:test|student:event:older',{event:{id:'older',kind:'read',occurred_at:'2020'},state:'pending'});
 let release;globalThis.request=()=>new Promise(r=>{release=r;});
 const upload=course.flushCourseWork();await tick();assert.equal(course.flushCourseWork(),upload);
 globalThis.online=true;let result;const saving=course.submitCourseAttempt(start.attempt_id,{q1:'A'}).then(r=>{result=r;});await tick();
 assert.equal(result?.percentage,100);await saving;
 const repeated=await course.submitCourseAttempt(start.attempt_id,{q1:'B'});assert.equal(repeated.percentage,100);
 assert.equal((await course.courseEvents()).filter(r=>r.event.kind==='quiz').length,1);
 await assert.rejects(course.startCourseAttempt('quiz'),course.CourseQuizSubmitted);
 release({});await upload;
 globalThis.request=async()=>({});await course.flushCourseWork();
 assert.equal((await course.courseEvents()).every(r=>r.state==='synced'),true);
});
test('account switch prevents old upload result from writing into saved work',async()=>{
 const rows=reset();rows.set('course:test|student:event:old',{event:{id:'old',kind:'read'},state:'pending'});
 let release;globalThis.request=()=>new Promise(r=>{release=r;});const uploading=course.flushCourseWork();await tick();globalThis.session++;release({});await assert.rejects(uploading);
 assert.equal(rows.get('course:test|student:event:old').state,'pending');
});
fixtures['./coursework']='export const flushCourseWork=()=>globalThis.upload();';
await require('esbuild').build({entryPoints:[path.join(root,'frontend/src/offline/sync.ts')],outfile:path.join(tmp,'sync.cjs'),bundle:true,platform:'node',plugins:[plugin]});
const sync=require(path.join(tmp,'sync.cjs'));
test('failed or blocked upload never prevents downloading course updates',async()=>{
 reset();globalThis.request=async()=>({version:'new',entries:{lesson:'updated'}});globalThis.upload=async()=>{throw Error('upload failed');};
 await sync.syncNow();assert.deepEqual(globalThis.downloaded,{lesson:'updated'});
 globalThis.downloaded=null;let release;globalThis.upload=()=>new Promise(r=>{release=r;});const running=sync.syncNow();await tick();assert.deepEqual(globalThis.downloaded,{lesson:'updated'});release();await running;
});
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));
test('slow quiz start does not hold up another durable submission',async()=>{
 reset();const first=await course.startCourseAttempt('quiz');
 globalThis.packs.second={...globalThis.packs.quiz,quiz:{...globalThis.packs.quiz.quiz,id:'second'}};
 globalThis.online=true;let release;globalThis.request=()=>new Promise(r=>{release=r;});
 const starting=course.startCourseAttempt('second');await tick();globalThis.online=false;
 let result;const saving=course.submitCourseAttempt(first.attempt_id,{q1:'A'}).then(r=>{result=r;});await tick();
 assert.equal(result?.percentage,100);await saving;
 release({entries:{'/student/offline/quizzes/':globalThis.packs}});await starting;
});
test('resume keeps server attempt and timer, uploads to it, and notifies confirmation',async()=>{
 reset();const original={attempt_id:'server-id',attempt_number:1,started_at:'2026-09-19T10:00:00Z',time_limit_minutes:20,questions:globalThis.packs.quiz.questions,resumed:true};
 globalThis.packs.quiz.active_attempt=original;
 const [a,b]=await Promise.all([course.startCourseAttempt('quiz'),course.startCourseAttempt('quiz')]);assert.deepEqual(a,original);assert.equal(a.attempt_id,b.attempt_id);
 await course.submitCourseAttempt(a.attempt_id,{q1:'A'});
 const confirmed=[];const unsubscribe=course.onCourseWorkSynced(id=>confirmed.push(id));
 globalThis.request=async(path,opts)=>{assert.equal(opts.body.server_attempt_id,'server-id');return {server_id:'server-id'};};
 await course.flushCourseWork();unsubscribe();assert.deepEqual(confirmed,['server-id']);
 await assert.rejects(course.startCourseAttempt('quiz'),course.CourseQuizSubmitted);
});
test('submitted package cannot resume a stale active attempt',async()=>{
 reset();globalThis.packs.quiz.attempts_used=1;globalThis.packs.quiz.active_attempt={attempt_id:'old'};
 await assert.rejects(course.startCourseAttempt('quiz'),/already been submitted/);
});
