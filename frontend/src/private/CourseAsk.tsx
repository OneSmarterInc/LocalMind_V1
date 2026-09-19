import {useAsync} from "@/hooks/useAsync";
import {Library} from "./library";
import {queueDoubt,pendingDoubt} from "./pendingDoubts";
import {useGenerationJobs,useDoubtsBlocked} from "./useGenerationJobs";
import {DOUBTS_PAUSED_MESSAGE} from './jobs';
import React,{useEffect,useRef,useState,useMemo} from 'react';
import {View} from 'react-native';
import {useAuth} from '@/auth/AuthContext';
import {student} from '@/api/endpoints';
import type {Message} from '@/api/types';
import {Card,H2,P,Input,Button,Row,Notice,ErrorBanner,colors} from '@/ui';
import {answerCourse,localCourseHistory} from './courseDoubt';
export default function CourseAsk({moduleId}:{moduleId:string}){ const {user}=useAuth(); return user?<CourseAskInner key={`${user.id}:${moduleId}`} moduleId={moduleId}/>:null; }
function CourseAskInner({moduleId}:{moduleId:string}){
 const {user}=useAuth();
 const owner=user!.id;
 const library=useMemo(()=>new Library(owner),[owner]);
 const jobs=useGenerationJobs(library.prefix).filter(j=>j.bookId===`course:${moduleId}`);
 const version=jobs.map(j=>`${j.id}:${j.state}`).join(",");
 const pending=useAsync(()=>pendingDoubt(library,`course:${moduleId}`,moduleId),[library,moduleId,version]);
 const busy=jobs.some(j=>["queued","running"].includes(j.state));
 const [error,setError]=useState("");
 const doubtsBlocked=useDoubtsBlocked();
 const userId=user?.id;
 const [question,setQuestion]=useState(''),[messages,setMessages]=useState<(Message&{local?:boolean})[]>([]),[conversation,setConversation]=useState<string>(),[restoring,setRestoring]=useState(true);
 const active=useRef(true);
 useEffect(()=>{
  let current=true;active.current=true;setRestoring(true);setMessages([]);setConversation(undefined);
  (async()=>{
   let rows:Message[]=[];
   let local:Awaited<ReturnType<typeof localCourseHistory>>=[];
   if(userId){try{local=await localCourseHistory(userId,moduleId);}catch(e){if(current)setError(String(e));}}
   try{
    const conversations=await student.conversations(moduleId);
    if(current)setConversation(conversations[0]?.id);
    // Each synchronized device answer has a stable conversation ID. Restore all
    // institutional threads, but do not duplicate records already on this device.
    for(const c of conversations){
     if(!current)return;
     if(local.some(h=>h.conversationId===c.id))continue;
     const full=await student.conversation(c.id);rows.push(...(full.messages||[]));
    }
   }catch{/* Offline records remain available even if the server cannot be reached. */}
   rows.push(...local.flatMap(h=>[{id:h.id+'-q',role:'user' as const,content:h.question,grounded:true,source_reference:'',created_at:h.createdAt,local:true},{id:h.id,role:'assistant' as const,content:h.answer,grounded:h.supported,source_reference:h.quote,created_at:h.createdAt,local:true}]));
   if(current){setMessages(rows.sort((a,b)=>a.created_at.localeCompare(b.created_at)));setRestoring(false);}
  })();return()=>{current=false;active.current=false;};
 },[moduleId,userId,setError,version]);
 const send = (retry?: string) => {
  if (!user || restoring || doubtsBlocked || busy) return;
  const q = (retry || question).trim(); if(!q)return;
  setError("");
  void queueDoubt(library,`course:${moduleId}`,moduleId,q,signal=>answerCourse(user.id,moduleId,q,conversation,signal)).then(()=>{if(active.current){setQuestion("");void pending.reload();}}).catch(e=>{if(active.current)setError(String(e));});
 };
 return <Card><H2>Ask a doubt</H2><Notice title="AI on this device" message="Questions are answered locally from your course source. Course conversations save on this device and synchronize with your institution when connected."/>
  {messages.map(m=><View key={m.id} style={{padding:14,borderRadius:8,backgroundColor:m.role==='user'?'#EAF2ED':colors.bg,gap:6}}><P small muted>{m.role==='user'?'You':m.local?'Local AI · this device':'Course tutor'}</P><P>{m.content}</P>{m.source_reference?<P small muted>From the module: {m.source_reference}</P>:null}</View>)}
  {doubtsBlocked?<Notice autoDismiss={false} title="Doubts temporarily unavailable" message={DOUBTS_PAUSED_MESSAGE}/>:null}
  {restoring?<P muted>Restoring your conversation…</P>:null}<ErrorBanner message={error||pending.error}/>
  <Input label="Your question" value={question} onChangeText={setQuestion} multiline maxLength={1000} editable={!busy&&!restoring&&!doubtsBlocked} placeholder="What would you like to understand?"/>
  {pending.data?<View style={{padding:14,borderRadius:8,backgroundColor:colors.bg,gap:8}}><P>You: {pending.data.question}</P><P small muted>{busy?"Preparing your answer. You can leave this page.":pending.data.error||"Answer interrupted. Your question is saved."}</P>{!busy?<Button title="Retry answer" variant="secondary" disabled={doubtsBlocked||restoring} onPress={()=>send(pending.data!.question)}/>:null}</View>:null}
  <Row><Button title="Ask" icon="send-outline" onPress={()=>send()} busy={busy} disabled={!question.trim()||restoring||doubtsBlocked}/></Row>
 </Card>;
}
