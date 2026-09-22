import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { manage } from "@/api/endpoints";
import { useAuth } from "@/auth/AuthContext";
import { useAsync } from "@/hooks/useAsync";
import { CardGrid, Dropdown, Empty, ErrorBanner, Input, Loading, Notice, PageHeading, Screen, RequestFailed } from "@/ui";
import { TeachingSubjectCard } from "@/screens/manage/TeachingSubjectCard";

export default function TeachingSubjects() {
  const router = useRouter();
  const ov = useAsync(() => manage.overview(), []);
  const subjects = useAsync(() => manage.subjects(), []);
  const [q, setQ] = useState("");
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [includeArchived, setIncludeArchived] = useState("");
  const rows = useMemo(() => {
    const summaries = new Map<string, any>((ov.data?.subjects ?? []).map((s: any) => [s.subject.id, s]));
    return (subjects.data ?? []).filter((s) => !isAdmin || includeArchived || s.status !== "archived").map((s) => summaries.get(s.id) ?? { subject: s, students_enrolled: s.active_students, documents: { total: 0, published: 0 }, modules: { completion_percentage: 0 } })
      .filter((s) => `${s.subject.name} ${s.subject.code}`.toLowerCase().includes(q.trim().toLowerCase()));
  }, [ov.data, subjects.data, q, isAdmin, includeArchived]);
  return (
    <Screen refreshing={subjects.loading} onRefresh={() => { ov.reload(); subjects.reload(); }}>
      <PageHeading eyebrow={isAdmin ? "CONTENT WORKSPACE · ALL SUBJECTS" : "SUBJECTS"} title={isAdmin ? "All subjects" : "My teaching subjects"} subtitle={isAdmin ? "Every subject in LocalMind. You are viewing as an administrator." : "Your classes, books, learners, and progress."} />
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Input icon="search" placeholder="Search this list…" value={q} onChangeText={setQ} compact containerStyle={{ maxWidth: 350, flexGrow: 1 }} accessibilityLabel="Search subjects" />
        {isAdmin ? <Dropdown value={includeArchived} onChange={setIncludeArchived} accessibilityLabel="Archived subjects" options={[{ value: "", label: "Active subjects" }, { value: "yes", label: "Include archived subjects" }]} /> : null}
      </View>
      <ErrorBanner message={subjects.error || ov.error} onRetry={subjects.reload} />
      {subjects.error && !subjects.data ? <RequestFailed onRetry={subjects.reload} /> : subjects.loading && !subjects.data ? <Loading /> : null}
      {subjects.data?.length === 0 ? <Empty icon="library-outline" title="No subjects yet" text="Your administrator assigns subjects to you. They appear here once assigned." /> : null}
      <CardGrid min={250} max={3}>{rows.map((s, i) => <TeachingSubjectCard key={s.subject.id} summary={s} index={i} onPress={() => router.push(`/manage/subject/${s.subject.id}`)} />)}</CardGrid>
      {rows.length && !isAdmin ? <Notice title="Subjects are assigned by your administrator." message="You can manage content and enroll students within the subjects assigned to you." /> : null}
    </Screen>
  );
}
