import React,{useEffect} from "react";
import {courseEvents,retryCourseEvent} from "@/offline/coursework";
import { Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import type { DocumentTree, Subject, TeachResponse } from "@/api/types";
import { useAsync } from "@/hooks/useAsync";
import { useOnline } from "@/offline/connectivity";
import { readEntry } from "@/offline/store";
import { syncNow, useSyncState } from "@/offline/sync";
import { device } from "@/private/device";
import { Badge, Button, Card, CardHead, DetailList, ErrorBanner, Grid, ListRow, PageHeading, Row, Screen, colors, fmtDate } from "@/ui";
import { everyVisible } from "@/hooks/visibleInterval";

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
  const work=useAsync(courseEvents,[sync.lastSync]);
  useEffect(()=>everyVisible(work.reload,5000),[work.reload]);
  const pending=work.data?.filter(e=>e.state!=='synced')||[];
  const saved = useAsync(countSaved, [sync.lastSync]);
  const model = useAsync(async () => (await device()).status(), []);
  const refresh = async () => { await syncNow(); await saved.reload(); };
  const s = saved.data;
  return (
    <Screen refreshing={saved.loading} onRefresh={() => { saved.reload(); model.reload(); }}>
      <PageHeading eyebrow="OFFLINE AVAILABILITY" title="Course sync" subtitle="What is saved on this device and what is waiting to send." />
      {(() => {
        const waiting = pending.length;
        const tone = !online ? "warning" : waiting ? "warning" : "success";
        const bg = tone === "success" ? colors.pale : "#FFFAEC", fg = tone === "success" ? colors.primary : "#866028";
        const title = !online ? "You are offline" : waiting ? `${waiting} item${waiting === 1 ? "" : "s"} waiting to send` : "Everything is up to date";
        const sub = `${sync.lastSync ? `Last synced ${fmtDate(sync.lastSync)}.` : "No course copy downloaded yet."} ${online ? "Connected to LocalMind; syncing happens automatically." : "Your work is saved here and sends when you reconnect."}`;
        return (
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={!online ? "cloud-offline-outline" : waiting ? "sync-outline" : "checkmark-circle-outline"} size={22} color={fg} />
              </View>
              <View style={{ flex: 1, minWidth: 220 }}>
                <Text style={{ fontSize: 16, fontWeight: "600", color: colors.ink }} accessibilityRole="header">{title}</Text>
                <Text style={{ fontSize: 12.5, color: colors.muted, marginTop: 2 }}>{sub}</Text>
              </View>
              <Button title="Sync now" icon="sync-outline" onPress={refresh} busy={sync.running} disabled={!online} />
            </View>
          </Card>
        );
      })()}
      <ErrorBanner message={sync.error ? `The last course refresh did not finish: ${sync.error}` : null} />
      <ErrorBanner message={model.error} onRetry={model.reload} />
      <Grid min={320} gap={20}>
        <Card>
          <CardHead title="Waiting to send" subtitle="Quiz answers and progress saved on this device" />
          <ErrorBanner message={work.error} />
          {pending.length ? <>{pending.map(row=><Row key={row.event.id}><Text>{row.event.kind} · {row.state}{row.error?` · ${row.error}`:''}</Text>{row.state==='conflict'?<Button title="Retry synchronization" disabled={!online} onPress={()=>{void retryCourseEvent(row.event.id).then(work.reload).catch(work.reload);}}/>:null}</Row>)}</> : <Text style={{ fontSize: 13, color: colors.muted }}>Nothing is waiting. Private Library activity is never uploaded.</Text>}
        </Card>
        <Card>
          <CardHead title="Saved on this device" subtitle="Available without a connection" />
          <DetailList items={[
            ["Subjects", String(s?.subjects ?? 0)],
            ["Books", String(s?.books ?? 0)],
            ["Modules for offline reading", String(s?.modules ?? 0)],
            ["Lessons ready", String(s?.lessons ?? 0)],
            ["Offline AI", <Badge key="ai" value={model.data?.installed ? "Installed" : "Not set up"} tone={model.data?.installed ? "green" : "neutral"} />],
          ]} />
          <Row><Button title="Open Private Library" small variant="secondary" icon="book-outline" onPress={() => router.push('/student/private-library')} /><Button title="Set up Offline AI" small variant="secondary" icon="hardware-chip-outline" onPress={() => router.push('/student/offline-ai')} /></Row>
        </Card>
      </Grid>
      <Grid min={320} gap={20}>
        <Card>
          <CardHead title="Available on this device" />
          <ListRow plain icon="document-text-outline" title="Saved course text" subtitle="Previously downloaded, authorized modules." right={<Badge value={s?.modules ? "Available" : "Not saved yet"} tone={s?.modules ? "green" : "neutral"} />} />
          <ListRow plain icon="sparkles-outline" title="Saved course lessons" subtitle="Previously prepared lessons in your course copy." right={<Badge value={s?.lessons ? "Available" : "None saved"} tone={s?.lessons ? "green" : "neutral"} />} />
          <ListRow plain icon="chatbubble-ellipses-outline" title="New doubts" subtitle="The installed local model answers from source already on this device. Institutional course conversations synchronize when connected; Private Study conversations stay local." />
          <ListRow plain icon="book-outline" title="Private books, lessons and quizzes" subtitle="Import supported books locally. Generate or regenerate with the local model, check practice answers and keep history here. No module progression locks." />
        </Card>
        <Card>
          <CardHead title="Needs the institution server" />
          <ListRow plain icon="help-circle-outline" tone="amber" title="Official result confirmation" subtitle="Downloaded MCQ quizzes can be attempted offline. Immediate results are marked locally; answers are regraded by the server after synchronization." />
          <ListRow plain icon="create-outline" tone="amber" title="Released course results" subtitle="Receiving a new faculty result release needs a reachable server." />
          <ListRow plain icon="cloud-download-outline" tone="amber" title="New shared books and course updates" subtitle="Download while connected; use the saved private copy afterward. A local-network institution server can work without public internet." />
        </Card>
      </Grid>
      <Card>
        <CardHead title="Your data on a shared device" />
        <Text style={{ fontSize: 12, lineHeight: 20, color: colors.text }}>Stay signed in to reopen offline. Unsent course work remains stored for the same account. Signing out clears the downloaded course cache; a new institutional sign-in needs a connection. Private Library records remain in a separate account-scoped local store and are not shown to another account. Remove private books explicitly before handing over a device. Clearing application or browser storage removes local books, history and models. This is storage separation, not encryption against someone who controls the device.</Text>
      </Card>
    </Screen>
  );
}
