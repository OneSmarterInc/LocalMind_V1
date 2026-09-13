import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { admin } from "@/api/endpoints";
import type { MonitorPolicy, MonitorSeverity } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Button, Card, CardHead, Dropdown, ErrorBanner, FormFooter, Input, Loading, Notice, PageHeading, Screen, colors, RequestFailed } from "@/ui";
import { ISSUE_LABEL } from "@/screens/admin/monitor";

const SEVERITIES: { value: MonitorSeverity; label: string }[] = [{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }, { value: "critical", label: "Critical" }];
type Draft = { enabled: boolean; conf: string; sev: MonitorSeverity };
const toDraft = (p: MonitorPolicy): Draft => ({ enabled: p.enabled, conf: String(Math.round(p.min_confidence * 100)), sev: p.min_severity });

function Check({ on, onPress, label }: { on: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: on }} hitSlop={8}
      style={{ width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: on ? colors.primary : "#9AAA9D", backgroundColor: on ? colors.primary : "#FFFFFF", alignItems: "center", justifyContent: "center" }}>
      {on ? <Ionicons name="checkmark" size={12} color="#FFFFFF" /> : null}
    </Pressable>
  );
}

export default function MonitorPolicies() {
  const router = useRouter();
  const q = useAsync(() => admin.monitorPolicies(), []);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (q.data) setDrafts(Object.fromEntries(q.data.map((p) => [p.issue_type, toDraft(p)]))); }, [q.data]);
  const policies = q.data ?? [];
  const invalid = (d: Draft) => d.conf.trim() === "" || Number.isNaN(Number(d.conf)) || Number(d.conf) < 0 || Number(d.conf) > 100;
  const changed = policies.filter((p) => { const d = drafts[p.issue_type]; return d && (d.enabled !== p.enabled || d.sev !== p.min_severity || Number(d.conf) !== Math.round(p.min_confidence * 100)); });
  const anyInvalid = policies.some((p) => drafts[p.issue_type] && invalid(drafts[p.issue_type]));
  const set = (type: string, patch: Partial<Draft>) => { setSaved(false); setDrafts((x) => ({ ...x, [type]: { ...x[type], ...patch } })); };
  const save = useAction(async () => {
    for (const p of changed) {
      const d = drafts[p.issue_type];
      await admin.updatePolicy(p.issue_type, { enabled: d.enabled, min_confidence: Number(d.conf) / 100, min_severity: d.sev });
    }
    await q.reload(); setSaved(true);
  });
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <PageHeading eyebrow="ADMINISTRATOR CONTROLS" title="Monitoring policies" subtitle="Decide which findings create incidents for human review."
        right={<Button title="Back to monitoring" variant="secondary" icon="arrow-back" onPress={() => router.push("/admin/monitoring")} />} />
      <Notice title="These settings govern incident creation, not grading." message="Confidence is shown as a percentage and saved as the backend’s 0–1 value. Raising a threshold makes the queue quieter but lets more issues through unreviewed." />
      <ErrorBanner message={q.error ?? save.error} onRetry={q.reload} />
      {q.error && !q.data ? <RequestFailed onRetry={q.reload} /> : q.loading && !q.data ? <Loading /> : null}
      {q.data ? (
        <Card>
          <CardHead title="Incident thresholds" subtitle="Confidence is displayed as a percentage and mapped to the backend’s 0–1 value." />
          {policies.map((p) => {
            const d = drafts[p.issue_type]; if (!d) return null;
            const name = ISSUE_LABEL[p.issue_type] ?? p.issue_type;
            return (
              <View key={p.id} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.rowLine }}>
                <Check on={d.enabled} onPress={() => set(p.issue_type, { enabled: !d.enabled })} label={`Create incidents for ${name}`} />
                <View style={{ flex: 1, minWidth: 220 }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{name}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{p.description}</Text>
                </View>
                <Input label="Minimum confidence" compact keyboardType="numeric" value={d.conf} onChangeText={(v) => set(p.issue_type, { conf: v })} containerStyle={{ width: 150, opacity: d.enabled ? 1 : 0.6 }} error={invalid(d) ? "0 to 100" : null} accessibilityLabel={`Minimum confidence for ${name}`} />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, opacity: d.enabled ? 1 : 0.6 }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>Minimum severity</Text>
                  <Dropdown value={d.sev} onChange={(v) => set(p.issue_type, { sev: v })} accessibilityLabel={`Minimum severity for ${name}`} options={SEVERITIES} />
                </View>
              </View>
            );
          })}
          <FormFooter note={saved && !changed.length ? "Policies saved." : changed.length ? `${changed.length} unsaved change${changed.length === 1 ? "" : "s"}.` : "No unsaved changes."}>
            <Button title="Cancel" variant="secondary" disabled={!changed.length} onPress={() => { setDrafts(Object.fromEntries(policies.map((p) => [p.issue_type, toDraft(p)]))); }} />
            <Button title="Save policies" icon="checkmark" disabled={!changed.length || anyInvalid} busy={save.busy} onPress={() => save.run()} />
          </FormFooter>
        </Card>
      ) : null}
    </Screen>
  );
}
