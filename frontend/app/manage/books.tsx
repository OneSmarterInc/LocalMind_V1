import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {UploadStatus} from '@/authoring/UploadStatus';
import {useAuth} from "@/auth/AuthContext";
import { removeBook } from "@/documents/remove";
import { manage } from "@/api/endpoints";
import type { Document } from "@/api/types";
import { useFilterChoices } from "@/hooks/useChoices";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, CellText, Column, Dropdown, Empty, ErrorBanner, Input, Loading, PageHeading, Screen, Table, TableToolbar, fmtDay, RequestFailed, confirmDeleteAsync } from "@/ui";

export default function Books() {
  const router = useRouter();
  const {user}=useAuth();
  const { subject: subjectParam } = useLocalSearchParams<{ subject?: string }>();
  const [subject, setSubject] = useState(subjectParam ?? "");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const statuses = useFilterChoices("document_status");
  const subjects = useAsync(() => manage.subjects(), []);
  const q = useAsync(() => manage.documents({ subject: subject || undefined, status: status || undefined }), [subject, status]);
  const remove = useAction(async (d: Document) => {
    const confirmed = await confirmDeleteAsync("Remove this book?", "This permanently removes the book, its chapters and modules, and any quiz or assignment built from them, along with student attempts and submissions. It cannot be undone.", { detail: `${d.title} · ${d.original_name}`, okLabel: "Remove book" });
    if (!confirmed) return;
    if (!(await removeBook(d.id,user!.id))) return;
    await q.reload();
  });
  const busy = q.data?.some((d) => d.status === "processing") ?? false;
  useEffect(() => { if (!busy) return; const t = setInterval(q.reload, 4000); return () => clearInterval(t); }, [busy, q.reload]);
  const code = (d: Document) => d.subject_code ?? subjects.data?.find((s) => s.id === d.subject_id)?.code ?? "";
  const rows = useMemo(() => (q.data ?? []).filter((d) => (status || d.status !== "archived") && `${d.title} ${d.original_name} ${code(d)}`.toLowerCase().includes(search.trim().toLowerCase())), [q.data, search, subjects.data, status]); // eslint-disable-line react-hooks/exhaustive-deps
  const action = (d: Document) => (d.status === "under_review" ? "Review outline" : d.status === "processing" ? "View progress" : d.status === "error" ? "See problem" : "Open book");
  const columns: Column<Document>[] = [
    { key: "t", label: "Book", flex: 2.2, render: (d) => <CellText icon="book-outline" title={d.title} sub={code(d) || d.original_name} /> },
    { key: "m", label: "Modules", flex: 0.7, render: (d) => (d.status === "processing" && d.progress ? `Step ${d.progress.step} of ${d.progress.total_steps}` : String(d.module_count ?? 0)) },
    { key: "s", label: "Status", flex: 1, render: (d) => <Badge value={d.status === "under_review" ? "Under review" : d.status} /> },
    { key: "l", label: "Lessons", flex: 0.9, render: (d) => (d.lessons ? `${d.lessons.ready} of ${d.lessons.total} ready` : "—") },
    { key: "u", label: "Updated", flex: 0.9, render: (d) => fmtDay((d as Document & { updated_at?: string; created_at?: string }).updated_at ?? (d as Document & { created_at?: string }).created_at) },
    { key: "x", label: "Open", width: 170, align: "center", render: (d) => <Button title={action(d)} small icon="arrow-forward" iconPosition="right" variant={d.status === "under_review" ? "primary" : "secondary"} onPress={() => router.push(`/manage/document/${d.id}`)} /> },
    { key: "remove", label: "Remove", width: 150, align: "center", render: (d) => d.status === "archived" ? <Badge value="Archived" /> : <Button title="Remove book" small variant="danger" icon="trash-outline" disabled={remove.busy} onPress={() => remove.run(d)} /> },
  ];
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <PageHeading eyebrow="TEACHING CONTENT" title="Books & modules" subtitle="Import a book, prepare lessons and quizzes, then publish for your students."
        right={<Button title="Upload a book" icon="cloud-upload-outline" onPress={() => router.push({ pathname: "/manage/document/upload", params: subject ? { subject } : {} })} />} />
      {user?<UploadStatus owner={user.id}/>:null}
      <ErrorBanner message={q.error} onRetry={q.reload} />
      <ErrorBanner message={remove.error} />
      <Card flush>
        <TableToolbar right={<>
          <Dropdown value={subject} onChange={setSubject} accessibilityLabel="Filter by subject" options={[{ value: "", label: "All subjects" }, ...(subjects.data ?? []).map((s) => ({ value: s.id, label: s.code }))]} />
          <Dropdown value={status} onChange={setStatus} accessibilityLabel="Filter by status" options={statuses.map((s) => ({ value: s.value, label: s.value === "" ? "Active books" : s.label }))} />
        </>}>
          <Input icon="search" placeholder="Search this list…" value={search} onChangeText={setSearch} compact accessibilityLabel="Search books" />
        </TableToolbar>
        {q.error && !q.data ? <RequestFailed onRetry={q.reload} /> : q.loading && !q.data ? <Loading lines={2} /> : (
          <Table noun="book" columns={columns} rows={rows} keyOf={(d) => d.id} minWidth={900}
            empty={<Empty icon="book-outline" title={q.data?.length ? "No book matches" : "No books yet"} text={q.data?.length ? "Try a different search or filter." : "Upload a PDF or Word book to turn it into modules for your students."}
              action={!q.data?.length ? <Button title="Upload a book" icon="cloud-upload-outline" onPress={() => router.push("/manage/document/upload")} /> : undefined} />} />
        )}
      </Card>
    </Screen>
  );
}
