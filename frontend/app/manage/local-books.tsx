import React,{useEffect,useMemo,useState} from 'react';
import * as DocumentPicker from 'expo-document-picker';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {useAuth} from '@/auth/AuthContext';
import {LocalBooks,type LocalBook} from '@/authoring/books';
import {useTask} from '@/private/useTask';
import {Screen,PageHeading,Card,H2,P,Button,Row,Dropdown,Input,ErrorBanner,Notice,Badge,confirmAsync} from '@/ui';
import { everyVisible } from "@/hooks/visibleInterval";
export default function LocalBooksPage(){const {user}=useAuth();return user?<Books key={user.id} owner={user.id}/>:null;}
function Books({owner}:{owner:string}){
 const params=useLocalSearchParams<{subject?:string}>();
 const service=useMemo(()=>new LocalBooks(owner),[owner]),router=useRouter(),task=useTask();
 const [rows,setRows]=useState<LocalBook[]>([]),[subjects,setSubjects]=useState<Awaited<ReturnType<LocalBooks['subjects']>>>([]),[subject,setSubject]=useState(params.subject||''),[title,setTitle]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let active=true;const read=()=>service.list().then(v=>{if(active)setRows(v);}).catch(e=>{if(active)setError(String(e));});void read();void service.subjects().then(v=>{if(active)setSubjects(v);}).catch(e=>{if(active)setError(String(e));});void service.subjects(true).then(v=>{if(active)setSubjects(v);}).catch(()=>{});const stop=everyVisible(read,3000);return()=>{active=false;stop();};},[service]);
 const open=async(row:LocalBook,id:string)=>{await service.prepare(row);router.push(`/manage/local-authoring/${id}`);};
 return <Screen><PageHeading title="Upload and prepare books" subtitle="Books and generated work save automatically. Review before publishing." right={<Button title="Books & modules" variant="secondary" onPress={()=>router.push('/manage/books')}/>}/>
 <ErrorBanner message={error||task.error}/>
 <Card><H2>Import a new book</H2><P muted>PDF or DOCX, up to 100 MB in the current local importer. Save your subject list and offline app files while connected before working offline. Imports and generation run on this device. Book synchronization sends the original file and extracted text for institutional review. Generated lessons and quizzes have separate approval actions.</P>
 <Dropdown label="Subject" placeholder="Choose a subject" value={subject} onChange={setSubject} options={subjects.map(s=>({value:s.id,label:s.code+' · '+s.name}))}/><Input label="Book title" placeholder="For example, Chapter 4 - Threat landscape" value={title} onChangeText={setTitle}/>
 <Row><Button title="Refresh assigned subjects" variant="secondary" busy={task.busy} onPress={()=>task.run(async()=>{setSubjects(await service.subjects(true));})}/><Button title="Choose book" disabled={!subject||!title.trim()} busy={task.busy} onPress={()=>task.run(async signal=>{
  const picked=await DocumentPicker.getDocumentAsync({type:['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],copyToCacheDirectory:true});if(picked.canceled)return;
  await service.import(picked.assets[0],title,subject,signal,task.setNote);setRows(await service.list());task.setNote('Book saved on this device. Open a module to review its source and generate.');
 })}/></Row>{task.note?<P>{task.note}</P>:null}{task.busy?<Button title="Cancel current action" variant="secondary" onPress={task.cancel}/>:null}</Card>
 {rows.map(row=><Card key={row.id}><Row><H2>{row.title}</H2><Badge value={row.state}/></Row><P muted>{row.modules.length} modules · Original file and source saved on this device</P>{row.totalBytes&&row.state!=='synced'?<P muted>Transferred {((row.bytesSent||0)/1024/1024).toFixed(1)} of {(row.totalBytes/1024/1024).toFixed(1)} MB. Interrupted transfers resume from the server’s saved position.</P>:null}{row.error?<Notice tone="warning" message={row.error}/>:null}
 {row.state!=='synced'?<Button title={row.state==='local'?'Review and synchronize book draft':'Retry book synchronization'} busy={task.busy} onPress={()=>task.run(async()=>{
  if(row.state==='local'&&!await confirmAsync('Synchronize this book draft?','Review the extracted source in its modules first. This sends the original book and extracted text to your institution as an unpublished review draft. Generated lessons and quizzes have separate approval actions.','Synchronize draft','Stay'))return;
  await service.share(row.id);setRows(await service.list());
 })}/>:<Button title="Open institutional review" variant="secondary" onPress={()=>router.push(`/manage/document/${row.documentId}`)}/>}
 {row.state==='conflict'||row.state==='pending'?<Button title="Remove staged transfer and keep local book" variant="secondary" busy={task.busy} onPress={()=>task.run(async()=>{await service.clearTransfer(row.id);setRows(await service.list());})}/>:null}
 {row.modules.map(m=><Row key={m.id}><P>{m.title}</P><Button title="Open module" small variant="secondary" disabled={task.busy} onPress={()=>task.run(()=>open(row,m.id))}/></Row>)}</Card>)}
 </Screen>;
}
