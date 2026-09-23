import {useDoubtsBlocked} from './useGenerationJobs';
import {DOUBTS_PAUSED_MESSAGE} from './jobs';
import React,{useEffect,useRef,useState} from 'react';
import {View} from 'react-native';
import {useRouter} from 'expo-router';
import {useAuth} from '@/auth/AuthContext';
import {student} from '@/api/endpoints';
import type {Message} from '@/api/types';
import {Card,H2,P,Input,Button,Row,Notice,ErrorBanner} from '@/ui';
import ChatThread from './ChatThread';
import {answerCourse,localCourseHistory} from './courseDoubt';
import {useTask} from './useTask';
export default function CourseAsk({moduleId}:{moduleId:string}){ const {user}=useAuth(); return user?<CourseAskInner key={`${user.id}:${moduleId}`} moduleId={moduleId}/>:null; }
function CourseAskInner({moduleId}:{moduleId:string}){
 const {user}=useAuth(),router=useRouter(),task=useTask();
 const doubtsBlocked=useDoubtsBlocked();
 const userId=user?.id,{setError,cancel}=task;
 const [question,setQuestion]=useState(''),[messages,setMessages]=useState<(Message&{local?:boolean})[]>([]),[conversation,setConversation]=useState<string>(),[restoring,setRestoring]=useState(true);
 // The question is shown the moment it is asked, the way a chat does, rather
 // than appearing only once the answer comes back seconds later.
 const [pending,setPending]=useState('');
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
  })();return()=>{current=false;active.current=false;cancel();};
 },[moduleId,userId,setError,cancel]);
 const send=()=>{
  if(!user||restoring||doubtsBlocked||task.busy)return;const q=question.trim();if(!q)return;
  setPending(q);setQuestion('');
  void task.run(async signal=>{
   try{
    const result=await answerCourse(user.id,moduleId,q,conversation,signal);if(signal.aborted||!active.current)return;
    const now=new Date().toISOString();const local=!!result.local;
    const message:Message&{local?:boolean}=result.online?result.online.message:{id:result.local!.id,role:'assistant',content:result.local!.answer,grounded:result.local!.supported,source_reference:result.local!.quote,created_at:result.local!.createdAt,local:true};
    if(result.online)setConversation(result.online.conversation_id);
    setMessages(v=>[...v,{id:'q-'+now,role:'user',content:q,grounded:true,source_reference:'',created_at:now,local},message]);
    setPending('');
   }catch(e){
    // Put the question back in the box rather than making them retype it.
    if(active.current){setPending('');setQuestion(q);}
    throw e;
   }
  });
 };
 const bubble=(key:string,who:string,content:string,mine:boolean,quote?:string)=>
  <View key={key} style={{padding:14,borderRadius:10,backgroundColor:mine?'#EAF2ED':'#FFFFFF',borderWidth:mine?0:1,borderColor:'#E4EAE2',gap:6,alignSelf:mine?'flex-end':'stretch',maxWidth:mine?'88%':undefined}}>
   <P small muted>{who}</P><P>{content}</P>{quote?<P small muted>From the module: {quote}</P>:null}</View>;
 return <Card><H2>Ask a doubt</H2><Notice title="AI on this device" message="Questions are answered locally from your course source. Course conversations save on this device and synchronize with your institution when connected."/>
  <ChatThread empty={restoring?null:<P muted>No questions yet. Ask anything about this module.</P>}>
   {[...messages.map(m=>bubble(m.id,m.role==='user'?'You':m.local?'Local AI · this device':'Course tutor',m.content,m.role==='user',m.source_reference)),
     ...(pending?[bubble('pending','You',pending,true)]:[]),
     ...(task.busy?[<View key="thinking" style={{padding:14}}><P small muted>Reading the module…</P></View>]:[])]}
  </ChatThread>
  {doubtsBlocked?<Notice inline title="Doubts temporarily unavailable" message={DOUBTS_PAUSED_MESSAGE}/>:null}
  {restoring?<P muted>Restoring your conversation…</P>:null}<ErrorBanner message={task.error}/>
  <Input label="Your question" value={question} onChangeText={setQuestion} multiline maxLength={1000} editable={!task.busy&&!restoring&&!doubtsBlocked} placeholder="What would you like to understand?" onEnter={()=>{if(question.trim()&&!task.busy&&!restoring&&!doubtsBlocked)send();}}/>
  <Row><Button title="Ask" icon="send-outline" onPress={send} busy={task.busy} disabled={!question.trim()||restoring||doubtsBlocked}/>{task.busy?<Button title="Cancel" variant="secondary" onPress={task.cancel}/>:<Button title="Offline AI setup" variant="secondary" onPress={()=>router.push('/student/offline-ai')}/>}</Row>
 </Card>;
}
