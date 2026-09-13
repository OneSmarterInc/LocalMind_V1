import { useRouter } from "expo-router";
import React from "react";
import { Text, View } from "react-native";
import { student } from "@/api/endpoints";
import { useAuth } from "@/auth/AuthContext";
import { useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, CardGrid, CardHead, Empty, ErrorBanner, Eyebrow, HeroCard, ListRow, Loading, PageHeading, ProgressBar, Screen, Split, Stat, StatRow, TextLink, colors, fmtSeconds, RequestFailed } from "@/ui";
import { SubjectCard } from "@/screens/student/SubjectCard";
import { greeting, nextModule, useStudentCatalog } from "@/screens/student/catalog";

const today = () => new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).toUpperCase();

export default function StudentOverview() {
  const { user } = useAuth();
  const router = useRouter();
  const cat = useStudentCatalog();
  const ov = useAsync(() => student.overview(), []);
  const quizzes = useAsync(() => student.quizzes(), []);
  const assignments = useAsync(() => student.assignments(), []);
  const first = user?.full_name.split(" ")[0] ?? "there";
  const toTake = (quizzes.data ?? []).filter((q) => !q.passed && (!q.max_attempts || (q.attempts_used ?? 0) < q.max_attempts));
  const toDo = (assignments.data ?? []).filter((a) => a.status === "published" && !a.my_submission);
  const next = cat.data ? nextModule(cat.data.subjects) : null;
  const d = ov.data;
  const reload = () => { cat.reload(); ov.reload(); quizzes.reload(); assignments.reload(); };
  return (
    <Screen refreshing={cat.loading} onRefresh={reload}>
      <PageHeading eyebrow={today()} title={`${greeting()}, ${first}.`} subtitle="Ready for your next small step? Everything you need is right here."
        right={<Button title="View my progress" variant="secondary" icon="stats-chart-outline" onPress={() => router.push("/student/progress")} />} />
      <ErrorBanner message={cat.error || ov.error} onRetry={reload} />
      <StatRow>
        <Stat label="My subjects" icon="library-outline" value={d?.subjects_enrolled ?? cat.data?.subjects.length} helper="All your enrolled subjects" />
        <Stat label="Modules completed" icon="checkmark-done-outline" value={d ? `${d.modules.completed} / ${d.modules.total}` : null} helper="One module at a time" />
        <Stat label="Quizzes to take" icon="help-circle-outline" value={quizzes.data ? toTake.length : null} helper="Ready when you are" />
        <Stat label="Learning time" icon="time-outline" value={d ? fmtSeconds(d.time.learning_seconds) : null} helper="Time spent reading" />
      </StatRow>
      <Split
        main={
          <>
            {cat.error && !cat.data ? <RequestFailed onRetry={cat.reload} /> : cat.loading && !cat.data ? <Loading /> : next ? (
              <HeroCard eyebrow="PICK UP WHERE YOU LEFT OFF" title={next.title} text={`${next.subject.name} · ${next.document} · ${next.chapter}`}
                action={<Button title={next.status === "not_started" ? "Start learning" : "Continue learning"} icon="arrow-forward" onPress={() => router.push(`/student/module/${next.module_id}`)} />} />
            ) : cat.data ? (
              <HeroCard eyebrow="WELCOME" title="Your learning starts with a subject." text="Open a subject to find its books and the modules your faculty has opened." action={<Button title="See my subjects" onPress={() => router.push("/student/subjects")} />} />
            ) : null}
            <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginTop: 4 }}>
              <View>
                <Text style={{ fontSize: 18, fontWeight: "600", color: colors.ink }}>My subjects</Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>Your books, modules, and quizzes, organized by subject.</Text>
              </View>
              <TextLink title="View all" icon="arrow-forward" onPress={() => router.push("/student/subjects")} />
            </View>
            {cat.data?.subjects.length === 0 ? <Card><Empty title="You’re in. Let’s find your classes." icon="library-outline" text="You have not been enrolled in a subject yet. Ask your faculty or administrator to add you to the right subject." /></Card> : null}
            <CardGrid min={200} gap={16} max={3}>
              {cat.data?.subjects.slice(0, 3).map((r, i) => <SubjectCard key={r.subject.id} row={r} index={i} onPress={() => router.push(`/student/subject/${r.subject.id}`)} />)}
            </CardGrid>
          </>
        }
        side={
          <>
            <Card>
              <CardHead title="Up next" subtitle="A few things to keep you moving" />
              {toTake.length === 0 && toDo.length === 0 && quizzes.data && assignments.data ? <Text style={{ fontSize: 12, color: colors.muted }}>Nothing waiting. Nice work.</Text> : null}
              {toTake.slice(0, 3).map((q) => (
                <ListRow key={q.id} plain icon="help-circle-outline" title={q.title} subtitle={`${q.question_count ?? "?"} questions · Pass mark ${q.pass_percentage}%`} right={<><Badge value="Ready" tone="green" /></>} onPress={() => router.push(`/student/quiz/${q.id}`)} />
              ))}
              {toDo.slice(0, 3).map((a) => (
                <ListRow key={a.id} plain icon="create-outline" tone="amber" title={a.title} subtitle={`Assignment${a.due_at ? ` · Due ${new Date(a.due_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}`} right={<Badge value="To do" tone="amber" />} onPress={() => router.push(`/student/assignment/${a.id}`)} />
              ))}
            </Card>
            <Card>
              <Eyebrow>YOUR LEARNING, AT A GLANCE</Eyebrow>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <Text style={{ fontSize: 22, fontWeight: "600", color: colors.ink }}>{d ? fmtSeconds(d.time.learning_seconds) : "—"}</Text>
                <Badge value="Learning time" tone="neutral" />
              </View>
              <ProgressBar value={d?.modules.completion_percentage} />
              <Text style={{ fontSize: 12, color: colors.muted }}>A small step each day adds up.</Text>
            </Card>
          </>
        }
      />
    </Screen>
  );
}
