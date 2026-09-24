import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {UploadStatus} from '@/authoring/UploadStatus';
import {useAuth} from "@/auth/AuthContext";
import { removeBook, unarchiveBook, clearRemovedBook } from "@/documents/remove";
import { manage } from "@/api/endpoints";
import type { Document } from "@/api/types";
import { useFilterChoices } from "@/hooks/useChoices";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, CellText, Column, Dropdown, Empty, ErrorBanner, Input, Loading, PageHeading, Screen, Table, TableToolbar, fmtDay, RequestFailed, confirmAsync, confirmDeleteAsync } from "@/ui";
import { everyVisible } from "@/hooks/visibleInterval";

export default function Books() {
  const router = useRouter();
  const {user}=useAuth();
  const { subject: subjectParam } = useLocalSearchParams<{ subject?: string }>();
  const [subject, setSubject] = useState(subjectParam ?? "");
  useEffect(() => { setSubject(subjectParam ?? ""); }, [subjectParam]);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const isAdmin = user?.role === "admin";
  const [facultyFilter, setFacultyFilter] = useState("");
  const [includeArchived, setIncludeArchived] = useState("");
  const statuses = useFilterChoices("document_status");
  const subjects = useAsync(() => manage.subjects(), []);
  const q = useAsync(() => manage.documents({ subject: subject || undefined, status: status || undefined }), [subject, status]);
  const remove = useAction(async (d: Document) => {
    const confirmed = await confirmDeleteAsync("Remove this book?", "This permanently removes the book, its chapters and modules, and any quiz or assignment built from them, along with student attempts and submissions. It cannot be undone.", { detail: `${d.title} · ${d.original_name}`, okLabel: "Remove book" });
    if (!confirmed) return;
    if (!(await removeBook(d.id,user!.id))) return;
    await q.reload();
  });
  useEffect(() => {
    if (!user || !q.data) return;
    void Promise.all(q.data.filter(d => d.status !== "archived").map(d => clearRemovedBook(d.id, user.id))).catch(() => {});
  }, [q.data, user]);
  const restore = useAction(async (d: Document) => {
    if (!user || !(await confirmAsync("Unarchive this book?", "Its saved content will return as unpublished. Publish it when you are ready for students to see it.", "Unarchive", "Cancel"))) return;
    await unarchiveBook(d.id, user.id); await q.reload();
  });
  const busy = q.data?.some((d) => d.status === "processing" || d.status === "uploaded" || ["pending", "retry", "running"].includes(d.background_job?.status || "")) ?? false;
  useEffect(() => { if (!busy) return; return everyVisible(q.reload, 4000); }, [busy, q.reload]);
  const subjectOf = (d: Document) => subjects.data?.find((s) => s.id === d.subject_id);
  const facultyNames = useMemo(() => [...new Set((subjects.data ?? []).flatMap((s) => s.faculty_names ?? []))].sort(), [subjects.data]);
  const code = (d: Document) => d.subject_code ?? subjects.data?.find((s) => s.id === d.subject_id)?.code ?? "";
  const rows = useMemo(() => (q.data ?? []).filter((d) => {
    if (!(status || d.status !== "archived")) return false;
    const subj = subjectOf(d);
    // Administrators see every subject; archived subjects stay out of the way unless asked for.
    if (isAdmin && !includeArchived && subj?.status === "archived") return false;
    if (isAdmin && facultyFilter && !(subj?.faculty_names ?? []).includes(facultyFilter)) return false;
    return `${d.title} ${d.original_name} ${code(d)} ${(subj?.faculty_names ?? []).join(" ")}`.toLowerCase().includes(search.trim().toLowerCase());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [q.data, search, subjects.data, status, isAdmin, includeArchived, facultyFilter]);
  const action = (d: Document) => (d.status === "under_review" ? "Review outline" : d.status === "processing" ? "View progress" : d.status === "error" ? "See problem" : "Open book");
  const columns: Column<Document>[] = [
    { key: "t", label: "Book", flex: 2.2, render: (d) => <CellText icon="book-outline" title={d.title} sub={code(d) || d.original_name} /> },
    ...(isAdmin ? [
      { key: "subj", label: "Subject", flex: 1.2, render: (d: Document) => <CellText title={subjectOf(d)?.name ?? code(d)} sub={code(d)} /> },
      { key: "fac", label: "Faculty", flex: 1.3, render: (d: Document) => (subjectOf(d)?.faculty_names ?? []).join(", ") || "Not assigned" },
    ] as Column<Document>[] : []),
    { key: "m", label: "Modules", flex: 0.7, render: (d) => (d.status === "processing" && d.progress ? `Step ${d.progress.step} of ${d.progress.total_steps}` : String(d.module_count ?? 0)) },
    { key: "s", label: "Status", flex: 1, render: (d) => <Badge value={d.status === "under_review" ? "Under review" : d.status} /> },
    { key: "l", label: "Lessons", flex: 0.9, render: (d) => (d.lessons ? `${d.lessons.ready} of ${d.lessons.total} ready` : "—") },
    { key: "u", label: "Updated", flex: 0.9, render: (d) => fmtDay((d as Document & { updated_at?: string; created_at?: string }).updated_at ?? (d as Document & { created_at?: string }).created_at) },
    { key: "x", label: "Open", width: 170, align: "center", render: (d) => <Button title={action(d)} small icon="arrow-forward" iconPosition="right" variant={d.status === "under_review" ? "primary" : "secondary"} onPress={() => router.push(`/manage/document/${d.id}`)} /> },
    { key: "remove", label: "Remove", width: 150, align: "center", render: (d) => d.status === "archived" ? <Button title="Unarchive" small variant="secondary" busy={restore.busy} onPress={() => restore.run(d)} /> : <Button title="Remove book" small variant="danger" icon="trash-outline" disabled={remove.busy} onPress={() => remove.run(d)} /> },
  ];
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <PageHeading eyebrow={isAdmin ? "CONTENT WORKSPACE · ALL SUBJECTS" : "TEACHING CONTENT"} title="Books & modules" subtitle={isAdmin ? "Every book in LocalMind, across all subjects and faculty." : "Import a book, prepare lessons and quizzes, then publish for your students."}
        right={<Button title="Upload a book" icon="cloud-upload-outline" onPress={() => router.push({ pathname: "/manage/document/upload", params: subject ? { subject } : {} })} />} />
      {user?<UploadStatus owner={user.id}/>:null}
      <ErrorBanner message={q.error} onRetry={q.reload} />
      <ErrorBanner message={remove.error || restore.error} />
      <Card flush>
        <TableToolbar right={<>
          <Dropdown value={subject} onChange={setSubject} accessibilityLabel="Filter by subject" options={[{ value: "", label: isAdmin ? "All subjects" : "All my subjects" }, ...(subjects.data ?? []).filter((s) => includeArchived || s.status !== "archived").map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))]} />
          {isAdmin ? <Dropdown value={facultyFilter} onChange={setFacultyFilter} accessibilityLabel="Filter by faculty" options={[{ value: "", label: "All faculty" }, ...facultyNames.map((n) => ({ value: n, label: n }))]} /> : null}
          {isAdmin ? <Dropdown value={includeArchived} onChange={setIncludeArchived} accessibilityLabel="Archived subjects" options={[{ value: "", label: "Active subjects" }, { value: "yes", label: "Include archived subjects" }]} /> : null}
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
