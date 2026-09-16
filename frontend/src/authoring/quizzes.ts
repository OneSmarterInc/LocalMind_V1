import {randomUUID} from 'expo-crypto';
import {api,ApiError} from '@/api/client';
import {device} from '@/private/device';
import {fingerprint} from '@/private/library';
import {makeSections,requireThat,type MCQ} from '@/private/core';
import {LocalAuthoring,type Snapshot} from './local';
export type QuizDraft={id:string;title:string;count:number;book:string;sources:Snapshot[];parts:{section:string;module:string;count:number}[];done:number;questions:(MCQ&{module_id:string})[];state:'draft'|'pending'|'synced'|'conflict';quizId?:string;error?:string};
const active=new Set<string>(),sending=new Map<string,Promise<QuizDraft>>();
export class LocalQuizzes{
 readonly authoring:LocalAuthoring;
 constructor(owner:string){this.authoring=new LocalAuthoring(owner);}
 private key(id:string){return this.authoring.library.prefix+'quiz-draft:'+id;}
 async list(){const rows=await(await device()).list<QuizDraft>(this.key(''));this.authoring.library.guard();return rows;}
 async read(id:string){const row=await(await device()).get<QuizDraft>(this.key(id));this.authoring.library.guard();requireThat(row,'Quiz draft is unavailable.');return row;}
 private async save(row:QuizDraft){this.authoring.library.guard();await(await device()).put(this.key(row.id),row);this.authoring.library.guard();}
 async create(ids:string[],title:string,count:number){
  ids=[...new Set(ids)];requireThat(ids.length>0&&ids.length<=30,'Choose 1–30 modules.');
  requireThat(Number.isInteger(count)&&count>=ids.length&&count<=Math.min(30,6*ids.length),'Choose at least one question per selected module, up to six per module and 30 total.');
  const sources:Snapshot[]=[];for(const id of ids)sources.push((await this.authoring.ensure(id)).snapshot);
  const id=randomUUID(),book=fingerprint('quiz:'+id),sections=[],parts:QuizDraft['parts']=[];
  for(let i=0;i<sources.length;i++){
   const source=sources[i],n=Math.floor(count/ids.length)+(i<count%ids.length?1:0);
   const candidates=makeSections([{title:source.title,text:source.source}]);requireThat(candidates.length,'A module has no usable source.');
   const used=Math.min(n,candidates.length);
   for(let j=0;j<used;j++){
    const section={...candidates[Math.floor(j*candidates.length/used)],id:randomUUID()};sections.push(section);
    parts.push({section:section.id,module:source.remote_id||source.module_id,count:Math.floor(n/used)+(j<n%used?1:0)});
   }
  }
  await this.authoring.library.seed({id:book,title:title.trim()||'Practice quiz',originalName:'Selected modules',origin:'personal',importedAt:new Date().toISOString(),warnings:[],sections});
  const row:QuizDraft={id,title:title.trim()||sources.map(s=>s.title).join(', ').slice(0,300),count,book,sources,parts,done:0,questions:[],state:'draft'};await this.save(row);return row;
 }
 async generate(id:string,signal:AbortSignal,progress:(s:string)=>void){
  const key=this.key(id);requireThat(!active.has(key),'This quiz is already generating.');active.add(key);
  try{const row=await this.read(id);requireThat(row.state==='draft','This draft is already approved.');requireThat((await(await device()).status()).installed,'Install a model in Offline AI first.');
   for(let i=row.done;i<row.parts.length;i++){
    requireThat(!signal.aborted,'Generation cancelled. Saved questions are retained.');const part=row.parts[i];progress(`Preparing questions ${row.questions.length+1}–${row.questions.length+part.count} of ${row.count}`);
    const result=await this.authoring.library.generateQuiz(row.book,part.section,part.count,signal,()=>{},progress);
    const questions=result.questions.map(q=>({...q,module_id:part.module}));
    requireThat(new Set([...row.questions,...questions].map(q=>q.question.toLowerCase().trim())).size===row.questions.length+questions.length,'The model repeated a question. Completed work is retained; prepare a new draft if retrying repeats it.');
    row.questions.push(...questions);row.done=i+1;await this.save(row);
   }return row;
  }finally{active.delete(key);}
 }
 async approve(id:string){requireThat(!active.has(this.key(id)),'Wait for generation to finish.');const row=await this.read(id);requireThat(row.done===row.parts.length&&row.questions.length===row.count,'Finish and review every question first.');if(row.state==='synced')return row;row.state='pending';await this.save(row);return this.flush(id);}
 flush(id:string){const key=this.key(id),old=sending.get(key);if(old)return old;const run=this.send(id).finally(()=>sending.delete(key));sending.set(key,run);return run;}
 private async send(id:string){const row=await this.read(id);if(row.state!=='pending')return row;
  try{const response=await api<{quiz_id:string}>('/faculty/local-quizzes/',{method:'POST',body:{id:row.id,title:row.title,reviewed:true,sources:row.sources.map(s=>({module_id:s.remote_id||s.module_id,revision:s.revision})),questions:row.questions}});row.quizId=response.quiz_id;row.state='synced';row.error=undefined;}
  catch(e){row.state=e instanceof ApiError&&[400,403,404,409].includes(e.status)?'conflict':'pending';row.error=e instanceof Error?e.message:String(e);}await this.save(row);return row;
 }
 async flushAll(){for(const row of await this.list())if(row.state==='pending')await this.flush(row.id);}
}
