import {LocalQuizzes} from '@/authoring/quizzes';
import React,{useEffect} from 'react';
import {useRouter} from 'expo-router';
import {Card,H2,P,Row,Button,Badge} from '@/ui';
import {useLibrary} from './useLibrary';
import {useAuth} from '@/auth/AuthContext';
import {LocalBooks} from '@/authoring/books';
import {LocalAuthoring} from '@/authoring/local';
import {generationJobs} from './jobs';
import {jobScope,useGenerationJobs} from './useGenerationJobs';
/** Mounted under authentication, not under a learning page. */
export function GenerationHost(){const library=useLibrary(),{user}=useAuth(),scope=library?jobScope(library.prefix):'',owner=user?.id,role=user?.role;
 useEffect(()=>{if(!owner||role==='student')return;const service=new LocalAuthoring(owner);const sync=()=>{void new LocalBooks(owner).flushAll().then(()=>service.flushAll()).then(()=>new LocalQuizzes(owner).flushAll()).catch(()=>{});};sync();const timer=setInterval(sync,15000);return()=>clearInterval(timer);},[owner,role,scope]);
 useEffect(()=>{generationJobs.cancelOtherScopes(scope);return()=>generationJobs.cancelOtherScopes('');},[scope]);return null;
}
export function GenerationJobs(){const library=useLibrary(),router=useRouter(),jobs=useGenerationJobs(library?.prefix||'');
 if(!jobs.length)return null;
 return <Card><H2>Generation jobs</H2><P muted>You can read, practise and move between pages while these jobs run. The local model handles one response at a time. Keep this app open; refreshing or closing it interrupts unfinished jobs. Completed lesson parts and quiz questions are saved; open the book and generate again to resume.</P>
 {jobs.slice().reverse().map(j=><Card key={j.id}><Row><P>{j.label}</P><Badge value={j.state}/></Row><P muted>{j.error||j.note}</P><Row><Button title="Open book" small variant="secondary" onPress={()=>router.push(j.kind==='staff-quiz-selection'?`/manage/local-quizzes?id=${j.bookId}`:j.kind==='staff-batch'?`/manage/local-batch?document=${j.bookId}`:j.kind.startsWith('staff-')?`/manage/local-authoring/${j.bookId}`:`/student/private-book/${j.bookId}?section=${encodeURIComponent(j.sectionId)}&tab=${j.kind==='doubt'?'ask':j.kind}`)}/>{['queued','running'].includes(j.state)?<Button title="Cancel job" small variant="secondary" onPress={()=>generationJobs.cancel(j.id)}/>:null}</Row></Card>)}
 </Card>;
}
