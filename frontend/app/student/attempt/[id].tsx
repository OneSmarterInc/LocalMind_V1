import { useOnline } from "@/offline/connectivity";
import { useSyncState } from "@/offline/sync";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useBackTo } from "@/hooks/useBackTo";
import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {retryCourseEvent,onCourseWorkSynced} from "@/offline/coursework";
import { student } from "@/api/endpoints";
import type { DetailedResult } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, CardHead, DetailList, Empty, ErrorBanner, Loading, Notice, PageHeading, ScoreRing, Screen, Split, TextLink, TileIcon, colors, fmtDate, fmtSeconds, pct } from "@/ui";


export default function StudentAttempt() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const online = useOnline();
  const sync = useSyncState();
  const back = useBackTo();
  const q = useAsync(() => student.attempt(id), [id]);
  const retrySync = useAction(async () => { await retryCourseEvent(id); await q.reload(); });
  const reloadAttempt = q.reload;
  useEffect(() => onCourseWorkSynced(eventId => { if(eventId === id) void reloadAttempt(); }), [id,reloadAttempt]);
  useEffect(() => { if (sync.lastSync) void reloadAttempt(); }, [sync.lastSync, reloadAttempt]);
  const quizzes = useAsync(() => student.quizzes(), []);
  const a = q.data;
  useEffect(() => { if (a?.status !== "submitted" && a?.status !== "pending_evaluation") return; const t=setInterval(q.reload,5000); return()=>clearInterval(t); },[a?.status,q.reload]);
  const quiz = a ? quizzes.data?.find((x) => x.id === a.assessment_id) : undefined;
  const held = !!a && (a as unknown as { results_released?: boolean }).results_released === false;
  const correct = a?.detailed_results?.filter((r) => r.is_correct === true).length ?? 0;
  const title = a?.assessment_title ?? quiz?.title ?? "Quiz";
  const ctx = useAsync(async () => (quiz?.module_id ? student.module(quiz.module_id).catch(() => null) : null), [quiz?.module_id]);
  const book = ctx.data ? `${ctx.data.document_title ?? ""} · Module ${ctx.data.module_number ?? ctx.data.order}` : null;

  if (q.loading && !a) return <Screen><Loading /></Screen>;
  if (!a) return <Screen><ErrorBanner message={q.error} onRetry={q.reload} /></Screen>;

  // An attempt that has not reached the institution yet.
  //
  // This branch used to be a single line: one raw sentence per question, no
  // cards, no option letters, no option text, and four identical full-width
  // primary buttons stacked on top of each other. Everything the results screen
  // had been given — the per-question rows, the wording of the answer chosen
  // and the correct one — lived in the branch below and was never reached by a
  // student marking a quiz offline, which is most of them. It reuses the same
  // components now, so an offline result reads exactly like an online one.
  if (a.sync_status && a.sync_status !== 'synced') {
    const localCorrect = a.detailed_results?.filter((r) => r.is_correct === true).length ?? 0;
    return (
      <Screen refreshing={q.loading} onRefresh={q.reload}>
        <PageHeading eyebrow="SAVED ON THIS DEVICE" title={a.sync_status === 'conflict' ? 'Synchronization needs review' : 'Your quiz result'} subtitle={[title, book].filter(Boolean).join(" · ")}
          right={<Button title="Back to quizzes" variant="secondary" icon="arrow-back" onPress={() => back("/student/quizzes")} />} />
        <Notice tone={a.sync_status === 'conflict' ? 'warning' : 'info'}
          message={(a.sync_error === 'Quiz not found.'
            ? 'Your submitted answers are saved, but the quiz is not currently available to your account. Ask faculty to check publication, module access and enrollment, then retry synchronization.'
            : a.sync_error) || 'Your institution has not yet confirmed this attempt. Answers are retained locally and will synchronize when the server is reachable.'} />
        <ErrorBanner message={retrySync.error} />
        {a.results_released ? (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 30, padding: 28, borderWidth: 1, borderColor: "#D7E4D1", backgroundColor: "#F0F6EB", borderRadius: 13, flexWrap: "wrap" }}>
              <ScoreRing value={pct(a.percentage)} caption="YOUR SCORE" />
              <View style={{ flex: 1, minWidth: 220, gap: 8 }}>
                <Badge value={a.passed ? "Passed" : "Needs review"} tone={a.passed ? "green" : "amber"} />
                <Text style={{ fontSize: 24, fontWeight: "600", color: colors.ink }}>{a.passed ? "You\u2019ve got the essentials." : "Review the modules to strengthen your understanding."}</Text>
                <Text style={{ fontSize: 13, color: colors.muted }}>{localCorrect} of {a.total_questions} correct · Marked on this device</Text>
              </View>
            </View>
            <Card>
              <CardHead title="Question-by-question feedback" subtitle="Marked on this device. Your faculty sees the same answers once this attempt synchronizes." />
              {a.detailed_results.map((r, i) => <FeedbackRow key={r.question_id} r={r} n={i + 1} />)}
            </Card>
          </>
        ) : (
          <Card>
            <Empty icon="lock-closed-outline" title="Your faculty has withheld results."
              text="No score or answer key is shown on this device. Your answers are saved and will synchronize when the server is reachable." />
          </Card>
        )}
        <Card>
          <CardHead title="Saved on this device" subtitle={online ? (sync.running ? "Synchronizing…" : "Waiting for confirmation") : "Will sync when connected"} />
          {online && (a.sync_status === 'conflict' || sync.error) ? <View style={{ alignItems: "flex-start" }}><Button title="Retry sync" icon="refresh" variant="secondary" onPress={() => retrySync.run()} busy={retrySync.busy || sync.running} /></View> : null}
          <TextLink title="Course sync status" icon="cloud-offline-outline" onPress={() => router.push('/student/offline')} />
        </Card>
      </Screen>
    );
  }
  if (a.status === "submitted" && !held) {
    return <Screen><PageHeading title="Your answers are saved" subtitle={title}/><Notice autoDismiss={false} title="Evaluation is pending" message="Your response is safely stored. The local evaluation worker will process it, and faculty release rules still apply. No zero or pass has been assigned. If this remains pending, ask faculty to check the saved job."/><Button title="Check evaluation status" onPress={q.reload}/><Button title="Back to quizzes" variant="secondary" onPress={() => back("/student/quizzes")}/></Screen>;
  }

  if (held) {
    return (
      <Screen refreshing={q.loading} onRefresh={q.reload}>
        <PageHeading eyebrow="SUBMISSION CONFIRMED" title="Your answers are submitted." subtitle={title} right={<Button title="Back to quizzes" variant="secondary" icon="arrow-back" onPress={() => back("/student/quizzes")} />} />
        <Card>
          <Empty icon="time-outline" title="Your faculty will release the results." text="Your attempt has been received. Your score, correct answers, and feedback are hidden until results are released."
            action={<Badge value="Submitted · results not released" tone="amber" />} />
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16 }}>
            <DetailList items={[
              ["Attempt", `${a.attempt_number}`],
              ["Submitted", fmtDate(a.submitted_at)],
              ["Results release", (a as unknown as { results_release?: string }).results_release === "scheduled" ? "At a set time" : "By faculty"],
            ]} />
          </View>
        </Card>
      </Screen>
    );
  }

  const pending = a.status === "pending_evaluation";
  const passed = a.status === "evaluated" && a.passed;
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <PageHeading eyebrow="QUIZ COMPLETED" title="Your quiz result" subtitle={[title, book].filter(Boolean).join(" · ")}
        right={<Button title="Back to quizzes" variant="secondary" icon="arrow-back" onPress={() => back("/student/quizzes")} />} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 30, padding: 28, borderWidth: 1, borderColor: "#D7E4D1", backgroundColor: "#F0F6EB", borderRadius: 13, flexWrap: "wrap" }}>
        <ScoreRing value={pct(a.percentage)} caption="YOUR SCORE" />
        <View style={{ flex: 1, minWidth: 220, gap: 8 }}>
          <Badge value={pending ? "Being marked" : passed ? "Passed" : "Not passed"} tone={pending ? "amber" : passed ? "green" : "red"} />
          <Text style={{ fontSize: 24, fontWeight: "600", color: colors.ink }}>{pending ? "Some answers are still being marked." : passed ? "You’ve got the essentials." : "Review the modules to strengthen your understanding."}</Text>
          <Text style={{ fontSize: 13, color: colors.muted }}>{correct} of {a.total_questions} correct{quiz ? ` · Pass mark ${quiz.pass_percentage}%` : ""}</Text>
        </View>
      </View>
      {pending ? <Notice tone="warning" title="Marking in progress" message="Your written answers are awaiting evaluation. Multiple-choice questions are already scored; this page shows the rest when marking finishes." /> : null}
      <Split
        main={
          <>
            <Card>
              <CardHead title="Question-by-question feedback" />
              {a.detailed_results.map((r, i) => <FeedbackRow key={r.question_id} r={r} n={i + 1} />)}
            </Card>

          </>
        }
        side={
          <Card>
            <CardHead title="Attempt details" />
            <DetailList items={[
              ["Questions answered", `${a.detailed_results.filter((r) => (r.selected_option || r.student_answer || "").trim()).length} of ${a.total_questions}`],
              ["Time taken", fmtSeconds(a.time_taken_seconds)],
              ["Result visibility", "Released"],
            ]} />
            {quiz?.module_id ? <Button title="Review the module" variant="secondary" icon="book-outline" full onPress={() => router.push(`/student/module/${quiz.module_id}`)} /> : null}
          </Card>
        }
      />
    </Screen>
  );
}

function FeedbackRow({ r, n }: { r: DetailedResult; n: number }) {
  const [open, setOpen] = useState(r.is_correct === false);
  const tone = r.is_correct === null ? "amber" : r.is_correct ? "green" : "amber";
  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 9, marginBottom: 10, backgroundColor: "#FFFFFF" }}>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`Question ${n}`} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12 }}>
        <TileIcon icon={r.is_correct ? "checkmark" : r.is_correct === null ? "time-outline" : "warning-outline"} tone={tone} size={30} />
        <Text style={{ flex: 1, fontSize: 13, color: colors.ink, fontWeight: "600" }}>{r.question}</Text>
        <Badge value={r.is_correct === null ? "Pending" : r.is_correct ? "Correct" : "Review"} tone={tone} />
      </Pressable>
      {open ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 6, borderTopWidth: 1, borderTopColor: colors.rowLine, paddingTop: 10 }}>
          {r.type === "mcq" ? (
            <View style={{ gap: 3 }}>
              {/* The letter on its own ("Your answer: B · Correct answer: A") made a
                  student open the quiz again to find out what they had picked. Show
                  the wording; fall back to the letter for attempts graded before the
                  text was stored. */}
              <Text style={{ fontSize: 12, color: colors.muted }}>Your answer: {r.selected_option_text ? `${r.selected_option} — ${r.selected_option_text}` : (r.selected_option ?? "—")}</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>Correct answer: {r.correct_option_text ? `${r.correct_option} — ${r.correct_option_text}` : (r.correct_option ?? "—")}</Text>
            </View>
          ) : <Text style={{ fontSize: 12, color: colors.muted }}>Your answer: {r.student_answer || "—"}</Text>}
          {r.explanation ? <Text style={{ fontSize: 13, lineHeight: 21, color: colors.text }}>{r.explanation}</Text> : null}
          {r.feedback ? <Text style={{ fontSize: 13, lineHeight: 21, color: colors.text }}>{r.feedback}</Text> : null}
          {r.missing_points?.length ? <Text style={{ fontSize: 12, color: colors.muted }}>Missing: {r.missing_points.join("; ")}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}
