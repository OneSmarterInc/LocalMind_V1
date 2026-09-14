import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { student } from "@/api/endpoints";
import type { Attempt, Quiz } from "@/api/types";
import { useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, CellText, Column, Dropdown, Empty, ErrorBanner, Input, Loading, Notice, PageHeading, Screen, Table, TableToolbar, Tone, pct, RequestFailed, IncompleteNote } from "@/ui";
import { useStudentCatalog } from "@/screens/student/catalog";

type RowT = { quiz: Quiz; latest: Attempt | null; code: string; sub: string };

function statusOf(r: RowT): { label: string; tone: Tone; action: string } {
  const q = r.quiz;
  if(q.offline_pending)return {label:"Saved locally · awaiting sync",tone:"amber" as const,action:"View result"};
  if (!q.attempts_used) return { label: "Not started", tone: "blue", action: "Start quiz" };
  const held = (q.results_pending ?? 0) > 0 || (r.latest as unknown as { results_released?: boolean } | null)?.results_released === false;
  if (held && q.best_percentage == null) return { label: "Results not released", tone: "amber", action: "View submission" };
  if (r.latest?.status === "pending_evaluation") return { label: "Being marked", tone: "amber", action: "View result" };
  if (q.passed) return { label: `Passed · ${pct(q.best_percentage)}`, tone: "green", action: "View result" };
  if (q.best_percentage != null) return { label: `Not passed · ${pct(q.best_percentage)}`, tone: "red", action: "View result" };
  return { label: "Submitted", tone: "blue", action: "View result" };
}

export default function StudentQuizzes() {
  const router = useRouter();
  const quizzes = useAsync(() => student.quizzes(), []);
  const scores = useAsync(() => student.scores(), []);
  const cat = useStudentCatalog();
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("all");
  const rows: RowT[] = useMemo(() => (quizzes.data ?? []).map((quiz) => {
    const latest = (scores.data ?? []).filter((a) => a.assessment_id === quiz.id).sort((a, b) => b.attempt_number - a.attempt_number)[0] ?? null;
    const mod = quiz.module_id ? cat.data?.byModule.get(quiz.module_id) : undefined;
    const bySubject = cat.data?.subjects.find((s) => s.subject.id === quiz.subject_id);
    const code = mod?.subject.code ?? bySubject?.subject.code ?? "";
    return { quiz, latest, code, sub: [code, mod?.document, mod ? mod.title : quiz.kind === "module" ? null : "Several modules"].filter(Boolean).join(" · ") };
  }), [quizzes.data, scores.data, cat.data]);
  const codes = [...new Set(rows.map((r) => r.code).filter(Boolean))];
  const ready = rows.filter((r) => statusOf(r).action === "Start quiz").length;
  const shown = rows.filter((r) => (subject === "all" || r.code === subject) && `${r.quiz.title} ${r.sub}`.toLowerCase().includes(search.trim().toLowerCase()));
  const open = (r: RowT) => {
    const st = statusOf(r);
    if (st.action !== "Start quiz" && r.latest) router.push(`/student/attempt/${r.latest.id}`);
    else router.push(`/student/quiz/${r.quiz.id}`);
  };
  const columns: Column<RowT>[] = [
    { key: "quiz", label: "Quiz", flex: 2.4, render: (r) => <CellText title={r.quiz.title} sub={r.sub} /> },
    { key: "q", label: "Questions", flex: 0.8, render: (r) => `${r.quiz.question_count ?? "—"} questions` },
    { key: "pass", label: "Pass mark", flex: 0.7, render: (r) => `${r.quiz.pass_percentage}%` },
    { key: "status", label: "Your status", flex: 1.2, render: (r) => { const st = statusOf(r); return <Badge value={st.label} tone={st.tone} />; } },
    { key: "act", label: "", flex: 1, render: (r) => { const st = statusOf(r); return <Button title={st.action} small icon={st.action === "Start quiz" ? "arrow-forward" : undefined} variant={st.action === "Start quiz" ? "primary" : "secondary"} onPress={() => open(r)} />; } },
  ];
  const reload = () => { quizzes.reload(); scores.reload(); cat.reload(); };
  return (
    <Screen refreshing={quizzes.loading} onRefresh={reload}>
      <PageHeading eyebrow="CHECK YOUR UNDERSTANDING" title="My quizzes" subtitle="See what is ready, what you have completed, and what happens next." />
      <IncompleteNote rows={scores.data} noun="quiz results" />
      <Notice tone="success" title={ready ? `You have ${ready} quiz${ready === 1 ? "" : "zes"} ready.` : "No quizzes waiting right now."} message="Open a quiz to see its instructions before you begin." />
      <ErrorBanner message={quizzes.error} onRetry={reload} />
      <Card flush>
        <TableToolbar right={codes.length > 1 ? <Dropdown value={subject} onChange={setSubject} accessibilityLabel="Filter by subject" options={[{ value: "all", label: "All subjects" }, ...codes.map((c) => ({ value: c, label: c }))]} /> : undefined}>
          <Input icon="search" placeholder="Search this list…" value={search} onChangeText={setSearch} compact accessibilityLabel="Search quizzes" />
        </TableToolbar>
        {quizzes.error && !quizzes.data ? <RequestFailed onRetry={quizzes.reload} /> : quizzes.loading && !quizzes.data ? <Loading lines={2} /> : (
          <Table columns={columns} rows={shown} keyOf={(r) => r.quiz.id} onRowPress={open} noun="quiz"
            empty={<Empty icon="help-circle-outline" title={rows.length ? "No quiz matches" : "No quizzes yet"} text={rows.length ? "Try a different search or subject." : "Quizzes appear here when your faculty publishes them for your open modules."} />} />
        )}
      </Card>
    </Screen>
  );
}
