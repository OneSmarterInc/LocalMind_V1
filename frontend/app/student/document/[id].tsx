import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { student } from "@/api/endpoints";
import type { Chapter } from "@/api/types";
import { useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, DetailList, ErrorBanner, ListRow, Loading, Notice, PageHeading, ProgressBar, Screen, Split, colors, RequestFailed } from "@/ui";

const statusLabel = (st: string) => (st === "completed" ? "Completed" : st === "in_progress" ? "In progress" : st === "needs_review" ? "Needs review" : "Not started");

export default function StudentBook() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const q = useAsync(() => student.document(id), [id]);
  const subjects = useAsync(() => student.subjects(), []);
  const subject = subjects.data?.find((s) => s.id === q.data?.subject_id);
  const chapters = (q.data?.chapters ?? []).map((c) => ({ ...c, modules: c.modules.filter((m) => !m.source_missing) }));
  const all = chapters.flatMap((c) => c.modules);
  const open = all.filter((m) => m.availability === "open");
  const done = all.filter((m) => m.progress?.status === "completed").length;
  const current = open.find((m) => m.progress?.status === "in_progress" || m.progress?.status === "needs_review") ?? open.find((m) => m.progress?.status !== "completed");
  const numberOf = (mid: string) => all.findIndex((m) => m.id === mid) + 1;
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <PageHeading eyebrow={subject ? `${subject.code} · ${subject.name}`.toUpperCase() : undefined} title={q.data?.title ?? "Book"} subtitle="Your book, broken into manageable steps."
        right={current ? <Button title={`Continue Module ${numberOf(current.id)}`} icon="arrow-forward" onPress={() => router.push(`/student/module/${current.id}`)} /> : null} />
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.error && !q.data ? <RequestFailed onRetry={q.reload} /> : q.loading && !q.data ? <Loading /> : null}
      {q.data ? (
        <Split
          main={<View style={{ gap: 14 }}>{chapters.map((ch, i) => <ChapterBlock key={ch.id} chapter={ch} index={i} numberOf={numberOf} onOpen={(mid) => router.push(`/student/module/${mid}`)} />)}</View>}
          side={
            <>
              <Card>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
                  <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>Your book progress</Text>
                  <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>{all.length ? Math.round((done / all.length) * 100) : 0}%</Text>
                </View>
                <ProgressBar value={all.length ? (done / all.length) * 100 : 0} />
                <Text style={{ fontSize: 11, color: colors.muted }}>{done} of {all.length} modules completed</Text>
                <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 8 }} />
                <DetailList items={[
                  ["Current module", current ? `Module ${numberOf(current.id)}` : "—"],
                  ["Book status", <Badge key="s" value="Published" tone="green" />],
                  ["Your access", `${open.length} open · ${all.length - open.length} locked`],
                ]} />
              </Card>
              <Notice title="A lock is a teaching checkpoint." message="Locked modules open when your faculty makes them available. You have not missed a step." />
            </>
          }
        />
      ) : null}
    </Screen>
  );
}

function ChapterBlock({ chapter, index, numberOf, onOpen }: { chapter: Chapter; index: number; numberOf: (id: string) => number; onOpen: (id: string) => void }) {
  const [openBlock, setOpenBlock] = useState(true);
  const done = chapter.modules.filter((m) => m.progress?.status === "completed").length;
  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 11, backgroundColor: "#FFFFFF", overflow: "hidden" }}>
      <Pressable onPress={() => setOpenBlock((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: openBlock }}
        style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 18, borderBottomWidth: openBlock ? 1 : 0, borderBottomColor: colors.border }}>
        <View style={{ width: 28, height: 28, borderRadius: 6, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 11, color: colors.muted }}>{String(index + 1).padStart(2, "0")}</Text></View>
        <Text style={{ flex: 1, fontSize: 13, fontWeight: "600", color: colors.ink }}>{chapter.title}</Text>
        <Text style={{ fontSize: 11, color: colors.muted }}>{done} of {chapter.modules.length} completed</Text>
        <Ionicons name={openBlock ? "chevron-up" : "chevron-down"} size={16} color={colors.muted} />
      </Pressable>
      {openBlock ? (
        <View style={{ paddingHorizontal: 20 }}>
          {chapter.modules.map((m) => {
            const locked = m.availability === "locked";
            const st = m.progress?.status ?? "not_started";
            const n = String(numberOf(m.id)).padStart(2, "0");
            return (
              <ListRow key={m.id} plain icon={locked ? "lock-closed-outline" : st === "completed" ? "checkmark-circle-outline" : "book-outline"} tone={locked ? "neutral" : "green"}
                title={m.title} subtitle={locked ? `Module ${n} · Opens when your faculty is ready` : `Module ${n} · Read · Lesson · Ask a doubt`}
                right={<Badge value={locked ? "Locked" : statusLabel(st)} tone={locked ? "neutral" : st === "completed" ? "green" : st === "in_progress" ? "blue" : st === "needs_review" ? "amber" : "neutral"} />}
                onPress={locked ? undefined : () => onOpen(m.id)} />
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
