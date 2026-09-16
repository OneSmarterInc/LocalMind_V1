import {activeBookTransfers} from './locks';
import {randomUUID} from 'expo-crypto';
import {api,ApiError} from '@/api/client';
import {Library,fingerprint} from '@/private/library';
import {device} from '@/private/device';
import {generationJobs} from '@/private/jobs';
import {makeSections,requireThat,type Lesson,type MCQ} from '@/private/core';
export type Snapshot={module_id:string;document_id:string;title:string;source:string;revision:string;remote_id?:string};
type Operation={id:string;revision:string;kind:'lesson'|'quiz';reviewed:true;lesson?:Lesson;questions?:MCQ[]};
export type Draft={snapshot:Snapshot;localBook?:string;sourceBook?:string;sourceSection?:string;lesson?:Lesson;questions?:MCQ[];run?:{kind:'lesson'|'quiz';book:string;done:number;lessonParts:Lesson[];questions:MCQ[]};operation?:Operation;state?:'pending'|'synced'|'conflict';error?:string;quiz_id?:string;shared?:Partial<Record<'lesson'|'quiz',string>>};
export type ArchivedDraft={id:string;archivedAt:string;draft:Draft};
const draftOperations=new Set<string>();
const syncing=new Map<string,Promise<Draft|undefined>>();
export class LocalAuthoring {
 readonly library:Library;
 constructor(owner:string){this.library=new Library(owner,'authoring');}
 private key(id:string){return this.library.prefix+'module:'+id;}
 async drafts(){const rows=await(await device()).list<Draft>(this.library.prefix+'module:');this.library.guard();return rows;}
 async flushAll(){const rows=await this.drafts();for(const row of rows)if(row.state==='pending')await this.flush(row.snapshot.module_id);}
 async read(id:string){this.library.guard();const value=await(await device()).get<Draft>(this.key(id));this.library.guard();return value;}
 private async save(id:string,draft:Draft){this.library.guard();await(await device()).put(this.key(id),draft);this.library.guard();}
 private async exclusive<T>(id:string,run:()=>Promise<T>):Promise<T>{
  const key=this.key(id);requireThat(!draftOperations.has(key),'This module already has an operation in progress on this device.');draftOperations.add(key);
  try{return await run();}finally{draftOperations.delete(key);}
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
  const snapshot=await api<Snapshot>(`/faculty/modules/${old?.snapshot.remote_id||id}/local-authoring/`);this.library.guard();
  if(old?.snapshot.remote_id){snapshot.remote_id=snapshot.module_id;snapshot.module_id=id;}
  const archived:ArchivedDraft={id:randomUUID(),archivedAt:new Date().toISOString(),draft:old};
  await(await device()).put(this.library.prefix+'history:'+id+':'+archived.id,archived);this.library.guard();
  const fresh:Draft={snapshot,localBook:old.localBook,sourceBook:old.sourceBook,sourceSection:old.sourceSection};await this.save(id,fresh);return fresh;
 }
 async generate(id:string,kind:'lesson'|'quiz',signal:AbortSignal,progress:(message:string)=>void){
  return this.exclusive(id,()=>this.generateDraft(id,kind,signal,progress));
 }
 private async generateDraft(id:string,kind:'lesson'|'quiz',signal:AbortSignal,progress:(message:string)=>void){
  const draft=await this.read(id);requireThat(draft,'Save this module on the device first.');
  requireThat(!draft.localBook||!activeBookTransfers.has(this.library.prefix+'import:'+draft.localBook),'A book transfer is in progress. Try generation when it finishes.');
  requireThat(!draft.operation||draft.state==='synced','Finish synchronizing the reviewed draft before generating another version.');
  requireThat(!draft.run||draft.run.kind===kind,'Resume the interrupted generation first.');
  const d=await device();requireThat((await d.status()).installed,'Download a model in Offline AI first.');
  if(!draft.run){
   const book=fingerprint(id+'|'+randomUUID());
   await this.library.seed({id:book,title:draft.snapshot.title,originalName:draft.snapshot.title,origin:'personal',importedAt:new Date().toISOString(),warnings:[],sections:makeSections([{title:draft.snapshot.title,text:draft.snapshot.source}])});
   draft.run={kind,book,done:0,lessonParts:[],questions:[]};draft.operation=undefined;draft.state=undefined;await this.save(id,draft);
  }
  const run=draft.run,book=await this.library.book(run.book);
  for(let index=run.done;index<book.sections.length;index++){
   const section=book.sections[index];progress(`Module part ${index+1} of ${book.sections.length}`);
   if(kind==='lesson'){const result=await this.library.generateLesson(book.id,section.id,signal,progress);run.lessonParts.push(result.lesson);}
   else {const result=await this.library.generateQuiz(book.id,section.id,1,signal,done=>progress(`${done} questions saved`),progress);run.questions.push(...result.questions);}
   run.done=index+1;await this.save(id,draft);
   if(kind==='quiz'&&run.questions.length>=6)break;
  }
  if(kind==='lesson')draft.lesson={introduction:run.lessonParts[0].introduction,sections:run.lessonParts.flatMap(p=>p.sections),takeaways:run.lessonParts.flatMap(p=>p.takeaways)};
  else draft.questions=run.questions;
  draft.run=undefined;await this.save(id,draft);return draft;
 }
 async share(id:string,kind:'lesson'|'quiz'){return this.exclusive(id,()=>this.shareDraft(id,kind));}
 private async shareDraft(id:string,kind:'lesson'|'quiz'){
  const draft=await this.read(id);requireThat(draft,'No local draft.');requireThat(!draft.run,'Finish generation before sharing.');
  requireThat(!draft.localBook||!activeBookTransfers.has(this.library.prefix+'import:'+draft.localBook),'A book transfer is in progress. Try approval when it finishes.');
  requireThat(kind==='lesson'?draft.lesson:draft.questions?.length,'Generate and review the content first.');
  if(draft.shared?.[kind]===fingerprint(JSON.stringify(kind==='lesson'?draft.lesson:draft.questions)))return draft;
  if(draft.operation&&draft.state!=='synced'){requireThat(draft.operation.kind===kind,'A different draft is already waiting to synchronize.');}
  else{draft.operation={id:randomUUID(),revision:draft.snapshot.revision,kind,reviewed:true,...(kind==='lesson'?{lesson:draft.lesson}:{questions:draft.questions})};draft.state='pending';await this.save(id,draft);}
  return this.flush(id);
 }
 flush(id:string):Promise<Draft|undefined>{
  const key=this.key(id),old=syncing.get(key);if(old)return old;
  const task=this.performFlush(id).finally(()=>syncing.delete(key));syncing.set(key,task);return task;
 }
 private async performFlush(id:string){
  const draft=await this.read(id);if(!draft?.operation||draft.state==='synced')return draft;
  if(draft.localBook&&activeBookTransfers.has(this.library.prefix+'import:'+draft.localBook))return draft;
  if(draft.localBook&&!draft.snapshot.remote_id){draft.error='Synchronize the book draft before its reviewed content.';await this.save(id,draft);return draft;}
  try{
   const result=await api<{revision:string;quiz_id?:string}>(`/faculty/modules/${draft.snapshot.remote_id||id}/local-authoring/`,{method:'POST',body:draft.operation,timeoutMs:15000});
   this.library.guard();draft.snapshot.revision=result.revision;draft.state='synced';draft.error=undefined;draft.quiz_id=result.quiz_id;draft.shared={...draft.shared,[draft.operation.kind]:fingerprint(JSON.stringify(draft.operation.kind==='lesson'?draft.operation.lesson:draft.operation.questions))};await this.save(id,draft);
  }catch(e){this.library.guard();draft.state=e instanceof ApiError&&[400,403,404,409].includes(e.status)?'conflict':'pending';draft.error=e instanceof Error?e.message:String(e);await this.save(id,draft);}
  return draft;
 }
}
