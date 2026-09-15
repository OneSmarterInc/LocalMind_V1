import React,{useEffect,useMemo,useState} from 'react';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {useAuth} from '@/auth/AuthContext';
import {LocalAuthoring,type Draft,type ArchivedDraft} from '@/authoring/local';
import {useLibrary} from '@/private/useLibrary';
import {generationJobs} from '@/private/jobs';
import {jobScope,useGenerationJobs} from '@/private/useGenerationJobs';
import {SourceVisuals} from '@/private/SourceVisuals';
import {useTask} from '@/private/useTask';
import {Screen,PageHeading,Card,H2,P,Button,Row,Notice,ErrorBanner,Badge,confirmAsync} from '@/ui';
export default function LocalAuthoringPage(){const {user}=useAuth();return user?<Authoring key={user.id}/>:null;}
function Authoring(){
 const {id}=useLocalSearchParams<{id:string}>(),{user}=useAuth(),router=useRouter(),library=useLibrary(),task=useTask();
 const owner=user!.id;
 const service=useMemo(()=>new LocalAuthoring(owner),[owner]);
 const [draft,setDraft]=useState<Draft>(),[error,setError]=useState(''),[history,setHistory]=useState<ArchivedDraft[]>([]),[opened,setOpened]=useState('');
 const jobs=useGenerationJobs(library?.prefix||'').filter(j=>j.bookId===id);
 const busy=jobs.some(j=>['queued','running'].includes(j.state));
 useEffect(()=>{let live=true;void service.history(id).then(h=>{if(live)setHistory(h);}).catch(e=>{if(live)setError(String(e));});const read=()=>service.read(id).then(v=>{if(live)setDraft(v);}).catch(e=>{if(live)setError(String(e));});void read();const timer=setInterval(read,1000);return()=>{live=false;clearInterval(timer);};},[service,id]);
 const generate=(kind:'lesson'|'quiz')=>{try{setError('');generationJobs.enqueue({scope:jobScope(library!.prefix),bookId:id,sectionId:id,kind:'staff-'+kind,label:`${draft?.snapshot.title||'Module'} · ${kind}`},(signal,progress)=>service.generate(id,kind,signal,progress));}catch(e){setError(String(e));}};
 return <Screen><PageHeading title={draft?.snapshot.title||'Local authoring'} subtitle="Generate on this device. Review and share with your institution." right={<Button title="Offline AI" variant="secondary" onPress={()=>router.push('/manage/offline-ai')}/>}/>
 <ErrorBanner message={error||task.error}/>
 <Card><Row><Button title="Save module on this device" disabled={busy||!!draft?.localBook} busy={task.busy} onPress={()=>task.run(async()=>{setDraft(await service.download(id));})}/><Button title="Books & modules" variant="secondary" onPress={()=>router.push('/manage/books')}/></Row>
 <P muted>Save the authorized source while connected. Generation then works offline. Reviewed lessons are synchronized to the course; quizzes are synchronized as drafts for the existing publication workflow.</P></Card>
 {draft?<><Card><H2>Source</H2><P>{draft.snapshot.source}</P>{draft.sourceBook&&draft.sourceSection?<SourceVisuals bookId={draft.sourceBook} sectionId={draft.sourceSection} sourceLibrary={service.library}/>:null}</Card>
 {draft.localBook?<Button title="Open local book synchronization" variant="secondary" onPress={()=>router.push('/manage/local-books')}/>:null}
 <Card><Row><Button title="Generate local lesson" disabled={busy||task.busy} onPress={()=>generate('lesson')}/><Button title="Generate local quiz" disabled={busy||task.busy} onPress={()=>generate('quiz')}/></Row>
 {draft.run?<P muted>Saved through part {draft.run.done}. Select the same generation again after an interruption to resume.</P>:null}
 {jobs.map(j=><Row key={j.id}><Badge value={j.state}/><P>{j.error||j.note}</P>{['queued','running'].includes(j.state)?<Button title="Cancel generation" small variant="secondary" onPress={()=>generationJobs.cancel(j.id)}/>:null}</Row>)}
 </Card>
 {draft.lesson?<Card><H2>Review lesson</H2><P>{draft.lesson.introduction}</P>{draft.lesson.sections.map((s,i)=><Card key={i}><H2>{s.heading}</H2><P>{s.content}</P><P small muted>Source: {s.quote}</P></Card>)}<Button title="Approve and synchronize lesson" disabled={busy} busy={task.busy} onPress={()=>task.run(async()=>{setDraft(await service.share(id,'lesson'));})}/></Card>:null}
 {draft.questions?<Card><H2>Review quiz</H2>{draft.questions.map((q,i)=><Card key={i}><P>{i+1}. {q.question}</P>{q.options.map((o,n)=><P key={n}>{String.fromCharCode(65+n)}. {o}{n===q.answer?' — correct':''}</P>)}<P>{q.explanation}</P><P small muted>Source: {q.quote}</P></Card>)}<Button title="Approve and synchronize quiz draft" disabled={busy} busy={task.busy} onPress={()=>task.run(async()=>{setDraft(await service.share(id,'quiz'));})}/></Card>:null}
 {draft.state?<Notice title={draft.state==='synced'?'Received by institution':draft.state==='conflict'?'Review needed':'Waiting to synchronize'} message={draft.error||'Reviewed work is retained on this device.'}/>:null}
 {draft.state==='pending'||draft.state==='conflict'?<Button title="Retry synchronization" disabled={busy} busy={task.busy} onPress={()=>task.run(async()=>{setDraft(await service.flush(id));})}/>:null}
 <Button title="Refresh source and keep draft in history" variant="secondary" disabled={busy||task.busy||draft.state==='pending'||(!!draft.localBook&&!draft.snapshot.remote_id)} onPress={()=>task.run(async()=>{
  if(await confirmAsync('Refresh this module?', 'Your current source, generated content and sync details will remain in local draft history. The latest authorized source will become your working copy. Generate and review against that source before sharing again.', 'Keep draft and refresh', 'Stay')){setDraft(await service.refreshSource(id));setHistory(await service.history(id));}
 })}/>
 </>:null}
 {history.length?<Card><H2>Previous local drafts</H2><P muted>These copies stay on this device. Their content is not automatically submitted against a newer source.</P>{history.map(h=><Card key={h.id}><Row><P>{h.draft.snapshot.title} · {new Date(h.archivedAt).toLocaleString()}</P><Button title={opened===h.id?'Close previous draft':'View previous draft'} small variant="secondary" onPress={()=>setOpened(opened===h.id?'':h.id)}/></Row>{opened===h.id?<><H2>Previous source</H2><P>{h.draft.snapshot.source}</P>{h.draft.error?<P>{h.draft.error}</P>:null}{h.draft.run?<><H2>Interrupted generation</H2><P>{h.draft.run.done} complete module parts were retained.</P>{h.draft.run.lessonParts.flatMap(p=>p.sections).map((s,i)=><Card key={i}><H2>{s.heading}</H2><P>{s.content}</P><P small muted>Source: {s.quote}</P></Card>)}{h.draft.run.questions.map((q,i)=><P key={i}>{q.question} · Correct answer: {q.options[q.answer]}</P>)}</>:null}{h.draft.lesson?<><H2>Previous lesson</H2><P>{h.draft.lesson.introduction}</P>{h.draft.lesson.sections.map((s,i)=><Card key={i}><H2>{s.heading}</H2><P>{s.content}</P><P small muted>Source: {s.quote}</P></Card>)}</>:null}{h.draft.questions?<><H2>Previous quiz</H2>{h.draft.questions.map((q,i)=><Card key={i}><P>{q.question}</P>{q.options.map((o,n)=><P key={n}>{String.fromCharCode(65+n)}. {o}{n===q.answer?' — correct':''}</P>)}<P>{q.explanation}</P><P small muted>Source: {q.quote}</P></Card>)}</>:null}</>:null}</Card>)}</Card>:null}
 </Screen>;
}
