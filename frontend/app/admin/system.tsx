import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Text, View } from "react-native";
import { admin } from "@/api/endpoints";
import type { SystemComponent } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, CardHead, CellText, Column, DetailList, Empty, ErrorBanner, Grid, Loading, Notice, PageHeading, Screen, Table, colors, fmtDate } from "@/ui";
import type { IconName } from "@/ui/Shell";
import { sentence } from "@/screens/admin/monitor";

const TONE: Record<string, "green" | "amber" | "red" | "neutral"> = { READY: "green", WARNING: "amber", DEGRADED: "amber", MISSING: "amber", ERROR: "red", DISABLED: "neutral", UNKNOWN: "neutral" };
const WORD: Record<string, string> = { READY: "Ready", WARNING: "Warning", DEGRADED: "Degraded", MISSING: "Missing", ERROR: "Needs attention", DISABLED: "Off", UNKNOWN: "Unknown" };
const NAMES: Record<string, string> = { backend: "Backend", database: "Database", storage: "Storage", ai_runtime: "AI runtime", ai_model: "AI model", document_processing: "Document processing", web_client: "Web client", ai_monitor: "AI monitor", offline_mode: "Offline mode" };
const ICONS: Record<string, IconName> = { backend: "server-outline", database: "albums-outline", storage: "folder-outline", ai_runtime: "sparkles-outline", ai_model: "hardware-chip-outline", document_processing: "document-text-outline", web_client: "globe-outline", ai_monitor: "shield-checkmark-outline", offline_mode: "cloud-offline-outline" };

export default function SystemReadiness() {
  const router = useRouter();
  const q = useAsync(() => admin.aiStatus(), []);
  const refresh = useAction(async () => { q.setData(await admin.aiStatus(true)); });
  const [showAll, setShowAll] = useState(false);
  const d = q.data;
  const components = d?.system?.components ?? [];
  const problems = components.filter((c) => c.status !== "READY");
  const modelProblem = components.find((c) => c.component === "ai_model" && c.status !== "READY");
  const aiDown = !!d && d.enabled && (!d.ready || !!modelProblem);
  const service = (c: SystemComponent) => {
    const x = c as unknown as Record<string, unknown>;
    if (c.component === "backend") return "Django API";
    if (c.component === "database") return String(x.engine ?? "Database");
    if (c.component === "storage") return "Uploads and parsed content";
    if (c.component === "ai_runtime") return String(x.provider ?? d?.runtime ?? d?.provider ?? "Local runtime");
    if (c.component === "ai_model") return d?.tutor_model?.name ?? "Local model";
    if (c.component === "document_processing") return "Docling parser";
    if (c.component === "web_client") return "Built frontend";
    if (c.component === "ai_monitor") return "Evaluator";
    return "—";
  };
  const columns: Column<SystemComponent>[] = [
    { key: "c", label: "Component", flex: 1.2, render: (c) => <CellText icon={ICONS[c.component] ?? "ellipse-outline"} title={NAMES[c.component] ?? sentence(c.component)} /> },
    { key: "v", label: "Configured service", flex: 1.3, render: (c) => service(c) },
    { key: "s", label: "State", flex: 0.8, render: (c) => <Badge value={WORD[c.status] ?? c.status} tone={TONE[c.status] ?? "neutral"} /> },
    { key: "d", label: "Details", flex: 2.2, render: (c) => <Text style={{ fontSize: 12, color: colors.text }} numberOfLines={3}>{c.summary}</Text> },
  ];
  const checkedAt = new Date().toISOString();
  const refreshButton = <Button title={aiDown && !showAll ? "Check again" : "Refresh status"} icon="refresh" onPress={() => refresh.run()} busy={refresh.busy} />;

  if (d && aiDown && !showAll) {
    const runtime = d.runtime || d.provider;
    return (
      <Screen refreshing={q.loading} onRefresh={q.reload}>
        <PageHeading eyebrow="SYSTEM READINESS · ERROR" title="The AI model needs attention." subtitle="Reading remains available. New AI generation cannot run yet." right={refreshButton} />
        <ErrorBanner message={q.error ?? refresh.error} onRetry={q.reload} />
        <Notice tone="danger" title={modelProblem?.status === "MISSING" ? "Model file not found." : "The AI model is not ready."} message={modelProblem?.summary || d.error || "The configured model could not be loaded."} />
        <Card>
          <CardHead title="What to do next" />
          <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>Ask the system operator to check the model.</Text>
          <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 19 }}>The server reports the exact reason above. These commands, run on the server, download or verify the model.</Text>
          <View style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: "#F3F5F0", borderRadius: 8, padding: 14, gap: 4 }}>
            {runtime === "ollama" ? <Text style={{ fontFamily: "monospace", fontSize: 12, color: colors.ink }} selectable>ollama pull {d.tutor_model?.name ?? "<model>"}</Text> : <Text style={{ fontFamily: "monospace", fontSize: 12, color: colors.ink }} selectable>python manage.py fetch_model</Text>}
            <Text style={{ fontFamily: "monospace", fontSize: 12, color: colors.ink }} selectable>python manage.py check_ai --smoke</Text>
          </View>
          <Text style={{ fontSize: 11, color: colors.muted }}>The first model download needs internet access. Afterwards the platform runs offline.</Text>
          <View style={{ flexDirection: "row", gap: 9, flexWrap: "wrap" }}>
            <Button title="View all components" variant="secondary" icon="list-outline" onPress={() => setShowAll(true)} />
            <Button title="Back to overview" variant="ghost" onPress={() => router.push("/admin")} />
          </View>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <PageHeading eyebrow="PLATFORM HEALTH" title="System readiness" subtitle="See the exact component that needs attention, without guessing." right={refreshButton} />
      <ErrorBanner message={q.error ?? refresh.error} onRetry={q.reload} />
      {d && !problems.length ? <Notice tone="success" title="All components are ready." message="Every checked component responded normally." /> : null}
      {d && problems.length ? <Notice tone="warning" title={`${problems.length} component${problems.length === 1 ? " needs" : "s need"} attention.`} message="The details below come from the server and name the exact reason and how to fix it." /> : null}
      {q.loading && !d ? <Loading /> : null}
      {d ? (
        <>
          <Card flush><Table noun="component" columns={columns} rows={components} keyOf={(c) => c.component} minWidth={860} empty={<Empty icon="pulse-outline" text="The server did not report component details." />} /></Card>
          <Grid min={320} gap={20}>
            <Card>
              <CardHead title="Local AI details" />
              <DetailList items={[
                ["Runtime", d.runtime || d.provider],
                ["Model", `${d.tutor_model?.name ?? "—"}${d.tutor_model && !d.tutor_model.present ? " (missing)" : ""}`],
                ["Mode", d.details?.model_file ? "Embedded / local" : d.reachable ? "Local service" : "Not reachable"],
                ["Current work", !d.enabled ? "Turned off" : d.ready ? "Idle · ready" : "Not ready"],
                ["Last check", fmtDate(checkedAt)],
              ]} />
              {d.error ? <Notice tone="danger" message={d.error} /> : null}
            </Card>
            <Card>
              <CardHead title="Offline does not mean the same thing everywhere" />
              <Text style={{ fontSize: 12, lineHeight: 20, color: colors.text }}>The full platform can run on a reachable local server. If a student’s device loses access to that server, only previously saved reading content remains available.</Text>
            </Card>
          </Grid>
        </>
      ) : null}
    </Screen>
  );
}
