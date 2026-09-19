import React,{useEffect,useMemo,useState} from 'react';
import { useBackTo } from "@/hooks/useBackTo";
import {useLocalSearchParams,useNavigation,useRouter} from 'expo-router';
import {useAuth} from '@/auth/AuthContext';
import {manage} from '@/api/endpoints';
import {ApiError} from '@/api/client';
import {device} from '@/private/device';
import {runMissingBatch} from '@/authoring/batch';
import {LocalAuthoring,type Draft} from '@/authoring/local';
import {useLibrary} from '@/private/useLibrary';
import {generationJobs} from '@/private/jobs';
import {jobScope,useGenerationJobs} from '@/private/useGenerationJobs';
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
 const {document:id}=useLocalSearchParams<{document:string}>(),router=useRouter(),library=useLibrary();
 const back=useBackTo();
 const navigation=useNavigation();
 useEffect(()=>{navigation.setOptions({backTo:id?`/manage/document/${id}?tab=outline`:"/manage/books",backLabel:"Back to outline"});},[navigation,id]);
 const service=useMemo(()=>new LocalAuthoring(owner),[owner]);
 const [preparing,setPreparing]=useState(true),[modelReady,setModelReady]=useState(false);
 const [rows,setRows]=useState<Draft[]>([]),[error,setError]=useState('');
 const jobs=useGenerationJobs(library?.prefix||'').filter(j=>j.bookId===id||j.documentId===id);
 const busy=jobs.some(j=>['running','queued'].includes(j.state));
 useEffect(()=>{let live=true;const read=()=>draftsFor(service,id).then(v=>{if(live)setRows(v);}).catch(e=>{if(live)setError(String(e));});void read();const timer=setInterval(()=>{void read();void device().then(d=>d.status()).then(s=>{if(live)setModelReady(s.installed);}).catch(()=>{});},1500);return()=>{live=false;clearInterval(timer);};},[service,id]);
 useEffect(()=>{let live=true;setPreparing(true);
  void (async()=>{
   try{const book=await manage.document(id);service.library.guard();const saved=await draftsFor(service,id);
    for(const chapter of book.chapters||[])for(const module of chapter.modules){if(!live)return;if(module.id&&module.source_text?.trim())await service.ensure(saved.find(d=>(d.snapshot.remote_id||d.snapshot.module_id)===module.id)?.snapshot.module_id||module.id);}
   }catch(e){const saved=await draftsFor(service,id);if(!saved.length||(e instanceof ApiError&&[401,403].includes(e.status)))throw e;}
   if(live)setRows(await draftsFor(service,id));
  })().catch(e=>{if(live)setError(String(e));}).finally(()=>{if(live)setPreparing(false);});
  void device().then(d=>d.status()).then(s=>{if(live)setModelReady(s.installed);}).catch(()=>{});
  return()=>{live=false;};
 },[service,id]);
 const run=(kind:'lesson'|'quiz')=>{try{
  setError('');const ids=rows.map(d=>d.snapshot.module_id);
  generationJobs.enqueue({scope:jobScope(library!.prefix),bookId:id,documentId:id,sectionId:id,kind:'staff-batch',label:`Book · local ${kind}s`},(signal,progress)=>runMissingBatch({ids,kind,signal,read:id=>service.read(id),generate:(...args)=>service.generate(...args),progress})
  );
 }catch(e){setError(String(e));}};
 return <Screen><PageHeading title="Prepare book" subtitle="Generate lessons and quizzes, then review your drafts." right={<Button title="Offline AI" variant="secondary" onPress={()=>router.push('/manage/offline-ai')}/>}/>
 <Row><Button title="Back to outline" icon="arrow-back" variant="secondary" onPress={()=>back({pathname:"/manage/document/[id]",params:{id,tab:"outline"}})}/></Row>
 <ErrorBanner message={error}/><Card><P muted>{preparing?'Preparing book sources…':'Sources and generated work save automatically.'}</P>
 {!modelReady?<P>Download or import a model in Offline AI before generating.</P>:null}
 <P muted>Continue using the app while generation runs. After a refresh, restart the batch to resume missing work. Review drafts before publishing.</P>
 <Row><Button title="Generate missing lessons" disabled={busy||preparing||!modelReady||!rows.length} onPress={()=>run('lesson')}/><Button title="Generate missing quizzes" disabled={busy||preparing||!modelReady||!rows.length} onPress={()=>run('quiz')}/></Row>
 {jobs.map(j=><Row key={j.id}><Badge value={j.state}/><P>{j.error||j.note}</P>{['running','queued'].includes(j.state)?<Button title="Cancel batch" variant="secondary" onPress={()=>generationJobs.cancel(j.id)}/>:null}</Row>)}</Card>
 <Card><H2>Saved modules</H2>{rows.map(d=><Row key={d.snapshot.module_id}><P>{d.snapshot.title} · Lesson {d.lesson?'saved':'missing'} · Quiz {d.questions?.length?'saved':'missing'}</P><Button title="Review draft" small variant="secondary" onPress={()=>router.push(`/manage/local-authoring/${d.snapshot.module_id}`)}/></Row>)}</Card></Screen>;
}
