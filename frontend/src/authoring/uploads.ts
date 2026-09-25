import {randomUUID} from 'expo-crypto';
import {ApiError} from '@/api/client';
import {manage} from '@/api/endpoints';
import {device} from '@/private/device';
import {MAX_BOOK_BYTES,requireThat} from '@/private/core';
import type {LocalFile} from '@/private/device.types';
import {LocalAuthoring} from './local';
import {retainFile,attachFile,originalSize,discardFile} from './files';

export type QueuedUpload={id:string;title:string;subjectId:string;name:string;state:'pending'|'synced'|'conflict';documentId?:string;error?:string};
const active=new Map<string,Promise<QueuedUpload>>();
/** Retain originals before sending. The established heading extractor runs on reconnect. */
export class BookUploads {
 readonly authoring:LocalAuthoring;
 constructor(owner:string){this.authoring=new LocalAuthoring(owner);}
 private key(id:string){return this.authoring.library.prefix+'upload:'+id;}
 private file(id:string){return this.authoring.library.prefix+'upload-file:'+id;}
 async list(){const rows=await(await device()).list<QueuedUpload>(this.authoring.library.prefix+'upload:');this.authoring.library.guard();return rows;}
 private async save(row:QueuedUpload){this.authoring.library.guard();await(await device()).put(this.key(row.id),row);this.authoring.library.guard();}
 async enqueue(file:LocalFile,title:string,subjectId:string){
  requireThat(/\.(pdf|docx|doc)$/i.test(file.name),'Choose a PDF or Word book.');
  requireThat(title.trim()&&title.trim().length<=300&&subjectId,'Enter a title and choose a subject.');
  requireThat(!file.size||file.size<=MAX_BOOK_BYTES,'Choose a book up to 100 MB.');
  const row:QueuedUpload={id:randomUUID(),title:title.trim(),subjectId,name:file.name,state:'pending'};
  await retainFile(this.file(row.id),file);
  try{const size=await originalSize(this.file(row.id));requireThat(size>0&&size<=MAX_BOOK_BYTES,'Choose a nonempty book up to 100 MB.');await this.save(row);}
  catch(e){await discardFile(this.file(row.id));throw e;}
  return this.flush(row.id);
 }
 flush(id:string){const key=this.key(id),previous=active.get(key);if(previous)return previous;const task=this.send(id).finally(()=>active.delete(key));active.set(key,task);return task;}
 private async send(id:string){
  const row=await(await device()).get<QueuedUpload>(this.key(id));this.authoring.library.guard();requireThat(row,'Saved upload unavailable.');
  if(row.state==='synced')return row;
  try{
   if(!row.documentId){
    const form=new FormData();form.append('subject_id',row.subjectId);form.append('title',row.title);form.append('outline_strategy','source');await attachFile(this.file(id),form,row.name);
    try{row.documentId=(await manage.upload(form)).id;}
    catch(e){const existing=(e as ApiError)?.details?.document_id;if(typeof existing!=='string')throw e;row.documentId=existing;}
    await this.save(row);
   }
   const doc=await manage.document(row.documentId);
   if(doc.status==='uploaded'||doc.status==='error')await manage.process(doc.id);
   row.state='synced';row.error=undefined;await this.save(row);
   await discardFile(this.file(id));
  }catch(e){this.authoring.library.guard();row.state=e instanceof ApiError&&[400,403,404,409,413].includes(e.status)?'conflict':'pending';row.error=e instanceof Error?e.message:String(e);await this.save(row);}
  return row;
 }
 async dismiss(id:string){const row=(await this.list()).find(r=>r.id===id);requireThat(row?.state==='synced','Wait for this upload to finish.');await(await device()).removePrefix(this.key(id));}
 async flushAll(){for(const row of await this.list())if(row.state==='pending')await this.flush(row.id);}
}
