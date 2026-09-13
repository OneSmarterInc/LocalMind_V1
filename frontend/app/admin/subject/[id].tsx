import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { admin, manage } from "@/api/endpoints";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, CardHead, CellText, Column, DangerZone, DetailList, Empty, ErrorBanner, Input, Loading, Notice, OptionCard, PageHeading, PageTabs, ProgressBar, Screen, Split, Table, colors, confirmAsync, confirmDeleteAsync, pct, RequestFailed } from "@/ui";
import { StudentPicker } from "@/ui/StudentPicker";

type Tab = "details" | "faculty" | "students";

export default function AdminSubject() {
  const { id, tab: t } = useLocalSearchParams<{ id: string; tab?: Tab }>();
  const [tab, setTab] = useState<Tab>(t ?? "details");
  const q = useAsync(() => admin.subject(id), [id]);
  const s = q.data;
  const activeFaculty = (s?.faculty ?? []).filter((f) => f.status === "active");
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !s ? <Loading /> : null}
      {s ? (
        <>
          <PageHeading eyebrow="SUBJECTS" title={s.name} subtitle={`${s.code} · Manage the subject and its access.`} right={<Badge value={s.status.charAt(0).toUpperCase() + s.status.slice(1)} tone={s.status === "active" ? "green" : "neutral"} />} />
          <PageTabs<Tab> value={tab} onChange={setTab} tabs={[{ key: "details", label: "Subject details" }, { key: "faculty", label: "Assigned faculty", count: activeFaculty.length }, { key: "students", label: "Enrolled students", count: s.active_students ?? null }]} />
          {tab === "details" ? <DetailsTab subject={s} onChanged={q.reload} /> : null}
          {tab === "faculty" ? <FacultyTab subjectId={id} faculty={activeFaculty} onChanged={q.reload} /> : null}
          {tab === "students" ? <StudentsTab subjectId={id} /> : null}
          {s.status === "archived" ? <Notice tone="warning" message="Archived subjects are read-only for teaching. Delete removes the subject and its content for good." /> : null}
          <View style={{ height: 4 }} />
        </>
      ) : null}
    </Screen>
  );
}

function DetailsTab({ subject: s, onChanged }: { subject: any; onChanged: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(s.name);
  const [code, setCode] = useState(s.code);
  const [description, setDescription] = useState(s.description ?? "");
  const [saved, setSaved] = useState(false);
  useEffect(() => { setName(s.name); setCode(s.code); setDescription(s.description ?? ""); }, [s]);
  const stats = useAsync(async () => (await admin.platformSubjects()).subjects.find((x: any) => x.subject_id === s.id) ?? null, [s.id]);
  const dirty = name !== s.name || code !== s.code || description !== (s.description ?? "");
  const save = useAction(async () => { await admin.updateSubject(s.id, { name: name.trim(), code: code.trim().toUpperCase(), description: description.trim() }); setSaved(true); onChanged(); });
  const status = useAction(async (next: string) => {
    const text: Record<string, [string, string]> = {
      discontinued: ["Discontinue this subject?", "Faculty and students keep their records, but the subject is no longer active."],
      archived: ["Archive this subject?", "The subject becomes read-only. Its records stay for reference."],
      active: ["Reactivate this subject?", "Faculty and enrolled students can use it again."],
    };
    if (!(await confirmAsync(text[next][0], text[next][1], next === "active" ? "Reactivate" : next === "archived" ? "Archive subject" : "Discontinue subject", "Cancel", { tone: next === "active" ? "primary" : "warning" }))) return;
    await admin.subjectStatus(s.id, next); onChanged();
  });
  const remove = useAction(async () => {
    const ok = await confirmDeleteAsync("Delete this subject?", "This permanently removes the subject along with its books, modules, quizzes, assignments, submissions and enrolment records. It cannot be undone.", { detail: `${s.code} · ${s.name}`, okLabel: "Delete subject" });
    if (!ok) return;
    await admin.deleteSubject(s.id);
    router.replace({ pathname: "/admin/subjects", params: { notice: `${s.code} · ${s.name} was deleted.` } });
  });
  return (
    <>
    <Split
      main={
        <Card>
          <CardHead title="Subject information" />
          <Input label="Subject name" required value={name} onChangeText={(v) => { setSaved(false); setName(v); }} />
          <Input label="Subject code" required value={code} onChangeText={(v) => { setSaved(false); setCode(v); }} autoCapitalize="characters" hint="Existing identifier; changing a subject code should follow your institution’s naming rules." />
          <Input label="Description" multiline value={description} onChangeText={(v) => { setSaved(false); setDescription(v); }} placeholder="A short description for faculty and students." />
          <ErrorBanner message={save.error} />
          {saved && !dirty ? <Notice tone="success" message="Subject saved." /> : null}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 9, paddingTop: 18, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Button title="Cancel" variant="secondary" disabled={!dirty} onPress={() => { setName(s.name); setCode(s.code); setDescription(s.description ?? ""); }} />
            <Button title="Save subject" icon="checkmark" onPress={() => save.run()} busy={save.busy} disabled={!dirty || !name.trim() || !code.trim()} />
          </View>
        </Card>
      }
      side={
        <>
          <Card>
            <CardHead title="Subject access" />
            <DetailList items={[
              ["Faculty", `${(s.faculty ?? []).filter((f: any) => f.status === "active").length} assigned`],
              ["Students", `${stats.data?.students_enrolled ?? s.active_students ?? 0} enrolled`],
              ["Books", String(stats.data?.documents_published ?? "—")],
              ["Status", <Badge key="st" value={s.status.charAt(0).toUpperCase() + s.status.slice(1)} tone={s.status === "active" ? "green" : "neutral"} />],
            ]} />
            <View style={{ height: 1, backgroundColor: colors.border }} />
            <Button title="Open content workspace" variant="secondary" icon="book-outline" full onPress={() => router.push({ pathname: "/manage/books", params: { subject: s.id } })} />
            <View style={{ height: 1, backgroundColor: colors.border }} />
            {s.status === "active" ? <Button title="Discontinue subject" variant="secondary" full onPress={() => status.run("discontinued")} busy={status.busy} /> : <Button title="Reactivate subject" full onPress={() => status.run("active")} busy={status.busy} />}
            {s.status !== "archived" ? <Button title="Archive subject" variant="secondary" icon="archive-outline" full onPress={() => status.run("archived")} busy={status.busy} /> : null}
            <ErrorBanner message={status.error} />
          </Card>
        </>
      }
    />
    <DangerZone title="Delete subject" text="This is a permanent action. Review all books, enrollments, and student records first.">
      <Button title="Delete subject" variant="danger" icon="trash-outline" onPress={() => remove.run()} busy={remove.busy} />
    </DangerZone>
    <ErrorBanner message={remove.error} />
    </>
  );
}

function FacultyTab({ subjectId, faculty, onChanged }: { subjectId: string; faculty: { faculty_id: string; email: string; full_name: string; status: string }[]; onChanged: () => void }) {
  const [assigning, setAssigning] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const all = useAsync(() => admin.users("faculty", { status: "active" }), []);
  const assigned = new Set(faculty.map((f) => f.faculty_id));
  const assign = useAction(async () => { await admin.assignFaculty(subjectId, picked); setPicked([]); setAssigning(false); onChanged(); });
  const unassign = useAction(async (f: { faculty_id: string; full_name: string }) => {
    if (!(await confirmAsync("Remove this assignment?", `${f.full_name} will no longer manage this subject. Their content stays.`, "Remove assignment", "Cancel", { tone: "danger" }))) return;
    await admin.unassignFaculty(subjectId, f.faculty_id); onChanged();
  });
  const dept = (fid: string) => { const u = all.data?.find((x) => x.id === fid); return [u?.profile?.department, u?.profile?.designation].filter(Boolean).join(" · ") || "—"; };
  const columns: Column<(typeof faculty)[number]>[] = [
    { key: "n", label: "Faculty", flex: 2, render: (f) => <CellText avatar={f.full_name} title={f.full_name} sub={f.email} /> },
    { key: "d", label: "Department", flex: 1.3, render: (f) => dept(f.faculty_id) },
    { key: "a", label: "Assignment", flex: 0.8, render: () => <Badge value="Active" tone="green" /> },
    { key: "x", label: "", flex: 1, render: (f) => <Button title="Remove assignment" small variant="danger" onPress={() => unassign.run(f)} /> },
  ];
  const candidates = (all.data ?? []).filter((u) => !assigned.has(u.id));
  return (
    <>
      {assigning ? (
        <Card>
          <CardHead title="Assign faculty" subtitle="Choose one or more active faculty accounts." action={<Button title="Cancel" small variant="secondary" onPress={() => { setAssigning(false); setPicked([]); }} />} />
          {all.error && !all.data ? <RequestFailed onRetry={all.reload} /> : all.loading && !all.data ? <Loading lines={1} /> : candidates.length === 0 ? <Text style={{ fontSize: 12, color: colors.muted }}>Every active faculty account is already assigned.</Text> : (
            <View style={{ gap: 8 }}>{candidates.map((u) => <OptionCard key={u.id} multi title={u.full_name} text={[u.email, u.profile?.department].filter(Boolean).join(" · ")} selected={picked.includes(u.id)} onPress={() => setPicked((x) => (x.includes(u.id) ? x.filter((y) => y !== u.id) : [...x, u.id]))} />)}</View>
          )}
          <ErrorBanner message={assign.error} />
          <View style={{ flexDirection: "row" }}><Button title={`Assign ${picked.length || ""} faculty`.replace("  ", " ")} icon="checkmark" onPress={() => assign.run()} busy={assign.busy} disabled={!picked.length} /></View>
        </Card>
      ) : null}
      <ErrorBanner message={unassign.error} />
      <Card flush>
        <View style={{ padding: 23, paddingBottom: 12 }}>
          <CardHead title="Assigned faculty" subtitle="Only actively assigned faculty can manage this subject." action={!assigning ? <Button title="Assign faculty" icon="person-add-outline" onPress={() => setAssigning(true)} /> : null} />
        </View>
        <Table noun="faculty assignment" columns={columns} rows={faculty} keyOf={(f) => f.faculty_id} minWidth={760} empty={<Empty icon="people-outline" text="No faculty assigned yet." />} />
      </Card>
    </>
  );
}

function StudentsTab({ subjectId }: { subjectId: string }) {
  const router = useRouter();
  const rows = useAsync(() => manage.subjectStudentsAnalytics(subjectId), [subjectId]);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const drop = useAction(async (r: any) => {
    if (!(await confirmAsync("Discontinue enrollment?", `${r.full_name} will no longer see this subject. Earlier attempts and progress are kept.`, "Discontinue", "Cancel", { tone: "danger" }))) return;
    await admin.discontinueEnrollment(subjectId, r.student_id); await rows.reload();
  });
  const list = useMemo(() => (rows.data?.students ?? []).filter((r: any) => `${r.full_name} ${r.email} ${r.roll_number ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())), [rows.data, q]);
  const status = (r: any) => (r.modules_needs_review > 0 ? ["Needs review", "amber"] : r.completion_percentage >= 60 ? ["On track", "green"] : r.modules_completed > 0 || r.learning_seconds > 0 ? ["In progress", "blue"] : ["Not started", "neutral"]) as [string, "amber" | "green" | "blue" | "neutral"];
  const columns: Column<any>[] = [
    { key: "n", label: "Student", flex: 2, render: (r) => <CellText avatar={r.full_name} title={r.full_name} sub={r.email} /> },
    { key: "r", label: "Roll number", flex: 0.9, render: (r) => r.roll_number || "—" },
    { key: "p", label: "Progress", flex: 1.3, render: (r) => <View style={{ gap: 5, width: "100%" }}><ProgressBar value={r.completion_percentage} /><Text style={{ fontSize: 11, color: colors.muted }}>{pct(r.completion_percentage)} completed</Text></View> },
    { key: "q", label: "Best quiz", flex: 0.7, render: (r) => pct(r.best_quiz_percentage) },
    { key: "s", label: "Learning status", flex: 1, render: (r) => { const [l, tone] = status(r); return <Badge value={l} tone={tone} />; } },
    { key: "x", label: "", flex: 1, render: (r) => <Button title="View progress" small variant="secondary" onPress={() => router.push({ pathname: "/manage/student/[id]", params: { id: r.student_id, subject: subjectId } })} /> },
  ];
  return (
    <>
      {picking ? (
        <Card>
          <CardHead title="Enroll students" subtitle="Search existing student accounts. Create new accounts from People." action={<Button title="Done" small variant="secondary" onPress={() => setPicking(false)} />} />
          <StudentPicker subjectId={subjectId} search={admin.searchStudents} enrol={(ids) => admin.enroll(subjectId, ids)} onDone={rows.reload} />
        </Card>
      ) : null}
      <ErrorBanner message={rows.error ?? drop.error} onRetry={rows.reload} />
      <Card flush>
        <View style={{ padding: 23, paddingBottom: 12, gap: 14 }}>
          <CardHead title="Enrolled students" subtitle={rows.data ? `${rows.data.students.length} active enrollment${rows.data.students.length === 1 ? "" : "s"}` : null} action={!picking ? <Button title="Enroll students" icon="person-add-outline" onPress={() => setPicking(true)} /> : null} />
          <Input icon="search" compact placeholder="Search this list…" value={q} onChangeText={setQ} containerStyle={{ maxWidth: 350 }} accessibilityLabel="Search students" />
        </View>
        {rows.error && !rows.data ? <RequestFailed onRetry={rows.reload} /> : rows.loading && !rows.data ? <Loading lines={2} /> : <Table noun="student" columns={columns} rows={list} keyOf={(r) => r.student_id} minWidth={900} empty={<Empty icon="school-outline" text={rows.data?.students.length ? "No student matches." : "No students enrolled yet."} />} />}
      </Card>
      <Notice title="Changing access does not mean deleting a person." message="Discontinue an enrollment to remove subject access. Use People to change the account itself." />
    </>
  );
}
