import React,{useState} from 'react';
import * as Picker from 'expo-document-picker';
import {useRouter} from 'expo-router';
import {Screen,Card,PageHeading,PageTabs,Button,Row,H2,P,ErrorBanner,Notice,Empty,ListRow,Badge,Input,Loading,confirmAsync} from '@/ui';
import {useAsync} from '@/hooks/useAsync';
import {useOnline} from '@/offline/connectivity';
import {useLibrary} from '../useLibrary';
import {useTask} from '../useTask';
import {device} from '../device';
import {sharedBooks,downloadShared,type SharedBook} from '../catalogue';
export default function PrivateLibrary(){
 const router=useRouter(), library=useLibrary(),online=useOnline(),task=useTask();
 const [tab,setTab]=useState<'device'|'institution'>('device'),[search,setSearch]=useState('');
 const books=useAsync(()=>library?.books()||Promise.resolve([]),[library]);
 const available=useAsync(()=>tab==='institution'&&online?sharedBooks():Promise.resolve([]),[tab,online]);
 const model=useAsync(async()=>await(await device()).status(),[]);
 const open=(id:string)=>router.push(`/student/private-book/${id}`);
 const upload=()=>task.run(async signal=>{
  const pick=await Picker.getDocumentAsync({type:'*/*',copyToCacheDirectory:true});if(pick.canceled||!library||signal.aborted)return;
  const file=pick.assets[0];task.setNote('Preparing your book on this device. Scanned pages use local English OCR; large scans can take several minutes. Nothing is uploaded.');
  const saved=await library.import({name:file.name,uri:file.uri,file:file.file,size:file.size},undefined,signal,task.setNote);
  if(signal.aborted)return;task.setNote(saved.duplicate?'This book is already in your library. Your existing work is unchanged.':'Book saved on this device. Open any module to start learning.');await books.reload();setTab('device');
 });
 const add=(b:SharedBook)=>task.run(async signal=>{
  if(!library)return;
  const f=await downloadShared(b,signal);
  try{
   if(signal.aborted)return;
   const result=await library.import(f,{id:`${b.kind}:${b.id}`,title:b.title,sha256:b.sha256},signal,task.setNote);
   if(signal.aborted)return;task.setNote(result.duplicate?'Already in your library; saved work is unchanged.':'Private copy saved. All its modules are open for personal study.');await books.reload();setTab('device');
  }finally{await(await device()).releaseFile(f);}
 });
 return <Screen refreshing={books.loading} onRefresh={books.reload}>
  <PageHeading title="Private library" subtitle="Your books. Your pace. Lessons, quizzes and doubts stay on this device." right={<Button title="Offline AI" icon="hardware-chip-outline" variant="secondary" onPress={()=>router.push('/student/offline-ai')} disabled={task.busy}/>} />
  <ErrorBanner message={task.error||books.error} onRetry={books.reload}/>
  {!!task.note&&!task.error&&<Notice message={task.note}/>}
  <Row><Button title="Upload my book" icon="add-outline" onPress={upload} busy={task.busy}/><Badge value={model.data?.installed?'Local model downloaded':'Set up Offline AI'} tone={model.data?.installed?'green':'amber'}/></Row>
  {task.busy&&<Button title="Cancel import" variant="secondary" onPress={task.cancel}/>}
  <PageTabs value={tab} onChange={t=>{if(!task.busy)setTab(t);}} tabs={[{key:'device',label:'On this device',count:books.data?.length},{key:'institution',label:'From my institution'}]}/>
  <Input value={search} onChangeText={setSearch} placeholder="Find a book" accessibilityLabel="Find a private book"/>
  {tab==='device'?<Card>
   <H2>Saved books</H2>
   {books.loading&&!books.data?<Loading/>:null}
   {!books.loading&&!books.data?.length?<Empty title="Add your first book" text="Import a book from your device, or add one shared by your admin or faculty. No progression locks apply here."/>:null}
   {(books.data||[]).filter(b=>b.title.toLowerCase().includes(search.toLowerCase())).map(b=><ListRow key={b.id} title={b.title} subtitle={`${b.sections.length} modules · ${b.origin==='shared'?'Institution copy':'Your own book'} · Saved on this device`} icon="book-outline" onPress={()=>{if(!task.busy)open(b.id);}} right={<Button title="Remove" small variant="danger" disabled={task.busy} onPress={()=>task.run(async()=>{if(library&&await confirmAsync('Remove this private book?','Its locally generated lessons, quizzes, results and doubts will also be removed. The institution book and official grades are not changed.','Remove','Keep book')){await library.remove(b.id);await books.reload();}})}/>}/>) }
  </Card>:<Card><H2>Books shared with you</H2>
   <P muted>Published books from your subjects and books shared for private study. Download once; then learn independently.</P>
   {!online?<Notice tone="warning" message="Connect to your institution once to add another shared book. Your saved books still work offline."/>:null}
   <ErrorBanner message={available.error} onRetry={available.reload}/>
   {available.loading?<Loading/>:null}
   {online&&!available.loading&&!available.error&&!available.data?.length?<Empty title="No shared books yet" text="Your admin or faculty can upload one in Books for private study. Published books from enrolled subjects also appear here."/>:null}
   {(available.data||[]).filter(b=>b.title.toLowerCase().includes(search.toLowerCase())).map(b=><ListRow key={`${b.kind}:${b.id}`} title={b.title} subtitle={`${b.subject} · ${(b.file_size/1024/1024).toFixed(1)} MB`} icon="cloud-download-outline" right={<Button title="Add to my library" small disabled={task.busy} onPress={()=>add(b)}/>}/>) }
  </Card>}
  <Notice title="Private means on this device" message="Personal books and practice are not sent to faculty or used as course grades. Keep the same app/browser profile; clearing its storage removes the saved library. AI output is unreviewed practice—check it against your book."/>
 </Screen>;
}
