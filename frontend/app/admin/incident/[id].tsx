import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { Text, View } from "react-native";
import { admin } from "@/api/endpoints";
import type { ReviewAction } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, CardHead, DetailList, Dropdown, ErrorBanner, FormFooter, Input, Loading, Notice, PageHeading, Screen, Split, Table, colors, confirmAsync, fmtDate, fmtDay } from "@/ui";
import { ISSUE_LABEL, SEVERITY_TONE, STATUS_TONE, sentence } from "@/screens/admin/monitor";

const DECISIONS: { value: ReviewAction; title: string; text: string }[] = [
  { value: "confirm", title: "Confirm issue", text: "The finding is right. Recorded as a correct label." },
  { value: "false_positive", title: "Mark false positive", text: "The content is fine. A held automatic quiz is released." },
  { value: "needs_investigation", title: "Needs investigation", text: "Keep it open while someone checks further." },
  { value: "escalate", title: "Escalate", text: "Flag it as urgent for follow-up." },
  { value: "close", title: "Close", text: "No further action is needed." },
];


export default function IncidentReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const q = useAsync(() => admin.monitorIncident(id), [id]);
  const [decision, setDecision] = useState<ReviewAction>("confirm");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const i = q.data; const e = i?.evaluation; const judge = e?.judge_json ?? {};
  const resolved = !!i && ["confirmed", "false_positive", "closed"].includes(i.status);
  const review = useAction(async (action: ReviewAction) => {
    if ((action === "close" || action === "false_positive") && !(await confirmAsync(action === "close" ? "Close this incident?" : "Mark as false positive?", action === "close" ? "Closing records that no further action is needed." : "This tells the monitor its verdict was wrong and lowers the reported precision for this issue type.", "Save review", "Cancel"))) return;
    q.setData(await admin.reviewIncident(id, action, note.trim()));
    setNote(""); setSaved(action === "reopen" ? "Incident reopened." : "Review saved.");
  });
  const assign = useAction(async (to: string | null) => { q.setData(await admin.assignIncident(id, to)); });
  const rerun = useAction(async () => { if (e) { await admin.reevaluate(e.id); await q.reload(); } });
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !i ? <Loading /> : null}
      {i && e ? (
        <>
          <PageHeading eyebrow="AI MONITORING" title={`Review ${ISSUE_LABEL[i.issue_type]?.toLowerCase() ?? "an issue"} in a ${e.interaction_kind === "quiz" ? "generated quiz" : "tutor answer"}`}
            subtitle={[`Incident ${i.id.slice(0, 8).toUpperCase()}`, i.subject ? i.subject.code : null, e.module_title || null, i.user ? `${i.user.full_name} (${i.user.role})` : null].filter(Boolean).join(" · ")}
            right={<Button title="Back to incidents" variant="secondary" icon="arrow-back" onPress={() => router.push("/admin/monitoring")} />} />
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Badge value={`${i.severity} severity`} tone={SEVERITY_TONE[i.severity]} />
            <Badge value={i.status} tone={STATUS_TONE[i.status] ?? "neutral"} />
            <Badge value={`Raised ${fmtDay(i.created_at)}`} tone="neutral" />
            <Badge value={`Evaluator v${e.evaluator_version}`} tone="neutral" />
            {i.recurrence ? <Badge value={`Seen ${i.recurrence} times`} tone="amber" /> : null}
          </View>
          <Notice title="A finding is a reason to review—not a final judgment." message="Check the generated content against the evidence. Your decision is recorded as a label for the monitor and in the audit log; no student is penalised." />
          {saved ? <Notice tone="success" message={saved} /> : null}
          <Split sideWidth={340}
            main={
              <>
                <Card>
                  <CardHead title="What was generated" />
                  <View style={{ borderWidth: 1, borderColor: "#DDE8D8", backgroundColor: "#F3F6EE", borderRadius: 10, padding: 16, gap: 6 }}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: colors.ink }}>{e.interaction_kind === "quiz" ? "Request" : "Question"}</Text>
                    <Text style={{ fontSize: 13, lineHeight: 21, color: colors.text }}>{e.prompt_excerpt || "(none recorded)"}</Text>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: colors.ink, marginTop: 8 }}>{e.interaction_kind === "quiz" ? "Generated quiz" : "Generated answer"}</Text>
                    <Text style={{ fontSize: 13, lineHeight: 21, color: colors.text }} selectable>{e.response_excerpt}</Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    <Badge value={`Generator: ${e.app_model_name || "local model"}`} tone="neutral" />
                    <Badge value={`Confidence: ${e.confidence.toFixed(2)}`} tone="neutral" />
                  </View>
                </Card>
                <Card>
                  <CardHead title="Source evidence" subtitle={e.reason} />
                  {e.evidence_json.length === 0 ? <Text style={{ fontSize: 12, color: colors.muted }}>No reference passages were available for this interaction.</Text> : e.evidence_json.map((p, n) => (
                    <View key={n} style={{ borderLeftWidth: 3, borderLeftColor: "#73996F", backgroundColor: "#F3F6EE", paddingHorizontal: 16, paddingVertical: 12, gap: 4 }}>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted }}>{p.ref}{p.truncated ? " (truncated)" : ""}</Text>
                      <Text style={{ fontSize: 13, lineHeight: 21, color: colors.text }}>{p.text}</Text>
                    </View>
                  ))}
                  <Text style={{ fontSize: 12, color: colors.muted }}>Recommended action: {sentence(e.recommended_action)}</Text>
                  {e.interaction_kind === "quiz" && e.interaction_id ? <View style={{ flexDirection: "row" }}><Button title="Open the affected quiz" variant="ghost" icon="arrow-forward" onPress={() => router.push(`/manage/quiz/${e.interaction_id}`)} /></View> : null}
                </Card>
                <Card>
                  <CardHead title="Evaluator details" subtitle={e.judge_invoked ? `Checks plus judge model (${e.judge_model || "shared model"}${e.judge_latency_ms ? `, ${e.judge_latency_ms} ms` : ""})` : "Deterministic checks were decisive; the judge was not consulted."} />
                  <Table noun="check" minWidth={420} keyOf={(r) => r.name} columns={[
                    { key: "c", label: "Check", flex: 1.4, render: (r: { name: string; outcome: React.ReactNode }) => sentence(r.name) },
                    { key: "o", label: "Outcome", flex: 1.6, render: (r: { name: string; outcome: React.ReactNode }) => r.outcome },
                  ]} rows={[
                    ...e.validators_json.map((v) => ({ name: v.name, outcome: (<View style={{ gap: 4 }}><View style={{ flexDirection: "row" }}><Badge value={v.passed === true ? "Passed" : v.passed === false ? "Flagged" : "Undecided"} tone={v.passed === true ? "green" : v.passed === false ? "amber" : "neutral"} /></View>{v.passed === false && v.detail ? <Text style={{ fontSize: 11, color: colors.muted }}>{v.detail}</Text> : null}</View>) as React.ReactNode })),
                    ...(e.judge_invoked ? [{ name: "judge_evaluation", outcome: (judge.reason ? `${judge.is_issue ? ISSUE_LABEL[judge.issue_type ?? "other"] : "No issue"}: ${judge.reason}` : `Failed: ${e.judge_error || "unknown error"}`) as React.ReactNode }] : []),
                  ]} />
                  <View style={{ flexDirection: "row" }}><Button title="Re-evaluate with judge" variant="ghost" icon="sparkles-outline" onPress={() => rerun.run()} busy={rerun.busy} /></View>
                  <ErrorBanner message={rerun.error} />
                </Card>
              </>
            }
            side={
              <>
                <Card>
                  <CardHead title="Your decision" />
                  {resolved ? (
                    <>
                      <Text style={{ fontSize: 12, color: colors.text }}>This incident is {sentence(i.status).toLowerCase()}{i.resolved_by ? ` by ${i.resolved_by.full_name}` : ""}{i.resolved_at ? ` on ${fmtDay(i.resolved_at)}` : ""}.</Text>
                      {i.reviewer_note ? <Notice message={`Review note: ${i.reviewer_note}`} /> : null}
                      <Input label="Note (optional)" multiline value={note} onChangeText={setNote} placeholder="Why it is being reopened" style={{ minHeight: 80 }} />
                      <Button title="Reopen incident" variant="secondary" icon="refresh" full onPress={() => review.run("reopen")} busy={review.busy} />
                    </>
                  ) : (
                    <>
                      <Dropdown label="Decision" value={decision} onChange={(v) => setDecision(v as ReviewAction)} width="100%"
                        options={DECISIONS.filter((x) => !(x.value === "needs_investigation" && i.status === "needs_investigation") && !(x.value === "escalate" && i.status === "escalated")).map((x) => ({ value: x.value, label: x.title }))} />
                      <Text style={{ fontSize: 11, color: colors.muted }}>{DECISIONS.find((x) => x.value === decision)?.text}</Text>
                      <Input label="Review note" required multiline value={note} onChangeText={setNote} placeholder="What you checked and what you found" style={{ minHeight: 90 }} />
                      <FormFooter><Button title="Save review" icon="checkmark" onPress={() => review.run(decision)} busy={review.busy} disabled={!note.trim()} /></FormFooter>
                    </>
                  )}
                  <ErrorBanner message={review.error} />
                </Card>
                <Card>
                  <CardHead title="Review ownership" />
                  <DetailList items={[["Assigned to", i.assigned_to?.full_name ?? "Unassigned"]]} />
                  {i.assigned_to?.id === user?.id
                    ? <Button title="Unassign me" variant="secondary" full onPress={() => assign.run(null)} busy={assign.busy} />
                    : <Button title="Assign to me" variant="secondary" icon="person-outline" full onPress={() => assign.run(user?.id ?? null)} busy={assign.busy} />}
                  <ErrorBanner message={assign.error} />
                </Card>
                {e.feedback.length ? (
                  <Card>
                    <CardHead title="Review history" />
                    {e.feedback.map((f) => (
                      <View key={f.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.rowLine, gap: 2 }}>
                        <Text style={{ fontSize: 12, fontWeight: "600", color: colors.ink }}>{sentence(f.label)}</Text>
                        <Text style={{ fontSize: 11, color: colors.muted }}>{f.reviewer?.full_name ?? "Unknown"} · {fmtDate(f.created_at)}</Text>
                        {f.note ? <Text style={{ fontSize: 12, color: colors.text }}>{f.note}</Text> : null}
                      </View>
                    ))}
                  </Card>
                ) : null}
              </>
            }
          />
        </>
      ) : null}
    </Screen>
  );
}
