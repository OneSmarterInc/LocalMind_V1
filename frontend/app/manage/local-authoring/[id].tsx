import {useAsync} from '@/hooks/useAsync';
import { useBackTo } from "@/hooks/useBackTo";
import {LocalLessonView} from '@/private/LocalLessonView';
import {LessonView} from '@/ui/LessonView';
import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {Text,View} from 'react-native';
import {useLocalSearchParams,useNavigation,useRouter} from 'expo-router';
import {useAuth} from '@/auth/AuthContext';
import {LocalAuthoring,draftStatus,isFrontMatter,type Draft,type ArchivedDraft} from '@/authoring/local';
import {clearFailure} from '@/authoring/automatic';
import {manage} from '@/api/endpoints';
import {stripOptionLabel} from '@/private/core';
import {useLibrary} from '@/private/useLibrary';
import {generationJobs} from '@/private/jobs';
import {jobScope,useGenerationJobs} from '@/private/useGenerationJobs';
import {SourceVisuals} from '@/private/SourceVisuals';
import {device} from '@/private/device';
import {useTask} from '@/private/useTask';
import {Screen,PageHeading,PageTabs,Card,CardHead,H2,P,Button,Row,Notice,ErrorBanner,Badge,Input,Empty,Split,DetailList,confirmAsync,colors} from '@/ui';

/** How often the draft on disk is re-read.
 *
 * This used to poll every second, unconditionally, for as long as the page was
 * open: every reviewer hit IndexedDB and the device model status once a second
 * even when nothing was happening, on the one machine that is already the
 * bottleneck. Now it polls quickly only while work is in flight. */
const BUSY_POLL_MS=2500;
const IDLE_POLL_MS=15000;

type Tab='review'|'source'|'history';

export default function LocalAuthoringPage(){const {user}=useAuth();return user?<Authoring key={user.id}/>:null;}

function Authoring(){
 const {id}=useLocalSearchParams<{id:string}>(),{user}=useAuth(),router=useRouter(),library=useLibrary(),task=useTask();
 const back=useBackTo();
 const navigation=useNavigation();
 const owner=user!.id;
 const service=useMemo(()=>new LocalAuthoring(owner),[owner]);
 const [tab,setTab]=useState<Tab>('review');
 const [quizCount,setQuizCount]=useState('6'),[questionIndex,setQuestionIndex]=useState(0);
 const [modelReady,setModelReady]=useState(false);
 const [draft,setDraft]=useState<Draft>(),[error,setError]=useState(''),[history,setHistory]=useState<ArchivedDraft[]>([]),[opened,setOpened]=useState('');
 useEffect(()=>{navigation.setOptions({backTo:draft?.snapshot.document_id&&(!draft.localBook||draft.snapshot.remote_id)?`/manage/document/${draft.snapshot.document_id}?tab=outline&module=${draft.snapshot.remote_id||draft.snapshot.module_id}`:"/manage/books",backLabel:draft?.snapshot.document_id&&(!draft.localBook||draft.snapshot.remote_id)?"Back to outline":"Books & modules"});},[navigation,draft?.localBook,draft?.snapshot.document_id,draft?.snapshot.remote_id,draft?.snapshot.module_id]);
 const localFigures=useAsync(()=>draft?.sourceBook&&draft.sourceSection?service.library.visuals(draft.sourceBook,draft.sourceSection):Promise.resolve([]),[service,draft?.sourceBook,draft?.sourceSection]);

 // ONLY this module's own generation.
 //
 // This used to match on the document too, so a whole-book preparation — which
 // carries documentId = the document — appeared inside EVERY module of that
 // book. Open a module that was finished and synchronized, and it showed
 // "Working" for generation happening on some other module entirely. A job
 // belongs to this screen only when its bookId is this module.
 const jobs=useGenerationJobs(library?.prefix||'').filter(j=>j.bookId===id);
 const live=jobs.filter(j=>['queued','running'].includes(j.state));
 // Whether the book as a whole is being prepared. Worth knowing — it is why
 // generating here may queue — but it is NOT this module's progress, so it is
 // reported separately and never as "Working" on this module.
 const bookJobs=useGenerationJobs(library?.prefix||'').filter(j=>j.kind==='staff-auto'&&!!draft?.snapshot.document_id&&(j.documentId===draft.snapshot.document_id||j.bookId===draft.snapshot.document_id));
 const bookBusy=bookJobs.some(j=>['queued','running'].includes(j.state));
 const busy=live.length>0;
 // Whether generation of THIS specific kind is in flight. A lesson that has
 // finished can be approved even while the quiz is still being written, and
 // vice versa; the shared ``busy`` above only governs starting new work and
 // the sidebar. ``share()`` enforces the same rule server-side, so this only
 // stops the button looking wrongly disabled.
 const generating=(kind:'lesson'|'quiz')=>live.some(j=>j.kind==='staff-'+kind);

 const read=useCallback(()=>service.read(id).then(v=>setDraft(v)).catch(e=>setError(String(e))),[service,id]);

 useEffect(()=>{let mounted=true;
  void service.history(id).then(h=>{if(mounted)setHistory(h);}).catch(e=>{if(mounted)setError(String(e));});
  void service.ensure(id).then(v=>{if(mounted)setDraft(v);void service.loadInstitution(id).then(next=>{if(mounted&&next)setDraft(next);}).catch(()=>{});}).catch(e=>{if(mounted)setError(String(e));});
  void device().then(d=>d.status()).then(s=>{if(mounted)setModelReady(s.installed);}).catch(()=>{});
  return()=>{mounted=false;};
 },[service,id]);

 useEffect(()=>{let mounted=true;
  const tick=()=>{if(!mounted)return;void read();void device().then(d=>d.status()).then(s=>{if(mounted)setModelReady(s.installed);}).catch(()=>{});};
  const timer=setInterval(tick,busy?BUSY_POLL_MS:IDLE_POLL_MS);
  return()=>{mounted=false;clearInterval(timer);};
 },[read,busy]);

 useEffect(()=>{setQuestionIndex(0);},[id,draft?.questions?.length]);

 const start=(kind:'lesson'|'quiz',restart:boolean)=>{
  try{setError('');
   // Generating here is a deliberate retry, so drop any recorded failure for
   // this module first. Automatic preparation never retries a failed module by
   // design; without this the readiness table would keep reporting "Failed"
   // even after the module generated perfectly well.
   const documentId=draft?.snapshot.document_id;
   if(documentId)void manage.document(documentId).then(d=>clearFailure(service,d,draft!.snapshot.remote_id||id)).catch(()=>{});
   generationJobs.enqueue({scope:jobScope(library!.prefix),bookId:id,documentId,sectionId:id,kind:'staff-'+kind,label:`${draft?.snapshot.title||'Module'} · ${kind}`},
    (signal,progress)=>service.generate(id,kind,signal,progress,Number(quizCount),restart));
  }catch(e){setError(String(e));}
 };

 // A half-finished run is the only case where resume and restart differ, so the
 // choice is only ever put to the reviewer when one actually exists. Before
 // this, Regenerate silently CONTINUED a run the reviewer had just cancelled.
 const partial=(kind:'lesson'|'quiz')=>draft?.run?.kind===kind||!!draft?.pausedRuns?.[kind];
 const generate=async(kind:'lesson'|'quiz')=>{
  if(!partial(kind))return start(kind,false);
  const done=draft?.run?.done??draft?.pausedRuns?.[kind]?.done??0;
  const fresh=await confirmAsync(
   kind==='quiz'?'Start this quiz again?':'Start this lesson again?',
   `Part of a previous generation was saved (${done} module part(s)). Continue it, or discard it and generate from the beginning?`,
   'Start again','Continue previous');
  start(kind,fresh);
 };

 // Front matter is read by students, never taught. Saying so here, and taking
 // the generate buttons away, is kinder than letting a reviewer spend four
 // minutes generating a lesson about a list of objectives.
 const frontMatter=!!draft&&isFrontMatter(draft.snapshot.title,draft.snapshot.source);
 const count=Number(quizCount);
 const countValid=Number.isInteger(count)&&count>=1&&count<=6;
 const quizStatus=draft?draftStatus(draft,'quiz'):'';
 const lessonStatus=draft?draftStatus(draft,'lesson'):'';

 return <Screen>
  <PageHeading eyebrow="LOCAL AUTHORING" title={draft?.snapshot.title||'Local authoring'}
   subtitle="Generated on this device. Review it, then synchronize it to the institution."
   right={<Row>
    {draft&&(!draft.localBook||draft.snapshot.remote_id)?<Button title="Back to outline" icon="arrow-back" variant="secondary" onPress={()=>back({pathname:"/manage/document/[id]",params:{id:draft.snapshot.document_id,tab:"outline",module:draft.snapshot.remote_id||draft.snapshot.module_id}})}/>:null}
    <Button title="Books & modules" icon="library-outline" variant="secondary" onPress={()=>router.push('/manage/books')}/>
   </Row>}/>

  <ErrorBanner message={error||task.error||localFigures.error}/>
  {!modelReady?<Notice title="Set up AI before generating" message="Download or import a model in Offline AI once on this device. Your books and saved work remain available without it."/>:null}
  {!draft?<Card><Empty icon="hourglass-outline" title="Preparing this module…" text="The source is being read from your device library."/></Card>:null}

  {draft?<>
   <PageTabs<Tab> value={tab} onChange={setTab} tabs={[
    {key:'review',label:'Review'},
    {key:'source',label:'Source & figures'},
    {key:'history',label:'Previous drafts',count:history.length||null},
   ]}/>

   {tab==='review'?<Split
    main={<>
     <Card>
      <CardHead title="Generate" subtitle="Written by the model on this device. Nothing reaches students until you synchronize it."/>
      {frontMatter?<Notice title="This module looks like front matter"
        message="Objectives, contents and similar pages are shown to students on the Read tab, but a lesson or quiz written from them mostly restates them, so automatic preparation skips this module instead of reporting it as Failed. If this one really is teaching material, generate it here and it will be kept."/>:null}
      <Row>
       <Button title={draft.lesson||draft.snapshot.institution?.lesson?'Regenerate lesson':'Generate lesson'} icon="sparkles-outline"
        disabled={busy||task.busy||!modelReady} onPress={()=>{void generate('lesson');}}/>
       <Button title={draft.questions||draft.snapshot.institution?.quiz?'Regenerate quiz':'Generate quiz'} icon="help-circle-outline"
        disabled={busy||task.busy||!modelReady||!countValid} onPress={()=>{void generate('quiz');}}/>
      </Row>
      <View style={{maxWidth:220}}>
       <Input label="Quiz questions" value={quizCount} onChangeText={setQuizCount} keyboardType="number-pad"
        hint={countValid?'1–6 questions. An existing quiz keeps its own count.':'Enter a whole number from 1 to 6.'}/>
      </View>

      {live.length?<View style={{gap:8,marginTop:4}}>
       {live.map(j=>
        <Row key={j.id}>
         <Badge value={j.cancelling?'Cancelling':j.state==='running'?'Working':'Waiting'} tone="neutral"/>
         <P small muted>{j.note}</P>
         {/* The button disappears the moment THIS job is cancelling, and says
             nothing about any other job that happens to be running. */}
         {j.cancelling?null:<Button title="Cancel" small variant="secondary" onPress={()=>generationJobs.cancel(j.id)}/>}
        </Row>)}
      </View>:null}
      {jobs.filter(j=>j.state==='failed'&&j.error).map(j=><Notice key={j.id} tone="warning" title="Generation stopped" message={j.error}/>)}
      {/* The book is preparing elsewhere. Said plainly and separately, because
          it is not this module's progress — showing it as "Working" here was
          the reason a finished module looked like it was still generating. */}
      {bookBusy&&!live.length?<Notice title="This book is preparing in the background"
        message="Other modules are being generated. This module is not affected; generating here will start when a slot is free."/>:null}
      {draft.run?<P small muted>Saved through part {draft.run.done}. Generating again offers to continue or start over.</P>:null}
     </Card>

     {draft.lesson?<Card>
      <CardHead title="Lesson draft" subtitle={lessonStatus==='Synchronized'?'Sent to the institution.':'On this device only.'}/>
      <LocalLessonView lesson={draft.lesson} visuals={draft.snapshot.source_visuals||localFigures.data||[]}/>
      <Button title={lessonStatus==='Synchronized'?'Lesson synchronized':'Approve and synchronize lesson'} icon="cloud-upload-outline" full
       disabled={generating('lesson')||task.busy||lessonStatus==='Synchronized'} busy={task.busy} onPress={()=>task.run(async()=>{setDraft(await service.share(id,'lesson'));})}/>
     </Card>:null}

     {draft.questions?.length?<Card>
      <CardHead title="Quiz draft" subtitle={`${draft.questions.length} question${draft.questions.length===1?'':'s'} · ${quizStatus==='Synchronized'?'sent to the institution':'on this device only'}`}/>
      <Row>
       <Button title="Previous" icon="arrow-back" small variant="secondary" disabled={questionIndex<=0} onPress={()=>setQuestionIndex(i=>i-1)}/>
       <P small muted>Question {Math.min(questionIndex,draft.questions.length-1)+1} of {draft.questions.length}</P>
       <Button title="Next" icon="arrow-forward" iconPosition="right" small variant="secondary" disabled={questionIndex>=draft.questions.length-1} onPress={()=>setQuestionIndex(i=>i+1)}/>
      </Row>
      {draft.questions.slice(Math.min(questionIndex,draft.questions.length-1),Math.min(questionIndex,draft.questions.length-1)+1).map(q=>
       <QuestionCard key={q.id} question={q}/>)}
      <Button title={quizStatus==='Synchronized'?'Quiz synchronized':'Approve and synchronize quiz'} icon="cloud-upload-outline" full
       disabled={generating('quiz')||task.busy||quizStatus==='Synchronized'} busy={task.busy} onPress={()=>task.run(async()=>{setDraft(await service.share(id,'quiz'));})}/>
     </Card>:null}

     {!draft.lesson&&!draft.questions?.length&&!busy?<Card>
      <Empty icon="sparkles-outline" title="Nothing generated yet."
       text={modelReady?'Generate a lesson or a quiz above. Your work saves on this device as it goes.':'Set up a model in Offline AI, then generate a lesson or a quiz.'}/>
     </Card>:null}
    </>}
    side={<>
     <Card>
      <CardHead title="This module"/>
      <DetailList items={[
       ['Lesson',lessonStatus||(draft.lesson?'Draft on device':'Not generated')],
       ['Quiz',quizStatus||(draft.questions?.length?'Draft on device':'Not generated')],
       ['Synchronization',draft.state==='synced'?'Received by institution':draft.state==='pending'?'Waiting to synchronize':draft.state==='conflict'?'Needs review':'Nothing pending'],
      ]}/>
      {draft.state?<Notice tone={draft.state==='conflict'?'warning':'info'}
       title={draft.state==='synced'?'Received by institution':draft.state==='conflict'?'Review needed':'Waiting to synchronize'}
       message={draft.error||'Reviewed work is retained on this device.'}/>:null}
      {draft.state==='pending'||draft.state==='conflict'?
       <Button title="Retry synchronization" icon="refresh" full disabled={busy} busy={task.busy} onPress={()=>task.run(async()=>{setDraft(await service.flush(id));})}/>:null}
     </Card>
     <Card>
      <CardHead title="Institution copy" subtitle="What students have now. Your drafts are separate until synchronized."/>
      {draft.snapshot.institution?.lesson?<Button title="View institution lesson" variant="secondary" full onPress={()=>setTab('source')}/>:<P small muted>No institution lesson yet.</P>}
      {draft.snapshot.institution?.quiz?<Button title="Open quiz settings" variant="secondary" full onPress={()=>router.push(`/manage/quiz/${draft.snapshot.institution!.quiz!.id}`)}/>:<P small muted>No institution quiz yet.</P>}
     </Card>
     <Card>
      <CardHead title="Book tools"/>
      {!draft.localBook||draft.snapshot.remote_id?<Button title="Prepare whole book" icon="albums-outline" variant="secondary" full onPress={()=>router.push(`/manage/local-batch?document=${draft.snapshot.document_id}`)}/>:null}
      {draft.localBook?<Button title="Local book synchronization" icon="sync-outline" variant="secondary" full onPress={()=>router.push('/manage/local-books')}/>:null}
      <Button title="Offline AI" icon="hardware-chip-outline" variant="secondary" full onPress={()=>router.push('/manage/offline-ai')}/>
     </Card>
    </>}/>:null}

   {tab==='source'?<>
    <Card>
     <CardHead title="Source text" subtitle="The authorized module text everything is generated from."/>
     <P>{draft.snapshot.source}</P>
    </Card>
    {draft.sourceBook&&draft.sourceSection?<Card>
     <CardHead title="Figures in this module"/>
     <SourceVisuals bookId={draft.sourceBook} sectionId={draft.sourceSection} sourceLibrary={service.library}/>
    </Card>:null}
    {draft.snapshot.institution?.lesson?<Card>
     <CardHead title="Institution lesson" subtitle="The saved institution version. Regeneration creates a separate draft on the Review tab."/>
     <LessonView lesson={draft.snapshot.institution.lesson}/>
    </Card>:null}
    {draft.snapshot.institution?.quiz?<Card>
     <CardHead title="Institution quiz" subtitle={`${draft.snapshot.institution.quiz.questions.length} questions · ${draft.snapshot.institution.quiz.status}`}/>
     {draft.snapshot.institution.quiz.questions.map((q,i)=><Card key={i}>
      <P>{i+1}. {q.question}</P>
      {q.options?.map(o=><P key={o.key}>{o.key}. {stripOptionLabel(o.text)}{o.key===q.correct_answer?' — correct':''}</P>)}
     </Card>)}
    </Card>:null}
    <Card>
     <CardHead title="Refresh source" subtitle="Replace your working copy with the latest authorized source. Your current draft is kept in Previous drafts."/>
     <Button title="Refresh source and keep draft in history" variant="secondary" full
      disabled={busy||task.busy||draft.state==='pending'||(!!draft.localBook&&!draft.snapshot.remote_id)}
      onPress={()=>task.run(async()=>{
       if(await confirmAsync('Refresh this module?','Your current source, generated content and sync details will remain in local draft history. The latest authorized source will become your working copy. Generate and review against that source before sharing again.','Keep draft and refresh','Stay')){
        setDraft(await service.refreshSource(id));setHistory(await service.history(id));}
      })}/>
    </Card>
   </>:null}

   {tab==='history'?(history.length?<>
    <Notice message="These copies stay on this device. Their content is not automatically submitted against a newer source."/>
    {history.map(h=><Card key={h.id}>
     <Row>
      <P>{h.draft.snapshot.title} · {new Date(h.archivedAt).toLocaleString()}</P>
      <Button title={opened===h.id?'Close':'View'} small variant="secondary" onPress={()=>setOpened(opened===h.id?'':h.id)}/>
     </Row>
     {opened===h.id?<>
      <H2>Previous source</H2><P>{h.draft.snapshot.source}</P>
      {h.draft.error?<P>{h.draft.error}</P>:null}
      {h.draft.run?<><H2>Interrupted generation</H2><P>{h.draft.run.done} complete module parts were retained.</P>
       {h.draft.run.lessonParts.flatMap(p=>p.sections).map((s,i)=><Card key={i}><H2>{s.heading}</H2><P>{s.content}</P><P small muted>Source: {s.quote}</P></Card>)}
       {h.draft.run.questions.map((q,i)=><P key={i}>{q.question} · Correct answer: {stripOptionLabel(q.options[q.answer])}</P>)}</>:null}
      {h.draft.lesson?<><H2>Previous lesson</H2><P>{h.draft.lesson.introduction}</P>
       {h.draft.lesson.sections.map((s,i)=><Card key={i}><H2>{s.heading}</H2><P>{s.content}</P><P small muted>Source: {s.quote}</P></Card>)}</>:null}
      {h.draft.questions?<><H2>Previous quiz</H2>{h.draft.questions.map(q=><QuestionCard key={q.id} question={q}/>)}</>:null}
     </>:null}
    </Card>)}
   </>:<Card><Empty icon="time-outline" title="No previous drafts." text="A draft is kept here when you refresh a module's source."/></Card>):null}
  </>:null}
 </Screen>;
}

/** One question, options as rows with the correct one marked.
 *
 * ``stripOptionLabel`` is applied on the way out as well as on the way in:
 * drafts generated before the parser stripped labels are already saved with
 * "A. " inside the option text, and would otherwise keep rendering
 * "A. A. Cloud computing" here until they were regenerated. */
function QuestionCard({question}:{question:{id:string;question:string;options:string[];answer:number;explanation:string;quote:string}}){
 return <Card>
  <Text style={{fontSize:15,fontWeight:'600',color:colors.ink}}>{question.question}</Text>
  <View style={{gap:6,marginTop:8}}>
   {question.options.map((option,n)=>{
    const right=n===question.answer;
    return <View key={n} style={{flexDirection:'row',alignItems:'flex-start',gap:8,borderRadius:7,paddingHorizontal:10,paddingVertical:8,
     backgroundColor:right?'#EDF5EA':'transparent',borderWidth:1,borderColor:right?'#CFE3C8':colors.border}}>
     <Text style={{fontSize:13,fontWeight:'700',color:right?colors.ink:colors.muted,minWidth:16}}>{String.fromCharCode(65+n)}</Text>
     <Text style={{fontSize:13,color:colors.text,flex:1}}>{stripOptionLabel(option)}</Text>
     {right?<Badge value="Correct" tone="green"/>:null}
    </View>;
   })}
  </View>
  {question.explanation?<P small muted>{question.explanation}</P>:null}
  {question.quote?<P small muted>Source: {question.quote}</P>:null}
 </Card>;
}
