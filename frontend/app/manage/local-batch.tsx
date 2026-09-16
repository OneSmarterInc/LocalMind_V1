import React,{useEffect,useMemo,useState} from 'react';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {useAuth} from '@/auth/AuthContext';
import {manage} from '@/api/endpoints';
import {runMissingBatch} from '@/authoring/batch';
import {LocalAuthoring,type Draft} from '@/authoring/local';
import {useLibrary} from '@/private/useLibrary';
import {generationJobs} from '@/private/jobs';
import {jobScope,useGenerationJobs} from '@/private/useGenerationJobs';
import {useTask} from '@/private/useTask';
import {Screen,PageHeading,Card,H2,P,Button,Row,ErrorBanner,Badge} from '@/ui';
async function draftsFor(service:LocalAuthoring,documentId:string){
 const unique=new Map<string,Draft>();
 for(const draft of await service.drafts())if(draft.snapshot.document_id===documentId){
  const remote=draft.snapshot.remote_id||draft.snapshot.module_id;
  if(!unique.has(remote)||draft.localBook)unique.set(remote,draft);
 }
 return [...unique.values()];
}
export default function LocalBatch(){const {user}=useAuth();return user?<Batch key={user.id} owner={user.id}/>:null;}
function Batch({owner}:{owner:string}){
 const {document:id}=useLocalSearchParams<{document:string}>(),router=useRouter(),library=useLibrary(),task=useTask();
 const service=useMemo(()=>new LocalAuthoring(owner),[owner]);
 const [rows,setRows]=useState<Draft[]>([]),[error,setError]=useState('');
 const jobs=useGenerationJobs(library?.prefix||'').filter(j=>j.bookId===id&&j.kind==='staff-batch');
 const busy=jobs.some(j=>['running','queued'].includes(j.state));
 useEffect(()=>{let live=true;const read=()=>draftsFor(service,id).then(v=>{if(live)setRows(v);}).catch(e=>{if(live)setError(String(e));});void read();const timer=setInterval(read,1500);return()=>{live=false;clearInterval(timer);};},[service,id]);
 const run=(kind:'lesson'|'quiz')=>{try{
  setError('');const ids=rows.map(d=>d.snapshot.module_id);
  generationJobs.enqueue({scope:jobScope(library!.prefix),bookId:id,sectionId:id,kind:'staff-batch',label:`Book · local ${kind}s`},(signal,progress)=>runMissingBatch({ids,kind,signal,read:id=>service.read(id),generate:(...args)=>service.generate(...args),progress})
  );
 }catch(e){setError(String(e));}};
 return <Screen><PageHeading title="Prepare this book on your device" subtitle="Save source modules, generate missing content locally, then review each draft." right={<Button title="Offline AI" variant="secondary" onPress={()=>router.push('/manage/offline-ai')}/>}/>
 <ErrorBanner message={error||task.error}/><Card><Button title="Save book sources on this device" disabled={busy} busy={task.busy} onPress={()=>task.run(async signal=>{
  const book=await manage.document(id);service.library.guard();const saved=await draftsFor(service,id);
  for(const chapter of book.chapters||[])for(const module of chapter.modules){if(signal.aborted)return;if(module.id&&module.source_text?.trim())await service.download(saved.find(d=>(d.snapshot.remote_id||d.snapshot.module_id)===module.id)?.snapshot.module_id||module.id);}
  setRows(await draftsFor(service,id));
 })}/><P muted>Save sources while connected. Generation works offline and continues while you navigate. Completed drafts survive refresh; start the same batch again to finish remaining modules. Drafts still require your review before synchronization.</P>
 <Row><Button title="Generate missing lessons locally" disabled={busy||task.busy||!rows.length} onPress={()=>run('lesson')}/><Button title="Generate missing quizzes locally" disabled={busy||task.busy||!rows.length} onPress={()=>run('quiz')}/></Row>
 {jobs.map(j=><Row key={j.id}><Badge value={j.state}/><P>{j.error||j.note}</P>{['running','queued'].includes(j.state)?<Button title="Cancel batch" variant="secondary" onPress={()=>generationJobs.cancel(j.id)}/>:null}</Row>)}</Card>
 <Card><H2>Saved modules</H2>{rows.map(d=><Row key={d.snapshot.module_id}><P>{d.snapshot.title} · Lesson {d.lesson?'saved':'missing'} · Quiz {d.questions?.length?'saved':'missing'}</P><Button title="Review local draft" small variant="secondary" onPress={()=>router.push(`/manage/local-authoring/${d.snapshot.module_id}`)}/></Row>)}</Card></Screen>;
}
