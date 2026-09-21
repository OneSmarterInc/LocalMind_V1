import type {Lesson as CourseLesson,Question} from '@/api/types';
import {quizSectionIndices} from './quizSections';
import {activeBookTransfers} from './locks';
import {randomUUID} from 'expo-crypto';
import {api,ApiError} from '@/api/client';
import {Library,fingerprint} from '@/private/library';
import {device} from '@/private/device';
import {generationJobs} from '@/private/jobs';
import {makeSections,requireThat,type Lesson,type MCQ} from '@/private/core';
export type Snapshot={source_visuals?:import('@/ui/SourceFigures').Figure[];module_id:string;document_id:string;title:string;source:string;revision:string;remote_id?:string;institution?:{lesson:CourseLesson|null;quiz:{id:string;status:string;questions:Question[]}|null;lesson_by?:string|null;quiz_by?:string|null}};
type Operation={id:string;revision:string;kind:'lesson'|'quiz';reviewed:true;lesson?:Lesson;questions?:MCQ[]};
export type Draft={snapshot:Snapshot;localBook?:string;sourceBook?:string;sourceSection?:string;lesson?:Lesson;questions?:MCQ[];run?:{kind:'lesson'|'quiz';book:string;done:number;quizCount?:number;sectionIds?:string[];lessonParts:Lesson[];questions:MCQ[]};pausedRuns?:Partial<Record<'lesson'|'quiz',NonNullable<Draft['run']>>>;operation?:Operation;state?:'pending'|'synced'|'conflict';error?:string;quiz_id?:string;shared?:Partial<Record<'lesson'|'quiz',string>>};
export type ArchivedDraft={id:string;archivedAt:string;draft:Draft};
/** Front matter: readable, but not teachable.
 *
 * A book splits into modules at its headings, so "Chapter Objectives" becomes
 * Module 1 — seven hundred characters of "readers should be able to…". A
 * lesson written from that is the objectives restated, and a quiz from it can
 * only ask which objective is listed third. It also poisoned the readiness
 * table: the module could not produce the questions asked of it, so it sat
 * there as Failed, which reads as a broken system rather than a list of goals.
 *
 * Titles are matched, not guessed from content, and only for the handful of
 * headings that are unambiguously front matter. "Introduction" and "Overview"
 * are included only when they are short enough to be signposting rather than
 * teaching, because plenty of books open with a substantial introduction that
 * students should absolutely have a lesson for. Anything excluded still
 * appears, and is still read, on the student's Read tab.
 */
const FRONT_MATTER=/^(chapter\s+)?(objectives|learning\s+objectives|learning\s+outcomes|outcomes|goals|chapter\s+goals|contents|table\s+of\s+contents|preface|foreword|dedication|acknowledge?ments?|copyright|about\s+(the\s+)?(author|book)|how\s+to\s+use\s+this\s+book|title\s+page|colophon)\b/i;
const SIGNPOST=/^(introduction|overview|in\s+this\s+chapter|what\s+you\s+will\s+learn|chapter\s+summary|summary)\b/i;
const SIGNPOST_MAX=900;
export function isFrontMatter(title?:string|null,source?:string|null):boolean{
 const name=(title||'').trim();if(!name)return false;
 if(FRONT_MATTER.test(name))return true;
 return SIGNPOST.test(name)&&(source||'').trim().length<SIGNPOST_MAX;
}
const draftOperations=new Set<string>();
const preparing=new Map<string,Promise<Draft>>();
const syncing=new Map<string,Promise<Draft|undefined>>();
const draftWrites=new Map<string,Promise<unknown>>();
export class LocalAuthoring {
 readonly library:Library;
 constructor(owner:string){this.library=new Library(owner,'authoring');}
 private key(id:string){return this.library.prefix+'module:'+id;}
 async isRemoved(documentId:string){return !!await(await device()).get(this.library.prefix+'removed:'+documentId);}
 async markRemoved(documentId:string){this.library.guard();await(await device()).put(this.library.prefix+'removed:'+documentId,true);}
 async drafts(){const rows=await(await device()).list<Draft>(this.library.prefix+'module:');this.library.guard();return rows;}
 async flushAll(){const rows=await this.drafts();for(const row of rows)if(row.state==='pending')await this.flush(row.snapshot.module_id);}
 async read(id:string){this.library.guard();const value=await(await device()).get<Draft>(this.key(id));this.library.guard();return value;}
 private async save(id:string,draft:Draft){this.library.guard();await(await device()).put(this.key(id),draft);this.library.guard();}
 private async update(id:string,change:(fresh:Draft)=>Draft){
  const key=this.key(id),previous=draftWrites.get(key)||Promise.resolve();
  const next=previous.catch(()=>{}).then(async()=>{const fresh=await this.read(id);requireThat(fresh,'Local draft is missing.');const result=change(fresh);await this.save(id,result);return result;});
  draftWrites.set(key,next);
  try{return await next;}finally{if(draftWrites.get(key)===next)draftWrites.delete(key);}
 }
 /** One operation at a time per module LANE, not per module.
  *
  * The lock used to cover the whole module, so approving a finished lesson
  * while the quiz was still being written was rejected with "This module
  * already has an operation in progress on this device." Lesson work and quiz
  * work touch different fields of the draft and have no reason to exclude each
  * other; only two operations on the SAME kind genuinely conflict. Callers that
  * rewrite the module as a whole (refresh, download, link) keep the module-wide
  * lane and still exclude everything.
  */
 private async exclusive<T>(id:string,run:()=>Promise<T>,lane='module'):Promise<T>{
  const key=this.key(id)+'#'+lane,whole=this.key(id)+'#module';
  requireThat(!draftOperations.has(key)&&!draftOperations.has(whole),'This module already has an operation in progress on this device.');
  if(lane==='module')requireThat(![...draftOperations].some(k=>k.startsWith(this.key(id)+'#')),'This module already has an operation in progress on this device.');
  draftOperations.add(key);
  try{return await run();}finally{draftOperations.delete(key);}
 }
 /** Write back only the fields this generation owns.
  *
  * A generation run holds its draft in memory for minutes. Saving that whole
  * object at the end would undo anything the reviewer did meanwhile — most
  * obviously approving the other kind, which sets ``operation`` and ``state``.
  * Re-reading and copying across only the generated fields keeps both.
  */
 private async mergeGenerated(id:string,draft:Draft,kind:'lesson'|'quiz'){
  return this.update(id,fresh=>({...fresh,...(kind==='lesson'?{lesson:draft.lesson}:{questions:draft.questions}),run:draft.run,pausedRuns:draft.pausedRuns}));
 }
 async seedLocal(id:string,draft:Draft){if(!await this.read(id))await this.save(id,draft);}
 async linkLocal(id:string,documentId:string,remoteId:string,revision:string){return this.exclusive(id,()=>this.linkLocalDraft(id,documentId,remoteId,revision));}
 private async linkLocalDraft(id:string,documentId:string,remoteId:string,revision:string){
  const draft=await this.read(id);requireThat(draft,'Local draft is missing.');
  if(draft.snapshot.remote_id)return; // replay must not roll a newer lesson revision back
  draft.snapshot={...draft.snapshot,document_id:documentId,remote_id:remoteId,revision};
  if(draft.operation)draft.operation.revision=revision;
  await this.save(id,draft);
 }
 ensure(id:string):Promise<Draft>{
  const key=this.key(id),active=preparing.get(key);if(active)return active;
  const task=(async()=>{const saved=await this.read(id);return saved||await this.download(id);})().finally(()=>preparing.delete(key));
  preparing.set(key,task);return task;
 }
 async download(id:string){return this.exclusive(id,()=>this.downloadDraft(id));}
 private async downloadDraft(id:string){
  const old=await this.read(id);
  requireThat(!old?.localBook||old.snapshot.remote_id,"Synchronize the book draft first.");
  const snapshot=await api<Snapshot>(`/faculty/modules/${old?.snapshot.remote_id||id}/local-authoring/`);this.library.guard();
  if(old?.snapshot.remote_id){snapshot.remote_id=snapshot.module_id;snapshot.module_id=id;}
  if(old?.operation&&old.state!=='synced')throw Error('Synchronize or review the pending draft before replacing its source.');
  if(old&&(old.lesson||old.questions||old.run)&&old.snapshot.revision!==snapshot.revision)throw Error('The institutional source or lesson changed. Your local work is retained; resolve this draft before downloading a replacement.');
  const next={...old,snapshot};await this.save(id,next);return next;
 }
 async loadInstitution(id:string){
  const old=await this.read(id);if(!old||old.localBook&&!old.snapshot.remote_id)return old;
  const remote=await api<Snapshot>(`/faculty/modules/${old.snapshot.remote_id||id}/local-authoring/`);
  return this.exclusive(id,async()=>{const current=await this.read(id);requireThat(current,'Module unavailable.');current.snapshot.institution=remote.institution;if(current.snapshot.revision===remote.revision)current.snapshot.source_visuals=remote.source_visuals;await this.save(id,current);return current;});
 }
 async history(id:string){
  this.library.guard();const rows=await(await device()).list<ArchivedDraft>(this.library.prefix+'history:'+id+':');this.library.guard();
  return rows.sort((a,b)=>b.archivedAt.localeCompare(a.archivedAt));
 }
 async refreshSource(id:string){return this.exclusive(id,()=>this.refreshSourceDraft(id));}
 private async refreshSourceDraft(id:string){
  const inflight=syncing.get(this.key(id));if(inflight)await inflight;
  const old=await this.read(id);requireThat(old,'Save the module first.');
  requireThat(old.state!=='pending','A reviewed draft is still waiting to synchronize. Retry it before refreshing the source.');
  const scope=new Library(this.library.owner).prefix;
  requireThat(!generationJobs.snapshot().some(j=>j.bookId===id&&j.scope.startsWith(scope)&&['running','queued'].includes(j.state)),'Finish or cancel the current generation before refreshing its source.');
  // Fetch succeeds before any local mutation. A revoked permission or failed
  // connection leaves both the current draft and its operation unchanged.
  requireThat(!old?.localBook||old.snapshot.remote_id,"Synchronize the book draft first.");
  const snapshot=await api<Snapshot>(`/faculty/modules/${old?.snapshot.remote_id||id}/local-authoring/`,{cacheOffline:false});this.library.guard();
  if(old?.snapshot.remote_id){snapshot.remote_id=snapshot.module_id;snapshot.module_id=id;}
  const archived:ArchivedDraft={id:randomUUID(),archivedAt:new Date().toISOString(),draft:old};
  await(await device()).put(this.library.prefix+'history:'+id+':'+archived.id,archived);this.library.guard();
  const fresh:Draft={snapshot,localBook:old.localBook,sourceBook:old.sourceBook,sourceSection:old.sourceSection};await this.save(id,fresh);return fresh;
 }
 /** ``restart`` throws away a partly finished run and begins again.
  * Without it, cancelling a generation and then pressing Regenerate silently
  * RESUMED the cancelled run: reviewers expected a fresh quiz and got the
  * abandoned one continued, which read as the cancel having done nothing. */
 async generate(id:string,kind:'lesson'|'quiz',signal:AbortSignal,progress:(message:string)=>void,quizCount=6,restart=false){
  // Both kinds share one checkpoint field. Jobs queue by module; direct callers
  // fail explicitly instead of racing that shared record.
  return this.exclusive(id,()=>this.generateDraft(id,kind,signal,progress,quizCount,restart),'generation');
 }
 private async generateDraft(id:string,kind:'lesson'|'quiz',signal:AbortSignal,progress:(message:string)=>void,quizCount:number,restart=false){
  if(kind==='quiz')requireThat(Number.isInteger(quizCount)&&quizCount>=1&&quizCount<=6,'Choose 1–6 questions.');
  const draft=await this.read(id);requireThat(draft,'Save this module on the device first.');
  requireThat(!await this.isRemoved(draft.snapshot.document_id),'This book was removed or archived.');
  requireThat(!draft.localBook||!activeBookTransfers.has(this.library.prefix+'import:'+draft.localBook),'A book transfer is in progress. Try generation when it finishes.');
  requireThat(!draft.operation||draft.state==='synced','Finish synchronizing the reviewed draft before generating another version.');
  if(draft.run&&draft.run.kind!==kind){draft.pausedRuns={...draft.pausedRuns,[draft.run.kind]:draft.run};draft.run=undefined;}
  if(restart){if(draft.run?.kind===kind)draft.run=undefined;if(draft.pausedRuns?.[kind])delete draft.pausedRuns[kind];}
  if(!draft.run&&draft.pausedRuns?.[kind]){draft.run=draft.pausedRuns[kind];delete draft.pausedRuns[kind];}
  const d=await device();requireThat((await d.status()).installed,'Download a model in Offline AI first.');
  const legacyQuiz=kind==='quiz'&&!!draft.run&&!draft.run.sectionIds;
  if(!draft.run){
   const book=fingerprint(id+'|'+randomUUID());
   await this.library.seed({id:book,title:draft.snapshot.title,originalName:draft.snapshot.title,origin:'personal',importedAt:new Date().toISOString(),warnings:[],sections:makeSections([{title:draft.snapshot.title,text:draft.snapshot.source}])});
   draft.run={kind,book,done:0,quizCount:kind==='quiz'?quizCount:undefined,lessonParts:[],questions:[]};await this.mergeGenerated(id,draft,kind);
  }
  const run=draft.run,book=await this.library.book(run.book);
  if(kind==='quiz'&&!run.sectionIds){
   run.sectionIds=quizSectionIndices(book.sections.length,run.quizCount||6,legacyQuiz).map(i=>book.sections[i].id);
   await this.mergeGenerated(id,draft,kind);
  }
  for(let index=run.done;index<(kind==='quiz'?Math.min(book.sections.length,run.quizCount||6):book.sections.length);index++){
   if(signal.aborted)throw Error('Generation cancelled. Completed work is retained.');
   const section=kind==='quiz'?book.sections.find(s=>s.id===run.sectionIds![index])!:book.sections[index];progress(`Module part ${index+1} of ${book.sections.length}`);
   if(kind==='lesson'){const result=await this.library.generateLesson(book.id,section.id,signal,progress);run.lessonParts.push(result.lesson);}
   else {const used=Math.min(book.sections.length,run.quizCount||6);const count=run.quizCount?Math.floor(run.quizCount/used)+(index<run.quizCount%used?1:0):1;const result=await this.library.generateQuiz(book.id,section.id,count,signal,done=>progress(`${done} questions saved`),progress,run.questions.map(q=>q.question),draft.snapshot.source);run.questions.push(...result.questions);}
   run.done=index+1;await this.mergeGenerated(id,draft,kind);
   if(kind==='quiz'&&run.questions.length>=6)break;
  }
  if(kind==='lesson')draft.lesson={introduction:run.lessonParts[0].introduction,sections:run.lessonParts.flatMap(p=>p.sections),takeaways:run.lessonParts.flatMap(p=>p.takeaways)};
  else draft.questions=run.questions;
  draft.run=undefined;return await this.mergeGenerated(id,draft,kind);
 }
 async share(id:string,kind:'lesson'|'quiz'){return this.exclusive(id,()=>this.shareDraft(id,kind),kind);}
 private async shareDraft(id:string,kind:'lesson'|'quiz'){
  const draft=await this.read(id);requireThat(draft,'No local draft.');requireThat(draft.run?.kind!==kind&&!draft.pausedRuns?.[kind],'Finish generation before sharing.');
  requireThat(!await this.isRemoved(draft.snapshot.document_id),'This book was removed or archived.');
  requireThat(!draft.localBook||!activeBookTransfers.has(this.library.prefix+'import:'+draft.localBook),'A book transfer is in progress. Try approval when it finishes.');
  requireThat(kind==='lesson'?draft.lesson:draft.questions?.length,'Generate and review the content first.');
  if(draft.shared?.[kind]===fingerprint(JSON.stringify(kind==='lesson'?draft.lesson:draft.questions)))return draft;
  if(draft.operation&&draft.state!=='synced'){requireThat(draft.operation.kind===kind,'A different draft is already waiting to synchronize.');}
  else{await this.update(id,fresh=>{
   requireThat(!fresh.operation||fresh.state==='synced','A reviewed draft is already waiting to synchronize.');
   return {...fresh,operation:{id:randomUUID(),revision:fresh.snapshot.revision,kind,reviewed:true,...(kind==='lesson'?{lesson:fresh.lesson}:{questions:fresh.questions})},state:'pending'};
  });}
  return this.flush(id);
 }
 flush(id:string):Promise<Draft|undefined>{
  const key=this.key(id),old=syncing.get(key);if(old)return old;
  const task=this.performFlush(id).finally(()=>syncing.delete(key));syncing.set(key,task);return task;
 }
 private async performFlush(id:string){
  const draft=await this.read(id);if(!draft?.operation||draft.state==='synced'||await this.isRemoved(draft.snapshot.document_id))return draft;
  if(draft.localBook&&activeBookTransfers.has(this.library.prefix+'import:'+draft.localBook))return draft;
  if(draft.localBook&&!draft.snapshot.remote_id){draft.error='Synchronize the book draft before its reviewed content.';await this.save(id,draft);return draft;}
  try{
   const result=await api<{revision:string;quiz_id?:string}>(`/faculty/modules/${draft.snapshot.remote_id||id}/local-authoring/`,{method:'POST',body:draft.operation,timeoutMs:15000});
   this.library.guard();return await this.update(id,fresh=>{
    if(fresh.operation?.id!==draft.operation!.id)return fresh;
    return {...fresh,snapshot:{...fresh.snapshot,revision:result.revision},state:'synced',error:undefined,quiz_id:result.quiz_id??fresh.quiz_id,shared:{...fresh.shared,[draft.operation!.kind]:fingerprint(JSON.stringify(draft.operation!.kind==='lesson'?draft.operation!.lesson:draft.operation!.questions))}};
   });
  }catch(e){this.library.guard();return this.update(id,fresh=>fresh.operation?.id!==draft.operation!.id?fresh:{...fresh,state:e instanceof ApiError&&[400,403,404,409].includes(e.status)?'conflict':'pending',error:e instanceof Error?e.message:String(e)});}
 }
}

/** Label for content the institution already holds, synchronized by anyone. */
export function syncedBy(name?:string|null){return `Synchronized by ${name?.trim()||'another user'}`;}
export function draftStatus(draft:Draft|undefined,kind:'lesson'|'quiz'){
 const content=kind==='lesson'?draft?.lesson:draft?.questions;
 if(!content||(Array.isArray(content)&&!content.length)){
  // Nothing generated on this device, but another faculty member (or this
  // one, earlier) already synchronized it. Say so instead of offering to
  // generate the same module again.
  const held=kind==='lesson'?draft?.snapshot.institution?.lesson:draft?.snapshot.institution?.quiz;
  return held?syncedBy(kind==='lesson'?draft?.snapshot.institution?.lesson_by:draft?.snapshot.institution?.quiz_by):undefined;
 }
 if(draft?.shared?.[kind]===fingerprint(JSON.stringify(content)))return 'Synchronized';
 if(draft?.operation?.kind===kind&&draft.state==='pending')return 'Awaiting synchronization';
 if(draft?.operation?.kind===kind&&draft.state==='conflict')return 'Synchronization needs review';
 return 'Ready for review';
}
