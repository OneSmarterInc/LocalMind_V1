import React, { useEffect, useRef, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Image, Linking, Platform, View } from "react-native";
import * as Picker from "expo-document-picker";
import { api, BASE_URL } from "@/api/client";
import { useAsync, useAction } from "@/hooks/useAsync";
import { registerGuard, confirmLeave } from "@/hooks/unsavedGuard";
import { useUnsavedWarning } from "@/hooks/useDraft";
import { Screen, Card, H2, P, Button, Input, Row, Chip, ErrorBanner, Notice, Loading, PageHeading, confirmAsync } from "@/ui";
import { SelectField } from "@/ui/SelectField";
import { SourceContent } from "@/ui/SourceContent";

type Ref = { id: string; revision: number };
type Aid = { revision: number; simpler_text: string; examples: Ref[]; diagnostics: string[]; prerequisites: Ref[] };
type Block = { id: string; module_id: string; module_title: string; revision: number; kind: string; title: string; text: string; data: Record<string, unknown>; aids: Aid | null };
type Question = { id: string; body: { type: string; prompt: string; quote: string; options?: string[]; answer?: number; rubric?: string[]; explanation?: string }; references: Ref[]; approved: boolean; error: string; digest: string; review: { summary?: string; concerns?: string[] } };
type Policy = Record<string, string[]>;
type Snapshot = { document_id: string; title: string; source_current: boolean; source_digest: string; blocks: Block[]; modules: { id: string; title: string }[]; questions: Question[]; assets: { id: string; caption: string; source: string }[]; packages: { version: number; digest: string }[]; policy: Policy; policy_proposal: { policy?: Policy; explanation?: string } };
type Job = { status: string; error: string; result: Record<string, unknown> };
const KINDS = ["prose", "table", "figure", "worked_example", "callout"];
const ref = (b: Block): Ref => ({ id: b.id, revision: b.revision });

export default function StudyAuthoringRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <StudyAuthoring key={id} id={id} />;
}
function StudyAuthoring({ id }: { id: string }) {
  const path = `/study/authoring/${id}/`;
  const q = useAsync(() => api<Snapshot>(path), [path]);
  const [tab, setTab] = useState("blocks");
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [notice, setNotice] = useState("");
  const write = async (action: string, data: unknown = {}) => {
    const result = await api<{ job_id?: string }>(path, { method: "POST", body: { action, data } });
    if (result?.job_id) { setJobId(result.job_id); setJob(null); }
    await q.reload();
    return result;
  };
  const action = useAction(async (name: string, data: unknown = {}) => { await write(name, data); setNotice(name === "publish" ? "A new immutable package is published. Existing installed versions have not changed." : "Changes saved. Review the current status below."); });
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    const poll = async () => {
      try {
        const result = await api<Job>(`/jobs/${jobId}/`);
        if (!alive) return;
        setJob(result);
        if (["done", "failed"].includes(result.status)) { clearInterval(timer); if (result.status === "done") await q.reload(); }
      } catch (e) { if (alive) { clearInterval(timer); setJob({ status: "unavailable", error: String(e), result: {} }); } }
    };
    const timer = setInterval(() => { void poll(); }, 2500);
    void poll(); return () => { alive = false; clearInterval(timer); };
    // Keep edits in the child editor while job progress refreshes the snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);
  const changeTab = (next: string) => { void confirmLeave().then(ok => { if (ok) setTab(next); }); };
  const upload = useAction(async () => {
    const picked = await Picker.getDocumentAsync({ type: ["image/png", "image/jpeg"], copyToCacheDirectory: true });
    if (picked.canceled) return;
    const file = picked.assets[0]; const form = new FormData();
    if (Platform.OS === "web" && file.file) form.append("file", file.file);
    else form.append("file", { uri: file.uri, name: file.name, type: file.mimeType || "image/png" } as unknown as Blob);
    await api(`/study/authoring/${id}/assets/`, { method: "POST", form }); await q.reload();
  });
  const d = q.data;
  return <Screen>
    <PageHeading title="Private study publishing" subtitle={d?.title || "Prepare reviewed content for independent, offline study."} />
    <Notice title="Separate from classroom assessments" message="These packages contain learning material and practice feedback—not student accounts, grades or submissions. A published package is publicly downloadable. Review sharing rights before publishing." />
    <ErrorBanner message={q.error ?? action.error ?? upload.error} onRetry={q.reload} />
    {!!notice && <Notice message={notice} />}
    {jobId && <Card><H2>Saved background job</H2><P>{job?.status || "Queued"}</P><P>{job?.error || "The work is saved in the job queue. The local launcher or run_jobs worker must be running."}</P>{job?.status === "failed" && <Button title="Retry this job" onPress={() => { void api(`/jobs/${jobId}/`, { method: "POST" }).then(() => { setJobId(null); setTimeout(() => setJobId(jobId), 0); }).catch(e => setNotice(String(e))); }} />}{job?.status === "done" && <P>{JSON.stringify(job.result)}</P>}</Card>}
    {!d && q.loading ? <Loading /> : null}
    {d && <>
      <Row>{[["blocks", "1 · Content & teaching aids"], ["questions", "2 · Practice bank"], ["publish", "3 · Review & publish"]].map(([key, label]) => <Chip key={key} label={label} selected={tab === key} onPress={() => changeTab(key)} />)}</Row>
      {!d.source_current && <Notice tone="warning" title="Classroom source needs review" message="Import the source first. If it changed after you authored blocks, reconcile those changes manually; never overwrite authored material silently." action={<Button title="Import / reconcile source" busy={action.busy} onPress={() => { void confirmLeave().then(ok => { if (ok) void action.run("sync_source"); }); }} />} />}
      {tab === "blocks" && <>
        <Row><Button title="Upload PNG / JPEG figure" variant="secondary" busy={upload.busy} onPress={() => upload.run()} /><Button title="Extract PDF / Word figure candidates" variant="secondary" busy={action.busy} onPress={() => action.run("import_figures")} /></Row>
        <BlockEditor snapshot={d} save={write} />
      </>}
      {tab === "questions" && <QuestionEditor snapshot={d} save={write} />}
      {tab === "publish" && <>
        <Card><H2>Publication checklist</H2><P>{d.source_current ? "Source review is current." : "Source changed. Review and reconcile it before publishing."}</P><P>{d.blocks.length} active blocks · {d.questions.filter(x => x.approved).length} of {d.questions.length} questions currently approved.</P><P>Changed block revisions invalidate the questions and teaching aids that reference them. All practice questions must have current approval before publication.</P>
          {!d.source_current && d.blocks.length > 0 && <Button title="I reviewed the source changes" variant="secondary" busy={action.busy} onPress={() => { void confirmAsync("Confirm source reconciliation?", "Confirm you compared the current classroom source with every affected study block and reconciled the changes manually. This does not modify blocks for you.", "Confirm review", "Keep reviewing").then(ok => { if (ok) void action.run("accept_source_review", { digest: d.source_digest, review_confirmed: true }); }); }} />}
          <Button title="Publish a signed study package" busy={action.busy} disabled={!d.source_current || !d.questions.length || d.questions.some(x => !x.approved)} onPress={() => { void confirmAsync("Publish this reviewed learning material?", "The package is public content and cannot be silently changed. Confirm source, figures, questions, rubrics, and teaching aids are correct and may be distributed. No student records are included.", "Publish reviewed version", "Continue review").then(ok => { if (ok) void action.run("publish", { review_confirmed: true }); }); }} />
          <P muted>Configure STUDY_SIGNING_KEY_PATH and STUDY_SIGNING_KEY_ID on the authoring server. Share only the public key and verified fingerprint with learners.</P>
        </Card>
        <Card><H2>Teaching policy</H2><P>Each situation orders the same five permitted teaching moves. The device may only select moves with the required authored material.</P>{Object.entries(d.policy).map(([state, moves]) => <P key={state}>{state.replaceAll("_", " ")}: {moves.join(" → ")}</P>)}<Button title="Request a policy proposal from aggregate events" variant="secondary" busy={action.busy} onPress={() => action.run("propose_policy")} />
          {d.policy_proposal.policy && <><P>{d.policy_proposal.explanation}</P>{Object.entries(d.policy_proposal.policy).map(([state,moves])=><P key={state}>{state}: {moves.join(" → ")}</P>)}<Button title="Approve proposed policy for the next package" busy={action.busy} onPress={() => { void confirmAsync("Approve this policy proposal?", "These are event counts, not evidence of causation or unique students. This affects only future publications.", "Approve policy", "Cancel").then(ok => { if (ok) void action.run("save_policy", { policy: d.policy_proposal.policy }); }); }} /></>}
        </Card>
        <Card><H2>Published versions</H2>{d.packages.length ? d.packages.map(p => <View key={p.version}><P>Version {p.version} · {p.digest.slice(0,16)}</P><Button title={`Open version ${p.version} package`} variant="secondary" onPress={() => { void Linking.openURL(`${BASE_URL}/api/study/packages/${id}/${p.version}/`).catch(e => setNotice(String(e))); }} /></View>) : <P>No signed package published yet.</P>}</Card>
      </>}
    </>}
  </Screen>;
}

function BlockEditor({ snapshot: d, save }: { snapshot: Snapshot; save: (action: string, data?: unknown) => Promise<unknown> }) {
  const [selected, setSelected] = useState<Block | null>(null);
  const [moduleId, setModuleId] = useState(d.modules[0]?.id || "");
  const [kind, setKind] = useState("prose"), [title,setTitle]=useState(""), [text,setText]=useState("");
  const [rows,setRows]=useState(""), [assetId,setAssetId]=useState(""), [alt,setAlt]=useState("");
  const [simple,setSimple]=useState(""), [example,setExample]=useState(""), [prerequisite,setPrerequisite]=useState(""), [diagnostic,setDiagnostic]=useState("");
  const [dirty,setDirty]=useState(false),[aidDirty,setAidDirty]=useState(false);
  const locked=useRef(false),aidLocked=useRef(false);
  useUnsavedWarning(dirty || aidDirty);
  const act=useAction(async()=>{
    if(locked.current || aidDirty)return false;locked.current=true;
    try{
    const data = kind === "table" ? {rows: rows.split("\n").filter(line=>line.trim()).map(line=>line.split("|").map(x=>x.trim()))} : kind === "figure" ? {asset_id:assetId,alt} : {};
    await save("save_block",{module_id:moduleId,id:selected?.id,expected_revision:selected?.revision,block:{kind,title,text,data}});
    setDirty(false);setSelected(null);setTitle("");setText("");return true;
    }finally{locked.current=false;}
  });
  useEffect(()=>{if(!dirty)return;return registerGuard({label:"this study block",save:async()=>(await act.run())===true,discard:()=>setDirty(false)});},[dirty,act]);
  const open=(b:Block|null)=>{void confirmLeave().then(ok=>{if(!ok)return;setSelected(b);setModuleId(b?.module_id||d.modules[0]?.id||"");setKind(b?.kind||"prose");setTitle(b?.title||"");setText(b?.text||"");setRows((b?.data.rows as string[][]|undefined)?.map(row=>row.join(" | ")).join("\n")||"");setAssetId(String(b?.data.asset_id||""));setAlt(String(b?.data.alt||""));setSimple(b?.aids?.simpler_text||"");setExample(b?.aids?.examples[0]?.id||"");setPrerequisite(b?.aids?.prerequisites[0]?.id||"");setDiagnostic(b?.aids?.diagnostics[0]||"");setDirty(false);});};
  const aids=useAction(async()=>{if(!selected || dirty || aidLocked.current)return false;aidLocked.current=true;try{const ex=d.blocks.find(b=>b.id===example), pre=d.blocks.find(b=>b.id===prerequisite);await save("save_aid",{block_id:selected.id,aid:{revision:selected.revision,simpler_text:simple,examples:ex?[ref(ex)]:[],prerequisites:pre?[ref(pre)]:[],diagnostics:diagnostic?[diagnostic]:[]}});setAidDirty(false);return true;}finally{aidLocked.current=false;}});
  useEffect(()=>{if(!aidDirty)return;return registerGuard({label:"these teaching aids",save:async()=>(await aids.run())===true,discard:()=>setAidDirty(false)});},[aidDirty,aids]);
  const aidEdit=(fn:()=>void)=>{if(!aidLocked.current && !dirty){fn();setAidDirty(true);}};
  const edit=(fn:()=>void)=>{if(!locked.current && !aidDirty){fn();setDirty(true);}};
  return <>
    <Card><H2>Choose a block</H2><Row>{d.blocks.map(b=><Chip key={b.id} label={`${b.module_title} · ${b.title} · r${b.revision}`} selected={selected?.id===b.id} onPress={()=>open(b)}/>)}<Button title="Add block" variant="secondary" onPress={()=>open(null)}/></Row></Card>
    <Card><H2>{selected?"Edit this revision":"New content block"}</H2><ErrorBanner message={act.error}/><Row><SelectField label="Module" width={240} value={moduleId} options={d.modules.map(m=>({value:m.id,label:m.title}))} onChange={v=>edit(()=>setModuleId(v))}/><SelectField label="Block type" width={220} value={kind} options={KINDS.map(k=>({value:k,label:k.replaceAll("_"," ")}))} onChange={v=>edit(()=>setKind(v))}/></Row>
      <Input label="Title" value={title} editable={!act.busy&&!aidDirty} onChangeText={v=>edit(()=>setTitle(v))}/><Input label={kind==="figure"?"Approved explanation of the figure":"Source text (maximum 3,500 characters)"} multiline style={{minHeight:180}} maxLength={3500} value={text} editable={!act.busy&&!aidDirty} onChangeText={v=>edit(()=>setText(v))}/>
      {kind==="table"&&<Input label="Table rows: one per line; separate cells with |" multiline style={{minHeight:120}} value={rows} editable={!act.busy&&!aidDirty} onChangeText={v=>edit(()=>setRows(v))}/>}
      {kind==="figure"&&<><SelectField label="Reviewed figure asset" width={260} value={assetId} options={[{value:"",label:"Choose uploaded figure"},...d.assets.map(a=>({value:a.id,label:a.caption||a.source||a.id}))]} onChange={v=>edit(()=>setAssetId(v))}/>{assetId&&<AssetPreview documentId={d.document_id} assetId={assetId}/>}<Input label="Accessible image description" value={alt} editable={!act.busy&&!aidDirty} onChangeText={v=>edit(()=>setAlt(v))}/></>}
      <Button title="Save block revision" busy={act.busy} disabled={aidDirty||!dirty||!moduleId||!title.trim()||!text.trim()} onPress={()=>act.run()}/>
      {selected&&<Button title="Retire this block" variant="danger" disabled={act.busy||dirty} onPress={()=>{void confirmAsync("Retire this block?","Published packages keep their snapshot. Questions and aids referencing this block must be repaired before the next publication.","Retire","Cancel").then(async ok=>{if(ok){try{await save("retire_block",{id:selected.id,revision:selected.revision});setSelected(null);}catch(e){await confirmAsync("Block was not retired",String(e),"OK","Close");}}});}}/>}
      {!!text&&<SourceContent text={text}/>}
    </Card>
    {selected&&<Card><H2>Author the available teaching aids</H2><P>Save a changed source block first, then reopen its current revision before reviewing its aids. These aids are reviewed teaching content, not learner records.</P><ErrorBanner message={aids.error}/>
      <Input label="Simpler explanation" multiline style={{minHeight:110}} maxLength={3500} value={simple} editable={!aids.busy&&!dirty} onChangeText={v=>aidEdit(()=>setSimple(v))}/>
      <SelectField label="Worked example" width={260} value={example} options={[{value:"",label:"Not supplied"},...d.blocks.filter(b=>b.kind==="worked_example"&&b.id!==selected.id).map(b=>({value:b.id,label:b.title}))]} onChange={v=>aidEdit(()=>setExample(v))}/>
      <SelectField label="Prerequisite" width={260} value={prerequisite} options={[{value:"",label:"Not supplied"},...d.blocks.filter(b=>b.id!==selected.id).map(b=>({value:b.id,label:b.title}))]} onChange={v=>aidEdit(()=>setPrerequisite(v))}/>
      <SelectField label="Diagnostic question" width={260} value={diagnostic} options={[{value:"",label:"Not supplied"},...d.questions.filter(q=>q.approved&&q.references.some(r=>r.id===selected.id)).map(q=>({value:q.id,label:q.body.prompt}))]} onChange={v=>aidEdit(()=>setDiagnostic(v))}/>
      <Button title="Save reviewed teaching aids" busy={aids.busy} disabled={dirty||!aidDirty} onPress={()=>aids.run()}/>
    </Card>}
  </>;
}

function QuestionEditor({ snapshot:d,save }:{snapshot:Snapshot;save:(action:string,data?:unknown)=>Promise<unknown>}){
  const [blockId,setBlockId]=useState(d.blocks[0]?.id||""),[kind,setKind]=useState("mcq"),[prompt,setPrompt]=useState(""),[quote,setQuote]=useState(""),[explanation,setExplanation]=useState(""),[options,setOptions]=useState(["","","",""]),[answer,setAnswer]=useState("0"),[rubric,setRubric]=useState("");
  const [editing,setEditing]=useState<string|null>(null),[dirty,setDirty]=useState(false);
  const locked=useRef(false);
  const block=d.blocks.find(b=>b.id===blockId);
  useUnsavedWarning(dirty);
  const act=useAction(async()=>{if(locked.current)return false;if(!block)throw new Error("Choose a source block");locked.current=true;try{await save("save_question",{id:editing,body:{type:kind,prompt,quote,explanation,...(kind==="mcq"?{options,answer:Number(answer)}:{rubric:rubric.split("\n").filter(x=>x.trim())})},references:[ref(block)]});setDirty(false);setEditing(null);setPrompt("");setQuote("");setOptions(["","","",""]);setRubric("");setExplanation("");return true;}finally{locked.current=false;}});
  const review=useAction(async(name:string,data:unknown)=>{await save(name,data);});
  useEffect(()=>{if(!dirty)return;return registerGuard({label:"this practice question",save:async()=>(await act.run())===true,discard:()=>setDirty(false)});},[dirty,act]);
  const edit=(fn:()=>void)=>{if(!locked.current){fn();setDirty(true);}};
  return <><Card><H2>{editing?"Edit practice question":"Author a practice question"}</H2><ErrorBanner message={act.error??review.error}/>
    <SelectField label="Stored source block" width={260} value={blockId} options={d.blocks.map(b=>({value:b.id,label:`${b.title} · r${b.revision}`}))} onChange={v=>edit(()=>setBlockId(v))}/>
    {block&&<SourceContent text={block.text}/>}
    <SelectField label="Question type" width={240} value={kind} options={[{value:"mcq",label:"Multiple choice"},{value:"short",label:"Short written practice"}]} onChange={v=>edit(()=>setKind(v))}/>
    <Input label="Question" value={prompt} editable={!act.busy} onChangeText={v=>edit(()=>setPrompt(v))}/><Input label="Supporting quote copied from this block" value={quote} editable={!act.busy} onChangeText={v=>edit(()=>setQuote(v))}/>
    {kind==="mcq"?<>{options.map((value,i)=><Input key={i} label={`Option ${i+1}`} value={value} editable={!act.busy} onChangeText={v=>edit(()=>setOptions(x=>x.map((o,j)=>j===i?v:o)))}/>)}<SelectField label="Correct option" width={200} value={answer} options={options.map((_,i)=>({value:String(i),label:`Option ${i+1}`}))} onChange={v=>edit(()=>setAnswer(v))}/></>:<Input label="Rubric: one expected idea per line (1–6)" value={rubric} multiline style={{minHeight:100}} editable={!act.busy} onChangeText={v=>edit(()=>setRubric(v))}/>}
    <Input label="Explanation" value={explanation} multiline editable={!act.busy} onChangeText={v=>edit(()=>setExplanation(v))}/><Button title="Save question for review" busy={act.busy} disabled={!dirty||!block} onPress={()=>act.run()}/>
    <Button title="Generate 3 draft questions with the upstream model" variant="secondary" busy={review.busy} disabled={!block||dirty} onPress={()=>review.run("generate_bank",{block_id:blockId,count:3,question_type:kind})}/><P muted>The upstream model must be explicitly configured. Generated questions remain drafts until an author approves them.</P>
  </Card>
  {d.questions.map(q=><Card key={q.id}><H2>{q.body.prompt}</H2><P>{q.approved?"Approved for current source revisions":"Needs review"}</P>{q.error&&<Notice tone="warning" message={q.error}/>}<P>Source: {q.body.quote}</P>{q.body.options?.map((o,i)=><P key={i}>{i+1}. {o}{i===q.body.answer?" · correct answer":""}</P>)}{q.body.rubric?.map((idea,i)=><P key={i}>{idea}</P>)}<P>{q.body.explanation}</P>{q.review.summary&&<P>Model review: {q.review.summary}</P>}{q.review.concerns?.map((v,i)=><P key={i}>{v}</P>)}
    <Row><Button title="Edit question" variant="secondary" onPress={()=>{void confirmLeave().then(ok=>{if(!ok)return;setEditing(q.id);setBlockId(q.references[0]?.id||"");setKind(q.body.type);setPrompt(q.body.prompt);setQuote(q.body.quote);setOptions(q.body.options||["","","",""]);setAnswer(String(q.body.answer||0));setRubric(q.body.rubric?.join("\n")||"");setExplanation(q.body.explanation||"");setDirty(false);});}}/>
    {!q.approved&&<Button title="Approve reviewed question" busy={review.busy} disabled={!!q.error} onPress={()=>{void confirmAsync("Approve this exact question?","Confirm the answer, alternatives or rubric, explanation, and source reference are correct. A valid quote alone does not prove a correct answer.","Approve","Keep reviewing").then(ok=>{if(ok)void review.run("approve_question",{id:q.id,digest:q.digest});});}}/>}
    <Button title="Remove draft-bank question" variant="danger" busy={review.busy} onPress={()=>{void confirmAsync("Remove this question from future packages?","Existing published packages keep their copy. Repair any diagnostic links before publishing again.","Remove","Cancel").then(ok=>{if(ok)void review.run("remove_question",{id:q.id});});}}/></Row>
  </Card>)}
  </>;
}

function AssetPreview({documentId,assetId}:{documentId:string;assetId:string}){
  const q=useAsync(()=>api<{png_base64:string;source:string}>(`/study/authoring/${documentId}/assets/${assetId}/`),[documentId,assetId]);
  return <View><ErrorBanner message={q.error} onRetry={q.reload}/>{q.data&&<><Image source={{uri:`data:image/png;base64,${q.data.png_base64}`}} resizeMode="contain" accessibilityLabel="Figure candidate for faculty review" style={{width:"100%",height:300}}/><P>{q.data.source}</P></>}</View>;
}
