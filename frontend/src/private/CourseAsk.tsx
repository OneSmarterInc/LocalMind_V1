import React,{useEffect,useRef,useState} from 'react';
import {View} from 'react-native';
import {useRouter} from 'expo-router';
import {useAuth} from '@/auth/AuthContext';
import {student} from '@/api/endpoints';
import type {Message} from '@/api/types';
import {useOnline} from '@/offline/connectivity';
import {Card,H2,P,Input,Button,Row,Notice,ErrorBanner,colors} from '@/ui';
import {answerCourse,localCourseHistory} from './courseDoubt';
import {useTask} from './useTask';
export default function CourseAsk({moduleId}:{moduleId:string}){ const {user}=useAuth(); return user?<CourseAskInner key={`${user.id}:${moduleId}`} moduleId={moduleId}/>:null; }
function CourseAskInner({moduleId}:{moduleId:string}){
 const {user}=useAuth(),online=useOnline(),router=useRouter(),task=useTask();
 const [question,setQuestion]=useState(''),[messages,setMessages]=useState<(Message&{local?:boolean})[]>([]),[conversation,setConversation]=useState<string>(),[restoring,setRestoring]=useState(true);
 const active=useRef(true);
 useEffect(()=>{
  active.current=true;setRestoring(true);setMessages([]);setConversation(undefined);
  (async()=>{
   let rows:Message[]=[];
   try{const latest=(await student.conversations(moduleId))[0];if(latest){const full=await student.conversation(latest.id);if(active.current)setConversation(latest.id);rows=full.messages||[];}}catch{/* Offline history below is independent. */}
   if(user){try{const local=await localCourseHistory(user.id,moduleId);rows.push(...local.flatMap(h=>[{id:h.id+'-q',role:'user' as const,content:h.question,grounded:true,source_reference:'',created_at:h.createdAt,local:true},{id:h.id,role:'assistant' as const,content:h.answer,grounded:h.supported,source_reference:h.quote,created_at:h.createdAt,local:true}]));}catch(e){if(active.current)task.setError(String(e));}}
   if(active.current){setMessages(rows.sort((a,b)=>a.created_at.localeCompare(b.created_at)));setRestoring(false);}
  })();return()=>{active.current=false;task.cancel();};
 },[moduleId,user?.id]);
 const send=()=>task.run(async signal=>{
  if(!user||restoring)return;const q=question.trim();const result=await answerCourse(user.id,moduleId,q,conversation,signal);if(signal.aborted||!active.current)return;
  const now=new Date().toISOString();const local=!!result.local;
  const message:Message&{local?:boolean}=result.online?result.online.message:{id:result.local!.id,role:'assistant',content:result.local!.answer,grounded:result.local!.supported,source_reference:result.local!.quote,created_at:result.local!.createdAt,local:true};
  if(result.online)setConversation(result.online.conversation_id);
  setMessages(v=>[...v,{id:'q-'+now,role:'user',content:q,grounded:true,source_reference:'',created_at:now,local},message]);setQuestion('');
 });
 return <Card><H2>Ask a doubt</H2><Notice title={online?'Course tutor':'Using offline AI'} message={online?'Ask about this module. If the server disconnects, the installed local model can answer from your downloaded source.':'New doubts can be answered by the model on this device. These offline questions and answers stay here; they are not uploaded on reconnection.'}/>
  {messages.map(m=><View key={m.id} style={{padding:14,borderRadius:8,backgroundColor:m.role==='user'?'#EAF2ED':colors.bg,gap:6}}><P small muted>{m.role==='user'?'You':m.local?'Local AI · this device':'Course tutor'}</P><P>{m.content}</P>{m.source_reference?<P small muted>From the module: {m.source_reference}</P>:null}</View>)}
  {restoring?<P muted>Restoring your conversation…</P>:null}<ErrorBanner message={task.error}/>
  <Input label="Your question" value={question} onChangeText={setQuestion} multiline maxLength={1000} editable={!task.busy&&!restoring} placeholder="What would you like to understand?"/>
  <Row><Button title="Ask" icon="send-outline" onPress={send} busy={task.busy} disabled={!question.trim()||restoring}/>{task.busy?<Button title="Cancel" variant="secondary" onPress={task.cancel}/>:<Button title="Offline AI setup" variant="secondary" onPress={()=>router.push('/student/offline-ai')}/>}</Row>
 </Card>;
}
