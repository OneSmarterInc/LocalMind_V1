import { useRouter } from "expo-router";
import React from "react";
import { Text, View } from "react-native";
import { admin } from "@/api/endpoints";
import { useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, CardHead, CellText, Column, DetailList, Empty, ErrorBanner, Grid, HeroCard, ListRow, Loading, PageHeading, Screen, Split, Stat, StatRow, Table, TextLink, colors, RequestFailed } from "@/ui";

const NAMES: Record<string, string> = { backend: "Backend", database: "Database", storage: "Storage", ai_runtime: "AI runtime", ai_model: "Local model", document_processing: "Book processing", web_client: "Web build", ai_monitor: "AI monitor", offline_mode: "Offline mode" };

export default function AdminOverview() {
  const router = useRouter();
  const platform = useAsync(() => admin.platform(), []);
  const subjects = useAsync(() => admin.platformSubjects(), []);
  const monitor = useAsync(() => admin.monitorOverview(30), []);
  const status = useAsync(() => admin.aiStatus(), []);
  const pendingStudents = useAsync(async () => (await admin.users("students")).filter((u) => u.must_change_password).length + (await admin.users("faculty")).filter((u) => u.must_change_password).length, []);
  const d = platform.data;
  const open = monitor.data?.open_incidents ?? 0;
  const components = status.data?.system?.components ?? [];
  const problems = components.filter((c) => c.status !== "READY").length;
  const reload = () => { platform.reload(); subjects.reload(); monitor.reload(); status.reload(); pendingStudents.reload(); };
  const columns: Column<any>[] = [
    { key: "s", label: "Subject", flex: 2, render: (s) => <CellText strong={false} title={`${s.code} · ${s.name}`} /> },
    { key: "n", label: "Students", flex: 0.8, render: (s) => String(s.students_enrolled) },
    { key: "m", label: "Published modules", flex: 1, render: (s) => String(s.modules_published ?? 0) },
  ];
  const ring = (
    <View style={{ width: 150, height: 150, borderRadius: 75, borderWidth: 1, borderColor: "#CFE0CB", alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: 118, height: 118, borderRadius: 59, borderWidth: 9, borderColor: problems ? "#E2C27E" : "#A9C7A4", alignItems: "center", justifyContent: "center", backgroundColor: "#F4F8F1" }}>
        <Text style={{ fontSize: 19, fontWeight: "600", color: colors.ink }}>{status.data ? (problems ? "Check" : "Ready") : "…"}</Text>
        <Text style={{ fontSize: 8, letterSpacing: 1, color: colors.muted, textAlign: "center" }}>SYSTEM STATUS</Text>
      </View>
    </View>
  );
  return (
    <Screen refreshing={platform.loading} onRefresh={reload}>
      <PageHeading eyebrow="ADMINISTRATOR WORKSPACE" title="A clear view of your platform." subtitle="People, teaching activity, and system readiness in one place."
        right={<Button title="Create subject" variant="secondary" icon="add" onPress={() => router.push("/admin/subject/new")} />} />
      <ErrorBanner message={platform.error} onRetry={reload} />
      <StatRow>
        <Stat label="Students" icon="school-outline" value={d?.users.student?.active ?? (d ? 0 : null)} helper="Active student accounts" />
        <Stat label="Faculty" icon="people-outline" value={d?.users.faculty?.active ?? (d ? 0 : null)} helper="Active teaching accounts" />
        <Stat label="Subjects" icon="library-outline" value={d?.subjects.active ?? (d ? 0 : null)} helper="Across the platform" />
        <Stat label="Items to review" icon="shield-checkmark-outline" value={monitor.data ? open : null} helper="Open AI monitoring incidents" />
      </StatRow>
      <Split
        main={
          <>
            <HeroCard eyebrow="A HEALTHY LEARNING ENVIRONMENT" title="The right people. The right access." text="Keep accounts and subjects organized so teaching can happen without friction."
              action={<Button title="Add a person" icon="person-add-outline" onPress={() => router.push("/admin/user/new")} />} art={ring} />
            <Card>
              <CardHead title="Common tasks" />
              <Grid min={250} gap={10}>
                <Button title="Manage people" variant="secondary" icon="people-outline" full onPress={() => router.push("/admin/users")} />
                <Button title="Manage subjects" variant="secondary" icon="library-outline" full onPress={() => router.push("/admin/subjects")} />
                <Button title="Content workspace" variant="secondary" icon="book-outline" full onPress={() => router.push("/admin/content")} />
                <Button title="View audit trail" variant="secondary" icon="pulse-outline" full onPress={() => router.push("/admin/audit")} />
              </Grid>
            </Card>
            <Card>
              <CardHead title="Subject snapshot" action={<TextLink title="All subjects" icon="arrow-forward" onPress={() => router.push("/admin/subjects")} />} />
              {subjects.error && !subjects.data ? <RequestFailed onRetry={subjects.reload} /> : subjects.loading && !subjects.data ? <Loading lines={1} /> : <Table noun="subject" columns={columns} rows={(subjects.data?.subjects ?? []).slice(0, 6)} keyOf={(s) => s.subject_id} onRowPress={(s) => router.push(`/admin/subject/${s.subject_id}`)} minWidth={420} footer={false} empty={<Empty icon="library-outline" text="No subjects yet." />} />}
            </Card>
          </>
        }
        side={
          <>
            <Card>
              <CardHead title="Administration at a glance" subtitle="Clear priorities, not another long menu" />
              <ListRow plain icon="shield-outline" tone={open ? "amber" : "green"} title={open ? `Review ${open} AI incident${open === 1 ? "" : "s"}` : "No AI incidents open"} subtitle="Check the evidence and decide what should happen." right={<Badge value={`${open} open`} tone={open ? "amber" : "green"} />} onPress={() => router.push("/admin/monitoring")} />
              <ListRow plain icon="people-outline" tone="blue" title="Complete account onboarding" subtitle="New users change their password at first sign-in." right={<Badge value={pendingStudents.data == null ? "…" : `${pendingStudents.data} new`} tone="blue" />} onPress={() => router.push("/admin/users")} />
              <ListRow plain icon="server-outline" tone={problems ? "amber" : "green"} title="Check system readiness" subtitle="AI, parser, storage, and web build in one place." right={<Badge value={status.data ? (problems ? `${problems} to check` : "Ready") : "…"} tone={problems ? "amber" : "green"} />} onPress={() => router.push("/admin/system")} />
            </Card>
            <Card>
              <CardHead title="System readiness" />
              <View style={{ flexDirection: "row" }}><Badge value={status.data ? (problems ? `${problems} need attention` : "All checks ready") : "Checking…"} tone={problems ? "amber" : "green"} /></View>
              {status.error && !status.data ? <RequestFailed onRetry={status.reload} /> : status.loading && !status.data ? <Loading lines={1} /> : null}
              {status.error ? <Text style={{ fontSize: 12, color: colors.danger }}>{status.error}</Text> : null}
              <DetailList items={components.slice(0, 4).map((c) => [NAMES[c.component] ?? c.component, c.status === "READY" ? "Ready" : c.status === "MISSING" ? "Missing" : "Needs attention"] as [string, string])} />
              <TextLink title="View system details" icon="arrow-forward" onPress={() => router.push("/admin/system")} />
            </Card>
          </>
        }
      />
    </Screen>
  );
}
