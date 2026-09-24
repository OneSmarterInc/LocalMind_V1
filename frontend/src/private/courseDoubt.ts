import {generationJobs} from './jobs';
import {api,ApiError,currentSession,SessionChangedError} from '@/api/client';
import type {AskResponse,ModuleFull} from '@/api/types';
import {saveCourseDoubt,courseDoubtHistory} from '@/offline/coursework';
import {readEntry,offlineScope} from '@/offline/store';
import {isOnline} from '@/offline/connectivity';
import {randomUUID} from 'expo-crypto';
import {Library,fingerprint,type PrivateChat} from './library';
import {device} from './device';
import {ANSWER_SCHEMA,GROUNDING,groundedSchema,isFollowUp,notInModule,questionIsAbout,retrieve,text,requireThat,validateAnswer} from './core';
import {cancelled} from './busy';
import {offlineFallbackAllowed} from './offlinePolicy';
export function canUseLocal(error:unknown){return error instanceof ApiError && offlineFallbackAllowed(error.status,error.code);}
export async function localCourseHistory(owner:string,moduleId:string){
 const l=new Library(owner);l.guard();
 const rows=await(await device()).list<PrivateChat>(`${l.prefix}course:${moduleId}:chat:`);l.guard();return [...rows.map(r=>({...r,conversationId:undefined as string|undefined})),...await courseDoubtHistory(moduleId)].sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
}
export async function answerCourse(owner:string,moduleId:string,question:string,conversationId:string|undefined,signal:AbortSignal):Promise<{online?:AskResponse;local?:PrivateChat}>{
 generationJobs.requireDoubtsAvailable();
 const library=new Library(owner),session=currentSession(),d=await device();
 const guard=()=>{cancelled(signal);if(currentSession()!==session||offlineScope()!==owner)throw new SessionChangedError();};
 const denied=`${library.prefix}course:${moduleId}:denied`;guard();text(question,1000,'question');
 if(isOnline()){
  try{
   await api<ModuleFull>(`/student/modules/${moduleId}/`,{signal});
   guard();await d.removePrefix(denied);
  }catch(e){
   guard();
   if(e instanceof ApiError && [401,403,404,409].includes(e.status))await d.put(denied,true);
   if(!canUseLocal(e))throw e;
  }
 }
 guard();requireThat(!await d.get(denied),'This module was denied by the institution. Reconnect and restore authorized access before asking locally.');
 // Always resolve source from the account-scoped downloaded record, never a caller's source_text.
 const m=await readEntry<ModuleFull>(`/student/modules/${moduleId}/`);guard();
 requireThat(m && m.id===moduleId && m.availability==='open' && m.source_text?.trim(),'Save this authorized module while connected before asking offline.');
 // Refuse a question that is not about this module at all before the model is
 // asked. Cheaper, and safer than asking a small model to refuse on our behalf.
 // Four turns, not two, and with the answers as well as the questions. A
 // follow-up like "explain the above in short" refers to the answer before it,
 // and the model could not see any answer at all, so it re-emitted the
 // passage it had just been given.
 const turns=(await localCourseHistory(owner,moduleId)).slice(-4);
 const previous=turns.filter(t=>t.supported).slice(-1)[0];
 // A follow-up asks for a different treatment of the last answer, not for
 // something new, so its own words are the wrong thing to search the module
 // with and the wrong thing to judge against the module.
 const followUp=isFollowUp(question) && !!previous;
 const subject=followUp ? [...turns].reverse().find(t=>!isFollowUp(t.question))?.question || '' : question;
 if(!followUp && !questionIsAbout(question,m.source_text)) {
  console.info('[doubt] refused before generating: no word of the question appears in the module');
  const row:PrivateChat={id:randomUUID(),question,answer:notInModule(),quote:'',supported:false,createdAt:new Date().toISOString()};
  await saveCourseDoubt({id:row.id,kind:'doubt',module_id:moduleId,occurred_at:row.createdAt,question:row.question,answer:row.answer,quote:row.quote,supported:row.supported,source_hash:fingerprint(m.source_text.trim())});guard();return {local:row};
 }
 // Search the module with the subject of the conversation, plus the answer
 // being asked about, so a follow-up lands on the passage it is about.
 const ref=retrieve(m.source_text, followUp ? `${subject} ${previous!.answer}`.slice(0,600) : question);
 const transcript=turns.map(t=>`STUDENT: ${t.question.slice(0,250)}\nTUTOR: ${(t.answer||'').slice(0,600)}`).join('\n\n');
 // The quotation is constrained to sentences that actually occur in ``ref``.
 //
 // This call used to pass the bare ANSWER_SCHEMA while every other grounded
 // call passes ``groundedSchema``. With the field unconstrained the model was
 // free to paraphrase by a word, and ``validateAnswer`` below then threw the
 // whole answer away — "The AI could not provide a matching quotation from
 // this module" on a question the module plainly answers. Constraining the
 // field at decode time makes an unmatched quotation impossible rather than
 // fatal.
 generationJobs.requireDoubtsAvailable();
 // A follow-up is an instruction about the previous answer. Saying so, and
 // showing that answer, is what turns "make it shorter" into a shorter
 // version instead of the same paragraph again.
 const task=followUp
  ? `The student is asking you to rewrite YOUR PREVIOUS ANSWER, shown below, the way they describe. Do not repeat it unchanged and do not introduce anything the reference does not support. Follow their instruction exactly: if they ask for shorter, be shorter; for one line, write one sentence; for simpler, use plainer words; for more, add only what the reference supports.\nYOUR PREVIOUS ANSWER:\n${previous!.answer}\nTHEIR INSTRUCTION:\n${question}`
  : `Answer the question from the reference alone. If the reference does not support an answer, set supported=false.\nQUESTION:\n${question}`;
 const reply=await d.complete({system:GROUNDING,prompt:`Use only this stored course reference. Everything you write must come from it.\nREFERENCE:\n${ref}\n\nCONVERSATION SO FAR:\n${transcript||'(none)'}\n\n${task}`,schema:groundedSchema(ANSWER_SCHEMA,ref,followUp?`${subject} ${question}`:question),maxTokens:650,temperature:0.1,signal});
 guard();const answer=validateAnswer(reply,ref,m.source_text);
 // A source edit/download revocation while inference runs invalidates the result.
 const latest=await readEntry<ModuleFull>(`/student/modules/${moduleId}/`);guard();
 requireThat(latest?.availability==='open' && fingerprint(latest.source_text)===fingerprint(m.source_text),'The downloaded module changed. Ask again with the new version.');
 const row:PrivateChat={id:randomUUID(),question,...answer,createdAt:new Date().toISOString()};
 await saveCourseDoubt({id:row.id,kind:'doubt',module_id:moduleId,occurred_at:row.createdAt,question:row.question,answer:row.answer,quote:row.quote,supported:row.supported,source_hash:fingerprint(m.source_text.trim())});guard();return {local:row};
}
