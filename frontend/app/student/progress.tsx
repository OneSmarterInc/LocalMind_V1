import { useRouter } from "expo-router";
import React from "react";
import { Text, View } from "react-native";
import { student } from "@/api/endpoints";
import { useAsync } from "@/hooks/useAsync";
import { Badge, Card, CardHead, CellText, Column, Empty, ErrorBanner, Eyebrow, ListRow, Loading, PageHeading, ProgressBar, Screen, Split, Stat, StatRow, Table, colors, fmtDay, fmtSeconds, pct, RequestFailed, IncompleteNote } from "@/ui";
import type { Attempt } from "@/api/types";
import { useStudentCatalog } from "@/screens/student/catalog";

export default function StudentProgress() {
  const router = useRouter();
  const ov = useAsync(() => student.overview(), []);
  const cat = useStudentCatalog();
  const scores = useAsync(() => student.scores(), []);
  const quizzes = useAsync(() => student.quizzes(), []);
  const d = ov.data;
  const toTake = (quizzes.data ?? []).filter((q) => !q.passed && (!q.max_attempts || (q.attempts_used ?? 0) < q.max_attempts)).length;
  const recent = (scores.data ?? []).slice().sort((a, b) => (b.submitted_at ?? "").localeCompare(a.submitted_at ?? "")).slice(0, 6);
  const activity = [
    ...(cat.data?.subjects.flatMap((s) => s.modules).filter((m) => m.last_viewed_at).map((m) => ({ at: m.last_viewed_at!, title: `${m.status === "completed" ? "Completed" : "Read"} ${m.title}`, sub: `${fmtDay(m.last_viewed_at)} · ${m.subject.code}` })) ?? []),
    ...recent.map((a) => ({ at: a.submitted_at ?? a.started_at, title: `${held(a) ? "Submitted" : a.passed ? "Passed" : "Attempted"} ${a.assessment_title ?? "a quiz"}`, sub: fmtDay(a.submitted_at) })),
  ].sort((x, y) => y.at.localeCompare(x.at)).slice(0, 6);
  const columns: Column<Attempt>[] = [
    { key: "q", label: "Quiz", flex: 2, render: (a) => <CellText title={a.assessment_title ?? "Quiz"} sub={`Attempt ${a.attempt_number} · ${fmtDay(a.submitted_at)}`} /> },
    { key: "s", label: "Score", flex: 0.7, render: (a) => (held(a) ? "—" : pct(a.percentage)) },
    { key: "st", label: "Status", flex: 1.2, render: (a) => held(a) ? <Badge value="Results not released" tone="amber" /> : a.status === "pending_evaluation" ? <Badge value="Being marked" tone="amber" /> : <Badge value={a.passed ? "Passed" : "Not passed"} tone={a.passed ? "green" : "red"} /> },
  ];
  const reload = () => { ov.reload(); cat.reload(); scores.reload(); quizzes.reload(); };
  return (
    <Screen refreshing={ov.loading} onRefresh={reload}>
      <PageHeading eyebrow="MY PROGRESS" title="See how far you’ve come." subtitle="Your completed modules, released quiz results, and time spent learning." />
      <IncompleteNote rows={scores.data} noun="quiz results" />
      <ErrorBanner message={ov.error || cat.error} onRetry={reload} />
      <StatRow>
        <Stat label="My subjects" icon="library-outline" value={d?.subjects_enrolled} helper="Enrolled" />
        <Stat label="Modules completed" icon="checkmark-done-outline" value={d ? `${d.modules.completed} of ${d.modules.total}` : null} helper={d ? `${pct(d.modules.completion_percentage)} complete` : null} positive />
        <Stat label="Quizzes to take" icon="help-circle-outline" value={quizzes.data ? toTake : null} helper={d?.quizzes.average_percentage != null ? `Average ${pct(d.quizzes.average_percentage)}` : "No scores yet"} />
        <Stat label="Learning time" icon="time-outline" value={d ? fmtSeconds(d.time.learning_seconds) : null} helper={d ? `${fmtSeconds(d.time.quiz_seconds)} on quizzes` : null} />
      </StatRow>
      <Split
        main={
          <>
            <Card>
              <CardHead title="Progress by subject" />
              {cat.error && !cat.data ? <RequestFailed onRetry={cat.reload} /> : cat.loading && !cat.data ? <Loading lines={1} /> : null}
              {cat.data?.subjects.length === 0 ? <Empty icon="library-outline" text="You are not enrolled in a subject yet." /> : null}
              {cat.data?.subjects.map((s, i) => {
                const value = s.total ? Math.round((s.completed / s.total) * 100) : 0;
                return (
                  <ListRow key={s.subject.id} plain icon="library-outline" tone={(["green", "blue", "amber"] as const)[i % 3]} title={s.subject.name} subtitle={`${s.completed} of ${s.total} modules completed`}
                    onPress={() => router.push(`/student/subject/${s.subject.id}`)}
                    right={<View style={{ width: 90, gap: 5, alignItems: "flex-end" }}><Text style={{ fontSize: 11, color: colors.ink, fontWeight: "600" }}>{value}%</Text><ProgressBar value={value} /></View>} />
                );
              })}
            </Card>
            <Card>
              <CardHead title="Recent quiz outcomes" />
              <Table noun="result" columns={columns} rows={recent} keyOf={(a) => a.id} onRowPress={(a) => router.push(`/student/attempt/${a.id}`)} minWidth={480}
                empty={<Empty icon="ribbon-outline" text="No quiz attempts yet." />} />
            </Card>
          </>
        }
        side={
          <>
            <Card>
              <Eyebrow>YOUR LEARNING, AT A GLANCE</Eyebrow>
              <Text style={{ fontSize: 26, fontWeight: "600", color: colors.ink }}>{d ? fmtSeconds(d.time.learning_seconds) : "—"} <Text style={{ fontSize: 13, fontWeight: "400", color: colors.muted }}>Learning time</Text></Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>A small step each day adds up.</Text>
            </Card>
            <Card>
              <CardHead title="Recent activity" />
              {activity.length === 0 ? <Text style={{ fontSize: 12, color: colors.muted }}>Your reading and quiz activity will appear here.</Text> : (
                <View style={{ borderLeftWidth: 1, borderLeftColor: colors.border, marginLeft: 7, paddingLeft: 20, gap: 18 }}>
                  {activity.map((x, i) => (
                    <View key={i}>
                      <View style={{ position: "absolute", left: -25, top: 5, width: 9, height: 9, borderRadius: 5, backgroundColor: "#88A47B", borderWidth: 2, borderColor: "#FFFFFF" }} />
                      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{x.title}</Text>
                      <Text style={{ fontSize: 11, color: colors.muted, marginTop: 3 }}>{x.sub}</Text>
                    </View>
                  ))}
                </View>
              )}
            </Card>
          </>
        }
      />
    </Screen>
  );
}

const held = (a: Attempt) => (a as unknown as { results_released?: boolean }).results_released === false;
