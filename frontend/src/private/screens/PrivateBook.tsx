import {generationJobs} from '../jobs';
import {jobScope,useGenerationJobs} from '../useGenerationJobs';
import React,{useEffect,useRef,useState} from 'react';
import {Pressable,ScrollView,View} from 'react-native';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {Screen,PageHeading,Card,Row,H2,P,Button,Badge,Notice,ErrorBanner,Loading,PageTabs,Input,Split,Dropdown,confirmAsync,colors} from '@/ui';
import {SourceVisuals} from '../SourceVisuals';
import {SourceContent} from '@/ui/SourceContent';
import {useAsync} from '@/hooks/useAsync';
import {useLibrary} from '../useLibrary';
import {useTask} from '../useTask';
import type {QuizVersion,LessonVersion,PrivateChat} from '../library';
import type {Section} from '../core';
import {useUnsavedWarning} from '@/hooks/useDraft';
import {confirmLeave,registerGuard} from '@/hooks/unsavedGuard';

type Tab='read'|'lesson'|'quiz'|'ask';
export default function PrivateBook(){
 const {id,section:targetSection,tab:targetTab}=useLocalSearchParams<{id:string;section?:string;tab?:string}>(),router=useRouter(),library=useLibrary();
 const book=useAsync(()=>{if(!library)throw Error('Open the library after signing in.');return library.book(id);},[id,library]);
 const [sectionId,setSectionId]=useState(''),[query,setQuery]=useState('');
 useEffect(()=>{let alive=true;if(library&&book.data)void library.viewState(id,'section').then(saved=>{if(alive)setSectionId(book.data!.sections.find(s=>s.id===(targetSection||saved))?.id||book.data!.sections[0].id);});return()=>{alive=false;};},[book.data,id,library,targetSection]);
 const selectSection=(value:string)=>{setSectionId(value);void library?.saveViewState(id,'section',value).catch(()=>{});};
 const b=book.data,s=b?.sections.find(x=>x.id===sectionId);
 const sidebar=<Card><H2>Modules</H2><P muted>Open any module. Quiz results never lock the next one.</P><Input value={query} onChangeText={setQuery} placeholder="Find a module"/><ScrollView style={{maxHeight:550}}>
  {(b?.sections||[]).filter(x=>x.title.toLowerCase().includes(query.toLowerCase())).map((x)=><Pressable key={x.id} accessibilityRole="button" accessibilityState={{selected:x.id===sectionId}} onPress={()=>{void confirmLeave().then(ok=>{if(ok)selectSection(x.id);});}} style={{padding:12,borderRadius:8,marginBottom:5,backgroundColor:x.id===sectionId?colors.primary:'transparent'}}><P style={{color:x.id===sectionId?'white':colors.text}}>{x.title}</P></Pressable>)}
 </ScrollView></Card>;
 return <Screen><PageHeading title={b?.title||'Private book'} subtitle="Personal study · Saved only on this device" right={<Button title="Back to library" variant="secondary" onPress={()=>{void confirmLeave().then(ok=>{if(ok)router.push('/student/private-library');});}}/>}/><ErrorBanner message={book.error} onRetry={book.reload}/>
  {book.loading&&!b?<Loading/>:null}
  {b?.warnings.length?<Notice tone="warning" title="About this import" message={b.warnings.join('\n')}/>:null}
  {b&&s&&library?<Split side={sidebar} main={<ModuleLearning key={`${library.prefix}:${id}:${s.id}`} bookId={id} initialTab={targetTab} onSourceSaved={book.reload} section={s} next={()=>{const n=b.sections.findIndex(x=>x.id===s.id)+1;if(b.sections[n])void confirmLeave().then(ok=>{if(ok)selectSection(b.sections[n].id);});}}/>}/>:null}
 </Screen>;
}
function ModuleLearning({bookId,section,next,initialTab,onSourceSaved}:{bookId:string;section:Section;next:()=>void;initialTab?:string;onSourceSaved:()=>Promise<unknown>}){
 const library=useLibrary()!,router=useRouter();
 const jobs=useGenerationJobs(library.prefix).filter(j=>j.bookId===bookId&&j.sectionId===section.id);
 const completed=jobs.filter(j=>j.state==='completed').map(j=>j.id).join(',');
 const [tab,setTabState]=useState<Tab>('read'),[count,setCount]=useState('6');
 const lessons=useAsync(()=>library.lessons(bookId,section.id),[library,bookId,section.id,completed]);
 const quizzes=useAsync(()=>library.quizzes(bookId,section.id),[library,bookId,section.id,completed]);
 const chats=useAsync(()=>library.chats(bookId,section.id),[library,bookId,section.id,completed]);
 const [lessonId,setLessonId]=useState(''),[quizId,setQuizId]=useState(''),[question,setQuestion]=useState('');
 const [viewReady,setViewReady]=useState(false);const writes=useRef(Promise.resolve());
 const saveView=(key:string,value:string)=>{writes.current=writes.current.catch(()=>{}).then(()=>library.saveViewState(bookId,key,value)).catch(e=>setLocalError(String(e)));};
 const setTab=(value:Tab)=>{setTabState(value);saveView(`tab:${section.id}`,value);};
 const changeQuestion=(value:string)=>{setQuestion(value);saveView(`question:${section.id}`,value);};
 useEffect(()=>{let alive=true;void Promise.all([library.viewState(bookId,`tab:${section.id}`),library.viewState(bookId,`question:${section.id}`)]).then(([saved,draft])=>{if(alive){const t=initialTab||saved;setTabState(['read','lesson','quiz','ask'].includes(t)?t as Tab:'read');setQuestion(draft);setViewReady(true);}}).catch(e=>{if(alive)setLocalError(String(e));});return()=>{alive=false;};},[library,bookId,section.id,initialTab]);
 const lesson=lessons.data?.find(l=>l.id===lessonId)||lessons.data?.[0];
 const quiz=quizzes.data?.find(q=>q.id===quizId)||quizzes.data?.[0];
 useEffect(()=>{if(!quizId&&quizzes.data?.length)setQuizId(quizzes.data[0].id);},[quizId,quizzes.data]);
 const currentKind=tab==='ask'?'doubt':tab;
 const current=jobs.slice().reverse().find(j=>j.kind===currentKind);
 const active=(kind:string)=>jobs.some(j=>j.kind===kind&&['queued','running'].includes(j.state));
 const [localError,setLocalError]=useState('');
 const [editing,setEditing]=useState(false),[sourceDraft,setSourceDraft]=useState(section.source),[savingSource,setSavingSource]=useState(false);
 const saveSource=async()=>{setSavingSource(true);try{await library.correctSource(bookId,section.id,sourceDraft);await onSourceSaved();setEditing(false);}catch(e){setLocalError(String(e));}finally{setSavingSource(false);}};
 const task={busy:!!current&&['queued','running'].includes(current.state),note:current?.note||'',error:localError||current?.error||'',cancel:()=>{if(current)generationJobs.cancel(current.id);}};
 const enqueue=(kind:string,run:(signal:AbortSignal,progress:(s:string)=>void)=>Promise<unknown>)=>{
  try{setLocalError('');generationJobs.enqueue({scope:jobScope(library.prefix),bookId,sectionId:section.id,kind,label:`${section.title} · ${kind}`},run);}catch(e){setLocalError(String(e));}
 };
 const generateLesson=()=>{setLessonId('');enqueue('lesson',(signal,progress)=>library.generateLesson(bookId,section.id,signal,progress));};
 const generateQuiz=()=>{const total=Number(count);enqueue('quiz',(signal,progress)=>library.generateQuiz(bookId,section.id,total,signal,n=>progress(`Prepared question ${n} of ${total}`),progress));};
 const ask=()=>{const q=question.trim();enqueue('doubt',(signal,progress)=>library.ask(bookId,section.id,q,signal,progress));};
 return <Card><Row><H2>{section.title}</H2><Badge value="All modules open" tone="green"/></Row>
  <PageTabs value={tab} onChange={t=>{if(t!==tab)void confirmLeave().then(ok=>{if(ok)setTab(t);});}} tabs={[{key:'read',label:'Read'},{key:'lesson',label:'Lesson'},{key:'quiz',label:'Practice quiz'},{key:'ask',label:'Ask a doubt'}]}/>
  <ErrorBanner message={task.error||lessons.error||quizzes.error||chats.error}/>
  {task.busy?<Notice title="Working on this device" message={`${task.note} You can leave this page; the job will continue while the app stays open.`} action={<Button title="Cancel" variant="secondary" onPress={task.cancel}/>}/>:null}
  {section.ocr?<Notice title="Text recognised on this device" message="Compare OCR text with the original image, especially numbers, formulas and tables."/>:null}
  {!section.source.trim()?<Notice message="This page is available as an image. No usable text was recognised, so local AI cannot explain it."/>:null}
  {tab==='read'?<>{editing?<><Input label="Correct extracted source" value={sourceDraft} onChangeText={setSourceDraft} multiline maxLength={3200}/><P muted>Compare with the original page. Saving cancels unfinished jobs for this book; existing lessons and quizzes remain as earlier versions. Regenerate them to use the correction.</P><Row><Button title="Save source correction" onPress={()=>{void saveSource();}} busy={savingSource}/><Button title="Cancel correction" variant="secondary" disabled={savingSource} onPress={()=>setEditing(false)}/></Row></>:<><SourceContent text={section.source}/><Button title="Correct extracted text" variant="secondary" onPress={()=>{setSourceDraft(section.source);setEditing(true);}}/></>}<Row><Button title="Generate a lesson" onPress={()=>{setTab('lesson');generateLesson();}} disabled={active('lesson')}/><Button title="Next module" variant="secondary" onPress={next}/></Row></>:null}
  {tab==='lesson'?<><Row><Button title={lesson?'Regenerate lesson':'Generate lesson'} icon="sparkles-outline" onPress={generateLesson} disabled={task.busy}/>{lessons.data?.length?<Dropdown label="Saved lesson" value={lesson?.id||''} onChange={setLessonId} options={lessons.data.map((l,i)=>({value:l.id,label:`Version ${lessons.data!.length-i} · ${new Date(l.createdAt).toLocaleString()}`}))}/>:null}</Row>{lesson?<LocalLesson lesson={lesson}/>:<P muted>Generate an explanation from this module with your local AI model.</P>}</>:null}
  {tab==='quiz'?<><Row><Dropdown label="Questions" value={count} onChange={v=>{if(!task.busy)setCount(v);}} options={Array.from({length:10},(_,i)=>({value:String(i+1),label:String(i+1)}))}/><Button title={quiz?'Generate another quiz':'Generate quiz'} icon="sparkles-outline" onPress={()=>{void confirmLeave().then(ok=>{if(ok)generateQuiz();});}} disabled={task.busy}/>{quizzes.data?.length?<Dropdown label="Saved quiz" value={quiz?.id||''} onChange={v=>{void confirmLeave().then(ok=>{if(ok)setQuizId(v);});}} options={quizzes.data.map((q,i)=>({value:q.id,label:`Version ${quizzes.data!.length-i} · ${q.questions.length} questions`}))}/>:null}</Row>
   {quiz?<QuizPractice key={quiz.id} quiz={quiz}/>:<P muted>Create a quiz to practise. A failed or incomplete generation never becomes a completed quiz.</P>}</>:null}
  {tab==='ask'?<><P muted>Your private doubts stay on this device.</P>{(chats.data||[]).map(c=><Chat key={c.id} chat={c}/>)}<Input label="Your question" value={question} onChangeText={changeQuestion} multiline maxLength={1000} placeholder="What would you like to understand?" editable={viewReady&&!task.busy}/><Button title="Ask local AI" icon="send-outline" onPress={ask} disabled={!viewReady||task.busy||!question.trim()}/></>:null}
  {(tab==='read'||tab==='lesson')&&<SourceVisuals bookId={bookId} sectionId={section.id}/>}
  <Row><Button title="Offline AI setup" small variant="secondary" onPress={()=>{void confirmLeave().then(ok=>{if(ok)router.push('/student/offline-ai');});}}/></Row>
 </Card>;
}
function LocalLesson({lesson}:{lesson:LessonVersion}){return <><P>{lesson.lesson.introduction}</P>{lesson.lesson.sections.map((s,i)=><View key={i} style={{gap:8}}><H2>{s.heading}</H2><P>{s.content}</P><P small muted>From the book: {s.quote}</P></View>)}<H2>Key takeaways</H2>{lesson.lesson.takeaways.map((t,i)=><P key={i}>• {t}</P>)}</>;}
function Chat({chat}:{chat:PrivateChat}){return <View style={{gap:8,padding:14,backgroundColor:colors.bg,borderRadius:8}}><P style={{fontWeight:'600'}}>You: {chat.question}</P><P>{chat.answer}</P>{!!chat.quote&&<P muted small>From the book: {chat.quote}</P>}</View>;}
function QuizPractice({quiz}:{quiz:QuizVersion}){
 const library=useLibrary()!,task=useTask();
 const [answers,setAnswers]=useState<Record<string,number>>({}),[ready,setReady]=useState(false),[saved,setSaved]=useState(true);
 const answersRef=useRef<Record<string,number>>({});answersRef.current=answers;
 const [result,setResult]=useState<Awaited<ReturnType<typeof library.check>>|null>(null);
 const serial=useRef(Promise.resolve()),sequence=useRef(0),alive=useRef(true);
 const persisted=useRef<Record<string,number>>({}),dirty=useRef(false);
 const history=useAsync(()=>library.attempts(quiz.bookId,quiz.id),[library,quiz.id]);
 useEffect(()=>{alive.current=true;void library.draft(quiz.bookId,quiz.id).then(a=>{if(alive.current){persisted.current=a;answersRef.current=a;setAnswers(a);setReady(true);}}).catch(e=>{if(alive.current)task.setError(e.message);});return()=>{alive.current=false;};},[library,quiz.bookId,quiz.id]);
 useUnsavedWarning(!saved);
 useEffect(()=>{if(saved)return;return registerGuard({label:'this private quiz',save:async()=>{const sent=answersRef.current;await serial.current;await library.saveDraft(quiz.bookId,quiz.id,sent);persisted.current=sent;const clean=sent===answersRef.current;if(clean&&alive.current){dirty.current=false;setSaved(true);}return clean;},discard:async()=>{const restore=persisted.current;++sequence.current;await serial.current;await library.saveDraft(quiz.bookId,quiz.id,restore);answersRef.current=restore;dirty.current=false;if(alive.current){setAnswers(restore);setSaved(true);}},isDirty:()=>dirty.current});},[saved,library,quiz.bookId,quiz.id]);
 const choose=(id:string,value:number)=>{
  if(!ready||result||task.busy)return;const next={...answersRef.current,[id]:value};answersRef.current=next;dirty.current=true;setAnswers(next);setSaved(false);const mine=++sequence.current;
  // Writes are serialized. An older write cannot overwrite the latest answer.
  serial.current=serial.current.catch(()=>{}).then(()=>library.saveDraft(quiz.bookId,quiz.id,next)).then(()=>{persisted.current=next;if(alive.current&&mine===sequence.current){dirty.current=false;setSaved(true);}}).catch(e=>{if(alive.current)task.setError(`Draft was not saved: ${e.message}`);});
 };
 const check=()=>task.run(async()=>{await serial.current;const sent=answersRef.current;await library.saveDraft(quiz.bookId,quiz.id,sent);persisted.current=sent;const r=await library.check(quiz,sent);if(alive.current){setResult(r);dirty.current=false;setSaved(true);await history.reload();}});
 return <View style={{gap:16}}><P muted>{ready?(saved?'Answers saved on this device':'Saving your answers…'):'Restoring your saved answers…'}</P>
 <ErrorBanner message={task.error}/>
 {quiz.questions.map((q,n)=><View key={q.id} style={{gap:8,paddingVertical:12,borderBottomWidth:1,borderColor:colors.border}}><H2>{n+1}. {q.question}</H2>{q.options.map((o,i)=><Pressable key={i} accessibilityRole="radio" aria-checked={answers[q.id]===i} aria-disabled={!ready||!!result||task.busy} accessibilityState={{checked:answers[q.id]===i,disabled:!ready||!!result||task.busy}} disabled={!ready||!!result||task.busy} onPress={()=>choose(q.id,i)} style={{borderWidth:1,borderColor:answers[q.id]===i?colors.primary:colors.border,padding:12,borderRadius:8,backgroundColor:answers[q.id]===i?'#EAF2ED':'white'}}><P>{String.fromCharCode(65+i)}. {o}</P></Pressable>)}{result?<Notice tone={result.checks[n].correct?'success':'warning'} title={result.checks[n].correct?'Correct':`Correct answer: ${String.fromCharCode(65+q.answer)}`} message={`${q.explanation}\nFrom the book: ${q.quote}`}/>:null}</View>)}
 {result?<Notice tone="success" title={`${result.correct} of ${result.total} correct`} message="Private practice only. This result is saved here, not sent to faculty and never locks another module."/>:<Button title="Check my answers" onPress={check} busy={task.busy} disabled={!ready||Object.keys(answers).length!==quiz.questions.length}/>}
 <Button title="Start this quiz again" variant="secondary" disabled={!ready||task.busy} onPress={()=>task.run(async()=>{if(await confirmAsync('Start again?','Clear the current answers. Previous checked results remain in your history.','Start again','Keep answers')){await serial.current;await library.saveDraft(quiz.bookId,quiz.id,{});if(alive.current){persisted.current={};answersRef.current={};dirty.current=false;setAnswers({});setResult(null);setSaved(true);}}})}/>
 {!!history.data?.length&&<><H2>Previous practice</H2>{history.data.map(r=><P key={r.id}>{new Date(r.createdAt).toLocaleString()} · {r.correct}/{r.total} correct</P>)}</>}
 </View>;
}
