import React from "react";
import { Text } from "react-native";
import { useRouter } from "expo-router";
import type { DocumentTree, Subject, TeachResponse } from "@/api/types";
import { useAsync } from "@/hooks/useAsync";
import { useOnline } from "@/offline/connectivity";
import { readEntry } from "@/offline/store";
import { syncNow, useSyncState } from "@/offline/sync";
import { device } from "@/private/device";
import { Badge, Button, Card, CardHead, ErrorBanner, Grid, ListRow, Notice, PageHeading, Row, Screen, colors, fmtDate } from "@/ui";

type Saved = { subjects: number; books: number; modules: number; lessons: number; conversations: number };
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
  const online = useOnline(), router = useRouter();
  const sync = useSyncState();
  const saved = useAsync(countSaved, [sync.lastSync]);
  const model = useAsync(async () => (await device()).status(), []);
  const refresh = async () => { await syncNow(); await saved.reload(); };
  const s = saved.data;
  return (
    <Screen refreshing={saved.loading} onRefresh={() => { saved.reload(); model.reload(); }}>
      <PageHeading eyebrow="OFFLINE AVAILABILITY" title="Learning without a connection" subtitle="Private study stays on this device. Official course records stay with your institution."
        right={<Button title="Refresh course copy" icon="refresh" onPress={refresh} busy={sync.running} disabled={!online} />} />
      <Row><Button title="Open Private Library" icon="book-outline" onPress={() => router.push('/student/private-library')} /><Button title="Set up Offline AI" variant="secondary" icon="hardware-chip-outline" onPress={() => router.push('/student/offline-ai')} /></Row>
      <Notice tone={model.data?.installed ? "success" : "info"} title={model.data?.installed ? "A local model is installed." : "Local AI setup is needed for new explanations and doubts."}
        message="Install a model and save offline application files in Offline AI before disconnecting. The same model serves Private Library and new doubts about downloaded, authorized course modules. Saved reading and checking existing private MCQs do not need inference." />
      <ErrorBanner message={model.error} onRetry={model.reload} />
      <Notice tone={sync.lastSync ? "success" : "info"} title={sync.lastSync ? "Your course copy is saved." : "No complete course download yet."}
        message={`${sync.lastSync ? `Course copy from ${fmtDate(sync.lastSync)}: ${s?.modules ?? 0} modules, ${s?.lessons ?? 0} ready lessons.` : "Refresh the course copy while connected."} Only published, open course modules are included. This count does not include your separate Private Library.`} />
      <ErrorBanner message={sync.error ? `The last course refresh did not finish: ${sync.error}` : null} />
      <Grid min={320} gap={20}>
        <Card>
          <CardHead title="Available on this device" />
          <ListRow plain icon="document-text-outline" title="Saved course text" subtitle="Previously downloaded, authorized modules." right={<Badge value={s?.modules ? "Available" : "Not saved yet"} tone={s?.modules ? "green" : "neutral"} />} />
          <ListRow plain icon="sparkles-outline" title="Saved course lessons" subtitle="Previously prepared lessons in your course copy." right={<Badge value={s?.lessons ? "Available" : "None saved"} tone={s?.lessons ? "green" : "neutral"} />} />
          <ListRow plain icon="chatbubble-ellipses-outline" title="New doubts" subtitle="The installed local model answers from source already on this device. Offline conversations are not uploaded." />
          <ListRow plain icon="book-outline" title="Private books, lessons and quizzes" subtitle="Import supported books locally. Generate or regenerate with the local model, check practice answers and keep history here. No module progression locks." />
        </Card>
        <Card>
          <CardHead title="Needs the institution server" />
          <ListRow plain icon="help-circle-outline" tone="amber" title="Official course assessments" subtitle="Starting and submitting institutional quiz attempts still use the server. Private practice is different and works locally." />
          <ListRow plain icon="create-outline" tone="amber" title="Assignment submissions and released results" subtitle="Sending official work or receiving a faculty result release needs a reachable server." />
          <ListRow plain icon="cloud-download-outline" tone="amber" title="New shared books and course updates" subtitle="Download while connected; use the saved private copy afterward. A local-network institution server can work without public internet." />
        </Card>
      </Grid>
      <Card>
        <CardHead title="Your data on a shared device" />
        <Text style={{ fontSize: 12, lineHeight: 20, color: colors.text }}>Stay signed in to reopen offline. Signing out clears the downloaded course cache; a new institutional sign-in needs a connection. Private Library records remain in a separate account-scoped local store and are not shown to another account. Remove private books explicitly before handing over a device. Clearing application or browser storage removes local books, history and models. This is storage separation, not encryption against someone who controls the device.</Text>
      </Card>
    </Screen>
  );
}
