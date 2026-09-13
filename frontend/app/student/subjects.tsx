import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { Button, Card, CardGrid, Empty, ErrorBanner, Input, Loading, Notice, PageHeading, Screen, RequestFailed } from "@/ui";
import { openHelp } from "@/ui/Shell";
import { SubjectCard } from "@/screens/student/SubjectCard";
import { useStudentCatalog } from "@/screens/student/catalog";
import { useOnline } from "@/offline/connectivity";

export default function StudentSubjects() {
  const router = useRouter();
  const cat = useStudentCatalog();
  const online = useOnline();
  const [q, setQ] = useState("");
  const rows = useMemo(() => (cat.data?.subjects ?? []).filter((r) => `${r.subject.name} ${r.subject.code} ${(r.subject.faculty_names ?? []).join(" ")}`.toLowerCase().includes(q.trim().toLowerCase())), [cat.data, q]);
  const none = !!cat.data && cat.data.subjects.length === 0;
  return (
    <Screen refreshing={cat.loading} onRefresh={cat.reload}>
      <PageHeading eyebrow={online ? "YOUR LEARNING SPACE" : "OFFLINE READING"} title="My subjects"
        subtitle={none ? "Your enrolled subjects will appear here." : online ? "Start with a subject. You will find its books, modules, and activities inside." : "Read what is already saved on this device."} />
      {!none ? <Input icon="search" placeholder="Search this list…" value={q} onChangeText={setQ} compact containerStyle={{ maxWidth: 350 }} accessibilityLabel="Search subjects" /> : null}
      <ErrorBanner message={cat.error} onRetry={cat.reload} />
      {cat.error && !cat.data ? <RequestFailed onRetry={cat.reload} /> : cat.loading && !cat.data ? <Loading /> : null}
      {none ? (
        <Card>
          <Empty icon="library-outline" title="You’re in. Let’s find your classes." text="You have not been enrolled in a subject yet. Ask your faculty or administrator to add you to the right subject."
            action={<Button title="Where do I start?" icon="help-circle-outline" onPress={openHelp} />} />
        </Card>
      ) : null}
      {!none && cat.data && rows.length === 0 ? <Empty text="No subject matches that search." icon="search" /> : null}
      <CardGrid min={250} max={3}>
        {rows.map((r, i) => <SubjectCard key={r.subject.id} row={r} index={i} onPress={() => router.push(`/student/subject/${r.subject.id}`)} />)}
      </CardGrid>
      {!none && rows.length ? <Notice title="Missing a subject?" message="Your administrator or faculty can enroll you. Only your enrolled subjects appear here." /> : null}
    </Screen>
  );
}
