import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { manage } from "@/api/endpoints";
import type { Assignment, Submission } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { useDebounced } from "@/hooks/useDebounced";
import { useDraft, useUnsavedWarning } from "@/hooks/useDraft";
import { confirmLeave, registerGuard } from "@/hooks/unsavedGuard";
import {
  Badge, Button, Card, CardHead, CellText, Column, DangerZone, DetailList, Dropdown, Empty, ErrorBanner, FormFooter, Grid, Input, Loading,
  Notice, OptionCard, PageHeading, PageTabs, Screen, Split, StepList, Table, TableToolbar, Tone, colors, confirmAsync, confirmDeleteAsync, fmtDate, fmtDay,
RequestFailed, } from "@/ui";
import { DateTimeField } from "@/ui/DateTimeField";
import { ResultsRelease, type ReleaseMode } from "@/ui/ResultsRelease";
import { resultVisible } from "@/ui/releaseState";
import { SourceModuleChooser } from "@/screens/QuizWorkspace";
import { useSubjectModules } from "@/screens/manage/subjectModules";

export type Tab = "brief" | "sources" | "settings" | "submissions";

const aStatus = (a: Assignment): { label: string; tone: Tone } => (a.status === "published" ? { label: "Published", tone: "green" } : a.status === "draft" ? { label: "Draft", tone: "neutral" } : { label: "Closed", tone: "neutral" });

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

export function AssignmentListPage() {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const needle = useDebounced(search, 150).trim().toLowerCase();
  const list = useAsync(() => manage.assignments({ status: status || undefined }), [status]);
  const subjects = useAsync(() => manage.subjects(), []);
  const rows = useMemo(() => (list.data ?? []).filter((a) => !needle || a.title.toLowerCase().includes(needle)), [list.data, needle]);
  const subject = (a: Assignment) => subjects.data?.find((s) => s.id === a.subject_id);
  const action = (a: Assignment) => (a.status === "draft" ? "Edit draft" : (a.submission_count ?? 0) > 0 ? "Review submissions" : "Open assignment");
  const open = (a: Assignment) => router.push({ pathname: "/manage/assignment/[id]", params: action(a) === "Review submissions" ? { id: a.id, tab: "submissions" } : { id: a.id } });
  const columns: Column<Assignment>[] = [
    { key: "t", label: "Assignment", flex: 2.2, render: (a) => { const s = subject(a); return <CellText title={a.title} sub={s ? `${s.code} · ${s.name}` : null} />; } },
    { key: "s", label: "Status", flex: 0.8, render: (a) => { const st = aStatus(a); return <Badge value={st.label} tone={st.tone} />; } },
    { key: "d", label: "Due date", flex: 0.9, render: (a) => (a.due_at ? fmtDay(a.due_at) : "—") },
    { key: "n", label: "Submissions", flex: 0.8, render: (a) => `${a.submission_count ?? 0} of ${(subject(a) as { active_students?: number } | undefined)?.active_students ?? "—"}` },
    { key: "r", label: "To do", flex: 1, render: (a) => ((a.pending_release_count ?? 0) > 0 ? `${a.pending_release_count} results held` : "—") },
    { key: "x", label: "", flex: 1.1, render: (a) => <Button title={action(a)} small icon={action(a) === "Review submissions" ? "arrow-forward" : undefined} variant={action(a) === "Review submissions" ? "primary" : "secondary"} onPress={() => open(a)} /> },
  ];
  return (
    <Screen refreshing={list.loading} onRefresh={list.reload}>
      <PageHeading eyebrow="TEACHING ACTIVITIES" title="Assignments" subtitle="Clear instructions for students. A simpler review process for you."
        right={<Button title="Create assignment" icon="add" onPress={() => router.push("/manage/assignment/new")} />} />
      <ErrorBanner message={list.error} onRetry={list.reload} />
      <Card flush>
        <TableToolbar right={<Dropdown value={status} onChange={setStatus} accessibilityLabel="Filter by status" options={[{ value: "", label: "All statuses" }, { value: "published", label: "Published" }, { value: "draft", label: "Draft" }, { value: "closed", label: "Closed" }]} />}>
          <Input icon="search" compact value={search} onChangeText={setSearch} placeholder="Search this list…" accessibilityLabel="Search assignments" />
        </TableToolbar>
        {list.error && !list.data ? <RequestFailed onRetry={list.reload} /> : list.loading && !list.data ? <Loading lines={2} /> : (
          <Table noun="assignment" columns={columns} rows={rows} keyOf={(a) => a.id} onRowPress={open} minWidth={900}
            empty={<Empty icon="create-outline" title={list.data?.length ? "No matching records" : "No assignments yet"} text={list.data?.length ? "Try a different search." : "Create an assignment from one or more modules; the task and rubric can be drafted for you."}
              action={!list.data?.length ? <Button title="Create assignment" icon="add" onPress={() => router.push("/manage/assignment/new")} /> : undefined} />} />
        )}
      </Card>
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export function AssignmentNewPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [modules, setModules] = useState<string[]>([]);
  const [how, setHow] = useState<"generate" | "manual">("generate");
  const [maxScore, setMaxScore] = useState("10");
  const [due, setDue] = useState("");
  const go = useAction(async () => {
    const score = Number(maxScore) || 10;
    const common = { module_ids: modules, max_score: score, due_at: due || undefined, allow_late: true };
    const a = how === "generate"
      ? await manage.generateAssignment({ ...common, title: title.trim() || undefined })
      : await manage.createAssignment({ ...common, title: title.trim() || "Untitled assignment", rubric: [{ criterion: "Accuracy against the source", points: Math.ceil(score / 2) }, { criterion: "Clarity and structure", points: Math.floor(score / 2) }] });
    router.replace(`/manage/assignment/${a.id}`);
  });
  return (
    <Screen>
      <PageHeading eyebrow="ASSIGNMENTS" title="Create an assignment" subtitle="Select the source, describe the task, and decide how it will be assessed."
        right={<Button title="Back to assignments" variant="secondary" icon="arrow-back" onPress={() => router.push("/manage/assignments")} />} />
      <Split
        main={
          <Card>
            <CardHead title="Assignment basics" />
            <Input label="Assignment title" required value={title} onChangeText={setTitle} placeholder="For example, A personal security checklist" hint="Leave blank to name it after the modules when generating." />
            <SourceModuleChooser subjectId={subjectId} onSubject={setSubjectId} value={modules} onChange={setModules} />
            <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink, marginTop: 6 }}>Create the task</Text>
            <View style={{ gap: 8 }}>
              <OptionCard title="Generate a task and rubric with local AI" text="Drafted only from the selected modules; you edit it before publishing." selected={how === "generate"} onPress={() => setHow("generate")} />
              <OptionCard title="Write the task myself" text="Start from an empty task with a simple two-criterion rubric." selected={how === "manual"} onPress={() => setHow("manual")} />
            </View>
            <Grid min={200} gap={16}>
              <Input label="Maximum score" value={maxScore} onChangeText={setMaxScore} keyboardType="number-pad" />
              <DateTimeField label="Due date" value={due || null} onChange={(v) => setDue(v ?? "")} />
            </Grid>
            <ErrorBanner message={go.error} />
            <FormFooter note="Attempts, late submissions and result release are set on the Settings tab.">
              <Button title="Cancel" variant="secondary" onPress={() => router.push("/manage/assignments")} />
              <Button title="Continue to task" icon="arrow-forward" onPress={() => go.run()} busy={go.busy} disabled={modules.length === 0} />
            </FormFooter>
          </Card>
        }
        side={
          <Card>
            <CardHead title="How assignments work" />
            <StepList steps={[
              ["Choose the material", "The task is written from the modules you select."],
              ["Make expectations clear", "Say what to submit and how each part is assessed."],
              ["Evaluate, then release", "Mark each submission; release results when you are ready."],
            ]} />
          </Card>
        }
      />
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* One assignment                                                      */
/* ------------------------------------------------------------------ */

export function AssignmentDetailPage({ id, initialTab }: { id: string; initialTab?: Tab }) {
  const router = useRouter();
  const q = useAsync(() => manage.assignment(id), [id]);
  const subjects = useAsync(() => manage.subjects(), []);
  const modules = useSubjectModules(q.data?.subject_id);
  const [tab, setTab] = useState<Tab>(initialTab ?? "brief");
  const { draft: d, edit, dirty, discard, markSaved, changedMeanwhile, leftBehind, forgetLeftBehind } = useDraft<Assignment>(q.data, {
    label: (a) => `the assignment “${a.title || "Untitled assignment"}”`,
    save: async () => (await save.run()) === true,
  });

  const save = useAction(async () => {
    if (!d) return false;
    const sent = JSON.parse(JSON.stringify(d)) as Assignment;
    await manage.updateAssignment(sent.id, {
      title: sent.title, description: sent.description, instructions: sent.instructions, rubric: sent.rubric,
      max_score: sent.max_score, due_at: sent.due_at || null, available_from: sent.available_from || null,
      allow_late: sent.allow_late, allow_resubmission: sent.allow_resubmission, max_attempts: sent.allow_resubmission ? sent.max_attempts ?? null : null,
      results_release: sent.results_release, results_release_at: sent.results_release === "scheduled" ? sent.results_release_at || null : null,
    });
    markSaved(sent);
    if (sent.id === id) await q.reload();
    return true;
  });
  const setStatus = useAction(async (s: string) => {
    if (s === "closed" && !(await confirmAsync("Close this assignment?", "Students can no longer submit. Existing submissions and scores are kept.", "Close assignment", "Cancel", { tone: "warning" }))) return;
    if (s === "published" && !(await confirmAsync("Publish this assignment?", "Enrolled students can see it and submit.", "Publish assignment", "Cancel"))) return;
    await manage.assignmentStatus(id, s); await q.reload();
  });
  const remove = useAction(async () => {
    if (!q.data) return;
    const ok = await confirmDeleteAsync("Delete this assignment?", "This permanently removes the assignment and every submission, score and piece of feedback recorded against it. It cannot be undone.", { detail: q.data.title, okLabel: "Delete assignment" });
    if (!ok) return;
    await manage.deleteAssignment(id); router.replace("/manage/assignments");
  });

  if (q.loading && !d) return <Screen><Loading /></Screen>;
  if (!d) return <Screen><ErrorBanner message={q.error} onRetry={q.reload} /></Screen>;
  const subject = subjects.data?.find((s) => s.id === d.subject_id);
  const st = aStatus(d);
  const sourceIds = d.source_module_ids?.length ? d.source_module_ids : d.module_id ? [d.module_id] : [];
  const sources = (modules.data ?? []).filter((m) => sourceIds.includes(m.id) || (!sourceIds.length && !!d.chapter_id && m.chapter_id === d.chapter_id));
  const rubricTotal = d.rubric.reduce((t, r) => t + (Number(r.points) || 0), 0);
  const attemptsValue = !d.allow_resubmission ? "1" : d.max_attempts ? String(d.max_attempts) : "";

  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <PageHeading eyebrow="ASSIGNMENT WORKSPACE" title={d.title || "Untitled assignment"} subtitle={subject ? `${subject.code} · ${subject.name}` : null} right={<Badge value={st.label} tone={st.tone} />} />
      <PageTabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: "brief", label: "Task & rubric" }, { key: "sources", label: "Source modules" },
        { key: "settings", label: "Settings & release" }, { key: "submissions", label: "Submissions", count: d.submission_count ? d.submission_count : null },
      ]} />
      <ErrorBanner message={save.error ?? setStatus.error ?? remove.error} />
      {leftBehind ? <Notice tone="warning" title="Unsaved changes were left on another assignment." message={`Your edits to ${leftBehind.label} are kept with that assignment and were not applied here.`}
        action={<View style={{ flexDirection: "row", gap: 8 }}><Button title="Open that assignment" small variant="secondary" onPress={() => router.push(`/manage/assignment/${leftBehind.id}`)} /><Button title="Discard them" small variant="ghost" onPress={forgetLeftBehind} /></View>} /> : null}
      {changedMeanwhile ? <Notice tone="warning" title="This assignment changed on the server while you were editing." message="Your edits are kept. Saving replaces the server copy; cancel your edits to load the latest version." /> : null}
      {d.generator === "fallback" ? <Notice tone="warning" title="Fallback draft" message="This draft was produced without the AI. Review the task and rubric before publishing." /> : null}

      {tab === "brief" ? (
        <Split
          main={
            <Card>
              <CardHead title="Task & assessment criteria" />
              <Input label="Assignment title" required value={d.title} onChangeText={(v) => edit((a) => ({ ...a, title: v }))} />
              <Input label="Task instructions" multiline value={d.description ?? ""} onChangeText={(v) => edit((a) => ({ ...a, description: v }))} style={{ minHeight: 110 }} />
              <Input label="Points to include" multiline value={d.instructions ?? ""} onChangeText={(v) => edit((a) => ({ ...a, instructions: v }))} style={{ minHeight: 80 }} hint="One point per line; students see them as a numbered list." />
              <View style={{ gap: 8 }}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.ink }}>Assessment rubric</Text>
                {d.rubric.map((r, i) => (
                  <View key={i} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                    <Input compact value={r.criterion} placeholder="Criterion" onChangeText={(v) => edit((a) => ({ ...a, rubric: a.rubric.map((x, j) => (j === i ? { ...x, criterion: v } : x)) }))} containerStyle={{ flex: 1 }} accessibilityLabel={`Criterion ${i + 1}`} />
                    <Input compact value={String(r.points)} keyboardType="number-pad" onChangeText={(v) => edit((a) => ({ ...a, rubric: a.rubric.map((x, j) => (j === i ? { ...x, points: Number(v) || 0 } : x)) }))} containerStyle={{ width: 80 }} accessibilityLabel={`Points for criterion ${i + 1}`} />
                    <Text style={{ fontSize: 11, color: colors.muted }}>points</Text>
                    <Button title="Remove" small variant="ghost" onPress={() => edit((a) => ({ ...a, rubric: a.rubric.filter((_, j) => j !== i) }))} />
                  </View>
                ))}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Button title="Add criterion" small variant="secondary" icon="add" onPress={() => edit((a) => ({ ...a, rubric: [...a.rubric, { criterion: "", points: 0 }] }))} />
                  <Text style={{ fontSize: 11, color: rubricTotal === d.max_score ? colors.muted : colors.warning }}>{rubricTotal} of {d.max_score} points{rubricTotal === d.max_score ? "" : " · must match the maximum score"}</Text>
                </View>
              </View>
              <Input label="Maximum score" value={String(d.max_score)} keyboardType="number-pad" onChangeText={(v) => edit((a) => ({ ...a, max_score: Number(v) || 0 }))} containerStyle={{ maxWidth: 200 }} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", paddingVertical: 12, paddingHorizontal: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: "#F8FAF7", marginTop: 6 }}>
                <Text style={{ flex: 1, fontSize: 12, color: dirty ? colors.warning : colors.muted }}>{dirty ? "Unsaved changes" : "No unsaved changes"}</Text>
                {d.status === "draft" ? <Button title="Publish assignment" small variant="secondary" icon="checkmark" onPress={() => setStatus.run("published")} busy={setStatus.busy} disabled={dirty} /> : null}
                <Button title="Save changes" small icon="save-outline" onPress={() => save.run()} busy={save.busy} disabled={!dirty || rubricTotal !== d.max_score} />
              </View>
            </Card>
          }
          side={
            <Card>
              <CardHead title="Make expectations clear." subtitle="Tell students what to submit and how each part will be assessed. The rubric’s points should add up to the maximum score." />
              <Button title="Review submissions" variant="secondary" icon="people-outline" full onPress={() => setTab("submissions")} />
            </Card>
          }
        />
      ) : null}

      {tab === "sources" ? (
        <Card>
          <CardHead title="Source material" />
          {modules.error && !modules.data ? <RequestFailed onRetry={modules.reload} /> : modules.loading && !modules.data ? <Loading lines={1} /> : null}
          {modules.data && sources.length === 0 ? <Empty icon="book-outline" text={d.chapter_id ? "This assignment follows a whole chapter." : "This assignment was written for the whole subject."} /> : null}
          {sources.map((m) => (
            <View key={m.id} style={{ gap: 10, paddingVertical: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: colors.pale, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 11, color: colors.primary }}>{m.number}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{m.title}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{m.document_title} · Module {m.number}</Text>
                </View>
                <Badge value="Source module" tone="green" />
              </View>
              <View style={{ borderWidth: 1, borderColor: "#DDE8D8", backgroundColor: "#F3F6EE", borderRadius: 9, padding: 14 }}>
                <Text style={{ fontSize: 12, lineHeight: 20, color: colors.text }}>{m.source_text || "This module has no text."}</Text>
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {tab === "settings" ? (
        <Split
          main={
            <Card>
              <CardHead title="Assignment settings" />
              <Grid min={200} gap={16}>
                <Input label="Maximum attempts" value={attemptsValue} keyboardType="number-pad" placeholder="No limit" hint="1 means a single submission. Leave blank for no limit."
                  onChangeText={(v) => { const n = Number(v); edit((a) => ({ ...a, allow_resubmission: v.trim() === "" || n > 1, max_attempts: n > 1 ? n : null })); }} />
                <DateTimeField label="Available from" value={d.available_from} onChange={(v) => edit((a) => ({ ...a, available_from: v }))} hint="Empty means available as soon as it is published." />
              </Grid>
              <DateTimeField label="Due date" value={d.due_at} onChange={(v) => edit((a) => ({ ...a, due_at: v }))} width={360} />
              <OptionCard multi title="Accept late submissions" text="Late work is accepted and marked as late." selected={d.allow_late} onPress={() => edit((a) => ({ ...a, allow_late: !a.allow_late }))} />
              <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink, marginTop: 6 }}>When can students see results?</Text>
              <ResultsRelease kind="assignment" value={(d.results_release ?? "immediate") as ReleaseMode} at={d.results_release_at ?? null} onChange={(m, at) => edit((a) => ({ ...a, results_release: m, results_release_at: at }))} />
              <FormFooter note="Evaluation and release are separate steps.">
                <Button title="Cancel" variant="secondary" onPress={discard} disabled={!dirty} />
                <Button title="Save settings" icon="checkmark" onPress={() => save.run()} busy={save.busy} disabled={!dirty} />
              </FormFooter>
            </Card>
          }
          side={
            <>
              <Notice title="Evaluation and release are different steps." message="Your evaluation can be saved before the student is allowed to see it." />
              <DangerZone title="Assignment lifecycle" text="Closing ends availability. Deleting also removes submissions and scores.">
                {d.status === "published" ? <Button title="Close assignment" variant="secondary" onPress={() => setStatus.run("closed")} busy={setStatus.busy} disabled={dirty} /> : <Button title="Publish assignment" variant="secondary" onPress={() => setStatus.run("published")} busy={setStatus.busy} disabled={dirty} />}
                <Button title="Delete" variant="danger" icon="trash-outline" onPress={() => remove.run()} busy={remove.busy} />
              </DangerZone>
            </>
          }
        />
      ) : null}

      {tab === "submissions" ? <SubmissionsTab assignment={q.data!} onChanged={q.reload} /> : null}
    </Screen>
  );
}

const releasedFor = (a: Assignment, s: Submission) => s.status === "evaluated" && resultVisible(a, s);

function SubmissionsTab({ assignment, onChanged }: { assignment: Assignment; onChanged: () => void }) {
  const router = useRouter();
  const q = useAsync(() => manage.submissions(assignment.id), [assignment.id]);
  const [search, setSearch] = useState("");
  const pending = assignment.pending_release_count ?? 0;
  const release = useAction(async () => {
    if (!(await confirmAsync("Release evaluated results?", `${pending} evaluated submission${pending === 1 ? "" : "s"} will become visible to the students who made them. Pending evaluations stay hidden.`, "Release results", "Not yet"))) return;
    await manage.releaseAssignmentResults(assignment.id); await q.reload(); onChanged();
  });
  const rows = (q.data ?? []).filter((s) => `${s.student_name ?? ""} ${s.student_email ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const columns: Column<Submission>[] = [
    { key: "s", label: "Student", flex: 1.8, render: (s) => <CellText avatar={s.student_name || s.student_email || "?"} title={s.student_name || s.student_email || "Student"} sub={`${fmtDay(s.submitted_at)} · Attempt ${s.attempt_number}${s.is_late ? " · late" : ""}`} /> },
    { key: "e", label: "Evaluation", flex: 1, render: (s) => <Badge value={s.status === "evaluated" ? "Evaluated" : "Pending evaluation"} tone={s.status === "evaluated" ? "green" : "amber"} /> },
    { key: "p", label: "Score", flex: 0.6, render: (s) => (s.score != null ? `${s.score} / ${assignment.max_score}` : "—") },
    { key: "r", label: "Results", flex: 0.8, render: (s) => <Badge value={releasedFor(assignment, s) ? "Released" : "Not released"} tone={releasedFor(assignment, s) ? "green" : "amber"} /> },
    { key: "x", label: "", flex: 1, render: (s) => <Button title={s.status === "evaluated" ? "View submission" : "Evaluate"} small icon={s.status === "evaluated" ? undefined : "create-outline"} variant={s.status === "evaluated" ? "secondary" : "primary"} onPress={() => { void confirmLeave().then(ok => { if (ok) router.push({ pathname: "/manage/submission/[id]", params: { id: s.id, assignment: assignment.id } }); }); }} /> },
  ];
  return (
    <>
      {pending ? (
        <Notice tone="warning" title={`${pending} evaluated submission${pending === 1 ? " is" : "s are"} ready to release.`} message="Pending evaluations remain ungraded. Students see only their own released results."
          action={<Button title="Release evaluated results" small icon="checkmark" onPress={() => release.run()} busy={release.busy} />} />
      ) : null}
      <ErrorBanner message={q.error ?? release.error} onRetry={q.reload} />
      <Card flush>
        <TableToolbar><Input icon="search" compact value={search} onChangeText={setSearch} placeholder="Search this list…" accessibilityLabel="Search submissions" /></TableToolbar>
        {q.error && !q.data ? <RequestFailed onRetry={q.reload} /> : q.loading && !q.data ? <Loading lines={2} /> : <Table noun="submission" columns={columns} rows={rows} keyOf={(s) => s.id} minWidth={820} empty={<Empty icon="document-text-outline" text="No submissions yet." />} />}
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* One submission                                                      */
/* ------------------------------------------------------------------ */

export function SubmissionReviewPage({ submissionId, assignmentId }: { submissionId: string; assignmentId: string }) {
  const router = useRouter();
  const a = useAsync(() => manage.assignment(assignmentId), [assignmentId]);
  const subs = useAsync(() => manage.submissions(assignmentId), [assignmentId]);
  const s = subs.data?.find((x) => x.id === submissionId) ?? null;
  const [score, setScore] = useState("");
  const [feedback, setFeedback] = useState("");
  const [showError, setShowError] = useState(false);
  // Fill the form once per submission; a background reload must not overwrite marks being typed.
  const evaluationSaving = useRef(false);
  const filledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!s || filledFor.current === s.id) return;
    filledFor.current = s.id;
    setScore(s.score != null ? String(s.score) : ""); setFeedback(s.feedback ?? "");
  }, [s]);
  const marking = !!s && (score !== (s.score != null ? String(s.score) : "") || feedback !== (s.feedback ?? ""));
  useUnsavedWarning(marking);
  const saveRef = useRef<() => Promise<boolean>>(async () => false);
  useEffect(() => {
    if (!marking || !s) return;
    return registerGuard({
      label: `the evaluation of ${s.student_name || s.student_email || "this submission"}`,
      save: () => saveRef.current(),
      discard: () => { setScore(s.score != null ? String(s.score) : ""); setFeedback(s.feedback ?? ""); },
    });
  }, [marking, s]);
  const leave = () => router.push({ pathname: "/manage/assignment/[id]", params: { id: assignmentId, tab: "submissions" } });
  // Back and Cancel are exits like any other: unsaved marks ask Save / Discard / Stay first.
  const back = () => { void confirmLeave().then((ok) => { if (ok) leave(); }); };
  const z = a.data;
  const held = !!z && !!s && !resultVisible(z, s);
  // The same rule guards the button and the save itself, so "Save and leave" cannot turn a blank score
  // into a real 0. A typed 0 is a valid mark.
  const scoreError = score.trim() === "" ? "Enter a score before saving."
    : Number.isNaN(Number(score)) ? "The score must be a number."
    : Number(score) < 0 || (!!z && Number(score) > z.max_score) ? `Enter 0 to ${z?.max_score ?? "the maximum"}.`
    : null;
  const valid = !scoreError;
  const save = useAction(async () => {
    if (evaluationSaving.current) return false;
    if (scoreError) { setShowError(true); throw new Error(scoreError); }
    evaluationSaving.current = true;
    try {
      await manage.evaluate(submissionId, { score: Number(score), feedback: feedback.trim() });
      await subs.reload(); filledFor.current = null; leave(); return true;
    } finally { evaluationSaving.current = false; }
  });
  saveRef.current = async () => { try { return (await save.run()) === true; } catch { return false; } };
  const name = s?.student_name?.trim().split(/\s+/)[0] || s?.student_email?.split("@")[0] || "student";
  return (
    <Screen refreshing={subs.loading} onRefresh={subs.reload}>
      <PageHeading eyebrow="ASSIGNMENT EVALUATION" title={`Review ${name}’s submission`} subtitle={z && s ? `${z.title} · Submitted ${fmtDate(s.submitted_at)}${s.is_late ? " · late" : ""}` : null}
        right={<Button title="Back to submissions" variant="secondary" icon="arrow-back" onPress={back} />} />
      <ErrorBanner message={subs.error ?? a.error ?? save.error} onRetry={subs.reload} />
      {subs.loading && !s ? <Loading /> : null}
      {subs.data && !s ? <Notice tone="warning" title="Submission not found" message="It may have been removed." /> : null}
      {s && z ? (
        <Split sideWidth={340}
          main={
            <>
              <Card>
                <CardHead title="Student response" subtitle={`Attempt ${s.attempt_number} · ${Math.round((s.time_spent_seconds ?? 0) / 60)} min spent`} />
                <Text style={{ fontSize: 14, lineHeight: 25, color: colors.text }} selectable>{s.content}</Text>
              </Card>
              <Card>
                <CardHead title="Assessment rubric" />
                <DetailList items={z.rubric.map((r) => [r.criterion, `${r.points} point${r.points === 1 ? "" : "s"}`] as [string, string])} />
              </Card>
            </>
          }
          side={
            <Card>
              <CardHead title="Your evaluation" />
              <Input label="Score" required value={score} editable={!save.busy} onChangeText={(v) => { if (!evaluationSaving.current) { setShowError(false); setScore(v); } }} keyboardType="decimal-pad" hint={`Maximum ${z.max_score} points.`} error={(score || showError) && scoreError ? scoreError : null} />
              <Input label="Feedback" required multiline value={feedback} editable={!save.busy} onChangeText={v => { if (!evaluationSaving.current) setFeedback(v); }} style={{ minHeight: 120 }} />
              {held ? <Notice title="Results are currently held." message="Saving this evaluation does not release the result to the student." /> : null}
              <FormFooter>
                <Button title="Cancel" variant="secondary" onPress={back} />
                <Button title="Save evaluation" icon="checkmark" onPress={() => save.run()} busy={save.busy} disabled={!valid} />
              </FormFooter>
            </Card>
          }
        />
      ) : null}
    </Screen>
  );
}
