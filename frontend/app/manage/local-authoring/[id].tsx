import React,{useEffect,useMemo,useState} from 'react';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {useAuth} from '@/auth/AuthContext';
import {LocalAuthoring,type Draft} from '@/authoring/local';
import {useLibrary} from '@/private/useLibrary';
import {generationJobs} from '@/private/jobs';
import {jobScope,useGenerationJobs} from '@/private/useGenerationJobs';
import {useTask} from '@/private/useTask';
import {Screen,PageHeading,Card,H2,P,Button,Row,Notice,ErrorBanner,Badge} from '@/ui';
export default function LocalAuthoringPage(){const {user}=useAuth();return user?<Authoring key={user.id}/>:null;}
function Authoring(){
 const {id}=useLocalSearchParams<{id:string}>(),{user}=useAuth(),router=useRouter(),library=useLibrary(),task=useTask();
 const owner=user!.id;
 const service=useMemo(()=>new LocalAuthoring(owner),[owner]);
 const [draft,setDraft]=useState<Draft>(),[error,setError]=useState('');
 const jobs=useGenerationJobs(library?.prefix||'').filter(j=>j.bookId===id);
 const busy=jobs.some(j=>['queued','running'].includes(j.state));
 useEffect(()=>{let live=true;const read=()=>service.read(id).then(v=>{if(live)setDraft(v);}).catch(e=>{if(live)setError(String(e));});void read();const timer=setInterval(read,1000);return()=>{live=false;clearInterval(timer);};},[service,id]);
 const generate=(kind:'lesson'|'quiz')=>{try{setError('');generationJobs.enqueue({scope:jobScope(library!.prefix),bookId:id,sectionId:id,kind:'staff-'+kind,label:`${draft?.snapshot.title||'Module'} · ${kind}`},(signal,progress)=>service.generate(id,kind,signal,progress));}catch(e){setError(String(e));}};
 return <Screen><PageHeading title={draft?.snapshot.title||'Local authoring'} subtitle="Generate on this device. Review and share with your institution." right={<Button title="Offline AI" variant="secondary" onPress={()=>router.push('/manage/offline-ai')}/>}/>
 <ErrorBanner message={error||task.error}/>
 <Card><Row><Button title="Save module on this device" disabled={busy} busy={task.busy} onPress={()=>task.run(async()=>{setDraft(await service.download(id));})}/><Button title="Books & modules" variant="secondary" onPress={()=>router.push('/manage/books')}/></Row>
 <P muted>Save the authorized source while connected. Generation then works offline. Reviewed lessons are synchronized to the course; quizzes are synchronized as drafts for the existing publication workflow.</P></Card>
 {draft?<><Card><H2>Source</H2><P>{draft.snapshot.source}</P></Card>
 <Card><Row><Button title="Generate local lesson" disabled={busy||task.busy} onPress={()=>generate('lesson')}/><Button title="Generate local quiz" disabled={busy||task.busy} onPress={()=>generate('quiz')}/></Row>
 {draft.run?<P muted>Saved through part {draft.run.done}. Select the same generation again after an interruption to resume.</P>:null}
 {jobs.map(j=><Row key={j.id}><Badge value={j.state}/><P>{j.error||j.note}</P>{['queued','running'].includes(j.state)?<Button title="Cancel generation" small variant="secondary" onPress={()=>generationJobs.cancel(j.id)}/>:null}</Row>)}
 </Card>
 {draft.lesson?<Card><H2>Review lesson</H2><P>{draft.lesson.introduction}</P>{draft.lesson.sections.map((s,i)=><Card key={i}><H2>{s.heading}</H2><P>{s.content}</P><P small muted>Source: {s.quote}</P></Card>)}<Button title="Approve and synchronize lesson" disabled={busy} busy={task.busy} onPress={()=>task.run(async()=>{setDraft(await service.share(id,'lesson'));})}/></Card>:null}
 {draft.questions?<Card><H2>Review quiz</H2>{draft.questions.map((q,i)=><Card key={i}><P>{i+1}. {q.question}</P>{q.options.map((o,n)=><P key={n}>{String.fromCharCode(65+n)}. {o}{n===q.answer?' — correct':''}</P>)}<P>{q.explanation}</P><P small muted>Source: {q.quote}</P></Card>)}<Button title="Approve and synchronize quiz draft" disabled={busy} busy={task.busy} onPress={()=>task.run(async()=>{setDraft(await service.share(id,'quiz'));})}/></Card>:null}
 {draft.state?<Notice title={draft.state==='synced'?'Received by institution':draft.state==='conflict'?'Review needed':'Waiting to synchronize'} message={draft.error||'Reviewed work is retained on this device.'}/>:null}
 {draft.state==='pending'||draft.state==='conflict'?<Button title="Retry synchronization" disabled={busy} busy={task.busy} onPress={()=>task.run(async()=>{setDraft(await service.flush(id));})}/>:null}
 </>:null}</Screen>;
}
