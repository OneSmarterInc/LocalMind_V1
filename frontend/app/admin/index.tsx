import { useRouter } from "expo-router";
import React from "react";
import { admin } from "@/api/endpoints";
import { useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, CardHead, CellText, Column, Empty, ErrorBanner, Grid, HeroCard, ListRow, Loading, PageHeading, Screen, Split, Stat, StatRow, Table, TextLink, RequestFailed } from "@/ui";


export default function AdminOverview() {
  const router = useRouter();
  const platform = useAsync(() => admin.platform(), []);
  const subjects = useAsync(() => admin.platformSubjects(), []);
  const monitor = useAsync(() => admin.monitorOverview(30), []);
  const pendingStudents = useAsync(async () => (await admin.users("students")).filter((u) => u.must_change_password).length + (await admin.users("faculty")).filter((u) => u.must_change_password).length, []);
  const d = platform.data;
  const open = monitor.data?.open_incidents ?? 0;
  const reload = () => { platform.reload(); subjects.reload(); monitor.reload(); pendingStudents.reload(); };
  const columns: Column<any>[] = [
    { key: "s", label: "Subject", flex: 2, render: (s) => <CellText strong={false} title={`${s.code} · ${s.name}`} /> },
    { key: "n", label: "Students", flex: 0.8, render: (s) => String(s.students_enrolled) },
    { key: "m", label: "Published modules", flex: 1, render: (s) => String(s.modules_published ?? 0) },
  ];
  return (
    <Screen refreshing={platform.loading} onRefresh={reload}>
      <PageHeading eyebrow="ADMINISTRATOR WORKSPACE" title="A clear view of your platform." subtitle="People, teaching activity, and AI incidents in one place."
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
              action={<Button title="Add a person" icon="person-add-outline" onPress={() => router.push("/admin/user/new")} />} />
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
            </Card>
          </>
        }
      />
    </Screen>
  );
}
