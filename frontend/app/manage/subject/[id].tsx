import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { manage } from "@/api/endpoints";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, CardHead, CellText, Column, Dropdown, Empty, ErrorBanner, Input, ListRow, Loading, Notice, PageHeading, PageTabs, ProgressBar, Screen, Split, Stat, StatRow, Table, TableToolbar, TextLink, colors, confirmAsync, fmtDay, fmtSeconds, pct, RequestFailed } from "@/ui";
import { StudentPicker } from "@/ui/StudentPicker";

type Tab = "overview" | "students" | "modules";

const learningStatus = (r: any) => (r.modules_needs_review > 0 ? { label: "Needs review", tone: "amber" as const } : r.completion_percentage >= 60 ? { label: "On track", tone: "green" as const } : r.modules_completed > 0 || r.learning_seconds > 0 ? { label: "In progress", tone: "blue" as const } : { label: "Not started", tone: "neutral" as const });

export default function TeachingSubject() {
  const { id, tab: tabParam } = useLocalSearchParams<{ id: string; tab?: Tab }>();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(tabParam ?? "overview");
  const summary = useAsync(() => manage.subjectSummary(id), [id]);
  const s = summary.data;
  return (
    <Screen refreshing={summary.loading} onRefresh={summary.reload}>
      <PageHeading eyebrow="MY SUBJECTS" title={s?.subject.name ?? "Subject"} subtitle={s ? `${s.subject.code} · Your subject workspace` : null}
        right={<Button title="Upload a book" icon="cloud-upload-outline" onPress={() => router.push({ pathname: "/manage/document/upload", params: { subject: id } })} />} />
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
                <Button title="Create assignment" variant="secondary" icon="create-outline" onPress={() => router.push("/manage/assignment/new")} />
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
  const rows = useAsync(() => manage.subjectModules(subjectId), [subjectId]);
  const [q, setQ] = useState("");
  const toggle = useAction(async (m: any) => {
    const locking = m.availability === "open";
    if (locking && !(await confirmAsync("Lock this module?", "Students stop seeing it and its quizzes right away. Its content and earlier attempts are kept.", "Lock module", "Cancel", { tone: "warning" }))) return;
    await manage.moduleAvailability(m.module_id, locking ? "locked" : "open"); await rows.reload();
  });
  const enrolled = rows.data?.students_enrolled ?? 0;
  const list = (rows.data?.modules ?? []).filter((m: any) => `${m.title} ${m.document} ${m.chapter}`.toLowerCase().includes(q.trim().toLowerCase()));
  const columns: Column<any>[] = [
    { key: "m", label: "Module", flex: 2.2, render: (m) => <CellText title={m.title} sub={`${m.document} · ${m.chapter}`} /> },
    { key: "a", label: "Availability", flex: 0.9, render: (m) => <Badge value={m.source_missing ? "No text" : m.availability === "open" ? "Open" : "Locked"} tone={m.source_missing ? "red" : m.availability === "open" ? "green" : "neutral"} /> },
    { key: "s", label: "Started", flex: 0.8, render: (m) => `${m.students_started} of ${enrolled}` },
    { key: "c", label: "Completed", flex: 0.8, render: (m) => `${m.students_completed} of ${enrolled}` },
    { key: "x", label: "", flex: 1, render: (m) => <Button title={m.availability === "open" ? "Lock module" : "Open module"} small variant="secondary" icon={m.availability === "open" ? "lock-closed-outline" : "lock-open-outline"} disabled={m.source_missing || toggle.busy} onPress={() => toggle.run(m)} /> },
  ];
  return (
    <>
      <Notice title="Set the pace for your class." message="Open modules when you want students to see them. Locking a module does not delete its content or historical attempts." />
      <ErrorBanner message={rows.error ?? toggle.error} onRetry={rows.reload} />
      <Card flush>
        <TableToolbar><Input icon="search" placeholder="Search this list…" value={q} onChangeText={setQ} compact accessibilityLabel="Search modules" /></TableToolbar>
        {rows.error && !rows.data ? <RequestFailed onRetry={rows.reload} /> : rows.loading && !rows.data ? <Loading lines={2} /> : <Table noun="module" columns={columns} rows={list} keyOf={(m) => m.module_id} minWidth={760} empty={<Empty icon="layers-outline" text="No published modules yet." />} />}
      </Card>
    </>
  );
}
