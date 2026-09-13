import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { View } from "react-native";
import { student } from "@/api/endpoints";
import { useAsync } from "@/hooks/useAsync";
import { Badge, Card, CardHead, Empty, ErrorBanner, ListRow, Loading, PageHeading, ProgressBar, Screen, Split, Stat, StatRow, StepList, colors, fmtSeconds, pct, RequestFailed } from "@/ui";

export default function StudentSubject() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const docs = useAsync(() => student.documents(id), [id]);
  const an = useAsync(() => student.subjectAnalytics(id), [id]);
  const subj = useAsync(async () => (await student.subjects()).find((s) => s.id === id) ?? null, [id]);
  const modules: any[] = an.data?.modules ?? [];
  const done = modules.filter((m) => m.status === "completed").length;
  const best = modules.reduce((b: number | null, m) => (m.best_quiz_percentage != null && (b == null || m.best_quiz_percentage > b) ? m.best_quiz_percentage : b), null);
  const reload = () => { docs.reload(); an.reload(); subj.reload(); };
  return (
    <Screen refreshing={docs.loading} onRefresh={reload}>
      <PageHeading eyebrow="MY SUBJECTS" title={an.data?.subject.name ?? subj.data?.name ?? "Subject"} subtitle={[subj.data?.code ?? an.data?.subject.code, subj.data?.faculty_names?.join(", ")].filter(Boolean).join(" · ")}
        right={subj.data ? <Badge value={subj.data.status === "active" ? "Enrolled" : subj.data.status} tone={subj.data.status === "active" ? "green" : "neutral"} /> : null} />
      <ErrorBanner message={docs.error || an.error} onRetry={reload} />
      <StatRow>
        <Stat label="Books" icon="book-outline" value={docs.data?.length} helper="Published for you" />
        <Stat label="Progress" icon="checkmark-done-outline" value={an.data ? pct(modules.length ? (done / modules.length) * 100 : 0) : null} helper={an.data ? `${done} of ${modules.length} modules completed` : null} />
        <Stat label="Best quiz" icon="ribbon-outline" value={an.data ? pct(best) : null} helper="Your highest score" />
        <Stat label="Learning time" icon="time-outline" value={an.data ? fmtSeconds(an.data.time?.learning_seconds) : null} helper="In this subject" />
      </StatRow>
      <Split
        main={
          <Card>
            <CardHead title="Your books" subtitle="Open a book to find your next module" />
            {docs.error && !docs.data ? <RequestFailed onRetry={docs.reload} /> : docs.loading && !docs.data ? <Loading lines={1} /> : null}
            {docs.data?.length === 0 ? <Empty title="No books yet" icon="book-outline" text="Your faculty has not published a book for this subject yet. Check back soon." /> : null}
            {docs.data?.map((d) => {
              const status = (d.module_count ?? 0) > 0 && d.completed_modules >= (d.module_count ?? 0) ? "Completed" : d.completed_modules > 0 || d.progress_percent > 0 ? "In progress" : "Not started";
              return (
                <View key={d.id} style={{ borderBottomWidth: 1, borderBottomColor: colors.rowLine, paddingBottom: 12 }}>
                  <ListRow plain icon="book-outline" title={d.title}
                    subtitle={`${d.module_count ?? 0} modules · ${d.completed_modules} completed · ${d.open_module_count} open`}
                    right={<Badge value={status} tone={status === "Completed" ? "green" : status === "In progress" ? "blue" : "neutral"} />}
                    onPress={() => router.push(`/student/document/${d.id}`)} />
                  <ProgressBar value={d.progress_percent} />
                </View>
              );
            })}
          </Card>
        }
        side={
          <Card>
            <CardHead title="Your learning path" />
            <StepList steps={[
              ["Choose a book", "See the chapters and the modules your faculty has opened."],
              ["Read, then explore the lesson", "Ask a doubt whenever you need a hand."],
              ["Check your understanding", "Take the module quiz and review the feedback."],
            ]} />
          </Card>
        }
      />
    </Screen>
  );
}
