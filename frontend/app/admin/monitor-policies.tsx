import { useDraft } from "@/hooks/useDraft";
import { useBackTo } from "@/hooks/useBackTo";
import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { admin } from "@/api/endpoints";
import type { MonitorPolicy, MonitorSeverity } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Button, Card, CardHead, Dropdown, ErrorBanner, Input, Loading, Notice, PageHeading, Screen, colors, RequestFailed } from "@/ui";
import { ISSUE_LABEL } from "@/screens/admin/monitor";

const SEVERITIES: { value: MonitorSeverity; label: string }[] = [{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }, { value: "critical", label: "Critical" }];
type Draft = { enabled: boolean; conf: string; sev: MonitorSeverity };
const toDraft = (p: MonitorPolicy): Draft => ({ enabled: p.enabled, conf: String(Math.round(p.min_confidence * 100)), sev: p.min_severity });

const GROUPS = [
  { title: "Facts and sources", subtitle: "Answers and lessons must match the book.", types: ["factual_error", "hallucination", "unsupported_claim"] },
  { title: "Quizzes", subtitle: "Questions and answer keys.", types: ["quiz_error"] },
  { title: "Safety and relevance", subtitle: "Harmful or off-topic output.", types: ["safety", "irrelevant"] },
  { title: "Format and other", subtitle: "Broken output and anything else.", types: ["instruction_violation", "other"], rest: true },
];
const GROUPED = new Set(GROUPS.flatMap((g) => g.types));

/** On/off switch with the same colours as the rest of the portal. */
function Switch({ on, onPress, label }: { on: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: on }} hitSlop={8}
      style={{ width: 40, height: 22, borderRadius: 11, padding: 3, backgroundColor: on ? colors.primary : "#C9D3CB", justifyContent: "center" }}>
      <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: "#FFFFFF", alignSelf: on ? "flex-end" : "flex-start" }} />
    </Pressable>
  );
}


export default function MonitorPolicies() {
  const back = useBackTo();
  const q = useAsync(() => admin.monitorPolicies(), []);
  const source = useMemo(() => q.data ? { id: "monitor-policies", values: Object.fromEntries(q.data.map(p => [p.issue_type, toDraft(p)])) } : null, [q.data]);
  const { draft, edit, dirty, discard, markSaved } = useDraft(source, { label: () => "monitoring policies", save: async () => (await save.run()) === true });
  const drafts: Record<string, Draft> = draft?.values ?? {};
  const setDrafts = (fn: (previous: Record<string, Draft>) => Record<string, Draft>) => edit(d => ({ ...d, values: fn(d.values) }));
  const [saved, setSaved] = useState(false);
  const policies = q.data ?? [];
  const invalid = (d: Draft) => d.conf.trim() === "" || Number.isNaN(Number(d.conf)) || Number(d.conf) < 0 || Number(d.conf) > 100;
  const changed = policies.filter((p) => { const d = drafts[p.issue_type]; return d && (d.enabled !== p.enabled || d.sev !== p.min_severity || Number(d.conf) !== Math.round(p.min_confidence * 100)); });
  const anyInvalid = policies.some((p) => drafts[p.issue_type] && invalid(drafts[p.issue_type]));
  const set = (type: string, patch: Partial<Draft>) => { setSaved(false); setDrafts((x) => ({ ...x, [type]: { ...x[type], ...patch } })); };
  const save = useAction(async () => {
    if (!draft || anyInvalid) return false;
    const sent = draft;
    for (const p of changed) {
      const d = drafts[p.issue_type];
      await admin.updatePolicy(p.issue_type, { enabled: d.enabled, min_confidence: Number(d.conf) / 100, min_severity: d.sev });
    }
    markSaved(sent); await q.reload(); setSaved(true); return true;
  });
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <PageHeading eyebrow="ADMINISTRATOR CONTROLS" title="Monitoring policies" subtitle="Decide which findings create incidents for human review."
        right={<Button title="Back to monitoring" variant="secondary" icon="arrow-back" onPress={() => back("/admin/monitoring")} />} />
      <Notice title="These settings decide which findings become incidents" message="They never change grades. A higher confidence means fewer incidents, but more issues go unreviewed." />
      <ErrorBanner message={q.error ?? save.error} onRetry={q.reload} />
      {q.error && !q.data ? <RequestFailed onRetry={q.reload} /> : q.loading && !q.data ? <Loading /> : null}
      {q.data ? (
        <>
          {GROUPS.map((g) => {
            const items = policies.filter((p) => g.types.includes(p.issue_type) || (g.rest && !GROUPED.has(p.issue_type)));
            if (!items.length) return null;
            return (
              <Card key={g.title}>
                <CardHead title={g.title} subtitle={g.subtitle} />
                {items.map((p) => {
                  const d = drafts[p.issue_type]; if (!d) return null;
                  const name = ISSUE_LABEL[p.issue_type] ?? p.issue_type;
                  const sev = SEVERITIES.find((x) => x.value === d.sev)?.label?.toLowerCase() ?? d.sev;
                  return (
                    <View key={p.id} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.rowLine }}>
                      <Switch on={d.enabled} onPress={() => set(p.issue_type, { enabled: !d.enabled })} label={`Create incidents for ${name}`} />
                      <View style={{ flex: 1, minWidth: 240 }}>
                        <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>{name}</Text>
                        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{p.description}</Text>
                        <Text style={{ fontSize: 12, color: d.enabled ? colors.text : colors.faint, marginTop: 4 }}>
                          {d.enabled ? `Creates an incident when the monitor is at least ${invalid(d) ? "…" : d.conf}% sure and the problem is ${sev} or worse.` : "Off. This issue never creates an incident."}
                        </Text>
                      </View>
                      {d.enabled ? (
                        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
                          <Input label="Confidence (%)" compact keyboardType="numeric" value={d.conf} onChangeText={(v) => set(p.issue_type, { conf: v })} containerStyle={{ width: 120 }} error={invalid(d) ? "0 to 100" : null} accessibilityLabel={`Minimum confidence for ${name}, in percent`} />
                          <View style={{ gap: 7 }}>
                            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.ink }}>Severity at least</Text>
                            <Dropdown value={d.sev} onChange={(v) => set(p.issue_type, { sev: v })} accessibilityLabel={`Minimum severity for ${name}`} options={SEVERITIES} />
                          </View>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </Card>
            );
          })}
          {changed.length || dirty ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", padding: 12, borderRadius: 10, backgroundColor: colors.primary }} accessibilityLiveRegion="polite">
              <Text style={{ color: "#FFFFFF", fontWeight: "600", flex: 1, minWidth: 160 }}>{changed.length} unsaved change{changed.length === 1 ? "" : "s"}{anyInvalid ? ". Fix the highlighted confidence first." : ""}</Text>
              <Button title="Discard" small variant="secondary" onPress={discard} />
              <Button title="Save changes" small variant="secondary" icon="checkmark" disabled={!changed.length || anyInvalid} busy={save.busy} onPress={() => save.run()} />
            </View>
          ) : saved ? <Text style={{ fontSize: 12, color: colors.muted }}>Policies saved.</Text> : null}
        </>
      ) : null}
    </Screen>
  );
}
