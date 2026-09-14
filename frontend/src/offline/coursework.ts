/** Institutional work is durable and separate from replaceable downloads and private practice. */
import {randomUUID} from 'expo-crypto';
import {api,ApiError,BASE_URL,currentSession,SessionChangedError} from '@/api/client';
import type {Attempt,StartAttempt,Quiz,Question,ModuleFull} from '@/api/types';
import {device} from '@/private/device';
import {fingerprint} from '@/private/library';
import {offlineScope,readEntry} from './store';
import {isOnline} from './connectivity';
export type Package={quiz:Quiz;questions:Question[];marking?:Question[];grant:string;attempts_used:number};
export type Event={id:string;occurred_at?:string;kind:'read'|'lesson'|'time'|'quiz';module_id?:string;seconds?:number;grant?:string;answers?:Record<string,string>;started_at?:string;submitted_at?:string};
export type Pending={event:Event;state:'pending'|'synced'|'conflict';error?:string;server_id?:string;result?:Attempt};
type LocalAttempt={start:StartAttempt;pack:Package;event?:Event};
export type CourseResult=Attempt&{sync_status?:string;sync_error?:string;results_released?:boolean};
function context(){const owner=offlineScope(),session=currentSession();if(!owner)throw Error('Sign in to access saved course work.');return {prefix:`course:${fingerprint(`${BASE_URL}|${owner}`)}:`,guard:()=>{if(owner!==offlineScope()||session!==currentSession())throw new SessionChangedError();}};}
let serial=Promise.resolve();
function exclusive<T>(run:()=>Promise<T>):Promise<T>{const next=serial.catch(()=>{}).then(run);serial=next.then(()=>{},()=>{});return next;}
export async function courseEvents(){const c=context(),rows=await(await device()).list<Pending>(c.prefix+'event:');c.guard();return rows;}
export async function flushCourseWork(){const c=context();return exclusive(async()=>{
 const d=await device();for(const row of (await d.list<Pending>(c.prefix+'event:')).sort((a,b)=>(a.event.submitted_at||a.event.occurred_at||'').localeCompare(b.event.submitted_at||b.event.occurred_at||''))){
  c.guard();if(row.state!=='pending')continue;
  try{const response=await api<{attempt?:Attempt;server_id?:string}>('/student/offline/events/',{method:'POST',body:row.event,cacheOffline:false});c.guard();await d.put(c.prefix+'event:'+row.event.id,{...row,state:'synced',result:response.attempt,server_id:response.server_id});}
  catch(e){c.guard();if(e instanceof ApiError&&[400,403,404,409].includes(e.status)){await d.put(c.prefix+'event:'+row.event.id,{...row,state:'conflict',error:e.message});}else throw e;}
 }
 });}
export async function retryCourseEvent(id:string){const c=context();await exclusive(async()=>{const d=await device(),key=c.prefix+'event:'+id,row=await d.get<Pending>(key);c.guard();if(row?.state==='conflict')await d.put(key,{...row,state:'pending',error:undefined});});await flushCourseWork();}
export async function recordCourseWork(kind:'read'|'lesson'|'time',module_id:string,seconds?:number){
 const c=context(),event:Event={id:randomUUID(),occurred_at:new Date().toISOString(),kind,module_id,...(kind==='time'?{seconds:Math.max(0,Math.min(900,Math.floor(seconds||0)))}:{})};
 await(await device()).put(c.prefix+'event:'+event.id,{event,state:'pending'});c.guard();if(isOnline())void flushCourseWork().catch(()=>{});return {learning_seconds:seconds||0};
}
export async function courseModule(id:string){const value=await api<ModuleFull>(`/student/modules/${id}/`);await recordCourseWork('read',id);return localProgress(value);}
export async function startCourseAttempt(id:string):Promise<StartAttempt>{
 const c=context();return exclusive(async()=>{
 const d=await device(),local=await d.list<LocalAttempt>(c.prefix+'attempt:');c.guard();
 const storedEvents=await d.list<Pending>(c.prefix+'event:');
 const existing=local.find(a=>a.pack.quiz.id===id&&!a.event&&!storedEvents.some(e=>e.event.id===a.start.attempt_id));if(existing)return {...existing.start,resumed:true};
 let packs=await readEntry<Record<string,Package>>('/student/offline/quizzes/');c.guard();
 if(isOnline()){try{const bundle=await api<{entries:Record<string,unknown>}>('/student/offline/',{cacheOffline:false});packs=bundle.entries['/student/offline/quizzes/'] as Record<string,Package>;c.guard();}catch(e){if(!(e instanceof ApiError&&e.code==='NETWORK'))throw e;}}
 const pack=packs?.[id];if(!pack&&isOnline())return api<StartAttempt>(`/student/quizzes/${id}/attempts/`,{method:'POST'});if(!pack)throw Error('This quiz has not been downloaded for offline use. Refresh the course copy while connected. Only MCQ quizzes support local evaluation.');
 const now=Date.now(),q=pack.quiz;
 if(q.available_from&&now<Date.parse(q.available_from))throw Error('This quiz is not open yet.');
 if(q.due_at&&now>Date.parse(q.due_at))throw Error('This quiz is past its downloaded due date.');
 const events=await d.list<Pending>(c.prefix+'event:');const pendingIds=new Set(events.filter(e=>e.state!=='synced').map(e=>e.event.id));
 const used=pack.attempts_used+local.filter(a=>a.pack.quiz.id===id&&a.event&&pendingIds.has(a.event.id)).length;
 if(q.max_attempts&&used>=q.max_attempts)throw Error('No attempts remain in the downloaded quiz allowance.');
 const start:StartAttempt={attempt_id:randomUUID(),attempt_number:used+1,started_at:new Date().toISOString(),resumed:false,time_limit_minutes:q.time_limit_minutes,questions:pack.questions};
 c.guard();await d.put(c.prefix+'attempt:'+start.attempt_id,{start,pack});return start;
 });}
export function roundPercentage(value:number){const scaled=value*10,floor=Math.floor(scaled);return (scaled-floor===0.5?(floor%2===0?floor:floor+1):Math.round(scaled))/10;}
export function localGrade(local:{start:StartAttempt;pack:Package},event:Event):CourseResult{
 const {start,pack}=local,q=pack.quiz,visible=q.results_release==='immediate'&&!!pack.marking;
 const details=visible?pack.marking!.map(question=>{const selected=event.answers?.[question.id]||'',correct=selected===question.correct_answer;return {question_id:question.id,type:'mcq' as const,question:question.question,selected_option:selected,correct_option:question.correct_answer,is_correct:correct,score_awarded:correct?1:0,explanation:question.explanation||''};}):[];
 const score=visible?details.reduce((n,q)=>n+q.score_awarded,0):null,percentage=score===null?null:roundPercentage(score/pack.questions.length*100);
 return {id:start.attempt_id,assessment_id:q.id,assessment_title:q.title,attempt_number:start.attempt_number,status:visible?'evaluated':'submitted',started_at:start.started_at,submitted_at:event.submitted_at!,time_taken_seconds:Math.max(0,Math.floor((Date.parse(event.submitted_at!)-Date.parse(start.started_at))/1000)),score,total_questions:pack.questions.length,percentage,passed:percentage===null?null:percentage>=q.pass_percentage,detailed_results:details,results_released:visible,sync_status:'pending'};
}
export async function submitCourseAttempt(id:string,answers:Record<string,string>):Promise<CourseResult>{
 const c=context();const result=await exclusive(async()=>{const d=await device(),local=await d.get<LocalAttempt>(c.prefix+'attempt:'+id);c.guard();
 if(!local)return api<CourseResult>(`/student/quiz-attempts/${id}/submit/`,{method:'POST',body:{submitted_answers:answers}});
 const persisted=await d.get<Pending>(c.prefix+'event:'+id);
 const event=persisted?.event||local.event||{id,kind:'quiz' as const,grant:local.pack.grant,answers:{...answers},started_at:local.start.started_at,submitted_at:new Date().toISOString()};
 // The event is committed first. Recovery below can reconstruct a submitted attempt after interruption.
 if(!await d.get(c.prefix+'event:'+id))await d.put(c.prefix+'event:'+id,{event,state:'pending'});
 c.guard();await d.put(c.prefix+'attempt:'+id,{...local,event});return localGrade(local,event);
 });if(isOnline())await flushCourseWork().catch(()=>{});return {...result,...await courseAttempt(id)};
}
export async function courseAttempt(id:string):Promise<CourseResult>{
 const c=context(),d=await device(),local=await d.get<LocalAttempt>(c.prefix+'attempt:'+id);c.guard();
 if(!local)return api<CourseResult>(`/student/quiz-attempts/${id}/`);
 const row=await d.get<Pending>(c.prefix+'event:'+id);c.guard();if(!row)throw Error('This attempt has not been submitted yet.');
 if(row.server_id){const server=await api<Attempt>(`/student/quiz-attempts/${row.server_id}/`).catch(e=>{if(e instanceof ApiError&&e.code==='NETWORK')return row.result;throw e;});c.guard();if(server)return {...server,id,sync_status:'synced'};}
 return {...localGrade(local,row.event),sync_status:row.state,sync_error:row.error};
}
export async function pendingResults():Promise<CourseResult[]>{
 const c=context(),d=await device(),rows=await d.list<Pending>(c.prefix+'event:'),out:CourseResult[]=[];
 for(const row of rows){if(row.event.kind!=='quiz'||row.state==='synced')continue;const local=await d.get<LocalAttempt>(c.prefix+'attempt:'+row.event.id);if(local)out.push({...localGrade(local,row.event),sync_status:row.state,sync_error:row.error});}c.guard();return out;
}
export async function courseQuizzes(query:Record<string,string|number|undefined|null>={}){
 const rows=await api<Quiz[]>('/student/quizzes/',{query}),pending=await pendingResults();
 return rows.map(q=>{const attempts=pending.filter(a=>a.assessment_id===q.id);const visible=attempts.filter(a=>a.results_released);const best=visible.reduce((n,a)=>Math.max(n,a.percentage||0),q.best_percentage||0);return {...q,offline_pending:attempts.length,attempts_used:(q.attempts_used||0)+attempts.length,...(visible.length?{best_percentage:best,passed:best>=q.pass_percentage}:{})};});
}
/** Overlay unconfirmed device progress without changing the downloaded institutional record. */
export async function localProgress<T extends import('@/api/types').ModuleBrief>(module:T,snapshot?:{events:Pending[];attempts:LocalAttempt[]}):Promise<T>{
 const c=context(),d=await device(),events=snapshot?.events||await d.list<Pending>(c.prefix+'event:'),attempts=snapshot?.attempts||await d.list<LocalAttempt>(c.prefix+'attempt:');c.guard();
 const own=events.filter(e=>e.state==='pending'&&e.event.module_id===module.id);
 const results=events.filter(e=>e.state==='pending'&&e.event.kind==='quiz').flatMap(e=>{const a=attempts.find(a=>a.start.attempt_id===e.event.id&&a.pack.quiz.module_id===module.id);return a?[localGrade(a,e.event)]:[];}).filter(r=>r.results_released);
 if(!own.length&&!results.length)return module;
 const progress={status:'not_started' as import('@/api/types').ProgressStatus,best_quiz_percentage:null as number|null,quiz_attempts:0,learning_seconds:0,...module.progress,sync_pending:true};
 if(progress.status==='not_started'&&own.length)progress.status='in_progress';
 for(const r of results){progress.quiz_attempts++;progress.best_quiz_percentage=Math.max(progress.best_quiz_percentage||0,r.percentage||0);if(r.passed)progress.status='completed';else if(progress.status!=='completed')progress.status='needs_review';}
 progress.learning_seconds+=own.reduce((n,e)=>n+(e.event.seconds||0),0);return {...module,progress};
}
export async function courseDocument(id:string){const c=context(),d=await device(),snapshot={events:await d.list<Pending>(c.prefix+'event:'),attempts:await d.list<LocalAttempt>(c.prefix+'attempt:')};c.guard();const tree=await api<import('@/api/types').DocumentTree>(`/student/documents/${id}/`);return {...tree,chapters:await Promise.all(tree.chapters.map(async ch=>({...ch,modules:await Promise.all(ch.modules.map(m=>localProgress(m,snapshot)))})))};}
