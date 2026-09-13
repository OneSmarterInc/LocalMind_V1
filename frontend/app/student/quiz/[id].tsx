import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { student } from "@/api/endpoints";
import type { StartAttempt } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { useAction, useAsync } from "@/hooks/useAsync";
import { useUnsavedWarning } from "@/hooks/useDraft";
import { clearLocalDraft, useLocalDraft } from "@/hooks/useLocalDraft";
import { registerGuard } from "@/hooks/unsavedGuard";
import { useOnline } from "@/offline/connectivity";
import { alertAsync, Badge, Button, Card, CardHead, DetailList, ErrorBanner, Eyebrow, FormFooter, Loading, Notice, OptionCard, PageHeading, ProgressBar, Screen, Split, StepList, colors, confirmAsync, fmtDate, pct } from "@/ui";

const releaseText = (r?: string, at?: string | null) => (r === "held" ? "After faculty release" : r === "scheduled" ? `From ${fmtDate(at)}` : "Shown after submission");

export default function StudentQuiz() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const online = useOnline();
  const info = useAsync(async () => (await student.quizzes()).find((q) => q.id === id) ?? null, [id]);
  const [attempt, setAttempt] = useState<StartAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const userId = useAuth().user?.id;
  const start = useAction(async () => { const a = await student.startAttempt(id); setAnswers({}); setAttempt(a); setIndex(0); setReviewing(false); });
  const answersRef = useRef(answers); answersRef.current = answers;
  // Answers are kept on this device per user and attempt, so a refresh or a resumed attempt restores them.
  const { restored, saving: draftSaving, flush: flushAnswers } = useLocalDraft([userId, "quiz", attempt?.attempt_id], answers, (saved) => setAnswers(saved));
  const restoredRef = useRef(restored); restoredRef.current = restored;
  useUnsavedWarning(!!attempt && Object.values(answers).some((v) => v?.trim()));
  // Leaving on purpose writes the latest answers to the device first, so the last one is not lost.
  useEffect(() => {
    if (!attempt || !Object.values(answers).some((v) => v?.trim())) return;
    return registerGuard({ label: "your quiz answers", save: async () => { await flushAnswers(); return true; }, discard: () => {} });
  }, [attempt, answers, flushAnswers]);

  const submit = useAction(async (force = false) => {
    if (!attempt) return;
    // Never submit before the answers saved on this device have been loaded: an empty set would be final.
    if (restoredRef.current === null) { await alertAsync("Still restoring your answers", "Your saved answers are being loaded. Try again in a moment."); return; }
    const current = answersRef.current;
    const blank = attempt.questions.filter((q) => !current[q.id]?.trim()).length;
    if (!force) {
      const ok = await confirmAsync("Submit your answers?", blank ? `${blank} question${blank === 1 ? " is" : "s are"} still blank. You cannot change answers after submitting.` : "You cannot change answers after submitting.", "Submit answers", "Keep working");
      if (!ok) return;
    }
    const res = await student.submitAttempt(attempt.attempt_id, current);
    await clearLocalDraft([userId, "quiz", attempt.attempt_id]);
    router.replace(`/student/attempt/${res.id}`);
  });
  const submitRef = useRef(submit.run); submitRef.current = submit.run;
  // The deadline never submits before the answers saved on this device are loaded: an attempt reopened after
  // its time ran out must submit what was answered, not an empty set.
  const draftLoaded = !!attempt && restored !== null;
  const draftLoadedRef = useRef(draftLoaded); draftLoadedRef.current = draftLoaded;
  const fired = useRef(false);
  useEffect(() => { fired.current = false; }, [attempt?.attempt_id]);
  useEffect(() => {
    if (!attempt?.time_limit_minutes) return;
    const end = new Date(attempt.started_at).getTime() + attempt.time_limit_minutes * 60000;
    const tick = () => {
      const left = Math.max(0, Math.round((end - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0 && !fired.current && draftLoadedRef.current) { fired.current = true; void submitRef.current(true); }
    };
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t);
  }, [attempt, draftLoaded]);

  const q = info.data;
  const ctx = useAsync(async () => {
    if (!q?.module_id) return null;
    const m = await student.module(q.module_id).catch(() => null);
    return m ? `${m.document_title ?? ""} · Module ${m.module_number ?? m.order}`.toUpperCase() : null;
  }, [q?.module_id]);
  const eyebrow = ctx.data ?? undefined;
  if (!attempt) {
    const used = q?.attempts_used ?? 0;
    const left = q?.max_attempts ? q.max_attempts - used : null;
    return (
      <Screen refreshing={info.loading} onRefresh={info.reload}>
        <ErrorBanner message={info.error} onRetry={info.reload} />
        {info.loading && !q ? <Loading /> : null}
        {!info.loading && !q && !info.error ? <Notice tone="warning" title="Quiz not available" message="This quiz is closed or not open to you any more." /> : null}
        {q ? (
          <>
            <PageHeading eyebrow={eyebrow} title={q.title} subtitle={q.instructions || "A short check of what you have learned."}
              right={q.module_id ? <Button title="Review the module" variant="secondary" icon="book-outline" onPress={() => router.push(`/student/module/${q.module_id}`)} /> : null} />
            <Split
              main={
                <Card>
                  <View style={{ flexDirection: "row" }}><Badge value={left === 0 ? "No attempts left" : used ? "Ready to try again" : "Ready to start"} tone={left === 0 ? "neutral" : "green"} /></View>
                  <CardHead title="Before you begin" subtitle={`Answer ${q.question_count ?? "the"} question${q.question_count === 1 ? "" : "s"} about this module.`} />
                  <View style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 14 }}>
                    <DetailList items={[
                      ["Questions", String(q.question_count ?? "—")],
                      ["Time limit", q.time_limit_minutes ? `${q.time_limit_minutes} minutes` : "No time limit"],
                      ["Pass mark", `${q.pass_percentage}%`],
                      ["Attempts", q.max_attempts ? `${q.max_attempts} allowed · ${used} used` : `Unlimited · ${used} used`],
                      ["Results", releaseText((q as { results_release?: string }).results_release, (q as { results_release_at?: string | null }).results_release_at)],
                      ...(q.due_at ? [["Due", fmtDate(q.due_at)] as [string, string]] : []),
                      ...(q.best_percentage != null ? [["Your best so far", pct(q.best_percentage)] as [string, string]] : (q.results_pending ?? 0) > 0 ? [["Your results", "Not released yet"] as [string, string]] : []),
                    ]} />
                  </View>
                  <StepList steps={[["Choose one answer for each question.", ""], ["You can move between questions before you submit.", ""], ["Review your answers before the final submission.", ""]]} />
                  <Notice tone={online ? "info" : "warning"} title={online ? "Stay connected." : "You are offline."} message={online ? "Starting and submitting a quiz need the LocalMind server. Reading offline is supported; offline quiz submission is not." : "Reconnect to start this quiz."} />
                  <ErrorBanner message={start.error} />
                  <FormFooter note={q.time_limit_minutes ? `The timer starts with the attempt. When the ${q.time_limit_minutes} minutes run out, your answers are submitted automatically.` : "Nothing is submitted until you confirm."}>
                    <Button title="Start quiz" icon="arrow-forward" onPress={() => start.run()} busy={start.busy} disabled={!online || left === 0} />
                  </FormFooter>
                </Card>
              }
              side={
                <Card>
                  <CardHead title="Not quite ready?" subtitle="Read the module or revisit the guided lesson first. Your attempt will not start until you select Start quiz." />
                  {q.module_id ? <Button title="Open the lesson" variant="secondary" icon="school-outline" full onPress={() => router.push({ pathname: "/student/module/[id]", params: { id: q.module_id!, tab: "lesson" } })} /> : null}
                </Card>
              }
            />
          </>
        ) : null}
      </Screen>
    );
  }

  const question = attempt.questions[index];
  if (reviewing) {
    const blank = attempt.questions.filter((x) => !answers[x.id]?.trim()).length;
    return (
      <Screen>
        <PageHeading eyebrow={eyebrow} title="Review your answers" subtitle={`${attempt.questions.length - blank} of ${attempt.questions.length} answered. Change anything before you submit.`} right={remaining !== null ? <Badge value={`${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")} left`} tone={remaining < 60 ? "red" : "blue"} /> : null} />
        {blank ? <Notice tone="warning" title={`${blank} question${blank === 1 ? " is" : "s are"} not answered.`} message="Unanswered questions score nothing. You can still go back and answer them." /> : null}
        <Card>
          {attempt.questions.map((x, i) => {
            const a = answers[x.id]?.trim();
            const shown = x.type === "mcq" ? (a ? `${a}. ${x.options?.find((o) => o.key === a)?.text ?? ""}` : "") : a;
            return (
              <View key={x.id} style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12, borderBottomWidth: i === attempt.questions.length - 1 ? 0 : 1, borderBottomColor: colors.rowLine }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{i + 1}. {x.question}</Text>
                  <Text style={{ fontSize: 12, color: shown ? colors.text : colors.danger }} numberOfLines={2}>{shown || "Not answered"}</Text>
                </View>
                <Button title="Change" small variant="secondary" onPress={() => { setIndex(i); setReviewing(false); }} accessibilityLabel={`Change answer ${i + 1}`} />
              </View>
            );
          })}
          <ErrorBanner message={submit.error} />
          <FormFooter note={remaining !== null ? "If the time runs out, your answers are submitted as they are." : "You cannot change answers after submitting."}>
            <Button title="Back to questions" variant="secondary" icon="arrow-back" onPress={() => setReviewing(false)} />
            <Button title="Submit answers" icon="checkmark" onPress={() => submit.run()} busy={submit.busy} disabled={restored === null} />
          </FormFooter>
        </Card>
      </Screen>
    );
  }
  const answered = attempt.questions.filter((x) => answers[x.id]?.trim()).length;
  const last = index === attempt.questions.length - 1;
  const total = attempt.questions.length;
  return (
    <Screen>
      <PageHeading eyebrow={eyebrow} title={q?.title ?? "Quiz"} subtitle="Focus on one question at a time." right={<Badge value={`Attempt ${attempt.attempt_number}${q?.max_attempts ? ` of ${q.max_attempts}` : ""}`} tone="blue" />} />
      {restored === null ? <Notice title="Restoring saved answers…" message="Your answers saved on this device are being loaded. Submitting waits until that is done." /> : null}
      {attempt.resumed && restored !== null ? <Notice title="Resuming your open attempt" message={restored ? "Your answers saved on this device were restored. Check them before you submit." : "No answers were saved on this device for this attempt, so check each question."} /> : null}
      <Split sideWidth={265}
        main={
          <Card style={{ padding: 30 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Eyebrow>{`QUESTION ${index + 1} OF ${total}`}</Eyebrow>
              <Text style={{ fontSize: 11, color: colors.muted }}>{answered} of {total} answered</Text>
            </View>
            <ProgressBar value={((index + 1) / total) * 100} />
            <Text style={{ fontSize: 18, fontWeight: "600", color: colors.ink, lineHeight: 26, marginTop: 10 }}>{question.question}</Text>
            <View style={{ gap: 10, marginTop: 14 }}>
              {question.type === "mcq" ? question.options?.map((o) => (
                <OptionCard key={o.key} title={o.text} selected={answers[question.id] === o.key} onPress={() => setAnswers((a) => ({ ...a, [question.id]: o.key }))}
                  right={undefined} letter={o.key} />
              )) : (
                <TextInput multiline value={answers[question.id] ?? ""} onChangeText={(v) => setAnswers((a) => ({ ...a, [question.id]: v }))} placeholder="Write your answer" placeholderTextColor={colors.faint} accessibilityLabel="Your answer"
                  style={{ minHeight: 160, borderWidth: 1, borderColor: "#D8E0D7", borderRadius: 7, padding: 12, fontSize: 13, color: colors.ink, textAlignVertical: "top", backgroundColor: "#FFFFFF" }} />
              )}
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginTop: 18, paddingTop: 18, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Button title="Previous" variant="secondary" icon="arrow-back" disabled={index === 0} onPress={() => setIndex((i) => Math.max(0, i - 1))} />
              <View style={{ flexDirection: "row", gap: 9 }}>
                {!last ? <Button title="Next question" icon="arrow-forward" onPress={() => setIndex((i) => i + 1)} /> : null}
                <Button title="Review & submit" variant={last ? "primary" : "secondary"} icon="checkmark" disabled={restored === null} onPress={() => setReviewing(true)} />
              </View>
            </View>
            <ErrorBanner message={submit.error} />
          </Card>
        }
        side={
          <>
            <Card>
              {remaining !== null ? (
                <>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>Time remaining</Text>
                    <Ionicons name="timer-outline" size={17} color={colors.muted} />
                  </View>
                  <Text style={{ fontSize: 29, fontWeight: "600", color: remaining < 60 ? colors.danger : colors.ink }}>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>Your answers are submitted automatically when the time runs out.</Text>
                  <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 6 }} />
                </>
              ) : null}
              <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>Questions</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
                {attempt.questions.map((x, i) => {
                  const on = i === index, done = !!answers[x.id]?.trim();
                  return (
                    <Pressable key={x.id} onPress={() => setIndex(i)} accessibilityRole="button" accessibilityLabel={`Question ${i + 1}${done ? ", answered" : ""}`}
                      style={{ width: 38, height: 38, borderRadius: 7, borderWidth: 1, alignItems: "center", justifyContent: "center", borderColor: on ? colors.primary : done ? "#A6C4A7" : colors.border, backgroundColor: on ? colors.pale : done ? "#DEEBDD" : "#FFFFFF" }}>
                      <Text style={{ fontSize: 12, color: on ? colors.primary : done ? "#30653F" : colors.muted }}>{i + 1}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={{ fontSize: 11, color: colors.muted }}>{draftSaving ? "Saving your answers on this device…" : "Filled squares have an answer. You can come back to any question."}</Text>
            </Card>
            <Notice title="You are in control." message={remaining !== null ? "Nothing is submitted until you confirm on the review screen, unless the time runs out first." : "Nothing is submitted until you confirm on the review screen."} />
          </>
        }
      />
    </Screen>
  );
}
