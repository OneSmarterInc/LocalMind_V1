import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { student } from "@/api/endpoints";
import type { Assignment } from "@/api/types";
import { useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, CellText, Column, Empty, ErrorBanner, Input, Loading, PageHeading, Screen, Table, TableToolbar, Tone, fmtDay, RequestFailed } from "@/ui";
import { useStudentCatalog } from "@/screens/student/catalog";

function statusOf(a: Assignment): { label: string; tone: Tone; action: string } {
  const sub = a.my_submission;
  if (sub?.status === "evaluated") return { label: `Marked · ${sub.score}/${a.max_score}`, tone: "green", action: "View feedback" };
  if (sub) return { label: sub.is_late ? "Submitted late" : "Submitted", tone: "blue", action: "View submission" };
  if (a.due_at && new Date(a.due_at) < new Date()) return { label: a.allow_late ? "Past due" : "Closed", tone: "red", action: "View details" };
  return { label: "Not submitted", tone: "amber", action: "Open assignment" };
}

export default function StudentAssignments() {
  const router = useRouter();
  const q = useAsync(() => student.assignments(), []);
  const cat = useStudentCatalog();
  const [search, setSearch] = useState("");
  const subjectOf = (a: Assignment) => cat.data?.subjects.find((s) => s.subject.id === a.subject_id)?.subject;
  const rows = useMemo(() => (q.data ?? []).filter((a) => `${a.title} ${subjectOf(a)?.name ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())), [q.data, cat.data, search]); // eslint-disable-line react-hooks/exhaustive-deps
  const columns: Column<Assignment>[] = [
    { key: "t", label: "Assignment", flex: 2.4, render: (a) => { const s = subjectOf(a); return <CellText title={a.title} sub={s ? `${s.code} · ${s.name}` : null} />; } },
    { key: "d", label: "Due date", flex: 1, render: (a) => (a.due_at ? fmtDay(a.due_at) : "No due date") },
    { key: "s", label: "Your status", flex: 1.1, render: (a) => { const st = statusOf(a); return <Badge value={st.label} tone={st.tone} />; } },
    { key: "x", label: "", flex: 1, render: (a) => { const st = statusOf(a); return <Button title={st.action} small icon={st.action === "Open assignment" ? "arrow-forward" : undefined} variant={st.action === "Open assignment" ? "primary" : "secondary"} onPress={() => router.push(`/student/assignment/${a.id}`)} />; } },
  ];
  return (
    <Screen refreshing={q.loading} onRefresh={() => { q.reload(); cat.reload(); }}>
      <PageHeading eyebrow="PUT YOUR LEARNING INTO PRACTICE" title="My assignments" subtitle="Instructions, due dates, and feedback—all in one place." />
      <ErrorBanner message={q.error} onRetry={q.reload} />
      <Card flush>
        <TableToolbar><Input icon="search" placeholder="Search this list…" value={search} onChangeText={setSearch} compact accessibilityLabel="Search assignments" /></TableToolbar>
        {q.error && !q.data ? <RequestFailed onRetry={q.reload} /> : q.loading && !q.data ? <Loading lines={2} /> : (
          <Table noun="assignment" columns={columns} rows={rows} keyOf={(a) => a.id} onRowPress={(a) => router.push(`/student/assignment/${a.id}`)}
            empty={<Empty icon="create-outline" title={q.data?.length ? "No assignment matches" : "No assignments yet"} text={q.data?.length ? "Try a different search." : "Assignments appear here when your faculty publishes them."} />} />
        )}
      </Card>
    </Screen>
  );
}
