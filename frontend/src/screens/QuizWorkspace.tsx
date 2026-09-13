import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import { manage } from "@/api/endpoints";
import type { Attempt, Question, Quiz } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { useDebounced } from "@/hooks/useDebounced";
import { useDraft } from "@/hooks/useDraft";
import {
  Badge, Button, Card, CardHead, CellText, Column, DangerZone, DetailList, Dropdown, Empty, ErrorBanner, FormFooter, Grid, Input, Loading,
  Notice, OptionCard, PageHeading, PageTabs, Screen, Split, StepList, Table, TableToolbar, TextLink, Tone, colors, confirmAsync, confirmDeleteAsync, fmtSeconds, pct,
RequestFailed, } from "@/ui";
import { DateTimeField } from "@/ui/DateTimeField";
import { ResultsRelease, type ReleaseMode } from "@/ui/ResultsRelease";
import { resultVisible } from "@/ui/releaseState";
import { type SubjectModule, useSubjectModules } from "@/screens/manage/subjectModules";

export type Tab = "questions" | "sources" | "settings" | "attempts";

const quizStatus = (z: Quiz): { label: string; tone: Tone } => (z.held_for_review ? { label: "Held for review", tone: "amber" }
  : z.status === "published" ? { label: "Published", tone: "green" } : z.status === "draft" ? { label: "Draft", tone: "neutral" } : { label: z.status.charAt(0).toUpperCase() + z.status.slice(1), tone: "neutral" });

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

export function QuizListPage() {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [subject, setSubject] = useState("");
  const [search, setSearch] = useState("");
  const needle = useDebounced(search, 150).trim().toLowerCase();
  const list = useAsync(() => manage.quizzes({ status: status && status !== "held" ? status : undefined, subject: subject || undefined }), [status, subject]);
  const subjects = useAsync(() => manage.subjects(), []);
  const rows = useMemo(() => (list.data ?? []).filter((z) => (status !== "held" || z.held_for_review) && (!needle || z.title.toLowerCase().includes(needle))), [list.data, needle, status]);
  const code = (z: Quiz) => subjects.data?.find((s) => s.id === z.subject_id)?.code ?? "";
  const action = (z: Quiz) => (z.held_for_review ? "Review quiz" : (z.attempt_count ?? 0) > 0 ? "View results" : z.status === "draft" ? "Edit quiz" : "Open quiz");
  const open = (z: Quiz) => router.push({ pathname: "/manage/quiz/[id]", params: action(z) === "View results" ? { id: z.id, tab: "attempts" } : { id: z.id } });
  const columns: Column<Quiz>[] = [
    { key: "t", label: "Quiz", flex: 2.3, render: (z) => <CellText title={z.title} sub={[code(z), (z.source_module_ids?.length ?? 0) > 1 ? `${z.source_module_ids!.length} selected modules` : z.kind === "chapter" ? "Whole chapter" : "One module", z.auto_generated ? "Automatic quiz" : z.generator === "manual" ? "Written by faculty" : null].filter(Boolean).join(" · ")} /> },
    { key: "q", label: "Questions", flex: 0.7, render: (z) => String(z.question_count ?? 0) },
    { key: "s", label: "Status", flex: 1, render: (z) => { const st = quizStatus(z); return <Badge value={st.label} tone={st.tone} />; } },
    { key: "a", label: "Attempts", flex: 0.7, render: (z) => String(z.attempt_count ?? 0) },
    { key: "r", label: "Results", flex: 1, render: (z) => ((z.pending_release_count ?? 0) > 0 ? `${z.pending_release_count} results held` : (z.attempt_count ?? 0) > 0 ? "All released" : "—") },
    { key: "x", label: "", flex: 1, render: (z) => <Button title={action(z)} small icon={action(z) === "Review quiz" ? "arrow-forward" : undefined} variant={action(z) === "Review quiz" ? "primary" : "secondary"} onPress={() => open(z)} /> },
  ];
  return (
    <Screen refreshing={list.loading} onRefresh={list.reload}>
      <PageHeading eyebrow="ASSESSMENT WORKSPACE" title="Quizzes" subtitle="Create, review, publish, and release results without changing workspaces."
        right={<Button title="Create a quiz" icon="add" onPress={() => router.push("/manage/quiz/new")} />} />
      <ErrorBanner message={list.error} onRetry={list.reload} />
      <Card flush>
        <TableToolbar right={<>
          <Dropdown value={subject} onChange={setSubject} accessibilityLabel="Filter by subject" options={[{ value: "", label: "All subjects" }, ...(subjects.data ?? []).map((s) => ({ value: s.id, label: s.code }))]} />
          <Dropdown value={status} onChange={setStatus} accessibilityLabel="Filter by status" options={[{ value: "", label: "All statuses" }, { value: "published", label: "Published" }, { value: "draft", label: "Draft" }, { value: "held", label: "Held for review" }, { value: "closed", label: "Closed" }]} />
        </>}>
          <Input icon="search" compact value={search} onChangeText={setSearch} placeholder="Search this list…" accessibilityLabel="Search quizzes" />
        </TableToolbar>
        {list.error && !list.data ? <RequestFailed onRetry={list.reload} /> : list.loading && !list.data ? <Loading lines={2} /> : (
          <Table noun="quiz" columns={columns} rows={rows} keyOf={(z) => z.id} onRowPress={open} minWidth={900}
            empty={<Empty icon="help-circle-outline" title={list.data?.length ? "No matching records" : "No quizzes yet"} text={list.data?.length ? "Try a different search." : "Create a quiz from one or more modules. Automatic quizzes also appear here as books are processed."}
              action={!list.data?.length ? <Button title="Create a quiz" icon="add" onPress={() => router.push("/manage/quiz/new")} /> : undefined} />} />
        )}
      </Card>
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* Choosing source modules (create quiz / create assignment)           */
/* ------------------------------------------------------------------ */

export function SourceModuleChooser({ subjectId, onSubject, value, onChange }: { subjectId: string; onSubject: (id: string) => void; value: string[]; onChange: (ids: string[]) => void }) {
  const subjects = useAsync(() => manage.subjects(), []);
  const modules = useSubjectModules(subjectId, true);
  const active = (subjects.data ?? []).filter((s) => s.status === "active");
  useEffect(() => { if (!subjectId && active.length) onSubject(active[0].id); }, [subjectId, active, onSubject]);
  const books = [...new Set((modules.data ?? []).map((m) => m.document_title))];
  return (
    <>
      <Dropdown label="Subject" value={subjectId} onChange={(v) => { onSubject(v); onChange([]); }} placeholder="Choose a subject" width="100%" options={active.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} />
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 12, fontWeight: "600", color: colors.ink }}>Source modules <Text style={{ color: colors.danger, fontWeight: "400" }}>*</Text></Text>
        <Text style={{ fontSize: 11, color: colors.muted }}>Select one module or combine several from the same subject. No extra dropdown is needed for a single module.</Text>
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 9, backgroundColor: "#F8FAF7", padding: 10, gap: 2 }}>
          {modules.error && !modules.data ? <RequestFailed onRetry={modules.reload} /> : modules.loading && !modules.data ? <Loading lines={1} /> : null}
          {modules.data && modules.data.length === 0 ? <Text style={{ fontSize: 12, color: colors.muted, padding: 8 }}>This subject has no published modules yet.</Text> : null}
          {books.map((b) => (
            <View key={b}>
              {books.length > 1 ? <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, paddingHorizontal: 6, paddingTop: 8 }}>{b}</Text> : null}
              {(modules.data ?? []).filter((m) => m.document_title === b).map((m) => (
                <CheckRow key={m.id} label={m.title} meta={`Module ${m.number}`} checked={value.includes(m.id)} onPress={() => onChange(value.includes(m.id) ? value.filter((x) => x !== m.id) : [...value, m.id])} />
              ))}
            </View>
          ))}
        </View>
      </View>
    </>
  );
}

function CheckRow({ label, meta, checked, onPress }: { label: string; meta?: string; checked: boolean; onPress: () => void }) {
  return (
    <OptionCardLike checked={checked} onPress={onPress} label={label}>
      <Text style={{ flex: 1, fontSize: 12, color: colors.text }}>{label}</Text>
      {meta ? <Text style={{ fontSize: 11, color: colors.muted }}>{meta}</Text> : null}
    </OptionCardLike>
  );
}

function OptionCardLike({ checked, onPress, children, label }: { checked: boolean; onPress: () => void; children: React.ReactNode; label?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked }} aria-checked={checked} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 6, paddingVertical: 7, borderRadius: 6 }}>
      <View style={{ width: 16, height: 16, borderRadius: 4, borderWidth: 1.5, borderColor: checked ? colors.primary : "#9AAA9D", backgroundColor: checked ? colors.primary : "#FFFFFF", alignItems: "center", justifyContent: "center" }}>
        {checked ? <Ionicons name="checkmark" size={11} color="#FFFFFF" /> : null}
      </View>
      {children}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export function QuizNewPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [modules, setModules] = useState<string[]>([]);
  const [how, setHow] = useState<"generate" | "manual">("generate");
  const [mcqs, setMcqs] = useState("5");
  const [written, setWritten] = useState("0");
  const created = (id: string, note?: string | null) => router.replace({ pathname: "/manage/quiz/[id]", params: note ? { id, note } : { id } });
  const go = useAction(async () => {
    if (how === "generate") {
      const quiz = await manage.generateQuiz({ module_ids: modules, title: title.trim() || undefined, num_mcqs: Number(mcqs) || 0, num_subjective: Number(written) || 0 });
      created(quiz.id, quiz.generation_warning);
    } else {
      const quiz = await manage.createQuiz({
        module_ids: modules, title: title.trim() || "Untitled quiz",
        questions: [{ type: "mcq", question: "Replace this question", options: ["A", "B", "C", "D"].map((k) => ({ key: k, text: `Option ${k}` })), correct_answer: "A", explanation: "" }],
      });
      created(quiz.id);
    }
  });
  return (
    <Screen>
      <PageHeading eyebrow="QUIZZES" title="Create a quiz" subtitle="Choose the source first. Then generate questions or write your own."
        right={<Button title="Back to quizzes" variant="secondary" icon="arrow-back" onPress={() => router.push("/manage/quizzes")} />} />
      <Split
        main={
          <Card>
            <CardHead title="Quiz basics" />
            <Input label="Quiz title" required value={title} onChangeText={setTitle} placeholder="For example, Account security" hint="Leave blank to name it after the modules when generating." />
            <SourceModuleChooser subjectId={subjectId} onSubject={setSubjectId} value={modules} onChange={setModules} />
            <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink, marginTop: 6 }}>How would you like to create the questions?</Text>
            <View style={{ gap: 8 }}>
              <OptionCard title="Generate with local AI" text="Questions are based only on the selected source modules." selected={how === "generate"} onPress={() => setHow("generate")} />
              <OptionCard title="Write my own questions" text="Start with a clean editor. Set the options and correct answers yourself." selected={how === "manual"} onPress={() => setHow("manual")} />
            </View>
            {how === "generate" ? (
              <Grid min={200} gap={16}>
                <Input label="Multiple-choice questions" value={mcqs} onChangeText={setMcqs} keyboardType="number-pad" />
                <Input label="Written-answer questions" value={written} onChangeText={setWritten} keyboardType="number-pad" hint="Marked by the tutor model against a rubric." />
              </Grid>
            ) : null}
            <ErrorBanner message={go.error} />
            <FormFooter note="Pass mark, attempts and result release are set on the quiz’s Settings tab.">
              <Button title="Cancel" variant="secondary" onPress={() => router.push("/manage/quizzes")} />
              <Button title="Continue to questions" icon="arrow-forward" onPress={() => go.run()} busy={go.busy} disabled={modules.length === 0} />
            </FormFooter>
          </Card>
        }
        side={
          <Card>
            <CardHead title="A straightforward workflow" />
            <StepList steps={[
              ["Choose the material", "Keep all selected modules in one subject."],
              ["Review every question", "Check wording, options, and the correct answer."],
              ["Set results visibility", "Show results immediately, hold them, or schedule a release."],
              ["Publish when ready", "Drafts stay hidden from students."],
            ]} />
          </Card>
        }
      />
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* One quiz                                                            */
/* ------------------------------------------------------------------ */

/** Edits typed while a save was creating a new quiz version, handed to that new version's screen. */
const carryOver = new Map<string, Quiz>();

export function QuizDetailPage({ id, initialTab, note }: { id: string; initialTab?: Tab; note?: string }) {
  const router = useRouter();
  const q = useAsync(() => manage.quiz(id), [id]);
  const subjects = useAsync(() => manage.subjects(), []);
  const modules = useSubjectModules(q.data?.subject_id);
  const [tab, setTab] = useState<Tab>(initialTab ?? "questions");
  const [fixing, setFixing] = useState(false);
  useEffect(() => { setFixing(false); }, [id]);
  const draftRef = useRef<Quiz | null>(null);
  const { draft, edit, dirty, discard, markSaved, changedMeanwhile, leftBehind, forgetLeftBehind } = useDraft<Quiz>(q.data, {
    label: (z) => `the quiz “${z.title || "Untitled quiz"}”`,
    save: async () => (await save.run()) === true,
  });
  const editQ = (i: number, fn: (x: Question) => Question) => edit((z) => ({ ...z, questions: (z.questions ?? []).map((x, j) => (j === i ? fn(x) : x)) }));
  draftRef.current = draft;
  // Pick up edits carried over from the version this quiz replaced.
  useEffect(() => {
    const carried = carryOver.get(id);
    if (!carried || !q.data) return;
    carryOver.delete(id);
    edit(() => carried);
  }, [id, q.data, edit]);

  const save = useAction(async () => {
    if (!draft) return false;
    // The draft saves to its own quiz, never to whichever quiz the route shows now.
    const sent = JSON.parse(JSON.stringify(draft)) as Quiz;
    const base = q.data?.id === sent.id ? q.data : null;
    // Questions are sent only when they changed: once students have attempted a quiz, new questions
    // make a new version, and a settings change alone must not do that.
    const questionsChanged = !base || JSON.stringify(sent.questions ?? []) !== JSON.stringify(base.questions ?? []);
    const res = await manage.updateQuiz(sent.id, {
      title: sent.title, instructions: sent.instructions,
      ...(questionsChanged ? { questions: sent.questions } : {}),
      pass_percentage: sent.pass_percentage, max_attempts: sent.max_attempts || null,
      time_limit_minutes: sent.time_limit_minutes || null, due_at: sent.due_at || null, available_from: sent.available_from || null,
      results_release: sent.results_release, results_release_at: sent.results_release === "scheduled" ? sent.results_release_at || null : null,
    });
    markSaved(sent);
    if (res.id !== sent.id) {
      // A new version was created. Anything typed while the save ran belongs on that new version, so it is
      // carried across instead of being left on the retired one.
      const newer = draftRef.current;
      router.replace(`/manage/quiz/${res.id}`);
      if (newer && JSON.stringify(newer) !== JSON.stringify(sent)) carryOver.set(res.id, { ...newer, id: res.id });
    } else if (sent.id === id) await q.reload();
    return true;
  });
  const setStatus = useAction(async (s: string) => {
    if (s === "closed" && !(await confirmAsync("Close this quiz?", "Students can no longer start new attempts. Existing attempts and results are kept.", "Close quiz", "Cancel", { tone: "warning" }))) return;
    if (s === "published" && !(await confirmAsync("Publish this quiz?", "Enrolled students can take it once its module is open.", "Publish quiz", "Cancel"))) return;
    await manage.quizStatus(id, s); await q.reload();
  });
  const review = useAction(async (action: "false_positive" | "confirm", reviewNote: string) => {
    if (!q.data?.hold_incident_id) return;
    await manage.reviewIncident(q.data.hold_incident_id, action, reviewNote);
    await q.reload();
  });
  // A held automatic quiz that really was wrong: the corrections are saved, the finding is recorded as
  // confirmed, and publishing the corrected quiz clears the hold.
  const publishHeld = useAction(async () => {
    if (!q.data) return;
    if (!(await confirmAsync("Publish the corrected quiz?", "The monitor’s finding is recorded as confirmed, and your corrected questions become available to students when the module is open.", "Publish corrected quiz", "Cancel"))) return;
    if (q.data.hold_incident_id) await manage.reviewIncident(q.data.hold_incident_id, "confirm", "Corrected by faculty and published from the quiz screen.");
    await manage.quizStatus(id, "published");
    await q.reload();
  });
  const release = useAction(async (attemptId?: string) => {
    const d = q.data; if (!d) return;
    if (!attemptId && !(await confirmAsync("Release results to everyone?", `${d.pending_release_count ?? 0} attempt${(d.pending_release_count ?? 0) === 1 ? "" : "s"} will become visible to the students who made them. Releasing cannot be undone.`, "Release results", "Not yet"))) return;
    await manage.releaseQuizResults(id, attemptId); await q.reload();
  });
  const remove = useAction(async () => {
    const d = q.data; if (!d) return;
    const attempts = d.attempt_count ?? 0;
    const ok = await confirmDeleteAsync("Delete this quiz?", attempts ? `This permanently removes the quiz and the ${attempts} student attempt${attempts === 1 ? "" : "s"} recorded against it, including their scores. It cannot be undone.` : "This permanently removes the quiz and any results recorded against it. It cannot be undone.", { detail: d.title, okLabel: "Delete quiz" });
    if (!ok) return;
    await manage.deleteQuiz(id); router.replace("/manage/quizzes");
  });

  if (q.loading && !draft) return <Screen><Loading /></Screen>;
  if (!draft) return <Screen><ErrorBanner message={q.error} onRetry={q.reload} /></Screen>;
  const d = draft;
  const editable = d.status !== "superseded";
  const st = quizStatus(d);
  const code = subjects.data?.find((sb) => sb.id === d.subject_id)?.code;
  const sourceIds = d.source_module_ids?.length ? d.source_module_ids : d.module_id ? [d.module_id] : [];
  const sources = (modules.data ?? []).filter((m) => sourceIds.includes(m.id) || (!sourceIds.length && !!d.chapter_id && m.chapter_id === d.chapter_id));
  const first = sources[0];
  const subtitle = [code, first?.document_title, sources.length > 1 ? `${sources.length} modules` : first ? `Module ${first.number}` : null, `Version ${d.version}`].filter(Boolean).join(" · ");
  const held = !!d.held_for_review;

  const saveBar = (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", paddingVertical: 13, paddingHorizontal: 18, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: "#FFFFFFF2" },
      Platform.OS === "web" ? ({ position: "sticky", bottom: 14, zIndex: 10, boxShadow: "0 8px 30px rgba(27,59,42,0.08)" } as object) : null]}>
      <Text style={{ flex: 1, fontSize: 12, color: dirty ? colors.warning : colors.muted }}>{dirty ? "Unsaved changes" : "No unsaved changes"}</Text>
      {dirty ? <Button title="Discard" small variant="ghost" onPress={discard} /> : null}
      {d.status === "draft" || d.status === "closed" ? <Button title={held ? "Publish corrected quiz" : "Publish quiz"} small variant="secondary" icon="checkmark" onPress={() => (held ? publishHeld.run() : setStatus.run("published"))} busy={setStatus.busy || publishHeld.busy} disabled={dirty} /> : null}
      <Button title="Save changes" small icon="save-outline" onPress={() => save.run()} busy={save.busy} disabled={!dirty || !editable} />
    </View>
  );

  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <PageHeading eyebrow="QUIZ WORKSPACE" title={d.title || "Untitled quiz"} subtitle={subtitle} right={<Badge value={st.label} tone={st.tone} />} />
      <PageTabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: "questions", label: "Questions" }, { key: "sources", label: "Source modules" },
        { key: "settings", label: "Settings & release" }, { key: "attempts", label: "Student attempts", count: d.attempt_count ? d.attempt_count : null },
      ]} />
      <ErrorBanner message={save.error ?? setStatus.error ?? release.error ?? remove.error ?? review.error ?? publishHeld.error} />
      {leftBehind ? <Notice tone="warning" title="Unsaved changes were left on another quiz." message={`Your edits to ${leftBehind.label} are kept with that quiz and were not applied here.`}
        action={<View style={{ flexDirection: "row", gap: 8 }}><Button title="Open that quiz" small variant="secondary" onPress={() => router.push(`/manage/quiz/${leftBehind.id}`)} /><Button title="Discard them" small variant="ghost" onPress={forgetLeftBehind} /></View>} /> : null}
      {changedMeanwhile ? <Notice tone="warning" title="This quiz changed on the server while you were editing." message="Your edits are kept. Saving replaces the server copy; discard your edits to load the latest version." /> : null}
      {held && fixing ? <Notice tone="warning" title="Correcting a held quiz" message="Save your corrections, then use “Publish corrected quiz”. The quiz stays hidden from students until you publish it." /> : null}
      {note ? <Notice tone="warning" title="Generated with notes" message={`${note}. Review the questions, add any that are missing by hand, or generate again.`} /> : null}
      {d.generator === "fallback" ? <Notice tone="warning" title="Placeholder questions" message="This older draft was produced without the AI. Rewrite the marked options before publishing." /> : null}

      {tab === "questions" && held && !fixing ? (
        <HeldReview quiz={d} source={first} busy={review.busy} onFix={() => setFixing(true)} onDecide={(a, n) => review.run(a, n)} canDecide={!!d.hold_incident_id} />
      ) : null}
      {tab === "questions" && (!held || fixing) ? (
        <>
          <Split
            main={<QuestionsEditor quiz={d} editable={editable} edit={edit} editQ={editQ} />}
            side={
              <>
                <Card>
                  <CardHead title="Review before publishing" subtitle="Read every question and confirm its answer against the source. Generation does not make a quiz automatically correct." />
                  <Button title="View source modules" variant="secondary" icon="book-outline" full onPress={() => setTab("sources")} />
                  <DetailList items={[["Question count", String(d.questions?.length ?? 0)]]} />
                </Card>
                {editable ? (
                  <Card>
                    <CardHead title="Add a question" />
                    <Button title="Add multiple-choice question" variant="secondary" icon="add" full onPress={() => edit((z) => ({ ...z, questions: [...(z.questions ?? []), { id: `q${Date.now()}`, type: "mcq", question: "", options: ["A", "B", "C", "D"].map((k) => ({ key: k, text: "" })), correct_answer: "A", explanation: "" } as Question] }))} />
                    <Button title="Add written-answer question" variant="secondary" icon="add" full onPress={() => edit((z) => ({ ...z, questions: [...(z.questions ?? []), { id: `q${Date.now()}`, type: "subjective", question: "", expected_rubric: "" } as Question] }))} />
                  </Card>
                ) : null}
              </>
            }
          />
          {saveBar}
        </>
      ) : null}

      {tab === "sources" ? (
        <>
          <Notice title="Questions come from these modules only." message="When you review an AI-generated quiz, compare the correct answers with the source—not just with the generated explanation." />
          {modules.error && !modules.data ? <RequestFailed onRetry={modules.reload} /> : modules.loading && !modules.data ? <Loading lines={2} /> : null}
          {modules.data && sources.length === 0 ? <Card><Empty icon="book-outline" text={d.kind === "chapter" ? "This quiz follows a whole chapter." : "The source module is no longer available."} /></Card> : null}
          {sources.map((m) => <SourceCard key={m.id} module={m} />)}
        </>
      ) : null}

      {tab === "settings" ? (
        <>
          <Split
            main={
              <Card>
                <CardHead title="Quiz settings" />
                <Input label="Quiz title" required value={d.title} onChangeText={(v) => edit((z) => ({ ...z, title: v }))} editable={editable} />
                <Input label="Instructions" multiline value={d.instructions ?? ""} onChangeText={(v) => edit((z) => ({ ...z, instructions: v }))} editable={editable} style={{ minHeight: 90 }} />
                <Grid min={200} gap={16}>
                  <Input label="Pass percentage" value={String(d.pass_percentage)} keyboardType="number-pad" onChangeText={(v) => edit((z) => ({ ...z, pass_percentage: Number(v) || 0 }))} editable={editable} />
                  <Input label="Maximum attempts" value={d.max_attempts ? String(d.max_attempts) : ""} keyboardType="number-pad" hint="Leave blank for no limit." onChangeText={(v) => edit((z) => ({ ...z, max_attempts: Number(v) > 0 ? Number(v) : null }))} editable={editable} />
                </Grid>
                <Grid min={200} gap={16}>
                  <Input label="Time limit (minutes)" value={d.time_limit_minutes ? String(d.time_limit_minutes) : ""} placeholder="No limit" keyboardType="number-pad" onChangeText={(v) => edit((z) => ({ ...z, time_limit_minutes: Number(v) || null }))} editable={editable} />
                  <DateTimeField label="Available from" value={d.available_from} onChange={(v) => edit((z) => ({ ...z, available_from: v }))} disabled={!editable} hint="Empty means available as soon as it is published." />
                </Grid>
                <DateTimeField label="Due date" value={d.due_at} onChange={(v) => edit((z) => ({ ...z, due_at: v }))} disabled={!editable} width={360} />
                <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink, marginTop: 6 }}>When can students see results?</Text>
                <ResultsRelease value={(d.results_release ?? "immediate") as ReleaseMode} at={d.results_release_at ?? null} disabled={!editable} onChange={(m, at) => edit((z) => ({ ...z, results_release: m, results_release_at: at }))} />
                <FormFooter note="Evaluation and result visibility are separate.">
                  <Button title="Cancel" variant="secondary" onPress={discard} disabled={!dirty} />
                  <Button title="Save settings" icon="checkmark" onPress={() => save.run()} busy={save.busy} disabled={!dirty || !editable} />
                </FormFooter>
              </Card>
            }
            side={
              <>
                <Notice title="Holding results does not delay evaluation." message="Students see that their answers were submitted, but not the score, correct answers, or remediation." />
                <Card>
                  <CardHead title="Keep previous attempts intact" subtitle="Editing questions after attempts exist creates a new quiz version. Existing attempts keep their original questions." />
                </Card>
                <DangerZone title="Quiz lifecycle" text="Closing prevents new attempts. Deleting permanently removes the quiz and its attempts.">
                  {d.status === "published" ? <Button title="Close quiz" variant="secondary" onPress={() => setStatus.run("closed")} busy={setStatus.busy} disabled={dirty} /> : null}
                  {d.status === "closed" || d.status === "draft" ? <Button title={held ? "Publish corrected quiz" : "Publish quiz"} variant="secondary" onPress={() => (held ? publishHeld.run() : setStatus.run("published"))} busy={setStatus.busy || publishHeld.busy} disabled={dirty} /> : null}
                  <Button title="Delete quiz" variant="danger" icon="trash-outline" onPress={() => remove.run()} busy={remove.busy} />
                </DangerZone>
              </>
            }
          />
        </>
      ) : null}

      {tab === "attempts" ? <AttemptsTab quiz={d} pending={q.data?.pending_release_count ?? 0} onRelease={(a) => release.run(a)} releasing={release.busy} /> : null}
    </Screen>
  );
}

function SourceCard({ module: m, badge }: { module: SubjectModule; badge?: string }) {
  const router = useRouter();
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>{m.title}</Text>
          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 3 }}>{m.document_title} · {m.chapter} · Module {m.number}</Text>
        </View>
        {badge ? <Badge value={badge} tone="green" /> : <Button title="Open module" small variant="secondary" icon="open-outline" onPress={() => router.push({ pathname: "/manage/document/[id]", params: { id: m.document_id, tab: "outline", module: m.id } })} />}
      </View>
      <View style={{ borderWidth: 1, borderColor: "#DDE8D8", backgroundColor: "#F3F6EE", borderRadius: 9, padding: 16 }}>
        <Text style={{ fontSize: 12, lineHeight: 21, color: colors.text }}>{m.source_text || "This module has no text."}</Text>
      </View>
    </Card>
  );
}

/* ---------- questions ---------- */

function QuestionsEditor({ quiz, editable, edit, editQ }: { quiz: Quiz; editable: boolean; edit: (fn: (z: Quiz) => Quiz) => void; editQ: (i: number, fn: (x: Question) => Question) => void }) {
  const questions = quiz.questions ?? [];
  return (
    <View style={{ gap: 16 }}>
      {questions.length === 0 ? <Card><Empty icon="help-circle-outline" title="No questions yet" text="Add a multiple-choice or written-answer question." /></Card> : null}
      {questions.map((qq, i) => (
        <Card key={qq.id}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: colors.ink }}>Question {i + 1}</Text>
            <Badge value={qq.type === "mcq" ? "Multiple choice" : "Written answer"} tone="neutral" />
            {editable ? <Button title="Remove" small variant="ghost" icon="trash-outline" onPress={() => edit((z) => ({ ...z, questions: (z.questions ?? []).filter((_, j) => j !== i) }))} /> : null}
          </View>
          <Input label="Question" required multiline value={qq.question} editable={editable} onChangeText={(v) => editQ(i, (x) => ({ ...x, question: v }))} style={{ minHeight: 70 }} />
          {qq.type === "mcq" ? (
            <>
              <Text style={{ fontSize: 12, color: colors.muted }}>Select the correct answer.</Text>
              {qq.options?.map((o, oi) => {
                const on = qq.correct_answer === o.key;
                return (
                  <View key={o.key} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 8, borderWidth: 1, borderRadius: 9, borderColor: on ? "#82A58B" : colors.border, backgroundColor: on ? "#F1F6EF" : "#FFFFFF" }}>
                    <Pressable onPress={() => editable && editQ(i, (x) => ({ ...x, correct_answer: o.key }))} accessibilityRole="radio" accessibilityLabel={`Mark ${o.key} correct`} accessibilityState={{ checked: on }}
                      style={{ width: 16, height: 16, borderRadius: 8, borderWidth: on ? 5 : 1.5, borderColor: on ? colors.primary : "#9AAA9D" }} />
                    <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, width: 14 }}>{o.key}</Text>
                    <TextInput value={o.text} editable={editable} accessibilityLabel={`Option ${o.key}`}
                      onChangeText={(v) => editQ(i, (x) => ({ ...x, options: (x.options ?? []).map((p, pj) => (pj === oi ? { ...p, text: v } : p)) }))}
                      style={{ flex: 1, borderWidth: 1, borderColor: "#D8E0D7", borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7, fontSize: 12, color: colors.ink, backgroundColor: "#FFFFFF" }} />
                  </View>
                );
              })}
              <Input label="Explanation" value={qq.explanation ?? ""} editable={editable} onChangeText={(v) => editQ(i, (x) => ({ ...x, explanation: v }))} />
            </>
          ) : (
            <Input label="Expected answer / rubric" multiline value={qq.expected_rubric ?? ""} editable={editable} onChangeText={(v) => editQ(i, (x) => ({ ...x, expected_rubric: v }))} hint="The tutor model marks written answers against this." />
          )}
          {qq.source_reference ? (
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>Source reference</Text>
              <Text style={{ fontSize: 11, color: colors.muted, lineHeight: 17 }}>{qq.source_reference}</Text>
            </View>
          ) : null}
        </Card>
      ))}
    </View>
  );
}

/* ---------- held automatic quiz ---------- */

function HeldReview({ quiz, source, busy, onFix, onDecide, canDecide }: { quiz: Quiz; source?: SubjectModule; busy: boolean; onFix: () => void; onDecide: (a: "false_positive" | "confirm", note: string) => void; canDecide: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const details = quiz.hold_details;
  const questions = quiz.questions ?? [];
  const flagged = questions.map((q, i) => ({ q, n: i + 1 })).filter(({ q }) => details?.question_ids?.includes(q.id));
  const evidence = details?.evidence?.length ? details.evidence : source ? [{ ref: source.title, text: source.source_text }] : [];
  return (
    <>
      <Notice tone="warning" title="This automatic quiz is hidden from students." message={`The AI monitor found a possible problem${quiz.hold_reason ? `: ${quiz.hold_reason}` : ""}. Compare the flagged question with the source, then correct and publish the quiz, or mark the finding as a false alarm.`} />
      <Grid min={320} gap={20}>
        <Card>
          <CardHead title={flagged.length > 1 ? "Flagged questions" : "Generated question"} />
          {flagged.length ? flagged.map(({ q, n }) => {
            const answer = q.type === "mcq" ? q.options?.find((o) => o.key === q.correct_answer)?.text : q.expected_rubric;
            return (
              <View key={q.id} style={{ gap: 8 }}>
                <Text style={{ fontSize: 10, fontWeight: "700", letterSpacing: 1.8, color: colors.muted }}>{`QUESTION ${n} · FLAGGED FOR REVIEW`}</Text>
                <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>{q.question || "No question text"}</Text>
                {answer ? <View style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: "#F8FAF7", borderRadius: 9, padding: 12 }}><Text style={{ fontSize: 12, color: colors.text }}>The generated answer says: “{answer}”</Text></View> : null}
              </View>
            );
          }) : (
            <>
              <Text style={{ fontSize: 13, color: colors.text, lineHeight: 20 }}>The monitor’s finding does not name a single question. Check each of the {questions.length} question{questions.length === 1 ? "" : "s"} against the source.</Text>
              {questions.slice(0, 5).map((q, i) => <Text key={q.id} style={{ fontSize: 12, color: colors.muted }}>{i + 1}. {q.question}</Text>)}
            </>
          )}
          {details?.findings?.length ? (
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.ink }}>What the monitor found</Text>
              {details.findings.map((f, i) => <Text key={i} style={{ fontSize: 12, color: colors.text }}>• {f.detail || f.name}</Text>)}
            </View>
          ) : null}
          <View style={{ flexDirection: "row" }}><Button title="Correct questions" icon="create-outline" onPress={onFix} /></View>
        </Card>
        <Card>
          <CardHead title="Source evidence" subtitle={details?.evidence?.length ? "The passages the monitor compared the quiz with." : "The source module this quiz was written from."} />
          {evidence.length === 0 ? <Text style={{ fontSize: 12, color: colors.muted }}>No source passage was recorded for this finding.</Text> : evidence.map((e, i) => (
            <View key={i} style={{ borderWidth: 1, borderColor: "#DDE8D8", backgroundColor: "#F3F6EE", borderRadius: 9, padding: 14, gap: 4 }}>
              {e.ref ? <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted }}>{e.ref}</Text> : null}
              <Text style={{ fontSize: 12, lineHeight: 20, color: colors.text }} numberOfLines={10}>“{e.text}”</Text>
            </View>
          ))}
          {source ? <TextLink title="Read the full source" icon="book-outline" onPress={() => router.push({ pathname: "/manage/document/[id]", params: { id: source.document_id, tab: "outline", module: source.id } })} /> : null}
        </Card>
      </Grid>
      <Card>
        <CardHead title="Your decision" />
        <Input label="Review note" multiline value={note} onChangeText={setNote} placeholder="What you checked and what you decided" style={{ minHeight: 90 }} />
        <View style={{ flexDirection: "row", gap: 9, flexWrap: "wrap" }}>
          <Button title="Fix & review the quiz" icon="create-outline" onPress={onFix} />
          <Button title="Mark as false alarm" variant="secondary" icon="checkmark" onPress={() => onDecide("false_positive", note || "Released from the quiz screen: questions checked.")} busy={busy} disabled={!canDecide} />
          <Button title="Confirm the issue" variant="secondary" icon="flag-outline" onPress={() => onDecide("confirm", note)} busy={busy} disabled={!canDecide} />
        </View>
        <Text style={{ fontSize: 11, color: colors.muted }}>A false alarm releases the quiz as it is. If the finding is right, fix the questions and use “Publish corrected quiz”; confirming without fixing keeps the quiz hidden.</Text>
      </Card>
    </>
  );
}

/* ---------- attempts ---------- */

function AttemptsTab({ quiz, pending, onRelease, releasing }: { quiz: Quiz; pending: number; onRelease: (attemptId?: string) => void; releasing: boolean }) {
  const router = useRouter();
  const q = useAsync(() => manage.quizAttempts(quiz.id), [quiz.id, pending, quiz.results_released_at]);
  const held = (a: Attempt) => !resultVisible(quiz, a);
  const columns: Column<Attempt>[] = [
    { key: "s", label: "Student", flex: 1.8, render: (a) => <CellText avatar={a.student_name || a.student_email || "?"} title={a.student_name || a.student_email || "Student"} sub={`Attempt ${a.attempt_number} · ${a.submitted_at ? new Date(a.submitted_at).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "in progress"}`} /> },
    { key: "p", label: "Score", flex: 0.6, render: (a) => pct(a.percentage) },
    { key: "e", label: "Evaluation", flex: 1, render: (a) => <Badge value={a.status === "evaluated" ? "Evaluated" : a.status === "pending_evaluation" ? "Pending evaluation" : a.status === "in_progress" ? "In progress" : "Submitted"} tone={a.status === "evaluated" ? "green" : "amber"} /> },
    { key: "t", label: "Time taken", flex: 0.8, render: (a) => fmtSeconds(a.time_taken_seconds) },
    { key: "r", label: "Results", flex: 0.7, render: (a) => <Badge value={held(a) ? "Held" : "Released"} tone={held(a) ? "amber" : "green"} /> },
    { key: "x", label: "", flex: 1.5, render: (a) => (
      <View style={{ flexDirection: "row", gap: 6 }}>
        <Button title="Review attempt" small variant="secondary" onPress={() => router.push({ pathname: "/manage/attempt/[id]", params: { id: a.id, quiz: quiz.id } })} />
        {held(a) && a.status === "evaluated" ? <Button title="Release" small variant="secondary" onPress={() => onRelease(a.id)} /> : null}
      </View>
    ) },
  ];
  return (
    <>
      {pending ? (
        <Notice tone="warning" title={`${pending} student${pending === 1 ? " is" : "s are"} waiting for their results.`} message="Their attempts are evaluated. Releasing makes their own scores and feedback visible to them. Release cannot be undone."
          action={<Button title="Release all results" icon="checkmark" small onPress={() => onRelease()} busy={releasing} />} />
      ) : null}
      <ErrorBanner message={q.error} onRetry={q.reload} />
      <Card flush>
        {q.error && !q.data ? <RequestFailed onRetry={q.reload} /> : q.loading && !q.data ? <Loading lines={2} /> : <Table noun="attempt" columns={columns} rows={q.data ?? []} keyOf={(a) => a.id} minWidth={900} empty={<Empty icon="people-outline" text="No attempts yet." />} />}
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* One attempt                                                          */
/* ------------------------------------------------------------------ */

export function AttemptReviewPage({ attemptId, quizId }: { attemptId: string; quizId: string }) {
  const router = useRouter();
  const quiz = useAsync(() => manage.quiz(quizId), [quizId]);
  const attempts = useAsync(() => manage.quizAttempts(quizId), [quizId]);
  const a = attempts.data?.find((x) => x.id === attemptId) ?? null;
  const [overrides, setOverrides] = useState<Record<string, { score_awarded: number; feedback?: string }>>({});
  const save = useAction(async () => { await manage.reEvaluate(attemptId, overrides); setOverrides({}); await attempts.reload(); });
  const rerun = useAction(async () => { await manage.reEvaluate(attemptId); await attempts.reload(); });
  const release = useAction(async () => { await manage.releaseQuizResults(quizId, attemptId); await attempts.reload(); });
  const back = () => router.push({ pathname: "/manage/quiz/[id]", params: { id: quizId, tab: "attempts" } });
  const z = quiz.data;
  const held = !!a && !!z && !resultVisible(z, a);
  const correct = a?.detailed_results.filter((r) => r.is_correct).length ?? 0;
  const written = a?.detailed_results.filter((r) => r.type !== "mcq") ?? [];
  return (
    <Screen refreshing={attempts.loading} onRefresh={attempts.reload}>
      <PageHeading eyebrow="STUDENT ATTEMPT" title={a ? `${a.student_name || a.student_email} · Attempt ${a.attempt_number}` : "Attempt"} subtitle={z && a ? `${z.title} · Submitted ${a.submitted_at ? new Date(a.submitted_at).toLocaleString() : "—"}` : null}
        right={<Button title="Back to attempts" variant="secondary" icon="arrow-back" onPress={back} />} />
      <ErrorBanner message={attempts.error ?? save.error ?? rerun.error ?? release.error} onRetry={attempts.reload} />
      {attempts.loading && !a ? <Loading /> : null}
      {attempts.data && !a ? <Notice tone="warning" title="Attempt not found" message="It may belong to an older version of this quiz." /> : null}
      {a && z ? (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            {[["Score", pct(a.percentage), `${correct} of ${a.total_questions} correct`], ["Pass mark", `${z.pass_percentage}%`, a.passed ? "Passed this attempt" : a.status === "evaluated" ? "Not passed" : "Awaiting marking"], ["Time taken", fmtSeconds(a.time_taken_seconds), "Server-recorded timing"], ["Results", held ? "Held" : "Released", held ? "Not visible to the student" : "Visible to the student"]].map(([l, v, h]) => (
              <View key={l} style={{ flex: 1, minWidth: 200, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 18 }}>
                <Text style={{ fontSize: 12, color: colors.muted }}>{l}</Text>
                <Text style={{ fontSize: 29, fontWeight: "600", color: colors.ink, marginVertical: 6 }}>{v}</Text>
                <Text style={{ fontSize: 11, color: colors.muted }}>{h}</Text>
              </View>
            ))}
          </View>
          <Split
            main={
              <Card>
                <CardHead title="Review an answer" />
                {a.detailed_results.map((r, i) => (
                  <View key={r.question_id} style={{ gap: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.rowLine }}>
                    <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>Question {i + 1} · {r.question}</Text>
                    <View style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: "#F8FAF7", borderRadius: 9, padding: 12, gap: 8 }}>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.ink }}>Student answer</Text>
                      <Text style={{ fontSize: 12, color: colors.text }}>{r.type === "mcq" ? (r.selected_option ?? "—") : (r.student_answer || "(blank)")}</Text>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.ink }}>Expected answer</Text>
                      <Text style={{ fontSize: 12, color: colors.text }}>{r.type === "mcq" ? (r.correct_option ?? "—") : (r.explanation || r.feedback || "Marked against the rubric")}</Text>
                    </View>
                    {r.type === "mcq" ? <Badge value={r.is_correct ? "Correct" : "Incorrect"} tone={r.is_correct ? "green" : "red"} /> : (
                      <Grid min={200} gap={12}>
                        <Input label="Score awarded" keyboardType="decimal-pad" value={overrides[r.question_id] ? String(overrides[r.question_id].score_awarded) : r.score_awarded != null ? String(r.score_awarded) : ""}
                          hint="Each question is scored from 0 to 1." onChangeText={(v) => setOverrides((o) => ({ ...o, [r.question_id]: { ...o[r.question_id], score_awarded: Math.max(0, Math.min(1, Number(v) || 0)) } }))} />
                        <Input label="Feedback" multiline value={overrides[r.question_id]?.feedback ?? r.feedback ?? ""} style={{ minHeight: 70 }}
                          onChangeText={(v) => setOverrides((o) => ({ ...o, [r.question_id]: { score_awarded: o[r.question_id]?.score_awarded ?? r.score_awarded ?? 0, feedback: v } }))} />
                      </Grid>
                    )}
                  </View>
                ))}
                <FormFooter note={written.length ? "Changes use the existing faculty re-evaluation action." : "Multiple-choice answers are marked automatically."}>
                  <Button title="Cancel" variant="secondary" onPress={() => setOverrides({})} disabled={!Object.keys(overrides).length} />
                  <Button title="Save evaluation" icon="checkmark" onPress={() => save.run()} busy={save.busy} disabled={!Object.keys(overrides).length} />
                </FormFooter>
              </Card>
            }
            side={
              <Card>
                <CardHead title="Evaluation actions" subtitle={held ? "Scores and feedback stay hidden until released." : "This result is visible to the student."} />
                {held ? <Button title="Release this result" icon="checkmark" full onPress={() => release.run()} busy={release.busy} disabled={a.status !== "evaluated"} /> : null}
                <Button title="Re-evaluate pending answers" variant="secondary" icon="refresh" full onPress={() => rerun.run()} busy={rerun.busy} />
                <Text style={{ fontSize: 11, color: colors.muted }}>Written answers may be pending when the local AI is unavailable.</Text>
              </Card>
            }
          />
        </>
      ) : null}
    </Screen>
  );
}

