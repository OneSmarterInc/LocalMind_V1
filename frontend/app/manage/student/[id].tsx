import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { Text, View } from "react-native";
import { manage } from "@/api/endpoints";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, CardHead, CellText, Column, Empty, ErrorBanner, ListRow, Loading, Notice, PageHeading, Screen, Stat, StatRow, Table, colors, confirmAsync, fmtDate, fmtSeconds, pct } from "@/ui";

const STATUS: Record<string, { label: string; tone: "green" | "blue" | "amber" | "neutral" }> = {
  completed: { label: "Completed", tone: "green" }, in_progress: { label: "In progress", tone: "blue" }, needs_review: { label: "Needs review", tone: "amber" }, not_started: { label: "Not started", tone: "neutral" },
};

export default function FacultyStudent() {
  const { id, subject } = useLocalSearchParams<{ id: string; subject?: string }>();
  const router = useRouter();
  const q = useAsync(() => manage.studentAnalytics(id), [id]);
  const detail = useAsync(() => (subject ? manage.studentSubjectAnalytics(id, subject) : Promise.resolve(null)), [id, subject]);
  const row = useAsync(async () => (subject ? (await manage.subjectStudentsAnalytics(subject)).students.find((r: any) => r.student_id === id) ?? null : null), [id, subject]);
  const d = q.data; const r = row.data; const sd = detail.data;
  const back = () => router.push({ pathname: "/manage/subject/[id]", params: { id: subject!, tab: "students" } });
  const drop = useAction(async () => {
    if (!subject) return;
    const ok = await confirmAsync("Discontinue enrollment?", `${d?.student.full_name ?? "This student"} will no longer see this subject. Earlier attempts and progress are kept.`, "Discontinue", "Cancel", { tone: "danger" });
    if (!ok) return;
    await manage.discontinueEnrollment(subject, id);
    back();
  });
  const modules: any[] = sd?.modules ?? [];
  const best = modules.reduce((b: number | null, m) => (m.best_quiz_percentage != null && (b == null || m.best_quiz_percentage > b) ? m.best_quiz_percentage : b), null);
  const columns: Column<any>[] = [
    { key: "m", label: "Module", flex: 2.2, render: (m) => <CellText strong={false} title={m.title} sub={`${m.document} · ${m.chapter}`} /> },
    { key: "p", label: "Progress", flex: 1, render: (m) => (m.availability === "locked" ? <Badge value="Locked" tone="neutral" /> : <Badge value={STATUS[m.status]?.label ?? m.status} tone={STATUS[m.status]?.tone ?? "neutral"} />) },
    { key: "q", label: "Best quiz", flex: 0.8, render: (m) => pct(m.best_quiz_percentage) },
    { key: "t", label: "Learning time", flex: 0.9, render: (m) => (m.learning_seconds ? fmtSeconds(m.learning_seconds) : "—") },
  ];
  return (
    <Screen refreshing={q.loading} onRefresh={() => { q.reload(); detail.reload(); row.reload(); }}>
      <PageHeading eyebrow={sd ? `${sd.subject.code} · STUDENT PROGRESS` : "STUDENT PROGRESS"} title={d?.student.full_name ?? "Student"} subtitle={d ? [r?.roll_number, d.student.email].filter(Boolean).join(" · ") : null}
        right={subject ? <Button title="Back to students" variant="secondary" icon="arrow-back" onPress={back} /> : null} />
      <ErrorBanner message={q.error ?? detail.error} onRetry={q.reload} />
      {q.loading && !d ? <Loading /> : null}
      {d ? (
        <>
          <StatRow>
            <Stat label="Completion" icon="checkmark-done-outline" value={pct(r ? r.completion_percentage : d.modules.completion_percentage)} helper={r ? `${r.modules_completed} of ${r.modules_total} modules` : `${d.modules.completed} of ${d.modules.total} modules`} />
            <Stat label="Best quiz" icon="ribbon-outline" value={pct(best ?? r?.best_quiz_percentage)} helper="Released outcome" />
            <Stat label="Learning time" icon="time-outline" value={fmtSeconds(sd ? sd.time.learning_seconds : d.time.learning_seconds)} helper="In this subject" />
            <Stat label="Quiz attempts" icon="help-circle-outline" value={sd ? sd.quiz_attempts.length : d.quizzes.attempts} helper="Recorded attempts" />
          </StatRow>
          {subject ? (
            <>
              <Card flush>
                <View style={{ paddingHorizontal: 22, paddingTop: 22, paddingBottom: 10 }}><CardHead title="Module progress" /></View>
                {detail.loading && !sd ? <Loading lines={2} /> : <Table noun="module" columns={columns} rows={modules} keyOf={(m) => m.module_id} minWidth={640} empty={<Empty icon="layers-outline" text="No published modules in this subject yet." />} />}
              </Card>
              <Card>
                <CardHead title="Quiz attempts" />
                {sd && sd.quiz_attempts.length === 0 ? <Text style={{ fontSize: 12, color: colors.muted }}>No quiz attempts yet.</Text> : null}
                {sd?.quiz_attempts.map((a: any) => (
                  <ListRow key={a.id} plain icon="help-circle-outline" title={`${a.quiz_title} · Attempt ${a.attempt_number}`}
                    subtitle={`${a.status === "evaluated" ? "Evaluated" : a.status === "pending_evaluation" ? "Being marked" : "Submitted"} · ${pct(a.percentage)} · ${a.results_released ? "Results released" : "Results held"} · ${fmtDate(a.submitted_at)}`}
                    right={a.status === "evaluated" ? <Badge value={a.passed ? "Passed" : "Not passed"} tone={a.passed ? "green" : "red"} /> : <Badge value="Pending" tone="amber" />}
                    onPress={() => router.push({ pathname: "/manage/quiz/[id]", params: { id: a.quiz_id, tab: "attempts" } })} />
                ))}
              </Card>
              <View style={{ flexDirection: "row" }}><Button title="Discontinue enrollment" variant="danger" small icon="person-remove-outline" onPress={() => drop.run()} busy={drop.busy} /></View>
              <ErrorBanner message={drop.error} />
            </>
          ) : <Notice message="Open a student from a subject to see module progress and quiz attempts for that subject." />}
        </>
      ) : null}
    </Screen>
  );
}
