import {randomUUID} from 'expo-crypto';
import {api,ApiError} from '@/api/client';
import {Library,fingerprint} from '@/private/library';
import {device} from '@/private/device';
import {makeSections,requireThat,type Lesson,type MCQ} from '@/private/core';
export type Snapshot={module_id:string;document_id:string;title:string;source:string;revision:string};
type Operation={id:string;revision:string;kind:'lesson'|'quiz';reviewed:true;lesson?:Lesson;questions?:MCQ[]};
export type Draft={snapshot:Snapshot;lesson?:Lesson;questions?:MCQ[];run?:{kind:'lesson'|'quiz';book:string;done:number;lessonParts:Lesson[];questions:MCQ[]};operation?:Operation;state?:'pending'|'synced'|'conflict';error?:string;quiz_id?:string;shared?:Partial<Record<'lesson'|'quiz',string>>};
const syncing=new Map<string,Promise<Draft|undefined>>();
export class LocalAuthoring {
 readonly library:Library;
 constructor(owner:string){this.library=new Library(owner,'authoring');}
 private key(id:string){return this.library.prefix+'module:'+id;}
 async drafts(){const rows=await(await device()).list<Draft>(this.library.prefix+'module:');this.library.guard();return rows;}
 async flushAll(){const rows=await this.drafts();for(const row of rows)if(row.state==='pending')await this.flush(row.snapshot.module_id);}
 async read(id:string){this.library.guard();const value=await(await device()).get<Draft>(this.key(id));this.library.guard();return value;}
 private async save(id:string,draft:Draft){this.library.guard();await(await device()).put(this.key(id),draft);this.library.guard();}
 async download(id:string){
  const old=await this.read(id);
  const snapshot=await api<Snapshot>(`/faculty/modules/${id}/local-authoring/`);this.library.guard();
  if(old?.operation&&old.state!=='synced')throw Error('Synchronize or review the pending draft before replacing its source.');
  if(old&&(old.lesson||old.questions||old.run)&&old.snapshot.revision!==snapshot.revision)throw Error('The institutional source or lesson changed. Your local work is retained; resolve this draft before downloading a replacement.');
  const next={...old,snapshot};await this.save(id,next);return next;
 }
 async generate(id:string,kind:'lesson'|'quiz',signal:AbortSignal,progress:(message:string)=>void){
  const draft=await this.read(id);requireThat(draft,'Save this module on the device first.');
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
 async share(id:string,kind:'lesson'|'quiz'){
  const draft=await this.read(id);requireThat(draft,'No local draft.');requireThat(!draft.run,'Finish generation before sharing.');
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
  try{
   const result=await api<{revision:string;quiz_id?:string}>(`/faculty/modules/${id}/local-authoring/`,{method:'POST',body:draft.operation,timeoutMs:15000});
   this.library.guard();draft.snapshot.revision=result.revision;draft.state='synced';draft.error=undefined;draft.quiz_id=result.quiz_id;draft.shared={...draft.shared,[draft.operation.kind]:fingerprint(JSON.stringify(draft.operation.kind==='lesson'?draft.operation.lesson:draft.operation.questions))};await this.save(id,draft);
  }catch(e){this.library.guard();draft.state=e instanceof ApiError&&[400,403,404,409].includes(e.status)?'conflict':'pending';draft.error=e instanceof Error?e.message:String(e);await this.save(id,draft);}
  return draft;
 }
}
