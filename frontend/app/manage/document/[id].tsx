import { removeBook, archiveBook } from "@/documents/remove";
import { useBackTo } from "@/hooks/useBackTo";
import {prepareAutomatically,preparation,type PreparationMap} from '@/authoring/automatic';
import {device} from '@/private/device';
import {useAuth} from "@/auth/AuthContext";
import {LocalAuthoring,draftStatus,isFrontMatter,type Draft} from "@/authoring/local";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { api, errorMessage } from "@/api/client";
import { manage } from "@/api/endpoints";
import type { Document, LessonDetail, LessonStatus, OutlineChapter, OutlineModule, OutlineReport } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { useUnsavedWarning } from "@/hooks/useDraft";
import { registerGuard } from "@/hooks/unsavedGuard";
import { useDebounced } from "@/hooks/useDebounced";
import { Badge, Button, Card, CardHead, choiceAsync, CellText, Column, DangerZone, DetailList, Empty, ErrorBanner, FormFooter, Grid, Input, ListRow, Loading, Notice, PageHeading, PageTabs, ProgressBar, Row, Screen, Split, Stepper, Table, TextLink, Tone, colors, confirmAsync, confirmDeleteAsync, fmtDay, fmtSeconds, radiusSm, space } from "@/ui";
import { HeadingPicker, type Heading } from "@/ui/HeadingPicker";
import type { IconName } from "@/ui/Shell";
import { LessonView } from "@/ui/LessonView";
import { SourceFigures } from "@/ui/SourceFigures";

/** Which node of the outline the right-hand pane is editing. */
type Selection = { ci: number; mi: number | null };

type DocTab = "outline" | "pictures" | "lessons" | "publish" | "live";

export default function DocumentScreen() {
  const { id, tab: tabParam, module: moduleParam } = useLocalSearchParams<{ id: string; tab?: DocTab; module?: string }>();
  const router = useRouter();
  const back = useBackTo();
  const {user}=useAuth();
  const owner=user?.id;
  const authoring=useMemo(()=>owner?new LocalAuthoring(owner):null,[owner]);
  const [prepareError,setPrepareError]=useState("");
  const { height } = useWindowDimensions();
  const [tabChoice, setTabChoice] = useState<DocTab | null>(tabParam ?? null);
  useEffect(() => { setTabChoice(tabParam && ["outline", "pictures", "lessons", "publish", "live"].includes(tabParam) ? tabParam : null); }, [id, tabParam]);
  const [preview, setPreview] = useState<{ id: string; title: string; quizStatus: string; quizId: string | null } | null>(null);
  const doc = useAsync(() => manage.document(id), [id]);
  const subjects = useAsync(() => manage.subjects(), []);
  const d = doc.data;
  const sourceChapters=d?.chapters;
  const [automatic,setAutomatic]=useState<PreparationMap>({});
  const [modelInstalled,setModelInstalled]=useState(false);
  const autoStarted=useRef('');
  useEffect(()=>{let live=true;const poll=async()=>{if(!authoring||!d)return;try{const status=await(await device()).status();const rows=await preparation(authoring,d);if(live){setModelInstalled(status.installed);setAutomatic(rows);}}catch(e){if(live)setPrepareError(errorMessage(e));}};void poll();const timer=setInterval(poll,1500);return()=>{live=false;clearInterval(timer);};},[authoring,d]);
  useEffect(()=>{if(!authoring||!d||!modelInstalled||!['under_review','ready','published'].includes(d.status))return;
    const token=`${owner}:${d.id}:${d.content_version}`;if(autoStarted.current===token)return;autoStarted.current=token;
    // The guard is NOT cleared when preparation reports a problem. Clearing it
    // let the effect start the whole book again, which failed again, which
    // cleared it again — a permanent regeneration loop triggered by a single
    // unpreparable module. The token already changes when the book's content
    // version does, so genuine new work still starts on its own; anything else
    // is a deliberate retry from the module itself.
    void prepareAutomatically(authoring,d).catch(e=>{setPrepareError(errorMessage(e));});
  },[authoring,d,modelInstalled,owner]);

  useEffect(()=>{let live=true;if(!authoring||!sourceChapters)return;
    void (async()=>{const saved=await authoring.drafts();for(const chapter of sourceChapters)for(const module of chapter.modules){if(!live)return;if(module.id&&module.source_text?.trim())await authoring.ensure(saved.find(s=>s.snapshot.remote_id===module.id)?.snapshot.module_id||module.id);}})().catch(e=>{if(live)setPrepareError(errorMessage(e));});
    return()=>{live=false;};
  },[authoring,sourceChapters]);
  useEffect(() => { if (d?.status !== "processing" && !["pending", "retry", "running"].includes(d?.background_job?.status || "")) return; const t = setInterval(doc.reload, 3000); return () => clearInterval(t); }, [d?.status, d?.background_job?.status, doc.reload]);
  const lessonsBusy = (!!d?.lessons && d.lessons.pending + d.lessons.generating > 0)
    || (!!d?.auto_quizzes && d.auto_quizzes.pending + d.auto_quizzes.generating > 0);
  const { setData: setDoc } = doc;
  useEffect(() => {
    if (!lessonsBusy) return;
    const t = setInterval(async () => { try { setDoc(await manage.document(id)); } catch { /* shown on the next full reload */ } }, 10000);
    return () => clearInterval(t);
  }, [lessonsBusy, id, setDoc]);
  const lessonStatus = useMemo(() => {
    const map: Record<string, LessonStatus> = {};
    for (const c of d?.chapters ?? []) for (const m of c.modules) if (m.id && m.lesson_status) map[m.id] = m.lesson_status;
    return map;
  }, [d?.chapters]);
  const quizStatus = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of d?.chapters ?? []) for (const m of c.modules) if (m.id && m.quiz_status) map[m.id] = m.quiz_status;
    return map;
  }, [d?.chapters]);
  const retryJob = useAction(async () => { if (!d?.background_job) return; await api(`/jobs/${d.background_job.id}/`, { method: "POST" }); await doc.reload(); });
  const jobNotice = d?.background_job && d.background_job.status !== "done" ? <Notice tone={d.background_job.status === "failed" ? "warning" : "info"} title={`Saved processing job: ${d.background_job.status}`} message={d.background_job.error || "Parsing is saved in the job queue. Restarting the local launcher resumes eligible jobs."} action={d.background_job.status === "failed" ? <Button title="Retry saved job" busy={retryJob.busy} onPress={()=>retryJob.run()}/> : undefined}/> : null;
  const queueLessons = useAction(async () => { router.push({pathname:"/manage/local-batch",params:{document:id}}); });
  const queueQuizzes = useAction(async () => { router.push({pathname:"/manage/local-batch",params:{document:id}}); });
  // A quiz that used all three of its attempts stops retrying for good. This
  // is the only way back to a generated quiz without editing the database:
  // the endpoint already existed, nothing in the UI ever called it.
  const retryQuiz = useAction(async (moduleId?: string) => { if (!moduleId) return; await manage.regenerateAutoQuiz(moduleId); await doc.reload(); });
  // The outline editor keeps edits locally until Save; a transition offers to save them first.
  const [pending, setPending] = useState<{ dirty: boolean; save: () => Promise<boolean> } | null>(null);
  // Leaving the Outline tab unmounts the editor, so unsaved edits are saved first or the switch is cancelled.
  const [tabError, setTabError] = useState<string | null>(null);
  // The editor fills the rest of the screen below the notices above it (its measured position), so its own
  // Save and Review actions are in view without scrolling; with little room it keeps a usable minimum and the
  // page scrolls to it.
  const [editorTop, setEditorTop] = useState(0);
  const TOP_BAR = 72;
  const editorHeight = editorTop ? Math.max(520, height - TOP_BAR - editorTop - 24) : Math.max(520, height - 300);
  const setTab = async (next: DocTab) => {
    setTabError(null);
    if (pending?.dirty && next !== "outline") {
      const choice = await choiceAsync("Save your outline changes first?", "You have edits on the Outline tab that are not saved yet. Leaving the tab without saving discards them.", { confirm: "Save and continue", extra: "Discard changes", cancel: "Stay on this tab" });
      if (choice === "cancel") return;
      if (choice === "confirm") {
        try {
          if (!(await pending.save())) return;
        } catch (e) {
          // The draft stays on the Outline tab, with the reason the save failed.
          setTabError(`The outline was not saved, so you are still on the Outline tab. ${errorMessage(e)}`);
          return;
        }
      }
      setPending(null);
    }
    setTabChoice(next);
    router.setParams({ tab: next });
  };
  const act = useAction(async (action: "process" | "ready" | "publish" | "unpublish" | "archive" | "restore") => {
    if (pending?.dirty) {
      const ok = await confirmAsync("Save your outline changes first?", "The outline has edits that have not been saved. Continuing without saving would discard them and reload the version on the server.", "Save and continue", "Cancel");
      if (!ok) return;
      await pending.save();
    }
    if (action === "publish" && !(await confirmAsync("Publish this book?", "Enrolled students can see its open modules as soon as it is published.", "Publish book", "Cancel"))) return;
    if (action === "unpublish" && !(await confirmAsync("Unpublish this book?", "Students stop seeing its modules, lessons and quizzes until you publish it again. Nothing is deleted.", "Unpublish book", "Cancel", { tone: "warning" }))) return;
    if (action === "restore" && !(await confirmAsync("Unarchive this book?", "Restore it for review. It stays hidden from students until you publish it.", "Unarchive book", "Cancel"))) return;
    if (action === "archive" && !(await confirmAsync("Archive this book?", "Students stop seeing it and it moves out of your active books. Its content and student records are kept.", "Archive book", "Cancel", { tone: "warning" }))) return;
    if (action === "process") await manage.process(id); else if(action === "archive") await archiveBook(id,owner!); else await manage.transition(id, action);
    await doc.reload();
    if (action === "publish") setTab("live");
    if (action === "unpublish") setTab("publish");
  });
  const remove = useAction(async () => {
    if (!d) return;
    const ok = await confirmDeleteAsync("Delete this book?", "This permanently removes the book, its chapters and modules, and any quiz or assignment built from them, along with student attempts and submissions. It cannot be undone.", { detail: `${d.title} · ${d.original_name}`, okLabel: "Delete book" });
    if (!ok) return;
    if (!(await removeBook(id,owner!))) return;
    router.replace("/manage/books");
  });

  const code = subjects.data?.find((s) => s.id === d?.subject_id)?.code ?? d?.subject_code ?? "";
  const editable = !!d && d.status !== "uploaded" && d.status !== "processing" && d.status !== "error";
  const live = d?.status === "published";
  // A published book has no checklist: its last tab is the published-book view.
  const tab: DocTab = live && tabChoice === "publish" ? "live" : !live && tabChoice === "live" ? "publish" : tabChoice ?? (live ? "live" : "outline");
  const missingSource = d?.missing_source_modules?.length ?? 0;
  const statusBadge = d ? <Badge value={d.status === "under_review" ? "Under review" : d.status} /> : null;
  const subtitle = d ? `${code ? `${code} · ` : ""}${d.outline_quality?.content_chapters ?? d.chapter_count ?? 0} chapters${d.outline_quality?.introductory_group ? ' + introductory material' : ''} · ${d.module_count ?? 0} modules · Version ${d.content_version}` : null;
  const backToBooks = <Button title="Back to books" icon="arrow-back" variant="secondary" onPress={() => back("/manage/books")} />;
  const stepper = (active: number) => <Stepper steps={["Upload a book", "Review the outline", "Publish to students"]} active={active} />;

  if (!editable) {
    return (
      <Screen refreshing={doc.loading} onRefresh={doc.reload}>
        {prepareError?<Notice tone="warning" title="Source preparation needs attention" message={prepareError}/>:null}{jobNotice}<ErrorBanner message={retryJob.error}/>
        <ErrorBanner message={doc.error} onRetry={doc.reload} />
        {doc.loading && !d ? <Loading /> : null}
        {d ? (
          <>
            <PageHeading eyebrow="BOOK PROCESSING" title={d.status === "error" ? "This book could not be processed." : "Your book is taking shape."} subtitle={d.original_name} right={<Row style={{ gap: 8, alignItems: "center" }}>{backToBooks}{statusBadge}</Row>} />
            {stepper(0)}
            {d.status === "processing" ? <ProcessingCard doc={d} onOpen={() => { void doc.reload(); }} /> : null}
            {d.status === "error" ? <Notice tone="danger" title="Processing failed" message={`${d.error_message || "Unknown error"}. Check the file and try again, or delete it and upload a better copy.`} /> : null}
            {d.status === "uploaded" ? <Notice title="The file is uploaded." message="Process it to read the text and plan chapters and modules." /> : null}
            <ErrorBanner message={act.error ?? remove.error} />
            {d.status !== "processing" ? (
              <Card>
                <FormFooter note="You can delete the upload and start again with a better copy.">
                  <Button title="Delete book" icon="trash-outline" variant="danger" onPress={() => remove.run()} busy={remove.busy} />
                  <Button title={d.status === "error" ? "Try processing again" : "Process book"} icon="play" onPress={() => act.run("process")} busy={act.busy} />
                </FormFooter>
              </Card>
            ) : null}
          </>
        ) : null}
      </Screen>
    );
  }

  if (d?.status === "archived") {
    const moduleTotal = (d.chapters ?? []).reduce((n, c) => n + c.modules.length, 0);
    return (
      <Screen refreshing={doc.loading} onRefresh={doc.reload}>
        <PageHeading eyebrow="BOOKS & MODULES" title={`${d.title} is archived.`} subtitle={subtitle} right={<Row style={{ gap: 8, alignItems: "center" }}>{backToBooks}<Badge value="Archived" tone="neutral" /></Row>} />
        <ErrorBanner message={doc.error ?? remove.error ?? act.error} onRetry={doc.error ? doc.reload : undefined} />
        <Notice title="This book is read-only." message="Unarchive to edit this book again. Student records are preserved." />
        <Grid min={320} gap={20}>
          <Card>
            <CardHead title="Book details" action={<Button title="Unarchive book" icon="archive-outline" onPress={() => act.run("restore")} busy={act.busy} />} />
            <DetailList items={[
              ["Status", <Badge key="s" value="Archived" tone="neutral" />],
              ["Archived on", fmtDay(d.archived_at)],
              ["Chapters", String(d.chapter_count ?? (d.chapters ?? []).length)],
              ["Modules", String(d.module_count ?? moduleTotal)],
              ["File", d.original_name],
            ]} />
          </Card>
          <Card>
            <CardHead title="Contents" subtitle="The outline as it was when the book was archived." />
            {(d.chapters ?? []).map((c, ci) => (
              <View key={c.id ?? ci} style={{ gap: 3, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.rowLine }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{String(ci + 1).padStart(2, "0")} · {c.title}</Text>
                {c.modules.map((m) => <Text key={m.id ?? m.title} style={{ fontSize: 12, color: colors.text }}>{m.title}</Text>)}
              </View>
            ))}
          </Card>
        </Grid>

      </Screen>
    );
  }

  if (preview) {
    return (
      <Screen>
      {jobNotice}<ErrorBanner message={retryJob.error}/>
        <PageHeading eyebrow="FACULTY PREVIEW" title="Preview the student lesson" subtitle={preview.title}
          right={<Button title="Back to readiness" variant="secondary" icon="arrow-back" onPress={() => { setPreview(null); setTab("lessons"); void doc.reload(); }} />} />
        <ModuleLessonPanel moduleId={preview.id} textEdited={false} />
        {preview.quizStatus !== "off" ? (
          <Card>
            <CardHead title="Automatic quiz for this module" />
            <AutoQuizControls moduleId={preview.id} status={preview.quizStatus} quizId={preview.quizId} />
          </Card>
        ) : null}
      </Screen>
    );
  }

  if (tab === "live" && live) {
    return (
      <Screen refreshing={doc.loading} onRefresh={doc.reload}>
        <PageHeading eyebrow="BOOKS & MODULES" title={`${d!.title} is published.`} subtitle={subtitle} right={<Row style={{ gap: 8, alignItems: "center" }}>{backToBooks}{statusBadge}</Row>} />
        <ErrorBanner message={doc.error ?? act.error ?? remove.error} onRetry={doc.error ? doc.reload : undefined} />
        <Notice tone="success" title="Students can now find this book." message="Enrolled students see its open modules, ready lessons and published quizzes." />
        <Grid min={320} gap={20}>
          <Card>
            <CardHead title="Manage this book" />
            <ListRow plain icon="create-outline" title="Edit outline & source" subtitle="Changes to a live book reach students when saved." onPress={() => setTab("outline")} />
            <ListRow plain icon="sparkles-outline" title="Check lesson readiness" subtitle="See generated lessons and quiz review holds." onPress={() => setTab("lessons")} />
            <ListRow plain icon="lock-closed-outline" title="Manage module availability" subtitle="Open or lock modules at your teaching pace." onPress={() => router.push({ pathname: "/manage/subject/[id]", params: { id: d!.subject_id, tab: "modules" } })} />
          </Card>
          <Card>
            <CardHead title="Publication details" />
            <DetailList items={[
              ["Status", <Badge key="s" value="Published" tone="green" />],
              ["Published by", d!.published_by_name || "—"],
              ["Published on", fmtDay(d!.published_at)],
              ["Content version", String(d!.content_version)],
            ]} />
            <View style={{ flexDirection: "row", gap: 9, flexWrap: "wrap", marginTop: 8 }}>
              <Button title="Unpublish book" variant="secondary" icon="eye-off-outline" onPress={() => act.run("unpublish")} busy={act.busy} />
              <Button title="Archive book" variant="secondary" icon="archive-outline" onPress={() => act.run("archive")} busy={act.busy} />
            </View>
          </Card>
        </Grid>
        <DangerZone title="Delete book permanently" text="Deleting a book also removes its chapters, modules, quizzes and attempts. This is different from unpublishing.">
          <Button title="Delete book" variant="danger" icon="trash-outline" onPress={() => remove.run()} busy={remove.busy} />
        </DangerZone>
      </Screen>
    );
  }

  return (
    <Screen>
      {jobNotice}<ErrorBanner message={retryJob.error}/>
      <PageHeading eyebrow="BOOKS & MODULES" title={d!.title} subtitle={subtitle} right={<Row style={{ gap: 8, alignItems: "center" }}>{backToBooks}{statusBadge}</Row>} />
      {!live ? stepper(tab === "publish" ? 2 : 1) : null}
      <ErrorBanner message={tabError ?? doc.error ?? act.error ?? remove.error} onRetry={doc.error ? doc.reload : undefined} />
      <PageTabs<DocTab> value={tab} onChange={setTab} tabs={[
        { key: "outline", label: "Outline & source" },
        { key: "pictures", label: "Pictures" },
        { key: "lessons", label: "Lessons & quizzes", count: d!.auto_quizzes?.held ? d!.auto_quizzes.held : null },
        live ? { key: "live", label: "Published book" } : { key: "publish", label: "Publish checklist" },
      ]} />
      {tab === "pictures" ? <PicturesTab documentId={id} /> : null}
      {tab === "outline" ? (
        <>
          {d.outline_quality?.source_sections ? <Notice title={`${d.outline_quality.covered_sections} of ${d.outline_quality.source_sections} extracted sections accounted for`} message={[d.outline_quality.coverage_note,...(d.outline_quality.warnings||[])].filter(Boolean).join(' ')} tone={d.outline_quality.warnings?.length ? 'warning' : 'info'} /> : null}
          {missingSource ? <Notice tone="warning" title="Modules without text" message={`${missingSource} module${missingSource === 1 ? " has" : "s have"} no source text but ${missingSource === 1 ? "is" : "are"} kept because a quiz, an assignment or student work refers to ${missingSource === 1 ? "it" : "them"}. Students do not see ${missingSource === 1 ? "it" : "them"}. Paste text to bring ${missingSource === 1 ? "it" : "them"} back.`} /> : null}
          {live ? <Text style={{fontSize:12,color:colors.muted}}>Published · Saved edits are visible to students.</Text> : null}
          <View onLayout={(e) => setEditorTop(e.nativeEvent.layout.y)} style={{ height: editorHeight, borderWidth: 1, borderColor: colors.border, borderRadius: 13, overflow: "hidden", backgroundColor: "#FFFFFF" }}>
            <OutlineWorkspace initialModuleId={moduleParam} documentId={id} published={live} onSaved={doc.reload} onState={setPending} lessonStatus={lessonStatus} quizStatus={quizStatus} onReview={() => setTab(live ? "live" : "publish")} />
          </View>
        </>
      ) : null}
      {tab === "lessons" ? <ReadinessTab automatic={automatic} modelInstalled={modelInstalled} doc={d!} onQueueLessons={() => queueLessons.run()} lessonsBusy={queueLessons.busy} onQueueQuizzes={() => queueQuizzes.run()} quizzesBusy={queueQuizzes.busy} onRetryQuiz={(mid) => retryQuiz.run(mid)} retryBusy={retryQuiz.busy} error={queueLessons.error ?? queueQuizzes.error ?? retryQuiz.error} onPreview={setPreview} /> : null}
      {tab === "publish" ? <PublishTab doc={d!} onAct={(a) => act.run(a)} busy={act.busy} onDelete={() => remove.run()} deleting={remove.busy} onTab={setTab} /> : null}
    </Screen>
  );
}

const STAGES = [
  { key: "queued", title: "File accepted", text: "The file type and size passed validation." },
  { key: "reading", title: "Source text extracted", text: "Reading the document." },
  { key: "outline", title: "Outline planned", text: "Creating a clear learning structure." },
  { key: "structure", title: "Modules created", text: "Ready for your review after processing." },
];
const STAGE_LABEL: Record<string, string> = { queued: "Waiting for the parser", reading: "Reading the file", outline: "Planning the outline", structure: "Creating chapters and modules" };

function ProcessingCard({ doc, onOpen }: { doc: Document; onOpen: () => void }) {
  const p = doc.progress;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const started = doc.processing_started_at ? new Date(doc.processing_started_at).getTime() : null;
  const elapsed = started ? Math.max(0, Math.round((now - started) / 1000)) : null;
  const current = Math.max(0, STAGES.findIndex((st) => st.key === p?.stage));
  return (
    <Card>
      <CardHead title={p ? STAGE_LABEL[p.stage] ?? "Processing" : "Starting"} action={p ? <Badge value={`Step ${p.step} of ${p.total_steps}`} tone="blue" /> : null} />
      <ProgressBar value={p?.percent ?? 0} />
      <Text style={{ fontSize: 12, color: colors.muted }}>{p?.detail || "The page updates on its own; you can leave and come back."}</Text>
      {STAGES.map((st, i) => (
        <ListRow key={st.key} plain icon={i < current ? "checkmark-circle-outline" : i === current ? "sync-outline" : "ellipse-outline"} tone={i < current ? "green" : i === current ? "blue" : "neutral"}
          title={st.title} subtitle={st.text} right={<Badge value={i < current ? "Complete" : i === current ? "In progress" : "Next"} tone={i < current ? "green" : i === current ? "blue" : "neutral"} />} />
      ))}
      <FormFooter note={`Reading a scanned book takes the longest.${elapsed !== null ? ` Running for ${fmtSeconds(elapsed)}.` : ""}`}>
        <Button title="Preview the completed outline" icon="arrow-forward" disabled onPress={onOpen} />
      </FormFooter>
    </Card>
  );
}

const LESSON_TEXT: Record<string, string> = { ready: "Ready", pending: "Queued", generating: "Preparing", failed: "Failed", none: "Not generated" };
// "failed_final" is a quiz that used all its retries: it will never run again
// on its own, so it needs a person. It used to report as plain "Failed",
// indistinguishable from one retrying in ten minutes, and quietly sat there.
const QUIZ_TEXT: Record<string, string> = { ready: "Ready", checking: "Being checked", held: "Held for review", pending: "Queued", generating: "Being written", failed: "Failed — retrying", failed_final: "Failed — needs retry", dismissed: "Deleted", short: "Too short", none: "None", off: "Off" };

type ModuleRow = OutlineModule & { chapter: string; number: number };
type Preview = { id: string; title: string; quizStatus: string; quizId: string | null };

function ReadinessTab({ automatic, modelInstalled, doc, onQueueLessons, lessonsBusy, onQueueQuizzes, quizzesBusy, onRetryQuiz, retryBusy, error, onPreview }: { automatic: PreparationMap; modelInstalled:boolean; doc: Document; onQueueLessons: () => void; lessonsBusy: boolean; onQueueQuizzes: () => void; quizzesBusy: boolean; onRetryQuiz: (moduleId: string) => void; retryBusy: boolean; error: string | null; onPreview: (p: Preview) => void }) {
  const router = useRouter();
  const {user}=useAuth(),owner=user?.id;
  const service=useMemo(()=>owner?new LocalAuthoring(owner):null,[owner]);
  const [drafts,setDrafts]=useState<Draft[]>([]);
  useEffect(()=>{let live=true;const read=()=>service?.drafts().then(rows=>{if(live)setDrafts(rows);}).catch(()=>{});void read();const timer=setInterval(read,1500);return()=>{live=false;clearInterval(timer);};},[service]);
  const local=(id:string)=>drafts.find(d=>d.snapshot.remote_id===id)||drafts.find(d=>d.snapshot.module_id===id);
  let n = 0;
  const modules: ModuleRow[] = (doc.chapters ?? []).flatMap((c) => c.modules.map((m) => ({ ...m, chapter: c.title, number: ++n }))).filter((m) => m.id);
  const l = doc.lessons; const a = doc.auto_quizzes;
  const teachableRows=(m:ModuleRow)=>!m.source_missing&&!!m.source_text?.trim()&&!isFrontMatter(m.title,m.source_text);
  const total=modules.filter(teachableRows).length;
  const status=(m:ModuleRow,kind:'lesson'|'quiz')=>{
    if(m.source_missing||!m.source_text?.trim())return 'No source text';
    // Objectives, contents and other front matter are read by students but
    // never taught. Reporting them as Queued (and later Failed) made a healthy
    // book look broken, and counted them against the prepared total.
    if(isFrontMatter(m.title,m.source_text))return 'Front matter';
    const saved=draftStatus(local(m.id!),kind);if(saved)return saved;
    const shared=kind==='lesson'?m.lesson_status:m.quiz_status;
    if(shared&&['ready','held','checking','failed','failed_final','dismissed'].includes(shared))return (kind==='lesson'?LESSON_TEXT:QUIZ_TEXT)[shared];
    return automatic[m.id!]?.[kind]||(modelInstalled?'Waiting to prepare':'Model setup required');
  };
  const columns: Column<ModuleRow>[] = [
    { key: "m", label: "Module", flex: 2.2, render: (m) => <CellText title={m.title} sub={`Module ${m.number}`} /> },
    { key: "l", label: "Lesson", flex: 0.8, render: (m) => <Badge value={status(m,"lesson")} tone={status(m,"lesson").startsWith("Ready")?"green":"neutral"} /> },
    { key: "q", label: "Quiz", flex: 1, render: (m) => <Badge value={status(m,"quiz")} tone={status(m,"quiz").startsWith("Ready")?"green":m.quiz_status==="failed_final"?"red":"neutral"} /> },
    { key: "draft", label: "Saved work", flex: 1.1, render: (m) => {const d=local(m.id!);return <CellText title={d?.lesson?"Local lesson draft":m.lesson_status==="ready"?"Shared lesson ready":"No lesson saved"} sub={automatic[m.id!]?.error?"Generation failed · Open module for details":d?.questions?.length?`${d.questions.length} local questions`:m.quiz_status==="ready"?"Shared quiz ready":"No quiz saved"}/>;} },
    { key: "x", label: "Actions", width: 250, align: "right", render: (m) => (
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
        <Button title="Open module" small variant="secondary" onPress={()=>router.push(`/manage/local-authoring/${local(m.id!)?.snapshot.module_id||m.id}`)}/>
        <Button title="Preview lesson" small variant="secondary" disabled={m.lesson_status !== "ready"} onPress={() => onPreview({ id: m.id!, title: m.title, quizStatus: m.quiz_status ?? "off", quizId: m.auto_quiz_id ?? null })} />
        {m.quiz_status === "held" && m.auto_quiz_id
          ? <Button title="Review quiz" small variant="secondary" onPress={() => router.push(`/manage/quiz/${m.auto_quiz_id}`)} />
          : null}
        {/* A quiz that exhausted its retries has no way back without this. */}
        {m.quiz_status === "failed_final"
          ? <Button title="Retry quiz" small icon="refresh" busy={retryBusy} onPress={() => onRetryQuiz(m.id!)} />
          : null}
      </View>
    ) },
  ];
  const heldCount = a?.enabled ? a.held ?? 0 : 0;
  // Count what the table below actually shows. A device draft moves through
  // "Ready for review", then "Awaiting synchronization", then "Synchronized";
  // doc.lessons.ready only counts the last stage, so a book full of drafts
  // waiting for the reviewer read "0 of 41 ready" even though every row was
  // prepared. Count lessons that are prepared on this device (any stage past
  // generation) so the headline matches the rows.
  const lessonState = (m: ModuleRow) => status(m, "lesson");
  const teachable = modules.filter(teachableRows);
  const preparedLocally = teachable.filter((m) => {
    const st = lessonState(m);
    return st === "Ready for review" || st === "Awaiting synchronization" || st === "Synchronized" || st === "Ready";
  }).length;
  const syncedLessons = l?.ready ?? 0;
  const ready = Math.max(preparedLocally, syncedLessons);
  const allReady = total > 0 && ready >= total;
  return (
    <>
      <Notice tone={heldCount || !allReady ? "warning" : "success"}
        title={`${ready} of ${total} lesson${total === 1 ? "" : "s"} prepared${syncedLessons < ready ? ` \u00b7 ${syncedLessons} synchronized to the institution` : ""}.${heldCount ? ` ${heldCount === 1 ? "One quiz needs" : `${heldCount} quizzes need`} your review.` : ""}`}
        message={modelInstalled?"Open a module to review drafts. Keep the app open while generation runs.":"Set up a model in Offline AI to start automatic lesson and quiz generation. The extracted source text is already saved."} />
      <ErrorBanner message={error} />
      <Card flush>
        <Table noun="module" columns={columns} rows={modules} keyOf={(m) => m.id!} minWidth={860} empty={<Empty icon="school-outline" text="This book has no modules yet." />} />
      </Card>
      <View style={{ flexDirection: "row", gap: 9, flexWrap: "wrap" }}>
        <Button title="Prepare lessons" variant="secondary" icon="sparkles-outline" onPress={onQueueLessons} busy={lessonsBusy} disabled={!modules.length} />
        <Button title="Prepare quizzes" variant="secondary" icon="refresh" onPress={onQueueQuizzes} busy={quizzesBusy} disabled={!modules.length} />
      </View>
    </>
  );
}

/** The automatic-quiz line of the checklist, from the real generation state rather than holds alone. */
function autoQuizCheck(a: Document["auto_quizzes"]): { icon: IconName; title: string; text: string; badge: string; tone: Tone } {
  const base = { icon: "shield-checkmark-outline" as IconName, title: "Automatic quizzes" };
  if (!a || !a.enabled) return { ...base, text: "Automatic quizzes are turned off for this platform.", badge: "Turned off", tone: "neutral" };
  const working = (a.pending ?? 0) + (a.generating ?? 0) + (a.checking ?? 0);
  const parts = [`${a.ready} ready`, working ? `${working} still being written or checked` : "", a.held ? `${a.held} held for review` : "", a.failed ? `${a.failed} failed` : "", a.short ? `${a.short} modules too short` : ""].filter(Boolean);
  const text = `${parts.join(" · ")}. Held and unfinished quizzes stay hidden from students.`;
  if (a.held) return { ...base, text, badge: "Review needed", tone: "amber" };
  if (a.failed) return { ...base, text, badge: "Some failed", tone: "red" };
  if (working) return { ...base, text, badge: "In progress", tone: "blue" };
  if (!a.ready) return { ...base, text: "No automatic quizzes have been written for this book.", badge: "None yet", tone: "neutral" };
  return { ...base, text, badge: "Ready", tone: "green" };
}

function PublishTab({ doc, onAct, busy, onDelete, deleting, onTab }: { doc: Document; onAct: (a: "ready" | "publish" | "unpublish") => void; busy: boolean; onDelete: () => void; deleting: boolean; onTab: (t: DocTab) => void }) {
  const modules = (doc.chapters ?? []).flatMap((c) => c.modules).filter((m) => m.id);
  const open = modules.filter((m) => m.availability === "open").length;
  const l = doc.lessons; const a = doc.auto_quizzes;
  const teachableRows=(m:OutlineModule)=>!m.source_missing&&!!m.source_text?.trim()&&!isFrontMatter(m.title,m.source_text);
  const total=modules.filter(teachableRows).length;
  const missing = doc.missing_source_modules?.length ?? 0;
  const checks: { icon: IconName; title: string; text: string; badge: string; tone: Tone }[] = [
    { icon: "document-text-outline", title: "Source text", text: missing ? `${missing} module${missing === 1 ? " has" : "s have"} no source text and stay hidden.` : `${modules.length} modules have readable source text.`, badge: missing ? "Check text" : "Ready", tone: missing ? "amber" : "green" },
    { icon: "list-outline", title: "Outline reviewed", text: `${doc.chapter_count ?? 0} chapters with ${modules.length} modules, ${open} open to students.`, badge: doc.status === "under_review" ? "Review needed" : "Ready", tone: doc.status === "under_review" ? "amber" : "green" },
    { icon: "sparkles-outline", title: "Guided lessons", text: l ? (l.ready === total ? `All ${total} lessons are synchronized and will be shared.` : `${l.ready} of ${total} synchronized to the institution${total - l.ready ? ` · ${total - l.ready} still preparing or awaiting review in Lessons & quizzes` : ""}.`) : "Lesson status is not available.", badge: l && l.ready === total ? "Ready" : "Optional to wait", tone: l && l.ready === total ? "green" : "amber" },
    autoQuizCheck(a),
  ];
  return (
    <>
      <Split
        main={
          <Card>
            <CardHead title="Review before publishing" />
            {checks.map((c) => <ListRow key={c.title} plain icon={c.icon} tone={c.tone} title={c.title} subtitle={c.text} right={<Badge value={c.badge} tone={c.tone} />} />)}
            <Notice title="What students will see" message="The book becomes visible to enrolled students. Modules opened on publication become readable. Pending lessons show a preparation message." />
            <FormFooter note="Publishing uses the existing document publish action.">
              <Button title="Cancel" variant="secondary" onPress={() => onTab("outline")} />
              <Button title="Publish book" icon="checkmark" onPress={() => onAct("publish")} busy={busy} />
            </FormFooter>
          </Card>
        }
        side={
          <Card>
            <CardHead title="Keep control after publishing" subtitle="You can lock modules, update source text, or unpublish the book. Saved edits to a published book reach students immediately." />
            <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>Protect student work</Text>
            <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 19 }}>Modules referenced by student activity cannot be removed through outline editing.</Text>
            {doc.status === "under_review" ? <TextLink title="Not ready to publish? Mark it as ready" onPress={() => onAct("ready")} /> : null}
          </Card>
        }
      />
      <DangerZone title="Delete this book" text="Removes the book, its modules, and any quiz or assignment built from them, with student attempts. This cannot be undone.">
        <Button title="Delete book" variant="danger" icon="trash-outline" onPress={onDelete} busy={deleting} />
      </DangerZone>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The workspace: outline tree on the left, one node open on the right  */
/* ------------------------------------------------------------------ */

/**
 * A book is edited one module at a time.
 *
 * The outline used to render every chapter and every module as a stack of
 * cards on one scrolling page, each module hiding its source text behind a
 * More button and, when opened, showing that text in a six-line box. Reading
 * a passage meant scrolling a window inside a window, and finding a module
 * meant scrolling past every other one. The tree now keeps the whole book
 * navigable on the left while the selected module gets the full height of the
 * right pane for its text.
 *
 * The save contract is unchanged: every edit lives in local state and one
 * PUT replaces the outline, so a rename here and a text edit three chapters
 * away are still one save.
 */
function OutlineWorkspace({ documentId, published, onSaved, onState, lessonStatus, quizStatus, onReview, initialModuleId }: { onReview?: () => void; initialModuleId?: string; documentId: string; published: boolean; onSaved: () => void; onState: (s: { dirty: boolean; save: () => Promise<boolean> }) => void; lessonStatus: Record<string, LessonStatus>; quizStatus: Record<string, string> }) {
  const q = useAsync(() => manage.outline(documentId), [documentId]);
  const { data: outlineData, reload: reloadOutline } = q;
  const [proposalVersion,setProposalVersion]=useState<number | null>(null);
  const propose=useAction(async()=>{
    const proposed=await manage.outline(documentId,true);
    setChapters(proposed.chapters);setProposalVersion(proposed.content_version);setDirty(true);setSel({ci:0,mi:0});
  });
  const [report, setReport] = useState<OutlineReport | null>(null);
  const [chapters, setChapters] = useState<OutlineChapter[] | null>(null);
  const [dirty, setDirtyState] = useState(false);
  const dirtyRef = useRef(false);
  const setDirty = (v: boolean) => { dirtyRef.current = v; setDirtyState(v); };
  const [sel, setSel] = useState<Selection | null>(null);
  // The two panes sit side by side only when the space beside the sidebar allows it.
  const [boxWidth, setBoxWidth] = useState(0);
  const split = boxWidth >= 820;
  useUnsavedWarning(dirty);
  // Once the width is known: side by side, the right pane opens the first module instead of sitting empty.
  useEffect(() => {
    if (split && !sel && chapters?.length) setSel({ ci: 0, mi: chapters[0].modules.length ? 0 : null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [split, chapters]);

  useEffect(() => {
    if (!q.data) return;
    // A background reload (for example when the window regains focus) must not replace unsaved edits.
    if (dirtyRef.current) return;
    setProposalVersion(null);
    setChapters(q.data.chapters.map((c) => ({ ...c, modules: c.modules.map((m) => ({ ...m })) })));
    setDirty(false);
    if (initialModuleId) {
      const ci = q.data.chapters.findIndex((c) => c.modules.some((m) => m.id === initialModuleId));
      if (ci >= 0) { setSel({ ci, mi: q.data.chapters[ci].modules.findIndex((m) => m.id === initialModuleId) }); return; }
    }
    // On a wide window the right pane would otherwise sit empty, so the first
    // module opens by itself. On a phone the two panes take turns, and landing
    // inside a module would hide the book the person came to look at.
    setSel((cur) => cur ?? (split && q.data!.chapters.length ? { ci: 0, mi: q.data!.chapters[0].modules.length ? 0 : null } : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  /** What this save would do, in the words the confirmation needs. */
  const changes = useMemo(() => {
    const before = q.data?.chapters ?? [];
    if (!chapters) return [];
    const beforeModules = new Map(before.flatMap((c) => c.modules).map((m) => [m.id, m]));
    const afterModules = chapters.flatMap((c) => c.modules);
    const afterIds = new Set(afterModules.map((m) => m.id).filter(Boolean));
    const removedModules = [...beforeModules.values()].filter((m) => !afterIds.has(m.id));
    const removedChapters = before.filter((c) => !chapters.some((x) => x.id === c.id));
    const added = afterModules.filter((m) => !m.id).length;
    const renamed = afterModules.filter((m) => m.id && beforeModules.get(m.id)?.title !== m.title).length;
    const retexted = afterModules.filter((m) => m.id && m.source_text !== undefined && beforeModules.get(m.id)?.source_text !== m.source_text).length;
    // Empty content is refused; removals must be an explicit edit.
    const emptied = afterModules.filter((m) => !(m.source_text ?? "").trim()).length;
    const lines: string[] = [];
    if (emptied) lines.push(`${emptied} module${emptied === 1 ? "" : "s"} need source text before saving`);
    if (removedChapters.length) lines.push(`${removedChapters.length} chapter${removedChapters.length === 1 ? "" : "s"} removed`);
    if (removedModules.length) lines.push(`${removedModules.length} module${removedModules.length === 1 ? "" : "s"} removed`);
    if (added) lines.push(`${added} module${added === 1 ? "" : "s"} added`);
    if (renamed) lines.push(`${renamed} title${renamed === 1 ? "" : "s"} changed`);
    if (retexted) lines.push(`${retexted} module${retexted === 1 ? "" : "s"} with edited text`);
    return lines;
  }, [chapters, q.data]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const persist = useCallback(async () => {
    if (!chapters) return false;
    setSaving(true);
    try {
    // The GET hands back every module's source_text, so sending it back
    // unchanged would mark each one as reviewer-supplied: the backend treats
    // explicit text as an override and drops the heading mapping when the
    // index does not resolve. Only text that actually changed is sent, so a
    // save leaves untouched modules pointing at their section.
    const loaded = new Map((outlineData?.chapters ?? []).flatMap((c) => c.modules).map((m) => [m.id, m.source_text]));
    const payload = chapters.map((c, ci) => ({ id: c.id, title: c.title, order: ci + 1, source_heading_index: c.source_heading_index ?? null,
      modules: c.modules.map((m, mi) => {
        const edited = m.source_text !== undefined && (!m.id || m.source_text !== loaded.get(m.id));
        return { id: m.id, title: m.title, order: mi + 1, source_heading_index: m.source_heading_index ?? null, ...(edited ? { source_text: m.source_text, start_page:m.start_page, end_page:m.end_page } : {}) };
      }) }));
    const saved = await manage.saveOutline(documentId, payload as OutlineChapter[], undefined, proposalVersion ?? outlineData?.content_version);
    setProposalVersion(null);
    const r = saved.outline_report;
    setReport(r && (r.removed_empty_modules.length || r.removed_empty_chapters.length || r.hidden_empty_modules.length) ? r : null);
    setDirty(false);
    await reloadOutline(); onSaved();
    return true;
    } finally { setSaving(false); }
  }, [chapters, proposalVersion, documentId, outlineData, reloadOutline, onSaved]);
  // Unsaved outline edits are guarded against in-app navigation too (Save / Discard / Stay).
  useEffect(() => {
    if (!dirty) return;
    return registerGuard({
      label: "this book’s outline",
      // The same save the button uses, so a failure is reported the same way wherever it happens.
      save: async () => { setSaveError(null); try { return await persist(); } catch (e) { setSaveError(errorMessage(e)); throw e; } },
      discard: () => { setProposalVersion(null); setDirty(false); if (outlineData) setChapters(outlineData.chapters.map((c) => ({ ...c, modules: c.modules.map((m) => ({ ...m })) }))); },
    });
  }, [dirty, persist, outlineData]);

  const save = useAction(async () => {
    // Saving is the point of no return for a removal, so it states what is
    // about to change, and says plainly when a live book is involved.
    const ok = await confirmAsync(
      "Save these outline changes?",
      published
        ? "This book is published, so the changes reach enrolled students as soon as they are saved."
        : "The outline on the server will be replaced with what is on screen.",
      "Save outline",
      "Keep editing",
      { tone: changes.some((l) => l.includes("removed")) ? "danger" : "primary", detail: changes.join(" · ") || undefined },
    );
    if (!ok) return;
    setSaveError(null);
    try { await persist(); } catch (e) { setSaveError(errorMessage(e)); throw e; }
  });

  const update = (fn: (c: OutlineChapter[]) => OutlineChapter[]) => { setChapters((c) => (c ? fn(c) : c)); setDirty(true); };
  const patchModule = (ci: number, mi: number, nm: OutlineModule) =>
    update((c) => c.map((x, i) => (i === ci ? { ...x, modules: x.modules.map((y, j) => (j === mi ? nm : y)) } : x)));

  // Opening or locking a module is a server call of its own, not part of the
  // outline PUT. It used to reload the outline afterwards, which discarded
  // every unsaved edit on the page, so the new availability is merged into
  // local state instead.
  const avail = useAction(async (ci: number, mi: number) => {
    const m = chapters?.[ci]?.modules[mi];
    if (!m?.id) return;
    const next = m.availability === "open" ? "locked" : "open";
    await manage.moduleAvailability(m.id, next);
    setChapters((c) => (c ? c.map((x, i) => (i === ci ? { ...x, modules: x.modules.map((y, j) => (j === mi ? { ...y, availability: next } : y)) } : x)) : c));
  });

  // Removing is the destructive edit here, so both levels ask first and the
  // chapter warning names how many modules go with it.
  const removeChapter = async (ci: number) => {
    const ch = chapters?.[ci];
    if (!ch) return;
    const n = ch.modules.length;
    const ok = await confirmDeleteAsync(
      "Remove this chapter?",
      n
        ? `Its ${n} module${n === 1 ? "" : "s"} go with it. Nothing is removed from the book until you save the outline.`
        : "Nothing is removed from the book until you save the outline.",
      { detail: ch.title, okLabel: "Remove chapter" },
    );
    if (!ok) return;
    update((c) => c.filter((_, i) => i !== ci));
    setSel(null);
  };
  const removeModule = async (ci: number, mi: number) => {
    const m = chapters?.[ci]?.modules[mi];
    if (!m) return;
    const ok = await confirmDeleteAsync(
      "Remove this module?",
      "Nothing is removed from the book until you save the outline. A module a student has already worked through cannot be removed.",
      { detail: m.title, okLabel: "Remove module" },
    );
    if (!ok) return;
    update((c) => c.map((x, i) => (i === ci ? { ...x, modules: x.modules.filter((_, j) => j !== mi) } : x)));
    setSel({ ci, mi: null });
  };

  const moveChapter = (ci: number, dir: -1 | 1) => {
    const target = ci + dir;
    if (!chapters || target < 0 || target >= chapters.length) return;
    update((c) => { const n = [...c]; [n[ci], n[target]] = [n[target], n[ci]]; return n; });
    setSel({ ci: target, mi: null });
  };
  const moveModule = (ci: number, mi: number, dir: -1 | 1) => {
    const list = chapters?.[ci]?.modules;
    const target = mi + dir;
    if (!list || target < 0 || target >= list.length) return;
    update((c) => c.map((x, i) => { if (i !== ci) return x; const n = [...x.modules]; [n[mi], n[target]] = [n[target], n[mi]]; return { ...x, modules: n }; }));
    setSel({ ci, mi: target });
  };
  const addChapter = () => {
    if (!chapters) return;
    update((c) => [...c, { title: `Chapter ${c.length + 1}`, order: c.length + 1, modules: [] }]);
    setSel({ ci: chapters.length, mi: null });
  };
  const addModule = (ci: number) => {
    const at = chapters?.[ci]?.modules.length ?? 0;
    update((c) => c.map((x, i) => (i === ci ? { ...x, modules: [...x.modules, { title: "New module", order: x.modules.length + 1, source_heading_index: null, source_text: "" }] } : x)));
    setSel({ ci, mi: at });
  };

  useEffect(() => { onState({ dirty, save: persist }); }, [dirty, persist, onState]);

  if (q.loading && !chapters) return <Loading />;
  if (!chapters) return <ErrorBanner message={q.error} onRetry={q.reload} />;

  const chapter = sel ? chapters[sel.ci] : undefined;
  const mod = chapter && sel?.mi !== null && sel?.mi !== undefined ? chapter.modules[sel.mi] : undefined;
  // On a phone the two panes take turns: the tree is the page until something
  // is picked, and the pane has a way back to it.
  const showPane = split || (!!sel && !!chapter);

  const tree = (
    <OutlineTree
      chapters={chapters}
      selection={sel}
      outlineSource={proposalVersion!==null?'reading_units':q.data?.outline_source}
      onSelect={setSel}
      onCollapse={() => setSel(null)}
      onAddChapter={addChapter}
      onAddModule={() => { const ci = sel?.ci ?? chapters.length - 1; if (ci >= 0) { addModule(ci); } }}
      lessonStatus={lessonStatus}
      style={split ? ws.treeSplit : ws.treeFull}
    />
  );

  const pane = (
    <View style={ws.pane}>
      <ErrorBanner message={save.error ?? avail.error ?? propose.error} />
      {!published && q.data?.outline_source !== 'reading_units' ? <Button small variant="secondary" title={proposalVersion!==null ? 'Discard proposed outline' : 'Preview reading outline'} busy={propose.busy} disabled={dirty && proposalVersion===null} onPress={()=>{if(proposalVersion!==null){setChapters(outlineData!.chapters);setProposalVersion(null);setDirty(false);setSel(null);}else void propose.run();}} /> : null}
      {proposalVersion!==null ? <Notice autoDismiss={false} title="Proposed outline — not saved" message="Rebuilt from the original extracted source. Review any previous manual corrections before saving. Existing student activity prevents replacement of affected modules." /> : null}
      {report ? <SaveReport report={report} onDismiss={() => setReport(null)} /> : null}
      {mod && chapter && sel ? (
        <ModulePane
          key={`${sel.ci}-${sel.mi}`}
          number={chapters.slice(0, sel.ci).reduce((n, c) => n + c.modules.length, 0) + sel.mi! + 1}
          onChapterSettings={() => setSel({ ci: sel.ci, mi: null })}
          headings={q.data?.headings ?? []}
          module={mod}
          index={sel.mi!}
          count={chapter.modules.length}
          onChange={(nm) => patchModule(sel.ci, sel.mi!, nm)}
          onMove={(dir) => moveModule(sel.ci, sel.mi!, dir)}
          onRemove={() => removeModule(sel.ci, sel.mi!)}
          onToggle={() => avail.run(sel.ci, sel.mi!)}
          toggleBusy={avail.busy}
          onBack={split ? undefined : () => setSel(null)}
          lessonStatus={mod.id ? lessonStatus[mod.id] : undefined}
          textEdited={!!mod.id && (mod.source_text ?? "") !== ((q.data?.chapters ?? []).flatMap((c) => c.modules).find((x) => x.id === mod.id)?.source_text ?? "")}
        />
      ) : chapter && sel ? (
        <ChapterPane
          key={`ch-${sel.ci}`}
          chapter={chapter}
          index={sel.ci}
          count={chapters.length}
          onChange={(title) => update((c) => c.map((x, i) => (i === sel.ci ? { ...x, title } : x)))}
          onMove={(dir) => moveChapter(sel.ci, dir)}
          onRemove={() => removeChapter(sel.ci)}
          onAddModule={() => addModule(sel.ci)}
          onOpenModule={(mi) => setSel({ ci: sel.ci, mi })}
          onBack={split ? undefined : () => setSel(null)}
        />
      ) : (
        <Empty text="Pick a chapter on the left, then a module. Its heading and source text open here." icon="book-outline" />
      )}
      <View style={ws.footer}>
        <Text style={[ws.saveState, { flex: 1, minWidth: 180 }, (saveError || dirty) && { color: saveError ? colors.danger : colors.warning }]} numberOfLines={2}>
          {saveError ? `Not saved: ${saveError}` : dirty ? "Unsaved changes" : "No unsaved changes"}
        </Text>
        {onReview ? <Button title="Review & publish" small variant="secondary" icon="arrow-forward" onPress={onReview} /> : null}
        <Button title="Save changes" icon="save-outline" small onPress={() => save.run()} busy={save.busy} disabled={!dirty} />
      </View>
    </View>
  );

  return (
    <View style={ws.body} onLayout={(e) => setBoxWidth(e.nativeEvent.layout.width)}>
      {boxWidth === 0 ? null : split ? <>{tree}{pane}</> : showPane ? pane : tree}
      {saving ? (
        // Editing waits for the save: the server assigns ids to new chapters and modules, so edits typed
        // meanwhile could not be matched to what was saved.
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(255,255,255,0.55)", alignItems: "center", justifyContent: "center" }} accessibilityRole="progressbar" accessibilityLabel="Saving the outline">
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>Saving the outline…</Text>
        </View>
      ) : null}
    </View>
  );
}

/** How the outline came to be, in words rather than the stored token. */
const OUTLINE_SOURCE: Record<string, string> = {
  ai: "outline planned by the tutor model",
  reading_units: "reading units grouped from the source; all extracted sections accounted for",
  source_hierarchy: "outline taken from the book's own headings",
  edited: "outline edited by hand",
};

/** The chapter and module tree. Chapters expand in place; modules select. */
function OutlineTree({ chapters, selection, outlineSource, onSelect, onCollapse, onAddChapter, onAddModule, lessonStatus, style }: {
  chapters: OutlineChapter[];
  selection: Selection | null;
  outlineSource?: string;
  onSelect: (s: Selection) => void;
  onCollapse: () => void;
  onAddChapter: () => void;
  onAddModule: () => void;
  lessonStatus: Record<string, LessonStatus>;
  style?: object;
}) {
  const [filter, setFilter] = useState("");
  const needle = useDebounced(filter, 150).trim().toLowerCase();
  const totalModules = chapters.reduce((n, c) => n + c.modules.length, 0);
  const rows = useMemo(() => {
    if (!needle) return chapters.map((c, i) => ({ chapter: c, index: i, modules: c.modules }));
    return chapters
      .map((c, i) => ({ chapter: c, index: i, modules: c.modules.filter((m) => m.title.toLowerCase().includes(needle)) }))
      .filter((row) => row.modules.length > 0 || row.chapter.title.toLowerCase().includes(needle));
  }, [chapters, needle]);
  let number = 0;
  const numbers = new Map<string, number>();
  chapters.forEach((c, ci) => c.modules.forEach((m, mi) => numbers.set(`${ci}-${mi}`, ++number)));
  return (
    <View style={[ws.tree, style]}>
      <View style={ws.treeHead}>
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={ws.treeTitle}>Book outline</Text>
          <Button title="Add" icon="add" small variant="secondary" onPress={onAddChapter} accessibilityLabel="Add chapter" />
        </Row>
        {outlineSource ? <Text style={ws.treeMeta}>{chapters.length} chapter{chapters.length === 1 ? "" : "s"} · {totalModules} module{totalModules === 1 ? "" : "s"} · {OUTLINE_SOURCE[outlineSource] ?? `outline from ${outlineSource}`}</Text> : null}
        {totalModules > 12 ? <Input compact icon="search" value={filter} onChangeText={setFilter} placeholder="Find a module" accessibilityLabel="Find a chapter or module" /> : null}
      </View>
      <ScrollView
        style={[{ flex: 1, minHeight: 0 }, Platform.OS === "web" && ({ overflowY: "auto" } as object)]}
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: space.xl }}
        keyboardShouldPersistTaps="handled"
      >
        {needle && rows.length === 0 ? <Empty text="Nothing in this outline matches that." icon="search-outline" /> : null}
        {rows.map(({ chapter: ch, index: ci, modules }) => (
          <View key={ch.id ?? `new-${ci}`}>
            <Pressable onPress={() => (selection?.ci === ci && selection.mi === null ? onCollapse() : onSelect({ ci, mi: null }))} accessibilityRole="button"
              style={({ pressed }) => [ws.chapterRow, selection?.ci === ci && selection.mi === null && ws.chapterRowOpen, pressed && { opacity: 0.85 }]}>
              <Text style={ws.chapterTitle} numberOfLines={2}>{String(ci + 1).padStart(2, "0")} · {ch.title}</Text>
            </Pressable>
            {modules.map((m) => {
              const mi = ch.modules.indexOf(m);
              const on = selection?.ci === ci && selection?.mi === mi;
              const n = numbers.get(`${ci}-${mi}`) ?? mi + 1;
              return (
                <Pressable key={m.id ?? `new-${ci}-${mi}`} onPress={() => onSelect({ ci, mi })} accessibilityRole="button" accessibilityLabel={m.title}
                  style={({ pressed }) => [ws.moduleRow, on && ws.moduleRowOn, pressed && { opacity: 0.85 }]}>
                  <Ionicons name={m.source_missing || !(m.source_text ?? "").trim() ? "alert-circle-outline" : "document-text-outline"} size={15} color={on ? colors.primary : m.source_missing ? colors.danger : colors.muted} style={{ marginTop: 1 }} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[ws.moduleTitle, on && { color: colors.primary, fontWeight: "600" }]} numberOfLines={2}>{m.title}</Text>
                    <Text style={{ fontSize: 11, color: "#7F8C7E", marginTop: 2 }}>Module {n} · {m.source_missing || !(m.source_text ?? "").trim() ? "no source text" : "source available"}{m.availability === "locked" ? " · locked" : ""}</Text>
                  </View>
                  <LessonMark status={m.id ? lessonStatus[m.id] ?? m.lesson_status : undefined} />
                </Pressable>
              );
            })}
          </View>
        ))}
        <View style={{ marginTop: 12 }}><Button title="Add module" icon="add" small variant="secondary" full onPress={onAddModule} /></View>
      </ScrollView>
    </View>
  );
}

/** One module: title, source text, mapping, availability and position. */
function ModulePane({ number, module: m, index, count, onChange, onMove, onRemove, onToggle, toggleBusy, onBack, onChapterSettings, headings, textEdited, lessonStatus }: {
  number: number;
  textEdited?: boolean;
  lessonStatus?: LessonStatus;
  module: OutlineModule;
  index: number;
  count: number;
  onChange: (m: OutlineModule) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  onToggle: () => void;
  toggleBusy?: boolean;
  onBack?: () => void;
  onChapterSettings: () => void;
  headings: Heading[];
}) {
  const empty = !(m.source_text ?? "").trim();
  const [mapping, setMapping] = useState(false);
  const heading = headings.find((h) => h.index === m.source_heading_index);
  const pages = heading?.start_page ? `Source pages ${heading.start_page}${heading.end_page && heading.end_page !== heading.start_page ? `–${heading.end_page}` : ""}` : "Source pages not recorded";
  return (
    <ScrollView style={[{ flex: 1, minHeight: 0 }, Platform.OS === "web" && ({ overflowY: "auto" } as object)]} contentContainerStyle={{ gap: 14, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
      <Row style={{ justifyContent: "space-between" }}>
        {onBack ? <Button title="Outline" icon="chevron-back" small variant="ghost" onPress={onBack} /> : null}
        <Text style={{ fontSize: 10, fontWeight: "700", letterSpacing: 1.8, color: colors.muted }}>MODULE {String(number).padStart(2, "0")}</Text>
        <View style={{ flex: 1 }} />
        <Badge value={!m.id ? "New module" : m.source_missing || empty ? "No source text" : "Source available"} tone={!m.id ? "blue" : m.source_missing || empty ? "red" : "green"} />
      </Row>
      <Input label="Module title" required value={m.title} onChangeText={(v) => onChange({ ...m, title: v })} />
      <Input label="Source text" required multiline value={m.source_text ?? ""}
        // Editing detaches the module from its mapped heading, so what is typed is what is saved.
        onChangeText={(v) => onChange({ ...m, source_text: v, source_heading_index: null })}
        placeholder="Paste the passage students should learn from. Add source text before saving."
        style={{ minHeight: 285, lineHeight: 24, backgroundColor: "#FDFEFC" }}
        hint={textEdited ? "Saving queues a new lesson and an unattempted automatic quiz for the edited text." : "Edit the source, not a generated summary. Text changes queue new lessons and an unattempted automatic quiz."} />
      {empty ? <Notice tone="warning" message="This module has no text. Add its source text or explicitly remove the module before saving." /> : null}
      {m.id && lessonStatus && lessonStatus !== "none" ? (
        <View style={{ gap: 6 }}>
          <Text style={ws.fieldLabel}>Lesson</Text>
          <LessonStatusBanner status={lessonStatus} />
        </View>
      ) : null}
      <Row style={{ justifyContent: "space-between" }}>
        <Text style={{ fontSize: 11, color: colors.muted }}>{pages} · {heading ? `Mapped to “${heading.title}”` : "Manually editable"}</Text>
        <Button title="Source mapping" small variant="secondary" icon="git-branch-outline" onPress={() => setMapping((v) => !v)} />
      </Row>
      {mapping ? (
        <View style={{ gap: 6 }}>
          <HeadingPicker headings={headings} value={m.source_heading_index} onChange={(idx) => onChange({ ...m, source_heading_index: idx })} />
          <Text style={{ fontSize: 11, color: colors.muted }}>Pick the book heading this module should take its text from. The text is refilled from that section when you save.</Text>
        </View>
      ) : null}
      {m.id ? <ModuleSourceVisualsPanel moduleId={m.id} /> : null}
      <View style={{ height: 1, backgroundColor: colors.border }} />
      <Row style={{ justifyContent: "space-between" }}>
        {m.id ? (
          <Pressable onPress={onToggle} disabled={!!m.source_missing || toggleBusy} accessibilityRole="checkbox" accessibilityState={{ checked: m.availability === "open", disabled: !!m.source_missing }} style={{ flexDirection: "row", alignItems: "center", gap: 10, opacity: toggleBusy ? 0.6 : 1 }}>
            <View style={{ width: 16, height: 16, borderRadius: 4, borderWidth: 1.5, borderColor: m.availability === "open" ? colors.primary : "#9AAA9D", backgroundColor: m.availability === "open" ? colors.primary : "#FFFFFF", alignItems: "center", justifyContent: "center" }}>
              {m.availability === "open" ? <Ionicons name="checkmark" size={11} color="#FFFFFF" /> : null}
            </View>
            <Text style={{ fontSize: 12, color: colors.text }}>Open to students when published</Text>
          </Pressable>
        ) : <Text style={{ fontSize: 12, color: colors.muted }}>Save the outline before opening this module to students.</Text>}
        <Button title="Remove module" small variant="danger" icon="trash-outline" onPress={onRemove} />
      </Row>
      <Row>
        <Button title="Move up" small variant="secondary" onPress={() => onMove(-1)} disabled={index === 0} />
        <Button title="Move down" small variant="secondary" onPress={() => onMove(1)} disabled={index >= count - 1} />
        <Button title="Chapter settings" small variant="secondary" icon="settings-outline" onPress={onChapterSettings} />
      </Row>
    </ScrollView>
  );
}

const LESSON_BADGE: Record<LessonStatus, string> = { ready: "lesson ready", pending: "lesson queued", generating: "lesson generating", failed: "lesson failed", none: "no lesson" };
const LESSON_COLOR: Record<LessonStatus, string> = { ready: colors.success, pending: colors.faint, generating: colors.accent, failed: colors.warning, none: colors.faint };

/** A small mark in the tree: nothing when the lesson is ready. */
function LessonMark({ status }: { status?: LessonStatus }) {
  if (!status || status === "ready" || status === "none") return null;
  const icon = status === "failed" ? "alert-circle-outline" : status === "generating" ? "sync-outline" : "time-outline";
  return <Ionicons name={icon} size={13} color={LESSON_COLOR[status]} accessibilityLabel={LESSON_BADGE[status]} />;
}

/** The module's lesson-generation state, shown in the module editor's own lesson
 *  section, so a "generating" message never has to live next to the source text. */
function LessonStatusBanner({ status }: { status: LessonStatus }) {
  const map: Partial<Record<LessonStatus, { icon: IconName; color: string; text: string }>> = {
    generating: { icon: "sync-outline", color: colors.accent, text: "Generating the lesson for this module…" },
    pending: { icon: "time-outline", color: colors.muted, text: "Lesson queued — it will be written in turn with the other modules." },
    ready: { icon: "checkmark-circle-outline", color: colors.success, text: "Lesson ready. Preview it from Lessons & quizzes." },
    failed: { icon: "alert-circle-outline", color: colors.warning, text: "Lesson generation failed. It is retried automatically, or regenerate it from Lessons & quizzes." },
  };
  const s = map[status];
  if (!s) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: radiusSm, borderWidth: 1, borderColor: `${s.color}33`, backgroundColor: `${s.color}12` }}>
      <Ionicons name={s.icon} size={16} color={s.color} />
      <Text style={{ flex: 1, fontSize: 12.5, lineHeight: 17, color: colors.text }}>{s.text}</Text>
    </View>
  );
}

/** Lesson generation for the whole book, above the outline. */

/** What the last save removed, so modules never vanish without a word. */
function SaveReport({ report, onDismiss }: { report: OutlineReport; onDismiss: () => void }) {
  const removed = report.removed_empty_modules.map((m) => m.title);
  const chapters = report.removed_empty_chapters.map((c) => c.title);
  const hidden = report.hidden_empty_modules.map((m) => m.title);
  const parts: string[] = [];
  if (removed.length) parts.push(`Removed ${removed.length} module${removed.length === 1 ? "" : "s"} with no source text: ${removed.join(", ")}.`);
  if (chapters.length) parts.push(`Removed ${chapters.length === 1 ? "a chapter" : `${chapters.length} chapters`} left with no modules: ${chapters.join(", ")}.`);
  if (hidden.length) parts.push(`Kept but hidden from students, because student work refers to them: ${hidden.join(", ")}.`);
  return (
    <Row style={{ alignItems: "flex-start" }}>
      <View style={{ flex: 1 }}><Notice tone="warning" message={parts.join(" ")} /></View>
      <Button title="Dismiss" small variant="ghost" onPress={onDismiss} />
    </Row>
  );
}

/** The module's lesson, as students will see it, with its generation state. */
function ModuleLessonPanel({ moduleId, textEdited }: { moduleId: string; textEdited: boolean }) {
  const router = useRouter();
  const q = useAsync(() => manage.moduleLesson(moduleId), [moduleId]);
  const d: LessonDetail | null = q.data;
  const { setData } = q;
  useEffect(() => {
    if (d?.status !== "pending" && d?.status !== "generating") return;
    const timer = setTimeout(async () => { try { setData(await manage.moduleLesson(moduleId)); } catch { /* retried on next open */ } }, 6000);
    return () => clearTimeout(timer);
  }, [d, moduleId, setData]);
  const again = useAction(async () => { router.push(`/manage/local-authoring/${moduleId}`); });
  const when = d?.generated_at ? new Date(d.generated_at).toLocaleString() : "";
  let line = "";
  if (d?.status === "ready") line = `Generated ${when}${d.model ? ` by ${d.model}` : ""}.`;
  else if (d?.status === "generating") line = "The tutor is writing this lesson now.";
  else if (d?.status === "pending") line = d.queue_position ? `Queued: ${d.queue_position === 1 ? "next in line" : `number ${d.queue_position} in line`}.` : "Queued.";
  else if (d?.status === "failed") line = `Could not be generated (${d.last_error || "unknown error"}).${d.next_attempt_at ? ` Trying again at ${new Date(d.next_attempt_at).toLocaleTimeString()}.` : " It will not be retried until you ask."} Students see the module text meanwhile.`;
  else if (d?.status === "none") line = "No generated lesson is available. Save the source and prepare a local draft.";
  return (
    <View style={{ gap: 16 }}>
      <Button title="Open module" variant="secondary" disabled={textEdited} onPress={()=>router.push(`/manage/local-authoring/${moduleId}`)}/>
      <ErrorBanner message={q.error ?? again.error} onRetry={q.error ? q.reload : undefined} />
      {q.loading && !d ? <Loading /> : null}
      {d ? (
        <Notice title={d.status === "ready" ? "This is the student-facing lesson." : d.status === "failed" ? "This lesson could not be generated." : d.status === "none" ? "No lesson for this module." : "This lesson is being prepared."}
          tone={d.status === "failed" ? "warning" : "info"}
          message={`${line} Regenerating requests a replacement based on the current source text. It does not edit the original source.`}
          action={d.status !== "none" && d.status !== "pending" && d.status !== "generating" ? <Button title={d.status === "failed" ? "Try again" : "Regenerate"} icon="refresh" small variant="secondary" onPress={() => again.run()} busy={again.busy} /> : undefined} />
      ) : null}
      {textEdited ? <Notice message="You have edited this module's text. Save the outline before opening local authoring; the lesson below belongs to the previously saved text." /> : null}
      {d?.lesson ? <LessonView lesson={d.lesson} badge={d.status === "ready" ? "Saved AI lesson" : null} /> : null}
    </View>
  );
}

/** The module's automatic quiz: open it, or have it written again. */
function AutoQuizControls({ moduleId, status, quizId }: { moduleId: string; status: string; quizId: string | null }) {
  const router = useRouter();
  const shown = status;
  const again = useAction(async () => { router.push(`/manage/local-authoring/${moduleId}`); });
  const busy = shown === "pending" || shown === "generating" || shown === "checking";

  const label = shown === "dismissed" ? "Write the quiz again" : shown === "none" ? "Write a quiz" : shown === "failed" ? "Try again" : "Write it again";
  return (
    <View style={{ gap: 4 }}>
      <Row>
        {quizId && (shown === "ready" || shown === "held") ? <Button title={shown === "held" ? "Review quiz" : "Open quiz"} icon="open-outline" small variant="secondary" onPress={() => router.push(`/manage/quiz/${quizId}`)} /> : null}
        {!busy ? <Button title={label} icon="refresh-outline" small variant="ghost" onPress={() => again.run()} busy={again.busy} /> : null}
        <Text style={[ws.hint, { flex: 1 }]}>
          {shown === "checking" ? "Written; the AI monitor is checking it before students can see it." :
            busy ? "The automatic quiz for this module is queued; quizzes are written in turn with lessons." :
            shown === "held" ? "The AI monitor flagged this quiz, so students do not see it. Open it to fix and publish it, or release it if the questions are right." :
            shown === "ready" ? "Goes live for students when this module is open. Once students have attempted it, writing it again keeps it as it is; edit it in Quizzes instead." :
            shown === "dismissed" ? "You deleted this module's automatic quiz, so it is not written again unless you ask." :
            shown === "failed" ? "The automatic quiz could not be written; it is retried later, or try now." : ""}
        </Text>
      </Row>
      <ErrorBanner message={again.error} />
    </View>
  );
}

/** A chapter: rename it, move it, add a module, or jump into one. */
function ChapterPane({ chapter, index, count, onChange, onMove, onRemove, onAddModule, onOpenModule, onBack }: {
  chapter: OutlineChapter;
  index: number;
  count: number;
  onChange: (title: string) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  onAddModule: () => void;
  onOpenModule: (mi: number) => void;
  onBack?: () => void;
}) {
  return (
    <ScrollView
      style={[{ flex: 1, minHeight: 0 }, Platform.OS === "web" && ({ overflowY: "auto" } as object)]}
      contentContainerStyle={{ gap: space.md, paddingBottom: space.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <Row>
        {onBack ? <Button title="Outline" icon="chevron-back" small variant="ghost" onPress={onBack} /> : null}
        <Text style={ws.crumbNow}>Chapter {index + 1} of {count}</Text>
      </Row>
      <Input label="Chapter title" value={chapter.title} onChangeText={onChange} />
      <Row>
        <Button title="↑" small variant="secondary" onPress={() => onMove(-1)} disabled={index === 0} />
        <Button title="↓" small variant="secondary" onPress={() => onMove(1)} disabled={index >= count - 1} />
        <Button title="Add module" icon="add-outline" small variant="secondary" onPress={onAddModule} />
        <Button title="Remove chapter" small variant="ghost" onPress={onRemove} />
      </Row>
      <Text style={ws.fieldLabel}>{chapter.modules.length} module{chapter.modules.length === 1 ? "" : "s"} in this chapter</Text>
      {chapter.modules.map((m, mi) => (
        <Pressable key={m.id ?? `new-${mi}`} onPress={() => onOpenModule(mi)} style={({ pressed }) => [ws.chapterListRow, pressed && { opacity: 0.85 }]}>
          <Text style={ws.moduleNum}>{mi + 1}</Text>
          <Text style={[ws.moduleTitle, { color: colors.text }]} numberOfLines={1}>{m.title}</Text>
          {m.source_missing ? <Badge value="no source" color={colors.danger} /> : null}
          <Ionicons name="chevron-forward" size={16} color={colors.faint} />
        </Pressable>
      ))}
      {chapter.modules.length === 0 ? <Empty text="This chapter has no modules yet." icon="layers-outline" /> : null}
    </ScrollView>
  );
}

const ws = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", gap: space.md, flexWrap: "wrap", paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  title: { fontSize: 20, fontWeight: "800", color: colors.text, letterSpacing: -0.2 },
  subtitle: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  band: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  body: { flex: 1, minHeight: 0, flexDirection: "row", gap: 0 },
  tree: { backgroundColor: colors.sidebar },
  treeSplit: { width: 330, borderRightWidth: 1, borderColor: colors.border },
  treeFull: { flex: 1 },
  treeHead: { padding: space.md, gap: space.sm, borderBottomWidth: 1, borderColor: colors.border },
  treeTitle: { fontSize: 16, fontWeight: "800", color: colors.text },
  treeMeta: { fontSize: 12, color: colors.faint, lineHeight: 17 },
  chapterRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 10, paddingHorizontal: 10, borderRadius: radiusSm, borderWidth: 1, borderColor: "transparent" },
  chapterRowOpen: { backgroundColor: colors.surface, borderColor: colors.border },
  chapterTitle: { flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: "700", color: colors.text },
  chapterCount: { fontSize: 11.5, color: colors.faint },
  moduleList: { marginLeft: 18, paddingLeft: space.sm, borderLeftWidth: 1, borderColor: colors.border, paddingVertical: 4 },
  moduleRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 8, paddingHorizontal: 10, borderRadius: radiusSm, borderWidth: 1, borderColor: "transparent" },
  moduleRowOn: { backgroundColor: colors.tealTint, borderColor: `${colors.primary}33` },
  moduleNum: { width: 22, fontSize: 11, color: colors.faint, fontVariant: ["tabular-nums"] },
  moduleTitle: { flex: 1, minWidth: 0, fontSize: 13.5, color: colors.muted },
  dot: { width: 8, height: 8, borderRadius: 4 },
  emptyModules: { fontSize: 12.5, color: colors.faint, paddingVertical: 8, paddingHorizontal: 10 },
  pane: { flex: 1, minWidth: 0, minHeight: 0, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md, gap: space.sm },
  crumb: { fontSize: 12.5, color: colors.muted },
  crumbNow: { fontSize: 12.5, color: colors.faint },
  fieldLabel: { fontSize: 12.5, color: colors.muted, fontWeight: "600" },
  charCount: { fontSize: 12, color: colors.faint },
  chapterListRow: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radiusSm },
  footer: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.md, paddingTop: space.sm, borderTopWidth: 1, borderColor: colors.border },
  saveState: { fontSize: 12.5, color: colors.faint },
  hint: { fontSize: 12, color: colors.faint, lineHeight: 17 },
});

/** Every picture extracted from the book, read-only, grouped the way the book
 * is organised. Extraction runs during processing, but its output was only
 * reachable through a module editor or a generated lesson, so a freshly
 * uploaded book looked as though nothing had been extracted. */
function PicturesTab({ documentId }: { documentId: string }) {
  const index = useAsync(() => manage.documentPictures(documentId), [documentId]);
  const data = index.data;
  const chapters = data?.chapters ?? [];
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const first = chapters.flatMap((c) => c.modules).find((m) => m.count > 0)?.id;
  useEffect(() => { if (first) setOpen((v) => (v[first] ? v : { ...v, [first]: true })); }, [first]);
  // Extraction finishes a little after processing, so a book can briefly report
  // zero pictures. Re-check a few times before concluding there are none, rather
  // than showing four zeros for the minute extraction takes.
  const { reload } = index;
  const [tries, setTries] = useState(0);
  const settling = !!data && data.total === 0 && tries < 12;
  useEffect(() => {
    if (!settling) return;
    const t = setTimeout(() => { setTries((n) => n + 1); void reload(); }, 4000);
    return () => clearTimeout(t);
  }, [settling, reload]);
  const warnings = data?.warnings ?? [];
  return (
    <View style={{ gap: 14 }}>
      <ErrorBanner message={index.error} onRetry={index.reload} />
      {index.loading && !data ? <Loading /> : null}
      {data ? <>
        <Notice message="Figures, charts, diagrams and tables only. Page banners, running heads, page numbers, navigation codes, watermarks and blocks of equations are left out on purpose. This tab is read-only." />
        <Grid min={190}>
          <Card><Text style={{ fontSize: 26, fontWeight: "700", color: colors.ink }}>{data.total}</Text><Text style={{ fontSize: 11, color: colors.muted }}>Pictures extracted</Text></Card>
          <Card><Text style={{ fontSize: 26, fontWeight: "700", color: colors.ink }}>{data.assigned}</Text><Text style={{ fontSize: 11, color: colors.muted }}>Placed in a module</Text></Card>
          <Card><Text style={{ fontSize: 26, fontWeight: "700", color: colors.ink }}>{data.needs_review}</Text><Text style={{ fontSize: 11, color: colors.muted }}>Need review</Text></Card>
          <Card><Text style={{ fontSize: 26, fontWeight: "700", color: colors.ink }}>{warnings.length}</Text><Text style={{ fontSize: 11, color: colors.muted }}>Extraction warnings</Text></Card>
        </Grid>
        {warnings.length ? <Notice tone="warning" title="Extraction notes" message={warnings.join("\n")} /> : null}
        {!data.total ? (settling ? <Row style={{ gap: 10, alignItems: "center", padding: 6 }}><Loading /><Text style={{ color: colors.muted }}>Still extracting pictures from this book\u2026</Text></Row> : <Empty icon="image-outline" title="No picture was extracted" text="This book may be text only, or its figures may be the page furniture that is deliberately left out. The source text is unaffected." />) : null}
        {chapters.map((chapter) => (
          <Card key={chapter.id}>
            <CardHead title={chapter.title} subtitle={`${chapter.modules.reduce((n, m) => n + m.count, 0)} picture(s) across ${chapter.modules.length} module(s)`} />
            {chapter.modules.map((module) => (
              <View key={module.id} style={{ borderTopWidth: 1, borderColor: colors.rowLine, paddingVertical: 10, gap: 10 }}>
                <Row style={{ justifyContent: "space-between" }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontWeight: "600", color: colors.ink }}>{module.title}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>
                      {module.start_page ? `Source page${module.end_page && module.end_page !== module.start_page ? `s ${module.start_page}\u2013${module.end_page}` : ` ${module.start_page}`}` : "Source pages not recorded"}
                    </Text>
                  </View>
                  <Badge value={module.count ? `${module.count} picture${module.count === 1 ? "" : "s"}` : "None"} tone={module.count ? "green" : "neutral"} />
                  {module.count ? <Button small variant="secondary" icon="image-outline" title={open[module.id] ? "Hide" : "Show"} onPress={() => setOpen((v) => ({ ...v, [module.id]: !v[module.id] }))} /> : null}
                </Row>
                {module.count && open[module.id] ? <ModulePictures moduleId={module.id} /> : null}
              </View>
            ))}
          </Card>
        ))}
        {data.review.length ? (
          <Card>
            <CardHead title={`Need review (${data.needs_review})`} subtitle="Extracted and stored, but matched to no module. Nothing has been discarded." />
            {data.review.map((visual) => (
              <View key={visual.id} style={{ borderTopWidth: 1, borderColor: colors.rowLine, paddingTop: 10, gap: 6 }}>
                <SourceFigures visuals={[visual]} />
                <Text style={{ fontSize: 11, color: colors.warning }}>{pictureReviewReason(visual.reason)}</Text>
              </View>
            ))}
          </Card>
        ) : null}
      </> : null}
    </View>
  );
}

function pictureReviewReason(reason?: string) {
  if (reason === "no_matching_source_page") return "No matching source page. The module it belongs to was probably edited by hand, which detaches it from its heading and clears its page range.";
  if (reason === "insufficient_context") return "Its caption and surrounding text match no module strongly enough to place it without guessing.";
  if (reason === "ambiguous_context") return "Two modules matched almost equally well, so it was not placed in either.";
  return reason ? `Held back: ${reason}` : "Held back for review.";
}

function ModulePictures({ moduleId }: { moduleId: string }) {
  const q = useAsync(() => manage.moduleVisuals(moduleId), [moduleId]);
  return <View style={{ gap: 8 }}>
    <ErrorBanner message={q.error} onRetry={q.reload} />
    {q.loading ? <Loading /> : <SourceFigures visuals={q.data?.visuals ?? []} />}
  </View>;
}

/** A module's pictures, inline and expanded, while its source text is reviewed. */
function ModuleSourceVisualsPanel({ moduleId }: { moduleId: string }) {
  const q = useAsync(() => manage.moduleVisuals(moduleId), [moduleId]);
  const visuals = q.data?.visuals ?? [];
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 11, fontWeight: "700", letterSpacing: 1.2, color: colors.muted }}>
        SOURCE PICTURES{visuals.length ? ` \u00b7 ${visuals.length}` : ""}
      </Text>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading ? <Loading /> : null}
      {!q.loading && !q.error && !visuals.length
        ? <Text style={{ fontSize: 11.5, color: colors.muted }}>No picture was extracted for these pages. Page banners, watermarks, navigation codes and blocks of equations are left out on purpose; the Pictures tab lists everything the book produced.</Text>
        : <SourceFigures visuals={visuals} />}
    </View>
  );
}

