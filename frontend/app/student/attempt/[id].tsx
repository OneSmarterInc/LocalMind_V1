import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { student } from "@/api/endpoints";
import type { DetailedResult } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, CardHead, DetailList, Empty, ErrorBanner, Loading, Notice, PageHeading, ScoreRing, Screen, Split, TileIcon, colors, fmtDate, fmtSeconds, pct } from "@/ui";

type Remediation = { overview: string; items: { question: string; explanation: string; source_reference?: string }[] };

export default function StudentAttempt() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const q = useAsync(() => student.attempt(id), [id]);
  const quizzes = useAsync(() => student.quizzes(), []);
  const [rem, setRem] = useState<Remediation | null>(null);
  const remediate = useAction(async () => { setRem(await student.remediation(id)); });
  const a = q.data;
  useEffect(() => { if (a?.status !== "submitted" && a?.status !== "pending_evaluation") return; const t=setInterval(q.reload,5000); return()=>clearInterval(t); },[a?.status,q.reload]);
  const quiz = a ? quizzes.data?.find((x) => x.id === a.assessment_id) : undefined;
  const held = !!a && (a as unknown as { results_released?: boolean }).results_released === false;
  const left = quiz?.max_attempts ? quiz.max_attempts - (quiz.attempts_used ?? 0) : null;
  const wrong = a?.detailed_results?.filter((r) => r.is_correct === false).length ?? 0;
  const correct = a?.detailed_results?.filter((r) => r.is_correct === true).length ?? 0;
  const title = a?.assessment_title ?? quiz?.title ?? "Quiz";
  const ctx = useAsync(async () => (quiz?.module_id ? student.module(quiz.module_id).catch(() => null) : null), [quiz?.module_id]);
  const book = ctx.data ? `${ctx.data.document_title ?? ""} · Module ${ctx.data.module_number ?? ctx.data.order}` : null;
  const bookId = ctx.data?.document_id;

  if (q.loading && !a) return <Screen><Loading /></Screen>;
  if (!a) return <Screen><ErrorBanner message={q.error} onRetry={q.reload} /></Screen>;

  if (a.sync_status && a.sync_status !== 'synced') {
    return <Screen><PageHeading title={a.sync_status==='conflict'?'Synchronization needs review':'Saved on this device'} subtitle={title}/><Notice tone={a.sync_status==='conflict'?'warning':'info'} message={a.sync_error||'Your institution has not yet confirmed this attempt. Answers are retained locally and will synchronize when the server is reachable.'}/>{a.results_released?<Card><CardHead title={`Local result: ${a.percentage}% · ${a.passed?'Passed':'Needs review'}`}/>{a.detailed_results.map(r=><Text key={r.question_id}>{r.question}: {r.is_correct?'Correct':'Incorrect'} — {r.explanation}</Text>)}</Card>:<Notice message="Your faculty has withheld results. No score or answer key is shown on this device."/>}<Button title="Check synchronization" onPress={q.reload}/><Button title="Course sync status" onPress={()=>router.push('/student/offline')}/><Button title="Back to quizzes" onPress={()=>router.push('/student/quizzes')}/></Screen>;
  }
  if (a.status === "submitted" && !held) {
    return <Screen><PageHeading title="Your answers are saved" subtitle={title}/><Notice title="Evaluation is pending" message="Your response is safely stored. The local evaluation worker will process it, and faculty release rules still apply. No zero or pass has been assigned. If this remains pending, ask faculty to check the saved job."/><Button title="Check evaluation status" onPress={q.reload}/><Button title="Back to quizzes" variant="secondary" onPress={()=>router.push("/student/quizzes")}/></Screen>;
  }

  if (held) {
    return (
      <Screen refreshing={q.loading} onRefresh={q.reload}>
        <PageHeading eyebrow="SUBMISSION CONFIRMED" title="Your answers are submitted." subtitle={title} right={<Button title="Back to quizzes" variant="secondary" icon="arrow-back" onPress={() => router.push("/student/quizzes")} />} />
        <Card>
          <Empty icon="time-outline" title="Your faculty will release the results." text="Your attempt has been received. Your score, correct answers, and feedback are hidden until results are released."
            action={<Badge value="Submitted · results not released" tone="amber" />} />
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16 }}>
            <DetailList items={[
              ["Attempt", `${a.attempt_number}${quiz?.max_attempts ? ` of ${quiz.max_attempts}` : ""}`],
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
        right={bookId ? <Button title="Back to book" variant="secondary" icon="arrow-back" onPress={() => router.push(`/student/document/${bookId}`)} /> : null} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 30, padding: 28, borderWidth: 1, borderColor: "#D7E4D1", backgroundColor: "#F0F6EB", borderRadius: 13, flexWrap: "wrap" }}>
        <ScoreRing value={pct(a.percentage)} caption="YOUR SCORE" />
        <View style={{ flex: 1, minWidth: 220, gap: 8 }}>
          <Badge value={pending ? "Being marked" : passed ? "Passed" : "Not passed"} tone={pending ? "amber" : passed ? "green" : "red"} />
          <Text style={{ fontSize: 24, fontWeight: "600", color: colors.ink }}>{pending ? "Some answers are still being marked." : passed ? "You’ve got the essentials." : "Not quite yet. You are close."}</Text>
          <Text style={{ fontSize: 13, color: colors.muted }}>{correct} of {a.total_questions} correct{quiz ? ` · Pass mark ${quiz.pass_percentage}%` : ""} · Attempt {a.attempt_number}{quiz?.max_attempts ? ` of ${quiz.max_attempts}` : ""}</Text>
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
            {wrong > 0 && a.status === "evaluated" ? (
              <Card>
                <CardHead title="Make the next attempt easier" subtitle="Get help with the idea behind the questions you missed." />
                {rem ? (
                  <View style={{ gap: 10 }}>
                    <Text style={{ fontSize: 14, lineHeight: 24, color: colors.text }}>{rem.overview}</Text>
                    {rem.items?.map((it, i) => (
                      <View key={i} style={{ gap: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.rowLine }}>
                        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{it.question}</Text>
                        <Text style={{ fontSize: 13, lineHeight: 22, color: colors.text }}>{it.explanation}</Text>
                        {it.source_reference ? <Text style={{ fontSize: 11, color: colors.muted }}>From the module: {it.source_reference}</Text> : null}
                      </View>
                    ))}
                  </View>
                ) : <View style={{ flexDirection: "row" }}><Button title="Explain what I missed" icon="sparkles-outline" onPress={() => remediate.run()} busy={remediate.busy} /></View>}
                <ErrorBanner message={remediate.error} />
              </Card>
            ) : null}
          </>
        }
        side={
          <Card>
            <CardHead title="Attempt details" />
            <DetailList items={[
              ["Questions answered", `${a.detailed_results.filter((r) => (r.selected_option || r.student_answer || "").trim()).length} of ${a.total_questions}`],
              ["Time taken", fmtSeconds(a.time_taken_seconds)],
              ["Attempts remaining", left == null ? "Unlimited" : String(Math.max(0, left))],
              ["Result visibility", "Released"],
            ]} />
            {quiz?.module_id ? <Button title="Review the module" variant="secondary" icon="book-outline" full onPress={() => router.push(`/student/module/${quiz.module_id}`)} /> : null}
            {quiz && (left == null || left > 0) ? <Button title="Try again" variant="secondary" icon="refresh" full onPress={() => router.push(`/student/quiz/${quiz.id}`)} /> : null}
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
          {r.type === "mcq" ? <Text style={{ fontSize: 12, color: colors.muted }}>Your answer: {r.selected_option ?? "—"} · Correct answer: {r.correct_option ?? "—"}</Text> : <Text style={{ fontSize: 12, color: colors.muted }}>Your answer: {r.student_answer || "—"}</Text>}
          {r.explanation ? <Text style={{ fontSize: 13, lineHeight: 21, color: colors.text }}>{r.explanation}</Text> : null}
          {r.feedback ? <Text style={{ fontSize: 13, lineHeight: 21, color: colors.text }}>{r.feedback}</Text> : null}
          {r.missing_points?.length ? <Text style={{ fontSize: 12, color: colors.muted }}>Missing: {r.missing_points.join("; ")}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}
