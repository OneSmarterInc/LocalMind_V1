import { useLocalSearchParams, useRouter } from "expo-router";
import { useTabParam } from "@/hooks/useTabParam";
import { useBackTo } from "@/hooks/useBackTo";
import React, { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { manage } from "@/api/endpoints";
import { ApiError, errorMessage } from "@/api/client";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, CardHead, CellText, Column, Dropdown, Empty, ErrorBanner, Input, ListRow, Loading, Notice, PageHeading, PageTabs, ProgressBar, Screen, Split, Stat, StatRow, Table, TableToolbar, TextLink, colors, confirmAsync, fmtDay, fmtSeconds, pct, RequestFailed, Checkbox, confirmDeleteAsync, useToast } from "@/ui";
import { StudentPicker } from "@/ui/StudentPicker";

type Tab = "overview" | "students" | "modules";

const learningStatus = (r: any) => (r.modules_needs_review > 0 ? { label: "Needs review", tone: "amber" as const } : r.completion_percentage >= 60 ? { label: "On track", tone: "green" as const } : r.modules_completed > 0 || r.learning_seconds > 0 ? { label: "In progress", tone: "blue" as const } : { label: "Not started", tone: "neutral" as const });

export default function TeachingSubject() {
  const { id } = useLocalSearchParams<{ id: string; tab?: Tab }>();
  const back = useBackTo();
  const [tab, setTab] = useTabParam<Tab>("overview", ["overview", "students", "modules"]);
  const summary = useAsync(() => manage.subjectSummary(id), [id]);
  const s = summary.data;
  return (
    <Screen refreshing={summary.loading} onRefresh={summary.reload}>
      <PageHeading eyebrow="MY SUBJECTS" title={s?.subject.name ?? "Subject"} subtitle={s ? `${s.subject.code} · Your subject workspace` : null}
        right={<Button title="Back to subjects" variant="secondary" icon="arrow-back" onPress={() => back("/manage/subjects")} />} />
      <ErrorBanner message={summary.error} onRetry={summary.reload} />
      <PageTabs<Tab> value={tab} onChange={setTab} tabs={[{ key: "overview", label: "Overview" }, { key: "students", label: "Students" }, { key: "modules", label: "Modules & progress" }]} />
      {tab === "overview" ? (summary.loading && !s ? <Loading /> : s ? <OverviewTab s={s} subjectId={id} onStudents={() => setTab("students")} /> : null) : null}
      {tab === "students" ? <StudentsTab subjectId={id} /> : null}
      {tab === "modules" ? <ModulesTab subjectId={id} /> : null}
    </Screen>
  );
}

function OverviewTab({ s, subjectId, onStudents }: { s: any; subjectId: string; onStudents: () => void }) {
  const router = useRouter();
  const docs = useAsync(() => manage.documents({ subject: subjectId }), [subjectId]);
  const students = useAsync(() => manage.subjectStudentsAnalytics(subjectId), [subjectId]);
  const struggling = (students.data?.students ?? []).filter((r: any) => r.modules_needs_review > 0 || (r.quiz_average != null && r.quiz_average < 50)).length;
  const books = docs.data?.length ?? s.documents.total;
  return (
    <>
      <StatRow>
        <Stat label="Students" icon="people-outline" value={s.students_enrolled} helper="Active enrollments" />
        <Stat label="Published modules" icon="book-outline" value={s.modules.open} helper={`Across ${books} book${books === 1 ? "" : "s"}`} />
        <Stat label="Average quiz score" icon="ribbon-outline" value={pct(s.quizzes.average_percentage)} helper="Evaluated attempts" />
        <Stat label="Learning time" icon="time-outline" value={fmtSeconds(s.time.learning_seconds)} helper="Recorded across this subject" />
      </StatRow>
      <Split
        main={
          <>
            <Card>
              <CardHead title="Books in this subject" action={<TextLink title="All books" icon="arrow-forward" onPress={() => router.push({ pathname: "/manage/books", params: { subject: subjectId } })} />} />
              {docs.error && !docs.data ? <RequestFailed onRetry={docs.reload} /> : docs.loading && !docs.data ? <Loading lines={1} /> : null}
              {docs.data?.length === 0 ? <Empty icon="book-outline" title="No books yet" text="Upload a book to turn it into modules for this class." /> : null}
              {docs.data?.map((d) => (
                <ListRow key={d.id} plain icon="book-outline" title={d.title} subtitle={`${d.module_count ?? 0} modules · Last updated ${fmtDay(d.updated_at ?? d.created_at)}`}
                  right={<Badge value={d.status === "under_review" ? "Under review" : d.status} />} onPress={() => router.push(`/manage/document/${d.id}`)} />
              ))}
            </Card>
            <Card>
              <CardHead title="Teaching activities" subtitle="Create a quiz for one module or combine several modules from this subject." />
              <View style={{ flexDirection: "row", gap: 9, flexWrap: "wrap" }}>
                <Button title="Create quiz" variant="secondary" icon="help-circle-outline" onPress={() => router.push("/manage/quiz/new")} />
              </View>
            </Card>
          </>
        }
        side={
          <Card>
            <CardHead title="Class snapshot" />
            <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>{students.data ? (struggling ? `${struggling} student${struggling === 1 ? "" : "s"} could use a hand.` : "Everyone is on track.") : "—"}</Text>
            <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 19 }}>Students marked “Needs review” have an evaluated quiz outcome that needs more practice. Check their progress before following up.</Text>
            <Button title="View student progress" variant="secondary" icon="people-outline" full onPress={onStudents} />
          </Card>
        }
      />
    </>
  );
}

function StudentsTab({ subjectId }: { subjectId: string }) {
  const router = useRouter();
  const rows = useAsync(() => manage.subjectStudentsAnalytics(subjectId), [subjectId]);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const list = useMemo(() => (rows.data?.students ?? []).filter((r: any) => (filter === "all" || learningStatus(r).label === filter) && `${r.full_name} ${r.email} ${r.roll_number ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())), [rows.data, q, filter]);
  const columns: Column<any>[] = [
    { key: "n", label: "Student", flex: 2, render: (r) => <CellText avatar={r.full_name} title={r.full_name} sub={r.email} /> },
    { key: "r", label: "Roll number", flex: 0.9, render: (r) => r.roll_number || "—" },
    { key: "p", label: "Progress", flex: 1.2, render: (r) => <View style={{ gap: 5, width: "100%" }}><Text style={{ fontSize: 11, color: colors.muted }}>{pct(r.completion_percentage)} completed</Text><ProgressBar value={r.completion_percentage} /></View> },
    { key: "q", label: "Best quiz", flex: 0.7, render: (r) => pct(r.best_quiz_percentage) },
    { key: "s", label: "Learning status", flex: 1, render: (r) => { const st = learningStatus(r); return <Badge value={st.label} tone={st.tone} />; } },
    { key: "a", label: "", flex: 1, render: (r) => <Button title="View progress" small variant="secondary" onPress={() => router.push({ pathname: "/manage/student/[id]", params: { id: r.student_id, subject: subjectId } })} /> },
  ];
  return (
    <>
      {picking ? (
        <Card>
          <CardHead title="Enroll students" subtitle="Select existing student accounts to enroll. Your administrator creates new student accounts." action={<Button title="Done" variant="secondary" small onPress={() => setPicking(false)} />} />
          <StudentPicker subjectId={subjectId} search={manage.searchStudents} enrol={(ids) => manage.enroll(subjectId, ids)} onDone={rows.reload} />
        </Card>
      ) : null}
      <ErrorBanner message={rows.error} onRetry={rows.reload} />
      <Card flush>
        <View style={{ paddingHorizontal: 22, paddingTop: 22 }}>
          <CardHead title="Enrolled students" subtitle={rows.data ? `${rows.data.students.length} active enrollment${rows.data.students.length === 1 ? "" : "s"}` : null} action={!picking ? <Button title="Enroll students" icon="person-add-outline" onPress={() => setPicking(true)} /> : null} />
        </View>
        <TableToolbar right={<Dropdown value={filter} onChange={setFilter} accessibilityLabel="Filter by progress" options={[{ value: "all", label: "All progress" }, { value: "On track", label: "On track" }, { value: "Needs review", label: "Needs review" }, { value: "In progress", label: "In progress" }, { value: "Not started", label: "Not started" }]} />}>
          <Input icon="search" placeholder="Search this list…" value={q} onChangeText={setQ} compact accessibilityLabel="Search students" />
        </TableToolbar>
        {rows.error && !rows.data ? <RequestFailed onRetry={rows.reload} /> : rows.loading && !rows.data ? <Loading lines={2} /> : <Table noun="student" columns={columns} rows={list} keyOf={(r) => r.student_id} minWidth={880} empty={<Empty icon="people-outline" text={rows.data?.students.length ? "No student matches." : "No students enrolled yet."} />} />}
      </Card>
      <Notice title="Enrollment is separate from account creation." message="Select existing student accounts to enroll. Your administrator creates new student accounts." />
    </>
  );
}

function ModulesTab({ subjectId }: { subjectId: string }) {
  const router = useRouter();
  const toast = useToast();
  const rows = useAsync(() => manage.subjectModules(subjectId), [subjectId]);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const all: any[] = useMemo(() => rows.data?.modules ?? [], [rows.data]);
  // Position in its book, recounted from the current list, so numbers stay continuous after a delete.
  const numberOf = useMemo(() => {
    const seen = new Map<string, number>(), out = new Map<string, number>();
    all.forEach((m) => { const n = (seen.get(m.document_id) ?? 0) + 1; seen.set(m.document_id, n); out.set(m.module_id, n); });
    return out;
  }, [all]);
  const list = all.filter((m) => `${m.title} ${m.document} ${m.chapter} ${numberOf.get(m.module_id)}`.toLowerCase().includes(q.trim().toLowerCase()));
  const selectable = list.filter((m) => !m.source_missing);
  const allOn = selectable.length > 0 && selectable.every((m) => picked.has(m.module_id));
  const someOn = selectable.some((m) => picked.has(m.module_id));
  const flip = (id: string) => setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const setMany = useAction(async (availability: "open" | "locked", targets: any[]) => {
    const todo = targets.filter((m) => m.availability !== availability && !m.source_missing);
    if (!todo.length) { toast.show({ tone: "info", message: `All selected modules are already ${availability === "open" ? "open" : "locked"}.` }); return; }
    if (availability === "locked" && !(await confirmAsync(todo.length === 1 ? "Lock this module?" : `Lock ${todo.length} modules?`, "Students stop seeing them and their quizzes right away. Content and earlier attempts are kept.", todo.length === 1 ? "Lock module" : "Lock modules", "Cancel", { tone: "warning" }))) return;
    const failed: string[] = [];
    for (const m of todo) { try { await manage.moduleAvailability(m.module_id, availability); } catch (e) { failed.push(`${m.title}: ${errorMessage(e)}`); } }
    setPicked(new Set()); await rows.reload();
    const done = todo.length - failed.length;
    if (done) toast.show({ tone: "success", title: `${done} module${done === 1 ? "" : "s"} ${availability === "open" ? "opened" : "locked"}`, message: availability === "open" ? "Students can read them now." : "Students no longer see them. Their progress is kept." });
    if (failed.length) toast.show({ tone: "danger", title: `${failed.length} could not be changed`, message: failed.join("\n") });
  });
  // Row-level Lock/Open shares the same single busy flag as the bulk action, so a
  // click on one row used to grey every row's button. Remember which row is running.
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const toggleOne = async (m: any) => {
    if (togglingId) return;
    setTogglingId(m.module_id);
    try { await setMany.run(m.availability === "open" ? "locked" : "open", [m]); } finally { setTogglingId(null); }
  };
  // Which row is being deleted. `useAction` keeps one shared busy flag, so using it
  // directly made every Delete button in the table spin — including while the
  // confirmation dialog was still open, before anything had been sent.
  const [removingId, setRemovingId] = useState<string | null>(null);
  const remove = useAction(async (m: any) => {
    try {
      const outline = await manage.outline(m.document_id);
      // Same minimal shape the outline editor saves. Sending source_text back
      // unchanged would mark every module as reviewer-supplied and drop its
      // heading mapping, so only identity, title and position are sent. The
      // backend renumbers modules from their position in this array, which is
      // what closes the gap left by the deleted module.
      const chapters = outline.chapters.map((c, ci) => ({
        id: c.id, title: c.title, order: ci + 1, source_heading_index: c.source_heading_index ?? null,
        modules: c.modules.filter((x) => x.id !== m.module_id).map((x, mi) => ({ id: x.id, title: x.title, order: mi + 1, source_heading_index: x.source_heading_index ?? null })),
      }));
      await manage.saveOutline(m.document_id, chapters, undefined, outline.content_version);
      setPicked((prev) => { const next = new Set(prev); next.delete(m.module_id); return next; });
      await rows.reload();
      toast.show({ tone: "success", title: "Module deleted", message: "The modules after it now have the next numbers." });
    } catch (e) {
      if (e instanceof ApiError && e.code === "MODULE_IN_USE") {
        const lock = await confirmAsync("Students have worked in this module", "It can't be deleted because their progress would be lost. Lock it instead to hide it from students and keep their records.", "Lock module", "Cancel", { tone: "warning" });
        if (lock) { await manage.moduleAvailability(m.module_id, "locked"); await rows.reload(); toast.show({ tone: "success", title: "Module locked", message: "Students no longer see it. Their progress is kept." }); }
        return;
      }
      throw e;
    }
  });
  const askRemove = async (m: any) => {
    if (removingId) return;
    if (!m.document_id) { toast.show({ tone: "danger", title: "This module cannot be deleted here", message: "Its book could not be identified. Open the book from Books & modules and edit its outline." }); return; }
    if (!(await confirmDeleteAsync("Delete this module?", "Its lesson and quiz are deleted too. The modules after it move up one number. This cannot be undone.", { detail: m.title, okLabel: "Delete module" }))) return;
    setRemovingId(m.module_id);
    try { await remove.run(m); } finally { setRemovingId(null); }
  };
  const edit = (m: any) => {
    // Without the book id expo-router drops the [id] segment and lands on
    // /manage/document?tab=outline&module=… , which is not a route at all.
    if (!m.document_id) { toast.show({ tone: "danger", title: "Cannot open the outline", message: "This module is not linked to a book. Open it from Books & modules instead." }); return; }
    router.push({ pathname: "/manage/document/[id]", params: { id: String(m.document_id), tab: "outline", module: String(m.module_id) } } as never);
  };
  const enrolled = rows.data?.students_enrolled ?? 0;
  const columns: Column<any>[] = [
    { key: "sel", label: "", width: 44, render: (m) => m.source_missing ? null : <Checkbox on={picked.has(m.module_id)} onPress={() => flip(m.module_id)} label={`Select ${m.title}`} /> },
    { key: "n", label: "No.", width: 56, render: (m) => <Text style={{ fontWeight: "700", color: colors.primary, fontVariant: ["tabular-nums"] }}>{numberOf.get(m.module_id)}</Text> },
    { key: "m", label: "Module", flex: 2.2, render: (m) => <CellText title={m.title} sub={`${m.document} · ${m.chapter}`} /> },
    { key: "a", label: "Access", flex: 0.8, render: (m) => <Badge value={m.source_missing ? "No text" : m.availability === "open" ? "Open" : "Locked"} tone={m.source_missing ? "red" : m.availability === "open" ? "green" : "neutral"} /> },
    { key: "s", label: "Students", flex: 1, render: (m) => `${m.students_started} started, ${m.students_completed} done of ${enrolled}` },
    { key: "x", label: "Actions", flex: 2.2, render: (m) => (
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        <Button title={m.availability === "open" ? "Lock" : "Open"} small variant="secondary" icon={m.availability === "open" ? "lock-closed-outline" : "lock-open-outline"} busy={togglingId === m.module_id} disabled={m.source_missing || (setMany.busy && togglingId !== m.module_id)} onPress={() => void toggleOne(m)} accessibilityLabel={`${m.availability === "open" ? "Lock" : "Open"} ${m.title}`} />
        <Button title="Edit" small variant="secondary" icon="create-outline" onPress={() => edit(m)} accessibilityLabel={`Edit ${m.title} in the outline`} />
        <Button title="Delete" small variant="secondary" icon="trash-outline" busy={removingId === m.module_id} disabled={removingId != null && removingId !== m.module_id} onPress={() => void askRemove(m)} accessibilityLabel={`Delete ${m.title}`} />
      </View>) },
  ];
  const chosen = all.filter((m) => picked.has(m.module_id));
  return (
    <>
      <Notice title="Set the pace for your class." message="Open modules when you want students to see them. Locking a module does not delete its content or historical attempts." />
      <ErrorBanner message={rows.error ?? setMany.error ?? remove.error} onRetry={rows.reload} />
      <Card flush>
        <TableToolbar right={selectable.length ? <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Checkbox on={allOn} mixed={!allOn && someOn} onPress={() => setPicked(allOn ? new Set() : new Set(selectable.map((m) => m.module_id)))} label="Select all modules in this list" /><Text style={{ fontSize: 12, color: colors.muted }}>Select all</Text></View> : undefined}>
          <Input icon="search" placeholder="Search modules" value={q} onChangeText={setQ} compact accessibilityLabel="Search modules" />
        </TableToolbar>
        {chosen.length ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.pale, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border }} accessibilityLiveRegion="polite">
            <Text style={{ fontWeight: "600", color: colors.ink, flex: 1, minWidth: 120 }}>{chosen.length} selected</Text>
            <Button title="Open selected" small icon="lock-open-outline" busy={setMany.busy} onPress={() => setMany.run("open", chosen)} />
            <Button title="Lock selected" small variant="secondary" icon="lock-closed-outline" busy={setMany.busy} onPress={() => setMany.run("locked", chosen)} />
            <Button title="Clear" small variant="secondary" icon="close" onPress={() => setPicked(new Set())} />
          </View>
        ) : null}
        {rows.error && !rows.data ? <RequestFailed onRetry={rows.reload} /> : rows.loading && !rows.data ? <Loading lines={2} /> : <Table noun="module" columns={columns} rows={list} keyOf={(m) => m.module_id} minWidth={980} empty={<Empty icon="layers-outline" text={q ? "No module matches this search." : "No published modules yet."} />} />}
      </Card>
    </>
  );
}
