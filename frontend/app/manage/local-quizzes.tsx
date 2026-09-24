import React,{useEffect,useMemo,useState} from 'react';
import {View} from 'react-native';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {useAuth} from '@/auth/AuthContext';
import {LocalQuizzes,type QuizDraft} from '@/authoring/quizzes';
import {device} from '@/private/device';
import {generationJobs} from '@/private/jobs';
import {useLibrary} from '@/private/useLibrary';
import {jobScope,useGenerationJobs} from '@/private/useGenerationJobs';
import {useTask} from '@/private/useTask';
import {Screen,PageHeading,Card,CardHead,P,Button,Row,Divider,ErrorBanner,Badge,Notice,Loading,Empty,ProgressBar,TextLink,colors,fmtDate} from '@/ui';
import {SyncAllButton} from '@/authoring/SyncAllButton';
import { everyVisible } from "@/hooks/visibleInterval";

/** Draft, pending, synced and conflict each mean something different to the
 *  person reading the list, and all four used to arrive in the same grey. */
const STATE_TONE={draft:'neutral',pending:'blue',synced:'green',conflict:'amber'} as const;
const STATE_LABEL={draft:'Draft',pending:'Sending',synced:'Synchronized',conflict:'Needs review'} as const;

export default function QuizDrafts(){const {user}=useAuth();return user?<Drafts key={user.id} owner={user.id}/>:null;}

function Drafts({owner}:{owner:string}){
 const service=useMemo(()=>new LocalQuizzes(owner),[owner]),router=useRouter(),{id}=useLocalSearchParams<{id?:string}>(),library=useLibrary(),task=useTask();
 const [rows,setRows]=useState<QuizDraft[]>([]),[loaded,setLoaded]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState('');
 const [open,setOpen]=useState<Record<string,boolean>>({});
 const jobs=useGenerationJobs(library?.prefix||'');
 useEffect(()=>{let live=true;const read=async()=>{try{const [rows,status]=await Promise.all([service.list(),device().then(d=>d.status())]);if(live){setRows(rows);setReady(status.installed);setLoaded(true);}}catch(e){if(live)setError(String(e));}};void read();const stop=everyVisible(read,1000);return()=>{live=false;stop();};},[service]);
 const generate=(row:QuizDraft)=>{try{generationJobs.enqueue({scope:jobScope(library!.prefix),bookId:row.id,documentIds:row.sources.map(s=>s.document_id),sectionId:row.id,kind:'staff-quiz-selection',label:row.title},(signal,progress)=>service.generate(row.id,signal,progress));}catch(e){setError(String(e));}};
 const shown=rows.filter(row=>!id||row.id===id);
 return <Screen><PageHeading title="Quiz drafts" subtitle="Questions save automatically. Review before sharing and publishing." right={<Button title="Create quiz" icon="add" onPress={()=>router.push('/manage/quiz/new')}/>}/><ErrorBanner message={error||task.error}/>
  {/* Synchronize is one action among several, not the headline: it used to run
      the full width of the page above every draft, heavier than the drafts it
      was acting on. */}
  {loaded&&!id&&rows.length?<Row><SyncAllButton owner={owner} scope={{lessons:false,quizzes:false,selections:true}} title="Synchronize all finished quizzes"/></Row>:null}
  {!loaded&&!error?<Loading/>:null}
  {loaded&&!shown.length?<Empty title={id?"Quiz draft not found":"No quiz drafts yet"} text={id?"This draft may have been removed. Open all drafts or create a quiz.":"Create a quiz to start preparing questions."}/>:null}
  {id?<Row><Button title="Show all drafts" icon="arrow-back" variant="secondary" onPress={()=>router.replace("/manage/local-quizzes")}/></Row>:null}
  {loaded&&!ready?<Notice tone="warning" title="No model installed" message="Set up your offline model before generating questions." action={<Button title="Offline AI" small variant="secondary" onPress={()=>router.push('/manage/offline-ai')}/>}/>:null}
  {shown.map(row=>{
   const job=jobs.find(j=>j.bookId===row.id&&j.kind==='staff-quiz-selection'),busy=!!job&&['queued','running'].includes(job.state);
   const saved=row.questions.length,complete=saved>=row.count;
   // Two drafts of the same lesson carry the same title, so the list showed
   // "Unit test 1" twice with nothing to tell them apart.
   const made=fmtDate(row.createdAt);
   return <Card key={row.id}>
    <CardHead icon="help-circle-outline" title={row.title}
     subtitle={`${row.sources.length} source module${row.sources.length===1?'':'s'}${made?` · started ${made}`:''}`}
     action={<Badge value={STATE_LABEL[row.state]} tone={STATE_TONE[row.state]}/>}/>
    <View style={{gap:6}}>
     <Row style={{justifyContent:'space-between'}}>
      <P small muted>{saved} of {row.count} questions saved</P>
      {complete?<P small style={{color:colors.primary,fontWeight:'600'}}>Ready to synchronize</P>:null}
     </Row>
     <ProgressBar value={row.count?(saved/row.count)*100:0} tone={complete?'green':'amber'}/>
    </View>
    {row.error?<Notice inline tone="warning" title="Generation problem" message={row.error}/>:null}
    {job&&(busy||job.error)?<Notice inline tone={job.error?'warning':'info'} message={job.error||job.note||'Generating questions on this device.'}/>:null}
    {row.state==='conflict'?<Notice inline tone="warning" title="Module sources changed" message="Your draft is retained. Review the updated module sources before creating a replacement quiz."/>:null}
    <Row>
     {row.state==='draft'&&row.done<row.parts.length?<Button title={row.done?'Resume generation':'Generate questions'} icon="sparkles-outline" disabled={!ready||busy} onPress={()=>generate(row)}/>:null}
     {job&&busy?<Button title="Cancel generation" variant="secondary" icon="pause-outline" onPress={()=>generationJobs.cancel(job.id)}/>:null}
     {row.state==='draft'&&complete?<Button title="Approve and synchronize" icon="cloud-upload-outline" busy={task.busy} onPress={()=>task.run(()=>service.approve(row.id))}/>:null}
     {row.state==='pending'?<Button title="Retry synchronization" variant="secondary" icon="refresh" busy={task.busy} onPress={()=>task.run(()=>service.flush(row.id))}/>:null}
     {row.quizId?<Button title="Open quiz settings and publish" variant="secondary" icon="settings-outline" onPress={()=>router.push(`/manage/quiz/${row.quizId}`)}/>:null}
     {saved?<TextLink title={open[row.id]?`Hide questions`:`Review ${saved} question${saved===1?'':'s'}`} icon={open[row.id]?'chevron-up':'chevron-down'} onPress={()=>setOpen(o=>({...o,[row.id]:!o[row.id]}))}/>:null}
    </Row>
    {open[row.id]?<View style={{gap:14}}>
     {/* Each question used to be a card inside a card, with the correct option
         marked by an em dash in the middle of a line of prose. */}
     {row.questions.map((q,i)=><View key={i} style={{gap:6}}>
      <Divider/>
      <P style={{fontWeight:'600'}}>{i+1}. {q.question}</P>
      {q.options.map((o,n)=><Row key={n} style={{gap:8}}>
       <P small muted style={{width:16}}>{String.fromCharCode(65+n)}</P>
       <P small style={n===q.answer?{color:colors.ink,fontWeight:'600'}:undefined}>{o}</P>
       {n===q.answer?<Badge value="Correct" tone="green"/>:null}
      </Row>)}
      {q.explanation?<P small muted>{q.explanation}</P>:null}
      {q.quote?<P small muted style={{fontStyle:'italic'}}>From the module: {q.quote}</P>:null}
     </View>)}
    </View>:null}
   </Card>;})}
 </Screen>;
}
