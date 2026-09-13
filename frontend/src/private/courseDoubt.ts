import {api,ApiError,currentSession,SessionChangedError} from '@/api/client';
import type {AskResponse,ModuleFull} from '@/api/types';
import {readEntry,offlineScope} from '@/offline/store';
import {isOnline} from '@/offline/connectivity';
import {randomUUID} from 'expo-crypto';
import {Library,fingerprint,type PrivateChat} from './library';
import {device} from './device';
import {ANSWER_SCHEMA,GROUNDING,retrieve,text,requireThat,validateAnswer} from './core';
import {cancelled} from './busy';
import {offlineFallbackAllowed} from './offlinePolicy';
export function canUseLocal(error:unknown){return error instanceof ApiError && offlineFallbackAllowed(error.status,error.code);}
export async function localCourseHistory(owner:string,moduleId:string){
 const l=new Library(owner);l.guard();
 const rows=await(await device()).list<PrivateChat>(`${l.prefix}course:${moduleId}:chat:`);l.guard();return rows.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
}
export async function answerCourse(owner:string,moduleId:string,question:string,conversationId:string|undefined,signal:AbortSignal):Promise<{online?:AskResponse;local?:PrivateChat}>{
 const library=new Library(owner),session=currentSession(),d=await device();
 const guard=()=>{cancelled(signal);if(currentSession()!==session||offlineScope()!==owner)throw new SessionChangedError();};
 const denied=`${library.prefix}course:${moduleId}:denied`;guard();text(question,1000,'question');
 if(isOnline()){
  try{
   const result=await api<AskResponse>(`/student/modules/${moduleId}/ask/`,{method:'POST',body:{question,conversation_id:conversationId},signal,timeoutMs:120000});
   guard();await d.removePrefix(denied);return {online:result};
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
 const ref=retrieve(m.source_text,question), history=(await localCourseHistory(owner,moduleId)).slice(-2);
 const reply=await d.complete({system:GROUNDING,prompt:`Answer only from this stored course reference. If it does not support the answer, set supported=false.\nREFERENCE:\n${ref}\nEARLIER QUESTIONS:\n${history.map(h=>h.question.slice(0,250)).join('\n')}\nQUESTION:\n${question}`,schema:ANSWER_SCHEMA,maxTokens:650,temperature:0.1,signal});
 guard();const answer=validateAnswer(reply,ref);
 // A source edit/download revocation while inference runs invalidates the result.
 const latest=await readEntry<ModuleFull>(`/student/modules/${moduleId}/`);guard();
 requireThat(latest?.availability==='open' && fingerprint(latest.source_text)===fingerprint(m.source_text),'The downloaded module changed. Ask again with the new version.');
 const row:PrivateChat={id:randomUUID(),question,...answer,createdAt:new Date().toISOString()};
 await d.put(`${library.prefix}course:${moduleId}:chat:${row.id}`,row);guard();return {local:row};
}
