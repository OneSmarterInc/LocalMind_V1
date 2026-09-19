import React,{useEffect,useMemo,useState} from 'react';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {useAuth} from '@/auth/AuthContext';
import {LocalQuizzes,type QuizDraft} from '@/authoring/quizzes';
import {device} from '@/private/device';
import {generationJobs} from '@/private/jobs';
import {useLibrary} from '@/private/useLibrary';
import {jobScope,useGenerationJobs} from '@/private/useGenerationJobs';
import {useTask} from '@/private/useTask';
import {Screen,PageHeading,Card,H2,P,Button,Row,ErrorBanner,Badge,Loading,Empty} from '@/ui';
export default function QuizDrafts(){const {user}=useAuth();return user?<Drafts key={user.id} owner={user.id}/>:null;}
function Drafts({owner}:{owner:string}){
 const service=useMemo(()=>new LocalQuizzes(owner),[owner]),router=useRouter(),{id}=useLocalSearchParams<{id?:string}>(),library=useLibrary(),task=useTask();
 const [rows,setRows]=useState<QuizDraft[]>([]),[loaded,setLoaded]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState('');
 const jobs=useGenerationJobs(library?.prefix||'');
 useEffect(()=>{let live=true;const read=async()=>{try{const [rows,status]=await Promise.all([service.list(),device().then(d=>d.status())]);if(live){setRows(rows);setReady(status.installed);setLoaded(true);}}catch(e){if(live)setError(String(e));}};void read();const timer=setInterval(read,1000);return()=>{live=false;clearInterval(timer);};},[service]);
 const generate=(row:QuizDraft)=>{try{generationJobs.enqueue({scope:jobScope(library!.prefix),bookId:row.id,documentIds:row.sources.map(s=>s.document_id),sectionId:row.id,kind:'staff-quiz-selection',label:row.title},(signal,progress)=>service.generate(row.id,signal,progress));}catch(e){setError(String(e));}};
 return <Screen><PageHeading title="Quiz drafts" subtitle="Questions save automatically. Review before sharing and publishing." right={<Button title="Create quiz" onPress={()=>router.push('/manage/quiz/new')}/>}/><ErrorBanner message={error||task.error}/>
 {!loaded&&!error?<Loading/>:null}
 {loaded&&!rows.some(row=>!id||row.id===id)?<Empty title={id?"Quiz draft not found":"No quiz drafts yet"} text={id?"This draft may have been removed. Open all drafts or create a quiz.":"Create a quiz to start preparing questions."}/>:null}
 {id?<Button title="Show all drafts" variant="secondary" onPress={()=>router.replace("/manage/local-quizzes")}/>:null}
 {loaded&&!ready?<Card><P>Set up your model before generating questions.</P><Button title="Offline AI" onPress={()=>router.push('/manage/offline-ai')}/></Card>:null}
 {rows.filter(row=>!id||row.id===id).map(row=>{const job=jobs.find(j=>j.bookId===row.id&&j.kind==='staff-quiz-selection'),busy=job&&['queued','running'].includes(job.state);return <Card key={row.id}><Row><H2>{row.title}</H2><Badge value={row.state}/></Row><P>{row.questions.length} of {row.count} questions saved · {row.sources.length} source modules</P>{row.error?<P>{row.error}</P>:null}{job?<P>{job.state} · {job.error||job.note}</P>:null}
 {row.state==='draft'&&row.done<row.parts.length?<Button title={row.done?'Resume generation':'Generate questions'} disabled={!ready||!!busy} onPress={()=>generate(row)}/>:null}
 {busy?<Button title="Cancel generation" variant="secondary" onPress={()=>generationJobs.cancel(job.id)}/>:null}
 {row.questions.map((q,i)=><Card key={i}><P>{i+1}. {q.question}</P>{q.options.map((o,n)=><P key={n}>{String.fromCharCode(65+n)}. {o}{n===q.answer?' — correct':''}</P>)}<P>{q.explanation}</P><P muted>Source: {q.quote}</P></Card>)}
 {row.state==='draft'&&row.questions.length===row.count?<Button title="Approve and synchronize quiz" busy={task.busy} onPress={()=>task.run(()=>service.approve(row.id))}/>:null}
 {row.state==='pending'?<Button title="Retry synchronization" busy={task.busy} onPress={()=>task.run(()=>service.flush(row.id))}/>:null}
 {row.state==='conflict'?<P>Your draft is retained. Review updated module sources before creating a replacement quiz.</P>:null}
 {row.quizId?<Button title="Open quiz settings and publish" onPress={()=>router.push(`/manage/quiz/${row.quizId}`)}/>:null}
 </Card>;})}</Screen>;
}
