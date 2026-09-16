import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Text, View } from "react-native";
import { admin } from "@/api/endpoints";
import type { MonitorIncident, MonitorSubjectHealth, MonitorUserImpact } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, CardHead, CellText, Column, DetailList, Dropdown, Empty, ErrorBanner, Grid, Input, Loading, Notice, PageHeading, PageTabs, Row, Screen, Stat, StatRow, Table, TableFooter, TableToolbar, colors, fmtDay, pct, RequestFailed } from "@/ui";
import { ISSUE_LABEL, SEVERITY_TONE, STATUS_TONE, sentence } from "@/screens/admin/monitor";

type Tab = "incidents" | "trends" | "impact";

export default function Monitoring() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("incidents");
  const [days, setDays] = useState("30");
  const [notice, setNotice] = useState<string | null>(null);
  const overview = useAsync(() => admin.monitorOverview(Number(days)), [days]);
  const backlog = useAction(async () => {
    const r = await admin.runBacklog(25);
    setNotice(`Evaluated ${r.evaluated} pending interaction${r.evaluated === 1 ? "" : "s"}; ${r.remaining} still pending.`);
    overview.reload();
  });
  const d = overview.data; const st = d?.status;
  return (
    <Screen refreshing={overview.loading} onRefresh={overview.reload}>
      <PageHeading eyebrow="CONTENT QUALITY & SAFETY" title="AI monitoring" subtitle="See what was flagged, understand the evidence, and make a decision."
        right={<Button title="Monitoring policies" variant="secondary" icon="options-outline" onPress={() => router.push("/admin/monitor-policies")} />} />
      <PageTabs<Tab> value={tab} onChange={setTab} tabs={[{ key: "incidents", label: "Incidents", count: d?.open_incidents ?? null }, { key: "trends", label: "Trends & coverage" }, { key: "impact", label: "Subjects & user impact" }]} />
      <ErrorBanner message={overview.error ?? backlog.error} onRetry={overview.reload} />
      {notice ? <Notice tone="success" message={notice} /> : null}
      {st && !st.enabled ? <Notice tone="warning" title="The AI monitor is switched off" message="Nothing is being evaluated (AI_MONITOR_ENABLED=false or AI_MONITOR_MODE=off)." /> : null}
      {st && st.enabled && !st.judge_ready ? <Notice tone="warning" title="Judge model unavailable" message={`${st.judge_detail}. Deterministic checks still run; ambiguous cases are recorded as “abstain” until a judge is ready.`} /> : null}
      {st?.pending_backlog ? <Notice title={`${st.pending_backlog} interaction${st.pending_backlog === 1 ? " is" : "s are"} waiting for evaluation.`} message="Evaluate a batch now, or let the background checker work through them."
        action={<Button title={`Evaluate ${Math.min(25, st.pending_backlog)}`} small variant="secondary" icon="play-outline" busy={backlog.busy} onPress={() => backlog.run()} />} /> : null}
      {tab === "incidents" ? (
        <StatRow>
        <Stat label="Open incidents" icon="alert-circle-outline" value={d?.open_incidents} helper={d ? `${d.incidents} in the last ${d.window_days} days` : null} />
        <Stat label="High severity" icon="flame-outline" value={d?.high_severity_incidents} helper={d?.high_severity_precision_percent == null ? "None reviewed yet" : `${pct(d.high_severity_precision_percent)} confirmed`} />
        <Stat label="Evaluation coverage" icon="checkmark-done-outline" value={d ? (d.coverage_percent == null ? "—" : pct(d.coverage_percent)) : null} helper={d ? `${d.evaluated} of ${d.interactions} interactions` : null} />
        <Stat label="Judge calls" icon="sparkles-outline" value={d?.judge_invocations} helper={st ? `Mode ${st.mode} · evaluator v${d?.evaluator_version}` : null} />
        </StatRow>
      ) : null}
      {tab === "incidents" ? <IncidentsTab /> : null}
      {tab === "trends" ? <TrendsTab days={days} setDays={setDays} overview={d} /> : null}
      {tab === "impact" ? <ImpactTab days={days} setDays={setDays} /> : null}
    </Screen>
  );
}

function IncidentsTab() {
  const router = useRouter();
  const [status, setStatus] = useState("active");
  const [severity, setSeverity] = useState("");
  const [issue, setIssue] = useState("");
  const [kind, setKind] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useAsync(() => admin.monitorIncidents({ status, severity, issue_type: issue, kind, page, page_size: 25 }), [status, severity, issue, kind, page]);
  const set = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };
  const rows = (q.data?.results ?? []).filter((i) => `${i.user?.full_name ?? ""} ${i.subject?.code ?? ""} ${i.evaluation.module_title ?? ""} ${ISSUE_LABEL[i.issue_type] ?? i.issue_type}`.toLowerCase().includes(search.trim().toLowerCase()));
  const columns: Column<MonitorIncident>[] = [
    { key: "f", label: "Finding", flex: 2.4, render: (i) => <CellText title={`${i.evaluation.interaction_kind === "quiz" ? "Generated quiz" : "Tutor response"}${i.evaluation.module_title ? ` · ${i.evaluation.module_title}` : ""}`} sub={[i.subject?.code, i.user?.full_name, `${Math.round(i.evaluation.confidence * 100)}% confidence`].filter(Boolean).join(" · ")} /> },
    { key: "s", label: "Severity", flex: 0.8, render: (i) => <Badge value={i.severity} tone={SEVERITY_TONE[i.severity]} /> },
    { key: "t", label: "Status", flex: 1.1, render: (i) => <Badge value={i.status} tone={STATUS_TONE[i.status] ?? "neutral"} /> },
    { key: "c", label: "Category", flex: 1.1, render: (i) => ISSUE_LABEL[i.issue_type] ?? sentence(i.issue_type) },
    { key: "r", label: "Raised", flex: 0.9, render: (i) => fmtDay(i.created_at) },
    { key: "x", label: "", flex: 1.1, render: (i) => <Button title={["confirmed", "false_positive", "closed"].includes(i.status) ? "View decision" : i.status === "open" ? "Review incident" : "Review"} small icon={i.status === "open" ? "arrow-forward" : undefined} variant={i.status === "open" || i.status === "escalated" ? "primary" : "secondary"} onPress={() => router.push(`/admin/incident/${i.id}`)} /> },
  ];
  return (
    <Card flush>
      <TableToolbar right={<>
        <Dropdown value={severity} onChange={set(setSeverity)} accessibilityLabel="Filter by severity" options={[{ value: "", label: "All severities" }, { value: "critical", label: "Critical" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} />
        <Dropdown value={status} onChange={set(setStatus)} accessibilityLabel="Filter by status" options={[{ value: "active", label: "Active incidents" }, { value: "", label: "All statuses" }, { value: "open", label: "Open" }, { value: "escalated", label: "Escalated" }, { value: "needs_investigation", label: "Needs investigation" }, { value: "confirmed", label: "Confirmed" }, { value: "false_positive", label: "False positive" }, { value: "closed", label: "Closed" }]} />
        <Dropdown value={issue} onChange={set(setIssue)} accessibilityLabel="Filter by category" options={[{ value: "", label: "All categories" }, ...Object.entries(ISSUE_LABEL).filter(([k]) => k !== "none").map(([value, l]) => ({ value, label: l }))]} />
        <Dropdown value={kind} onChange={set(setKind)} accessibilityLabel="Filter by source" options={[{ value: "", label: "Tutor and quizzes" }, { value: "tutor_answer", label: "Tutor answers" }, { value: "quiz", label: "Quizzes" }]} />
      </>}>
        <Input icon="search" compact placeholder="Search this list…" value={search} onChangeText={setSearch} accessibilityLabel="Search incidents" />
      </TableToolbar>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.error && !q.data ? <RequestFailed onRetry={q.reload} /> : q.loading && !q.data ? <Loading lines={2} /> : <Table footer={false} columns={columns} rows={rows} keyOf={(i) => i.id} onRowPress={(i) => router.push(`/admin/incident/${i.id}`)} minWidth={960} empty={<Empty icon="shield-checkmark-outline" title="Nothing to review" text="No incidents match these filters." />} />}
      {q.data && q.data.count > 0 ? (
        <TableFooter>
          <Text style={{ fontSize: 11, color: colors.muted }}>Showing {rows.length} of {q.data.count} incident{q.data.count === 1 ? "" : "s"} · page {page}</Text>
          <Row style={{ gap: 8 }}>
            <Button title="Previous" small variant="secondary" icon="chevron-back" disabled={page <= 1} onPress={() => setPage((p) => p - 1)} />
            <Button title="Next" small variant="secondary" icon="chevron-forward" disabled={!q.data.next} onPress={() => setPage((p) => p + 1)} />
          </Row>
        </TableFooter>
      ) : null}
    </Card>
  );
}

const DAY_OPTIONS = [{ value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" }];

function WindowSelect({ days, setDays }: { days: string; setDays: (v: string) => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <Text style={{ fontSize: 12, color: colors.text }}>Reporting window</Text>
      <Dropdown value={days} onChange={setDays} accessibilityLabel="Reporting window" options={DAY_OPTIONS} />
      <Text style={{ fontSize: 11, color: colors.muted }}>Metrics are illustrative of this window only.</Text>
    </View>
  );
}

function TrendsTab({ days, setDays, overview: d }: { days: string; setDays: (v: string) => void; overview: any }) {
  const trends = useAsync(() => admin.monitorTrends(Number(days)), [days]);
  const series = trends.data?.days ?? [];
  return (
    <>
      <WindowSelect days={days} setDays={setDays} />
      <StatRow>
        <Stat label="Interactions" icon="chatbubbles-outline" value={d?.interactions} />
        <Stat label="Evaluated" icon="checkmark-done-outline" value={d?.evaluated} helper={d?.coverage_percent == null ? null : `${pct(d.coverage_percent)} coverage`} />
        <Stat label="Confirmed precision" icon="ribbon-outline" value={d?.high_severity_precision_percent == null ? "—" : pct(d.high_severity_precision_percent)} helper="High-severity incidents confirmed" />
        <Stat label="False-positive rate" icon="thumbs-down-outline" value={d?.false_positive_rate_percent == null ? "—" : pct(d.false_positive_rate_percent)} helper={d ? `${d.feedback_count} reviewer labels` : null} />
      </StatRow>
      <Grid min={320} gap={20}>
        <Card>
          <CardHead title="Incidents over time" />
          {trends.error && !trends.data ? <RequestFailed onRetry={trends.reload} /> : trends.loading && !trends.data ? <Loading lines={1} /> : series.length === 0 ? <Empty icon="trending-up-outline" text="No incidents in this period." /> : (() => {
            const weeks: { label: string; total: number }[] = [];
            series.forEach((x, i) => { const w = Math.floor(i / 7); if (!weeks[w]) weeks[w] = { label: `Week ${w + 1}`, total: 0 }; weeks[w].total += x.total; });
            const top = Math.max(1, ...weeks.map((w) => w.total));
            return (
              <View style={{ flexDirection: "row", alignItems: "flex-end", height: 170, gap: 18, borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: 12 }} accessibilityLabel={`Incidents per week, highest ${top}`}>
                {weeks.map((w, i) => (
                  <View key={w.label} style={{ flex: 1, alignItems: "center", height: "100%", justifyContent: "flex-end", gap: 4 }}>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{w.total} incident{w.total === 1 ? "" : "s"}</Text>
                    <View style={{ width: "70%", height: `${Math.max(3, (w.total / top) * 78)}%`, backgroundColor: i === weeks.length - 1 ? "#588163" : "#BCD3B5", borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
                  </View>
                ))}
              </View>
            );
          })()}
          {series.length ? <View style={{ flexDirection: "row", gap: 18, paddingHorizontal: 12 }}>{Array.from({ length: Math.ceil(series.length / 7) }).map((_, i) => <Text key={i} style={{ flex: 1, textAlign: "center", fontSize: 11, color: colors.muted }}>Week {i + 1}</Text>)}</View> : null}
        </Card>
        <Card>
          <CardHead title="Evaluation outcomes" />
          {d ? <DetailList items={[["Evaluations passed", String(d.verdicts.pass ?? 0)], ["Issue verdicts", String(d.verdicts.issue ?? 0)], ["Abstained", String(d.verdicts.abstain ?? 0)], ["Failed evaluations", String(d.failed_evaluations)], ["Queued", String(d.queue_depth)]]} /> : <Loading lines={1} />}
        </Card>
      </Grid>
      <Card flush>
        <View style={{ padding: 23, paddingBottom: 12 }}><CardHead title="Model health" /></View>
        <Table columns={[
          { key: "m", label: "Application model", flex: 1.6, render: (m: any) => <CellText title={m.model} /> },
          { key: "e", label: "Evaluations", flex: 0.8, render: (m: any) => String(m.evaluated) },
          { key: "i", label: "Issue verdicts", flex: 0.8, render: (m: any) => `${m.issues} (${pct(m.issue_rate_percent)})` },
          { key: "h", label: "High-severity incidents", flex: 1, render: (m: any) => String(m.high_severity) },
        ]} rows={d?.models ?? []} keyOf={(m: any) => m.model} minWidth={600} empty={<Empty icon="hardware-chip-outline" text="No evaluations yet." />} />
      </Card>
    </>
  );
}

function ImpactTab({ days, setDays }: { days: string; setDays: (v: string) => void }) {
  const router = useRouter();
  const subjects = useAsync(() => admin.monitorSubjects(Number(days)), [days]);
  const users = useAsync(() => admin.monitorImpact(Number(days)), [days]);
  const subjectCols: Column<MonitorSubjectHealth>[] = [
    { key: "s", label: "Subject", flex: 1.8, render: (s) => <CellText title={s.name} sub={s.code} /> },
    { key: "e", label: "Evaluations", flex: 0.8, render: (s) => String(s.evaluated) },
    { key: "i", label: "Incidents", flex: 0.9, render: (s) => `${s.incidents} (${pct(s.incident_rate_percent)})` },
    { key: "c", label: "Common finding", flex: 1.4, render: (s) => (s.common_failures?.[0] ? `${ISSUE_LABEL[s.common_failures[0].issue_type] ?? s.common_failures[0].issue_type} · ${s.common_failures[0].count}` : "—") },
  ];
  const userCols: Column<MonitorUserImpact>[] = [
    { key: "u", label: "User", flex: 1.8, render: (u) => <CellText title={u.full_name} sub={u.email} /> },
    { key: "r", label: "Role", flex: 0.7, render: (u) => <Badge value={u.role} tone="blue" /> },
    { key: "i", label: "Incidents affecting this user", flex: 1.2, render: (u) => `${u.incidents} (${u.open} open)` },
    { key: "h", label: "High severity", flex: 0.8, render: (u) => String(u.high_severity) },
  ];
  return (
    <>
      <WindowSelect days={days} setDays={setDays} />
      <ErrorBanner message={subjects.error ?? users.error} />
      <Card flush>
        <View style={{ padding: 23, paddingBottom: 12 }}><CardHead title="Subject health" /></View>
        {subjects.error && !subjects.data ? <RequestFailed onRetry={subjects.reload} /> : subjects.loading && !subjects.data ? <Loading lines={1} /> : <Table columns={subjectCols} rows={subjects.data?.subjects ?? []} keyOf={(s) => s.subject_id} onRowPress={(s) => router.push(`/admin/subject/${s.subject_id}`)} minWidth={700} empty={<Empty icon="library-outline" text="No evaluated interactions in this period." />} />}
      </Card>
      <Card flush>
        <View style={{ padding: 23, paddingBottom: 12 }}><CardHead title="User impact" subtitle="An aggregate view. Open an incident only when the evidence is needed." /></View>
        {users.error && !users.data ? <RequestFailed onRetry={users.reload} /> : users.loading && !users.data ? <Loading lines={1} /> : <Table columns={userCols} rows={users.data?.users ?? []} keyOf={(u) => u.user_id} minWidth={700} empty={<Empty icon="people-outline" text="No users were affected by incidents in this period." />} />}
      </Card>
    </>
  );
}
