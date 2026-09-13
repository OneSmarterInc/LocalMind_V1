import React from "react";
import { Text } from "react-native";
import type { DocumentTree, Subject, TeachResponse } from "@/api/types";
import { useAsync } from "@/hooks/useAsync";
import { useOnline } from "@/offline/connectivity";
import { readEntry } from "@/offline/store";
import { syncNow, useSyncState } from "@/offline/sync";
import { Badge, Button, Card, CardHead, ErrorBanner, Grid, ListRow, Notice, PageHeading, Screen, colors, fmtDate } from "@/ui";

type Saved = { subjects: number; books: number; modules: number; lessons: number; conversations: number };

/** Counts what the offline copy on this device holds, by reading the same entries the app falls back to. */
async function countSaved(): Promise<Saved> {
  const out: Saved = { subjects: 0, books: 0, modules: 0, lessons: 0, conversations: 0 };
  const subjects = (await readEntry<Subject[] | { results: Subject[] }>("/student/subjects/")) ?? [];
  const list = Array.isArray(subjects) ? subjects : subjects.results ?? [];
  out.subjects = list.length;
  for (const s of list) {
    const rawDocs = (await readEntry<{ id: string }[] | { results: { id: string }[] }>(`/student/subjects/${s.id}/documents/`)) ?? [];
    const docs = Array.isArray(rawDocs) ? rawDocs : rawDocs.results ?? [];
    for (const d of docs) {
      const tree = await readEntry<DocumentTree>(`/student/documents/${d.id}/`);
      if (!tree) continue;
      out.books += 1;
      for (const ch of tree.chapters) for (const m of ch.modules) {
        if (m.availability !== "open") continue;
        if (await readEntry(`/student/modules/${m.id}/`)) out.modules += 1;
        const lesson = await readEntry<TeachResponse>(`/student/modules/${m.id}/teach/`);
        if (lesson?.status === "ready") out.lessons += 1;
        const conv = await readEntry<unknown[] | { results: unknown[] }>(`/student/conversations/?module=${m.id}`);
        const rows = Array.isArray(conv) ? conv : conv?.results ?? [];
        if (rows.length) out.conversations += 1;
      }
    }
  }
  return out;
}

export default function OfflineLibrary() {
  const online = useOnline();
  const sync = useSyncState();
  const saved = useAsync(countSaved, [sync.lastSync]);
  const refresh = async () => { await syncNow(); await saved.reload(); };
  const s = saved.data;
  return (
    <Screen refreshing={saved.loading} onRefresh={saved.reload}>
      <PageHeading eyebrow="OFFLINE AVAILABILITY" title="Learning without a connection" subtitle="Know what is saved and what still needs the LocalMind server."
        right={<Button title="Refresh offline copy" icon="refresh" onPress={refresh} busy={sync.running} disabled={!online} />} />
      <Notice tone={sync.lastSync ? "success" : "info"} title={sync.lastSync ? "Your saved reading is available." : "Nothing is saved on this device yet."}
        message={`${sync.lastSync ? `Saved copy from ${fmtDate(sync.lastSync)}: ${s?.modules ?? 0} modules, ${s?.lessons ?? 0} ready lessons.` : "Refresh the offline copy while you are connected."} Only published, open modules are included.`} />
      <ErrorBanner message={sync.error ? `The last refresh did not finish: ${sync.error}` : null} />
      <Grid min={320} gap={20}>
        <Card>
          <CardHead title="Available offline" />
          <ListRow plain icon="document-text-outline" title="Module text" subtitle="The modules already saved on this device." right={<Badge value={s?.modules ? "Available" : "Not saved yet"} tone={s?.modules ? "green" : "neutral"} />} />
          <ListRow plain icon="sparkles-outline" title="Ready lessons" subtitle="Previously generated lessons in your saved copy." right={<Badge value={s?.lessons ? "Available" : "None saved"} tone={s?.lessons ? "green" : "neutral"} />} />
          <ListRow plain icon="chatbubbles-outline" title="Earlier conversations" subtitle="Your latest saved questions and answers." right={<Badge value={s?.conversations ? "Available" : "None saved"} tone={s?.conversations ? "green" : "neutral"} />} />
        </Card>
        <Card>
          <CardHead title="Needs a connection" />
          <ListRow plain icon="chatbubble-ellipses-outline" tone="amber" title="New tutor questions" subtitle="New responses need the local model on the server." right={<Badge value="Connection needed" tone="amber" />} />
          <ListRow plain icon="help-circle-outline" tone="amber" title="Start or submit a quiz" subtitle="Quiz attempts and scoring remain server-side." right={<Badge value="Connection needed" tone="amber" />} />
          <ListRow plain icon="create-outline" tone="amber" title="Submit an assignment" subtitle="Submissions need a reachable server." right={<Badge value="Connection needed" tone="amber" />} />
        </Card>
      </Grid>
      <Card>
        <CardHead title="A note about shared devices" />
        <Text style={{ fontSize: 12, lineHeight: 20, color: colors.text }}>The saved copy refreshes when connectivity returns. A signed-out user must sign in again online. Signing out removes downloaded user data from this device.</Text>
      </Card>
    </Screen>
  );
}
