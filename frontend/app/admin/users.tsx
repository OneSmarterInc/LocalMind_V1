import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { admin } from "@/api/endpoints";
import type { User } from "@/api/types";
import { useAsync } from "@/hooks/useAsync";
import { useDebounced } from "@/hooks/useDebounced";
import { Badge, Button, Card, CellText, Column, Dropdown, Empty, ErrorBanner, Input, Loading, Notice, PageHeading, PageTabs, Screen, Table, TableToolbar, RequestFailed, IncompleteNote } from "@/ui";

type Kind = "students" | "faculty";

export default function People() {
  const router = useRouter();
  const p = useLocalSearchParams<{ kind?: string; tab?: string; notice?: string }>();
  const initial: Kind = p.kind === "faculty" || p.tab === "faculty" ? "faculty" : "students";
  const [kind, setKind] = useState<Kind>(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    if (p.kind === "faculty" || p.kind === "students") setKind(p.kind);
    if (p.notice) { setNotice(String(p.notice)); router.setParams({ notice: "" } as never); }
  }, [p.kind, p.notice, router]);
  const query = useDebounced(q);
  const list = useAsync(() => admin.users(kind, { q: query, status: status || undefined }), [kind, query, status]);
  const subjects = useAsync(() => admin.platformSubjects(), []);
  const teaching = (u: User) => (subjects.data?.subjects ?? []).filter((s: any) => (s.faculty ?? []).includes(u.full_name)).map((s: any) => s.code);
  const open = (u: User) => router.push({ pathname: "/admin/user/[id]", params: { id: u.id, kind } });
  const statusBadge = (u: User) => <Badge value={u.status} tone={u.status === "active" ? "green" : "red"} />;
  const studentCols: Column<User>[] = [
    { key: "n", label: "Student", flex: 2, render: (u) => <CellText avatar={u.full_name} title={u.full_name} sub={u.email} /> },
    { key: "r", label: "Roll number", flex: 0.9, render: (u) => String(u.profile?.roll_number ?? "—") },
    { key: "p", label: "Program", flex: 1, render: (u) => String(u.profile?.program ?? "—") },
    { key: "s", label: "Account status", flex: 0.9, render: statusBadge },
    { key: "o", label: "Onboarding", flex: 1.2, render: (u) => (u.must_change_password ? <Badge value="Password change required" tone="amber" /> : "Complete") },
    { key: "x", label: "", flex: 0.8, render: (u) => <Button title="Manage" small variant="secondary" icon="arrow-forward" onPress={() => open(u)} /> },
  ];
  const facultyCols: Column<User>[] = [
    { key: "n", label: "Faculty", flex: 2, render: (u) => <CellText avatar={u.full_name} title={u.full_name} sub={u.email} /> },
    { key: "e", label: "Employee ID", flex: 0.9, render: (u) => String(u.profile?.employee_id ?? "—") },
    { key: "d", label: "Department", flex: 1, render: (u) => String(u.profile?.department ?? "—") },
    { key: "t", label: "Teaching access", flex: 1, render: (u) => { const c = teaching(u).length; return c ? `${c} subject${c === 1 ? "" : "s"}` : "No subjects"; } },
    { key: "s", label: "Status", flex: 0.8, render: statusBadge },
    { key: "x", label: "", flex: 0.8, render: (u) => <Button title="Manage" small variant="secondary" icon="arrow-forward" onPress={() => open(u)} /> },
  ];
  return (
    <Screen refreshing={list.loading} onRefresh={list.reload}>
      <PageHeading eyebrow="PLATFORM ADMINISTRATION" title="People" subtitle="Create accounts, manage access, and help users get started."
        right={<>
          <Button title="Import from Excel" variant="secondary" icon="cloud-upload-outline" onPress={() => router.push({ pathname: "/admin/user/import", params: { kind } })} />
          <Button title="Add a person" icon="person-add-outline" onPress={() => router.push({ pathname: "/admin/user/new", params: { kind } })} />
        </>} />
      <PageTabs<Kind> value={kind} onChange={(k) => { setKind(k); setStatus(""); }} tabs={[{ key: "students", label: "Students" }, { key: "faculty", label: "Faculty" }]} />
      {notice ? <Notice tone="success" message={notice} /> : null}
      <ErrorBanner message={list.error} onRetry={list.reload} />
      <IncompleteNote rows={list.data} noun={kind === "students" ? "students" : "faculty accounts"} />
      <Card flush>
        <TableToolbar right={<Dropdown value={status} onChange={setStatus} accessibilityLabel="Filter by status" options={[{ value: "", label: "All statuses" }, { value: "active", label: "Active" }, { value: "discontinued", label: "Discontinued" }]} />}>
          <Input icon="search" compact placeholder="Search this list…" value={q} onChangeText={setQ} accessibilityLabel="Search people" />
        </TableToolbar>
        {list.error && !list.data ? <RequestFailed onRetry={list.reload} /> : list.loading && !list.data ? <Loading lines={2} /> : (
          <Table noun={kind === "students" ? "student" : "faculty account"} columns={kind === "students" ? studentCols : facultyCols} rows={list.data ?? []} keyOf={(u) => u.id} onRowPress={open} minWidth={900}
            empty={<Empty icon="people-outline" title={q || status ? "Nobody matches" : `No ${kind} yet`} text={q || status ? "Try a different search or status." : "Add a person or import a class from Excel."} />} />
        )}
      </Card>
    </Screen>
  );
}
