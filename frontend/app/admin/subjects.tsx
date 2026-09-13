import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { admin } from "@/api/endpoints";
import type { Subject } from "@/api/types";
import { useAsync } from "@/hooks/useAsync";
import { useDebounced } from "@/hooks/useDebounced";
import { Badge, Button, Card, CellText, Column, Dropdown, Empty, ErrorBanner, Input, Loading, Notice, PageHeading, Screen, Table, TableToolbar, RequestFailed } from "@/ui";

export default function Subjects() {
  const router = useRouter();
  const p = useLocalSearchParams<{ notice?: string }>();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { if (p.notice) { setNotice(String(p.notice)); router.setParams({ notice: "" } as never); } }, [p.notice, router]);
  const query = useDebounced(q);
  const list = useAsync(() => admin.subjects({ status: status || undefined, q: query }), [status, query]);
  const stats = useAsync(() => admin.platformSubjects(), []);
  const byId = useMemo(() => new Map<string, any>((stats.data?.subjects ?? []).map((s: any) => [s.subject_id, s])), [stats.data]);
  const columns: Column<Subject>[] = [
    { key: "s", label: "Subject", flex: 2, render: (s) => <CellText title={s.name} sub={s.code} /> },
    { key: "f", label: "Faculty", flex: 1.4, render: (s) => (byId.get(s.id)?.faculty ?? []).join(", ") || "Not assigned" },
    { key: "n", label: "Students", flex: 0.7, render: (s) => String(byId.get(s.id)?.students_enrolled ?? "—") },
    { key: "b", label: "Books", flex: 0.6, render: (s) => String(byId.get(s.id)?.documents_published ?? "—") },
    { key: "t", label: "Status", flex: 0.9, render: (s) => <Badge value={s.status.charAt(0).toUpperCase() + s.status.slice(1)} tone={s.status === "active" ? "green" : "neutral"} /> },
    { key: "x", label: "", flex: 1.1, render: (s) => <Button title="Manage subject" small variant="secondary" icon="arrow-forward" onPress={() => router.push(`/admin/subject/${s.id}`)} /> },
  ];
  return (
    <Screen refreshing={list.loading} onRefresh={() => { list.reload(); stats.reload(); }}>
      <PageHeading eyebrow="ACADEMIC STRUCTURE" title="Subjects" subtitle="Give every class a clear home and the right teaching access."
        right={<Button title="Create subject" icon="add" onPress={() => router.push("/admin/subject/new")} />} />
      {notice ? <Notice tone="success" message={notice} /> : null}
      <ErrorBanner message={list.error} onRetry={list.reload} />
      <Card flush>
        <TableToolbar right={<Dropdown value={status} onChange={setStatus} accessibilityLabel="Filter by status" options={[{ value: "", label: "All statuses" }, { value: "active", label: "Active" }, { value: "discontinued", label: "Discontinued" }, { value: "archived", label: "Archived" }]} />}>
          <Input icon="search" compact placeholder="Search this list…" value={q} onChangeText={setQ} accessibilityLabel="Search subjects" />
        </TableToolbar>
        {list.error && !list.data ? <RequestFailed onRetry={list.reload} /> : list.loading && !list.data ? <Loading lines={2} /> : (
          <Table noun="subject" columns={columns} rows={list.data ?? []} keyOf={(s) => s.id} onRowPress={(s) => router.push(`/admin/subject/${s.id}`)} minWidth={860}
            empty={<Empty icon="library-outline" title={q || status ? "No subject matches" : "No subjects yet"} text={q || status ? "Try a different search or status." : "Create a subject, then assign faculty and enroll students."}
              action={!q && !status ? <Button title="Create subject" icon="add" onPress={() => router.push("/admin/subject/new")} /> : undefined} />} />
        )}
      </Card>
    </Screen>
  );
}
