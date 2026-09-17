import {activeBookTransfers} from './locks';
import {randomUUID} from 'expo-crypto';
import {api,ApiError} from '@/api/client';
import {manage} from '@/api/endpoints';
import {generationJobs} from '@/private/jobs';
import {Library} from '@/private/library';
import {device} from '@/private/device';
import {requireThat,type Section} from '@/private/core';
import type {LocalFile} from '@/private/device.types';
import {LocalAuthoring} from './local';
import {retainFile,originalSize,originalChunk} from './files';
export type LocalBook={id:string;bookId:string;title:string;subjectId:string;originalName:string;modules:{id:string;sectionId:string;title:string}[];state:'local'|'pending'|'synced'|'conflict';manifest?:{id:string;subject_id:string;title:string;sha256:string;sections:Section[];reviewed:true};documentId?:string;error?:string;bytesSent?:number;totalBytes?:number};
type Receipt={document_id:string;modules:{local_id:string;module_id:string;revision:string}[]};
const syncing=new Map<string,Promise<LocalBook>>();
export class LocalBooks {
 readonly authoring:LocalAuthoring;
 constructor(owner:string){this.authoring=new LocalAuthoring(owner);}
 private key(id:string){return this.authoring.library.prefix+'import:'+id;}
 private fileKey(id:string){return this.authoring.library.prefix+'original:'+id;}
 async list(){const rows=await(await device()).list<LocalBook>(this.authoring.library.prefix+'import:');this.authoring.library.guard();return rows;}
 async read(id:string){const row=await(await device()).get<LocalBook>(this.key(id));this.authoring.library.guard();requireThat(row,'This local book is unavailable.');return row;}
 private async save(row:LocalBook){this.authoring.library.guard();await(await device()).put(this.key(row.id),row);this.authoring.library.guard();}
 async subjects(refresh=false){
  const key=this.authoring.library.prefix+'subjects';
  if(refresh){const rows=(await manage.subjects()).filter(s=>s.status==='active');this.authoring.library.guard();await(await device()).put(key,rows);return rows;}
  const rows=await(await device()).get<Awaited<ReturnType<typeof manage.subjects>>>(key)||[];this.authoring.library.guard();return rows;
 }
 async import(file:LocalFile,title:string,subjectId:string,signal:AbortSignal,progress:(s:string)=>void){
  requireThat(/\.(pdf|docx)$/i.test(file.name),'Choose a PDF or DOCX book for institutional authoring.');
  requireThat(title.trim()&&title.trim().length<=300,'Enter a book title.');
  requireThat((await this.subjects()).some(s=>s.id===subjectId),'Save your assigned subjects while connected first.');
  const {book}=await this.authoring.library.import(file,undefined,signal,progress);
  const existing=(await this.list()).find(b=>b.bookId===book.id&&b.subjectId===subjectId);if(existing)return existing;
  const id=randomUUID();await retainFile(this.fileKey(id),file);this.authoring.library.guard();
  const row:LocalBook={id,bookId:book.id,title:title.trim(),subjectId,originalName:file.name,state:'local',modules:book.sections.map(s=>({id:randomUUID(),sectionId:s.id,title:s.title}))};
  // Commit the book record first. Opening it can recover any module records
  // interrupted by a refresh without overwriting existing generated drafts.
  await this.save(row);await this.prepare(row);return row;
 }
 async prepare(row:LocalBook){
  const book=await this.authoring.library.book(row.bookId);
  for(const item of row.modules){const section=book.sections.find(s=>s.id===item.sectionId);requireThat(section,'Local source module is missing.');
   await this.authoring.seedLocal(item.id,{snapshot:{module_id:item.id,document_id:'',title:section.title,source:section.source,revision:''},localBook:row.id,sourceBook:row.bookId,sourceSection:section.id});
  }
 }
 async share(id:string){
  const row=await this.read(id);if(row.state==='synced')return row;
  if(!row.manifest){const book=await this.authoring.library.book(row.bookId);
   // The original parser hash is the book ID for new authoring imports.
   row.manifest={id:row.id,subject_id:row.subjectId,title:row.title,sha256:book.sourceHash||book.id,reviewed:true,sections:book.sections.map(s=>({id:s.id,title:s.title,source:s.source,...(s.page?{page:s.page}:{})}))};
  }
  row.state='pending';await this.save(row);return this.flush(id);
 }
 flush(id:string){const key=this.key(id),old=syncing.get(key);if(old)return old;activeBookTransfers.add(key);const task=this.performFlush(id).finally(()=>{syncing.delete(key);activeBookTransfers.delete(key);});syncing.set(key,task);return task;}
 private async performFlush(id:string){
  const row=await this.read(id);if(!row.manifest||row.state==='synced')return row;
  const scope=new Library(this.authoring.library.owner).prefix;
  if(generationJobs.snapshot().some(j=>j.scope.startsWith(scope)&&row.modules.some(m=>m.id===j.bookId)&&['queued','running'].includes(j.state)))return row;
  try{
   await this.prepare(row);
   const size=await originalSize(this.fileKey(id));this.authoring.library.guard();
   const transfer=await api<{received:number;chunk_bytes:number;completed:boolean}>('/faculty/local-books/transfers/',{method:'POST',body:{id:row.id,subject_id:row.subjectId,name:row.originalName,size,sha256:row.manifest.sha256},timeoutMs:15000});
   this.authoring.library.guard();
   requireThat(Number.isInteger(transfer.received)&&transfer.received>=0&&transfer.received<=size&&Number.isInteger(transfer.chunk_bytes)&&transfer.chunk_bytes>0&&transfer.chunk_bytes<=1024*1024,'Invalid transfer position from the server.');
   row.bytesSent=transfer.received;row.totalBytes=size;row.error=undefined;await this.save(row);
   while(row.bytesSent<size){
    const offset=row.bytesSent,part=await originalChunk(this.fileKey(id),offset,Math.min(transfer.chunk_bytes,size-offset));
    try{
     this.authoring.library.guard();const result=await api<{received:number}>(`/faculty/local-books/transfers/${id}/`,{method:'POST',form:part.form,timeoutMs:30000});this.authoring.library.guard();
     requireThat(Number.isInteger(result.received)&&result.received>offset&&result.received<=size,'Invalid chunk acknowledgement.');
     row.bytesSent=result.received;await this.save(row);
    }finally{await part.release();}
   }
   const form=new FormData();form.append('manifest',JSON.stringify(row.manifest));this.authoring.library.guard();
   const receipt=await api<Receipt>('/faculty/local-books/',{method:'POST',form,timeoutMs:120000});this.authoring.library.guard();
   for(const item of row.modules){const mapping=receipt.modules.find(m=>m.local_id===item.sectionId);requireThat(mapping,'The server did not return every module. Retry synchronization.');await this.authoring.linkLocal(item.id,receipt.document_id,mapping.module_id,mapping.revision);}
   row.documentId=receipt.document_id;row.state='synced';row.error=undefined;await this.save(row);
  }catch(e){this.authoring.library.guard();row.state=e instanceof ApiError&&e.code!=='TRANSFER_OFFSET'&&[400,403,404,409].includes(e.status)?'conflict':'pending';row.error=e instanceof Error?e.message:String(e);await this.save(row);}
  return row;
 }
 async clearTransfer(id:string){
  requireThat(!syncing.has(this.key(id)),'Wait for the active transfer to finish before removing its staged copy.');
  const row=await this.read(id);requireThat(row.state!=='synced','This book is already synchronized.');
  await api(`/faculty/local-books/transfers/${id}/`,{method:'DELETE',timeoutMs:15000});
  this.authoring.library.guard();row.state='local';row.bytesSent=0;row.error=undefined;await this.save(row);
 }
 async flushAll(){for(const row of await this.list())if(row.state==='pending')await this.flush(row.id);}
}
