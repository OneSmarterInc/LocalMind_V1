import React,{useEffect} from 'react';
import {useRouter} from 'expo-router';
import {Card,H2,P,Row,Button,Badge} from '@/ui';
import {useLibrary} from './useLibrary';
import {generationJobs} from './jobs';
import {jobScope,useGenerationJobs} from './useGenerationJobs';
/** Mounted under authentication, not under a learning page. */
export function GenerationHost(){const library=useLibrary(),scope=library?jobScope(library.prefix):'';
 useEffect(()=>{generationJobs.cancelOtherScopes(scope);return()=>generationJobs.cancelOtherScopes('');},[scope]);return null;
}
export function GenerationJobs(){const library=useLibrary(),router=useRouter(),jobs=useGenerationJobs(library?.prefix||'');
 if(!jobs.length)return null;
 return <Card><H2>Generation jobs</H2><P muted>You can read, practise and move between pages while these jobs run. The local model handles one response at a time. Keep this app open; refreshing or closing it interrupts unfinished jobs. Completed lesson parts and quiz questions are saved; open the book and generate again to resume.</P>
 {jobs.slice().reverse().map(j=><Card key={j.id}><Row><P>{j.label}</P><Badge value={j.state}/></Row><P muted>{j.error||j.note}</P><Row><Button title="Open book" small variant="secondary" onPress={()=>router.push(`/student/private-book/${j.bookId}?section=${encodeURIComponent(j.sectionId)}&tab=${j.kind==='doubt'?'ask':j.kind}`)}/>{['queued','running'].includes(j.state)?<Button title="Cancel job" small variant="secondary" onPress={()=>generationJobs.cancel(j.id)}/>:null}</Row></Card>)}
 </Card>;
}
