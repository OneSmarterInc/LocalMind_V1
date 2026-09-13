import { useRouter } from "expo-router";
import React from "react";
import { Text, View } from "react-native";
import { manage } from "@/api/endpoints";
import { useAuth } from "@/auth/AuthContext";
import { useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, CardGrid, CardHead, Empty, ErrorBanner, HeroCard, ListRow, Loading, PageHeading, Screen, Split, Stat, StatRow, TextLink, colors, RequestFailed } from "@/ui";
import { TeachingSubjectCard } from "@/screens/manage/TeachingSubjectCard";

const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };

export default function FacultyOverview() {
  const { user } = useAuth();
  const router = useRouter();
  const ov = useAsync(() => manage.overview(), []);
  const docs = useAsync(() => manage.documents(), []);
  const quizzes = useAsync(() => manage.quizzes(), []);
  const assignments = useAsync(() => manage.assignments(), []);
  const subjects: any[] = ov.data?.subjects ?? [];
  const students = subjects.reduce((n, s) => n + (s.students_enrolled ?? 0), 0);
  const published = subjects.reduce((n, s) => n + (s.documents?.published ?? 0), 0);
  const review = (docs.data ?? []).filter((d) => d.status === "under_review" || d.status === "ready" || d.status === "error");
  const held = (quizzes.data ?? []).filter((q) => q.held_for_review);
  const releases = (quizzes.data ?? []).filter((q) => ((q as { pending_release_count?: number }).pending_release_count ?? 0) > 0);
  const toMark = subjects.reduce((n, s) => n + (s.assignments?.awaiting_evaluation ?? 0), 0) + subjects.reduce((n, s) => n + (s.quizzes?.pending_evaluation ?? 0), 0);
  const attention = review.length + held.length + releases.length + (toMark ? 1 : 0);
  const reload = () => { ov.reload(); docs.reload(); quizzes.reload(); assignments.reload(); };
  const activity = useAsync(() => manage.teachingActivity(), []);
  const when = (iso: string) => {
    const d = new Date(iso); const today = new Date();
    const y = new Date(); y.setDate(today.getDate() - 1);
    return d.toDateString() === today.toDateString() ? "Today" : d.toDateString() === y.toDateString() ? "Yesterday" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  };
  return (
    <Screen refreshing={ov.loading} onRefresh={() => { reload(); activity.reload(); }}>
      <PageHeading eyebrow="YOUR TEACHING WORKSPACE" title={`${greeting()}, ${user?.full_name.split(" ")[0] ?? "there"}.`} subtitle="A clear view of your teaching, without the clutter."
        right={<Button title="Create a quiz" variant="secondary" icon="add" onPress={() => router.push("/manage/quiz/new")} />} />
      <ErrorBanner message={ov.error} onRetry={reload} />
      <StatRow>
        <Stat label="My subjects" icon="library-outline" value={ov.data ? subjects.length : null} helper="Your teaching workspace" />
        <Stat label="Enrolled students" icon="people-outline" value={ov.data ? students : null} helper="Across your subjects" />
        <Stat label="Published books" icon="book-outline" value={ov.data ? published : null} helper="Available to your students" />
        <Stat label="Need your attention" icon="flag-outline" value={docs.data && quizzes.data ? attention : null} helper="Reviews and result releases" />
      </StatRow>
      <Split
        main={
          <>
            <HeroCard eyebrow="FROM BOOK TO LEARNING" title="Make the next chapter easy to discover." text="Upload a book, review its modules, and publish when you are ready."
              action={<Button title="Upload a book" icon="cloud-upload-outline" onPress={() => router.push("/manage/document/upload")} />} />
            <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginTop: 4 }}>
              <View>
                <Text style={{ fontSize: 18, fontWeight: "600", color: colors.ink }}>My subjects</Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>Everything for a class lives together.</Text>
              </View>
              <TextLink title="View all" icon="arrow-forward" onPress={() => router.push("/manage/subjects")} />
            </View>
            {ov.error && !ov.data ? <RequestFailed onRetry={ov.reload} /> : ov.loading && !ov.data ? <Loading lines={1} /> : null}
            {ov.data && subjects.length === 0 ? <Card><Empty icon="library-outline" title="No subjects yet" text="Your administrator assigns subjects to you. They appear here once assigned." /></Card> : null}
            <CardGrid min={200} gap={16} max={3}>
              {subjects.slice(0, 3).map((s, i) => <TeachingSubjectCard key={s.subject.id} summary={s} index={i} onPress={() => router.push(`/manage/subject/${s.subject.id}`)} />)}
            </CardGrid>
          </>
        }
        side={
          <>
            <Card>
              <CardHead title="Your next actions" subtitle="Start with what needs a decision" />
              {docs.data && quizzes.data && attention === 0 ? <Text style={{ fontSize: 12, color: colors.muted }}>Nothing is waiting for you right now.</Text> : null}
              {review.slice(0, 3).map((d) => (
                <ListRow key={d.id} plain icon="book-outline" tone="amber" title={`Review ${d.title}`} subtitle={`${d.module_count ?? 0} modules · ${d.status === "error" ? "Processing failed" : d.status === "ready" ? "Ready to publish" : "Outline ready for review"}`}
                  right={<Badge value={d.status === "error" ? "Error" : "Review"} tone={d.status === "error" ? "red" : "amber"} />} onPress={() => router.push(`/manage/document/${d.id}`)} />
              ))}
              {held.length ? <ListRow plain icon="shield-outline" tone="amber" title={`Check ${held.length} flagged quiz${held.length === 1 ? "" : "zes"}`} subtitle="Review the source before publishing" right={<Badge value={`${held.length} held`} tone="amber" />} onPress={() => router.push(held.length === 1 ? `/manage/quiz/${held[0].id}` : "/manage/quizzes")} /> : null}
              {releases.slice(0, 2).map((q) => {
                const n = (q as { pending_release_count?: number }).pending_release_count ?? 0;
                return <ListRow key={q.id} plain icon="document-lock-outline" tone="blue" title={`Release ${n} student result${n === 1 ? "" : "s"}`} subtitle={`${q.title} · Results currently held`} right={<Badge value={`${n} waiting`} tone="blue" />} onPress={() => router.push({ pathname: "/manage/quiz/[id]", params: { id: q.id, tab: "attempts" } })} />;
              })}
              {toMark ? <ListRow plain icon="create-outline" tone="amber" title={`Mark ${toMark} submission${toMark === 1 ? "" : "s"}`} subtitle="Assignments and written answers awaiting evaluation" right={<Badge value={`${toMark} to mark`} tone="amber" />} onPress={() => router.push("/manage/assignments")} /> : null}
            </Card>
            <Card>
              <CardHead title="Recent teaching activity" />
              {activity.error && !activity.data ? <RequestFailed onRetry={activity.reload} /> : activity.loading && !activity.data ? <Loading lines={1} /> : null}
              {activity.data && activity.data.items.length === 0 ? <Text style={{ fontSize: 12, color: colors.muted }}>No activity in the last {activity.data.window_days} days.</Text> : null}
              {activity.data?.items.length ? (
                <View style={{ borderLeftWidth: 1, borderLeftColor: colors.border, marginLeft: 7, paddingLeft: 20, gap: 18 }}>
                  {activity.data.items.slice(0, 5).map((x, i) => (
                    <View key={i}>
                      <View style={{ position: "absolute", left: -25, top: 5, width: 9, height: 9, borderRadius: 5, backgroundColor: "#88A47B", borderWidth: 2, borderColor: "#FFFFFF" }} />
                      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{x.title}</Text>
                      <Text style={{ fontSize: 11, color: colors.muted, marginTop: 3 }}>{x.detail} · {when(x.at)}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </Card>
          </>
        }
      />
    </Screen>
  );
}
