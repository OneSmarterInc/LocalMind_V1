import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { student } from "@/api/endpoints";
import { useAuth } from "@/auth/AuthContext";
import { useAction, useAsync } from "@/hooks/useAsync";
import { useUnsavedWarning } from "@/hooks/useDraft";
import { useLocalDraft } from "@/hooks/useLocalDraft";
import { registerGuard, confirmLeave } from "@/hooks/unsavedGuard";
import { useOnline } from "@/offline/connectivity";
import { Badge, Button, Card, CardHead, DetailList, ErrorBanner, FormFooter, Input, Loading, Notice, PageHeading, Screen, Split, colors, confirmAsync, fmtDate } from "@/ui";

export default function StudentAssignment() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <StudentAssignmentEditor key={id} id={id} />;
}
function StudentAssignmentEditor({ id }: { id: string }) {
  const router = useRouter();
  const online = useOnline();
  const q = useAsync(async () => (await student.assignments()).find((a) => a.id === id) ?? null, [id]);
  const subjects = useAsync(() => student.subjects(), []);
  const [content, setContent] = useState("");
  const [rewriting, setRewriting] = useState(false);
  const userId = useAuth().user?.id;
  // The response being written is kept on this device until it is submitted.
  const { restored, saving: draftSaving, flush, discard: discardDraft, error: draftError } = useLocalDraft([userId, "assignment", id], content, (saved) => { if (typeof saved === "string" && saved.trim()) { setContent(saved); setRewriting(true); } });
  useUnsavedWarning(!!content.trim());
  // The response being written is stored on the device; leaving on purpose writes the last keystroke first.
  useEffect(() => {
    if (!content.trim()) return;
    return registerGuard({ label: "your assignment response", save: flush, discard: async () => { await discardDraft(); setContent(""); setRewriting(false); } });
  }, [content, flush, discardDraft]);
  const started = useRef(Date.now());
  useEffect(() => { started.current = Date.now(); }, [id]);
  const submit = useAction(async () => {
    const ok = await confirmAsync("Submit your response?", "Check your response before submitting. Your faculty sees exactly what you send.", "Submit", "Keep editing");
    if (!ok) return;
    await student.submitAssignment(id, content.trim(), Math.round((Date.now() - started.current) / 1000));
    await discardDraft();
    setContent(""); setRewriting(false); await q.reload();
  });
  const a = q.data; const sub = a?.my_submission;
  const subject = subjects.data?.find((s) => s.id === a?.subject_id);
  const pastDue = !!a?.due_at && new Date(a.due_at) < new Date();
  const used = sub?.attempt_number ?? 0;
  const limitReached = !!a && !!sub && (!a.allow_resubmission || (!!a.max_attempts && used >= a.max_attempts));
  const canSubmit = !!a && a.status === "published" && !limitReached && (a.allow_late || !pastDue);
  const release = a?.results_release === "held" ? "After faculty release" : a?.results_release === "scheduled" ? `From ${fmtDate(a.results_release_at)}` : "When marked";

  if (q.loading && !a) return <Screen><Loading /></Screen>;
  if (!a) return <Screen><ErrorBanner message={q.error ?? "This assignment is not available."} onRetry={q.reload} /></Screen>;

  const details = (
    <>
      <Card>
        <CardHead title="Assignment details" />
        <DetailList items={[
          ["Due date", a.due_at ? fmtDate(a.due_at) : "No due date"],
          ["Maximum score", `${a.max_score} points`],
          ["Attempts", !a.allow_resubmission ? "1 allowed" : a.max_attempts ? `${a.max_attempts} allowed` : "Unlimited"],
          ["Late submissions", a.allow_late ? "Accepted" : "Not accepted"],
          ["Results", release],
        ]} />
      </Card>
      {a.rubric.length ? (
        <Card>
          <CardHead title="How it will be assessed" />
          <DetailList items={a.rubric.map((r) => [r.criterion, `${r.points} point${r.points === 1 ? "" : "s"}`] as [string, string])} />
        </Card>
      ) : null}
    </>
  );

  if (sub && !rewriting) {
    const marked = sub.status === "evaluated";
    return (
      <Screen refreshing={q.loading} onRefresh={q.reload}>
        <PageHeading eyebrow={marked ? "ASSIGNMENT MARKED" : "ASSIGNMENT SUBMITTED"} title={marked ? "Your submission is marked." : "Your submission is received."} subtitle={`${a.title}${subject ? ` · ${subject.code}` : ""}`}
          right={<Button title="Back to assignments" variant="secondary" icon="arrow-back" onPress={() => router.push("/student/assignments")} />} />
        {marked ? null : <Notice tone="success" title="No further action needed." message="Your response is saved. Your score and feedback will appear when your faculty releases the results." />}
        <Card>
          <DetailList items={[
            ["Status", <Badge key="s" value={marked ? "Marked" : "Submitted"} tone={marked ? "green" : "blue"} />],
            ["Submitted", `${fmtDate(sub.submitted_at)}${sub.is_late ? " · late" : ""}`],
            ["Results", <Badge key="r" value={marked ? `Released · ${sub.score} of ${a.max_score}` : "Not yet released"} tone={marked ? "green" : "amber"} />],
          ]} />
        </Card>
        {marked ? (
          <Card>
            <CardHead title={`Score: ${sub.score} of ${a.max_score}`} subtitle={sub.evaluated_at ? `Marked ${fmtDate(sub.evaluated_at)}` : null} />
            {sub.rubric_scores?.length ? <DetailList items={sub.rubric_scores.map((r) => [r.criterion, `${r.points}`] as [string, string])} /> : null}
            {sub.feedback ? <Text style={{ fontSize: 14, lineHeight: 24, color: colors.text }}>{sub.feedback}</Text> : null}
          </Card>
        ) : null}
        <Card>
          <CardHead title="Your response" />
          <Text style={{ fontSize: 14, lineHeight: 25, color: colors.text }} selectable>{sub.content}</Text>
          {canSubmit ? <FormFooter note={a.max_attempts ? `Submission ${used} of ${a.max_attempts}. You can submit ${a.max_attempts - used} more time${a.max_attempts - used === 1 ? "" : "s"}.` : "Resubmission is allowed for this assignment."}><Button title="Write a new version" variant="secondary" icon="create-outline" onPress={() => { setContent((c) => c || sub.content); setRewriting(true); }} /></FormFooter> : null}
          {a.allow_resubmission && limitReached ? <Notice title={`You have used all ${a.max_attempts} submissions.`} message="No further versions can be submitted for this assignment." /> : null}
        </Card>
      </Screen>
    );
  }

  const instructionLines = (a.instructions || "").split(/\n+/).map((x) => x.replace(/^[-•*\d.)\s]+/, "").trim()).filter(Boolean);
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <PageHeading eyebrow="MY ASSIGNMENTS" title={a.title} subtitle={subject ? [`${subject.code} · ${subject.name}`, subject.faculty_names?.join(", ")].filter(Boolean).join(" · ") : undefined} right={<Badge value={pastDue && !a.allow_late ? "Closed" : "Not submitted"} tone={pastDue && !a.allow_late ? "neutral" : "amber"} />} />
      <Split
        main={
          <>
            <Card>
              <CardHead title="Your task" />
              <Text style={{ fontSize: 17, fontWeight: "600", color: colors.ink }}>What you will do</Text>
              {a.description ? <Text style={{ fontSize: 14, lineHeight: 25, color: colors.text }}>{a.description}</Text> : null}
              {instructionLines.length ? (
                <View style={{ gap: 6, marginTop: 6 }}>
                  <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>Include these points</Text>
                  {instructionLines.map((line, i) => <Text key={i} style={{ fontSize: 14, lineHeight: 24, color: colors.text }}>{i + 1}. {line}</Text>)}
                </View>
              ) : null}
            </Card>
            <Card>
              <CardHead title="Write your response" />
              {canSubmit ? (
                <>
                  <Input label="Your response" required editable={restored !== null && !submit.busy} multiline value={content} onChangeText={setContent} style={{ minHeight: 220 }}
                    hint="Write your response here. You can review it before confirming submission." />
                  <ErrorBanner message={submit.error ?? draftError} />
                  <FormFooter note={restored === null ? "Restoring your saved response…" : draftSaving ? "Saving your response on this device…" : online ? "A connection is required to submit. Your response is kept on this device as you write." : "You are offline. Keep this page open and submit when you are back online."}>
                    {rewriting ? <Button title="Cancel" variant="secondary" onPress={() => { void confirmLeave().then(ok => { if (ok) setRewriting(false); }); }} /> : null}
                    <Button title="Review submission" icon="arrow-forward" onPress={() => submit.run()} busy={submit.busy} disabled={!content.trim() || !online || restored === null} />
                  </FormFooter>
                </>
              ) : <Notice tone="warning" title="Submissions are closed" message={a.status !== "published" ? "This assignment is closed." : "The due date has passed and late submissions are not accepted."} />}
            </Card>
          </>
        }
        side={details}
      />
    </Screen>
  );
}
