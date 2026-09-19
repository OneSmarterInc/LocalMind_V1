import React,{useEffect} from "react";
import {courseEvents,retryCourseEvent} from "@/offline/coursework";
import { Text } from "react-native";
import { useRouter } from "expo-router";
import type { DocumentTree, Subject, TeachResponse } from "@/api/types";
import { useAsync } from "@/hooks/useAsync";
import { useOnline } from "@/offline/connectivity";
import { readEntry } from "@/offline/store";
import { syncNow, useSyncState } from "@/offline/sync";
import { device } from "@/private/device";
import { Button, Card, CardHead, ErrorBanner, Stat, StatRow, ListRow, PageHeading, Row, Screen, colors, fmtDate } from "@/ui";

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
  useEffect(()=>{const timer=setInterval(work.reload,5000);return()=>clearInterval(timer);},[work.reload]);
  const pending=work.data?.filter(e=>e.state!=='synced')||[];
  const saved = useAsync(countSaved, [sync.lastSync]);
  const model = useAsync(async () => (await device()).status(), []);
  const refresh = async () => { await syncNow(); await saved.reload(); };
  const s = saved.data;
  return (
    <Screen refreshing={saved.loading} onRefresh={() => { saved.reload(); model.reload(); }}>
      <PageHeading eyebrow="OFFLINE AVAILABILITY" title="Course sync" subtitle="Your courses and progress, available offline."
        right={<Button title="Sync now" icon="refresh" onPress={refresh} busy={sync.running} disabled={!online} />} />
      <Row><Button title="Open Private Library" icon="book-outline" onPress={() => router.push('/student/private-library')} /><Button title="Set up Offline AI" variant="secondary" icon="hardware-chip-outline" onPress={() => router.push('/student/offline-ai')} /></Row>
      <StatRow><Stat label="Saved books" value={s?.books ?? 0} icon="book-outline" /><Stat label="Modules" value={s?.modules ?? 0} icon="layers-outline" /><Stat label="Lessons" value={s?.lessons ?? 0} icon="school-outline" /><Stat label="Pending sync" value={pending.length} icon="sync-outline" /></StatRow>
      <Text style={{color:colors.muted,fontSize:12}}>{sync.lastSync ? `Last synced ${fmtDate(sync.lastSync)}` : "No complete course copy saved yet."}</Text>
      <ErrorBanner message={sync.error ? `The last course refresh did not finish: ${sync.error}` : null} />
      <Card><CardHead title="Course synchronization"/><Text style={{color:colors.muted}}>{pending.length ? `${pending.length} updates waiting${online ? " for synchronization" : " for a connection"}.` : "All saved progress is synchronized."}</Text><ErrorBanner message={work.error}/>{pending.map(row=><Row key={row.event.id}><Text>{row.event.kind} · {row.state}{row.error?` · ${row.error}`:''}</Text>{row.state==='conflict'?<Button title="Retry synchronization" disabled={!online} onPress={()=>{void retryCourseEvent(row.event.id).then(work.reload).catch(work.reload);}}/>:null}</Row>)}</Card>
      <Card><CardHead title="Offline access" />
        <ListRow plain icon="book-outline" title="Reading and saved lessons" subtitle={`${s?.modules ?? 0} modules available on this device`} />
        <ListRow plain icon="hardware-chip-outline" title="Local AI" subtitle={model.data?.installed ? "Installed · new explanations and doubts available" : "Set up Offline AI to generate new explanations"} onPress={()=>router.push('/student/offline-ai')} />
        <Text style={{fontSize:12,color:colors.muted}}>New course content and official result confirmation need a connection. Private study stays on this device.</Text>
      </Card>
    </Screen>
  );
}
