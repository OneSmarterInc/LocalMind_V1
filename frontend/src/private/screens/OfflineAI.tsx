import { accelerationLabel } from '../acceleration';
import {useSyncState, syncNow} from '@/offline/sync';
import {useAppFilesStatus} from "@/offline/appFiles";
import React, { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Picker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { Screen, Card, PageHeading, H2, P, Row, Button, ErrorBanner, Notice, ProgressBar, Badge, confirmAsync } from '@/ui';
import { device } from '../device';
import { useAuth } from '@/auth/AuthContext';
import { MODEL } from '../modelSpec';
import type { ModelStatus } from '../device.types';

export default function OfflineAI() {
  const router = useRouter();
  const appFilesStatus=useAppFilesStatus();
  const contentSync=useSyncState();
  const {user}=useAuth();const student=user?.role==='student';
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null), alive = useRef(true), locked = useRef(false);
  useEffect(() => { alive.current = true; void device().then(d => d.status()).then(s => { if (alive.current) setStatus(s); }).catch(e => { if (alive.current) setError(String(e.message || e)); }); return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const run = async (fn: (signal: AbortSignal) => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setProgress(0); setError(''); setNotice('');
    const abort = new AbortController(); controller.current = abort;
    try { await fn(abort.signal); const s = await (await device()).status(); if (alive.current) setStatus(s); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { locked.current = false; controller.current = null; if (alive.current) setBusy(false); }
  };
  const report = (p: number) => { if (alive.current) setProgress(Math.round(p * 100)); };
  const download = () => run(async signal => {
    if (!(await confirmAsync('Download local AI?', `${MODEL.title}: approximately ${MODEL.downloadSize}. Internet is used only to download the model. It will run on this device; your books and questions are not sent to the model publisher.`, 'Download', 'Cancel'))) return;
    await (await device()).download(report, signal);
    if (alive.current) setNotice('Model saved and verified. Private study and offline course doubts use this same model.');
  });
  const importModel = () => run(async (signal) => {
    const selected = await Picker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (selected.canceled) return;
    const f = selected.assets[0];
    await (await device()).importModel({ name: f.name, uri: f.uri, size: f.size, file: f.file }, report, signal);
    if (alive.current) setNotice('Local GGUF imported. Use only a model from a source you trust. Its compatibility is checked when it is loaded.');
  });
  return <Screen>
    <PageHeading title="Offline AI" subtitle="Download a model to run AI on this device." right={<Button title={student?"Private library":"Books & modules"} variant="secondary" icon="library-outline" onPress={() => router.push(student?'/student/private-library':'/manage/books')} disabled={busy} />} />
    <ErrorBanner message={error} />
    {!!notice && <Notice tone="success" message={notice} />}
    <Card>
      <Row><H2>Model on this device</H2><Badge value={status?.installed ? 'Downloaded' : 'Not downloaded'} tone={status?.installed ? 'green' : 'neutral'} /></Row>
      <P>{status?.name || MODEL.title}</P>
      <P muted>Available download: {MODEL.title} · {MODEL.downloadSize}.</P>
      {status?.installed && status.hash !== MODEL.sha256 && <P muted>Select Download replacement model to switch to Qwen3 1.7B. Your current model stays installed until the new download is complete and verified. Your books and saved study material are kept.</P>}
      {status?.loaded && <P muted>Local inference: {accelerationLabel({accelerator:status.accelerator || 'unconfirmed',gpuLayers:status.gpuLayers},status.threads)}. One response at a time.</P>}
      {!!status?.accelerationNote && <P muted>{status.accelerationNote}</P>}
      {!status?.loaded && <P muted>GPU acceleration is requested when the model loads. Actual hardware use appears here after generation.</P>}
      <P muted>Generate lessons, quizzes and answers on this device.</P>

      <Row><Button title={status?.installed ? 'Download replacement model' : `Download model · ${MODEL.downloadSize}`} icon="download-outline" onPress={download} disabled={busy} /><Button title="Import a .gguf file" variant="secondary" icon="folder-open-outline" onPress={importModel} disabled={busy} /></Row>
      {busy && <><ProgressBar value={progress} /><P>{progress > 0 ? `${progress}% — downloading or verifying` : 'Preparing…'}</P><Button title="Cancel download" variant="secondary" onPress={() => controller.current?.abort()} /></>}
      {status?.installed && <Button title="Remove model only" variant="secondary" disabled={busy} onPress={() => { void run(async () => { if (await confirmAsync('Remove this local model?', 'Books, lessons and quizzes will remain. New AI work will require importing or downloading a model again.', 'Remove model', 'Keep model')) { await (await device()).removeModel(); if (alive.current) setNotice('Model removed. Your saved study material is unchanged.'); } }); }} />}
    </Card>
    <Card><H2>Content on this device</H2>
      <P>{contentSync.running ? 'Saving content for offline use…' : contentSync.lastSync ? 'Your content copy is saved on this device.' : 'Preparing your first content copy. Keep LocalMind connected until this finishes.'}</P>
      {contentSync.lastSync && <P muted>Last saved: {new Date(contentSync.lastSync).toLocaleString()}</P>}

      {contentSync.error && <P muted>Content refresh did not finish. {contentSync.lastSync ? 'Your previous saved copy is retained.' : 'Connect to LocalMind and retry.'}</P>}
      <Button title="Refresh saved content" variant="secondary" busy={contentSync.running} onPress={()=>{void syncNow();}}/>
    </Card>

    <Card><H2>Ready to reopen offline</H2><P muted>Use this browser profile to reopen your saved books. Clearing site data removes local content.</P>
      {Platform.OS === 'web' && <P muted>Offline access requires HTTPS or localhost.</P>}
      {Platform.OS === 'web' && <P>{appFilesStatus}</P>}

      <Button title="Check offline access" variant="secondary" disabled={busy} onPress={() => { void run(async () => { const note = await (await device()).prepareOffline(); if (alive.current) setNotice(note); }); }} />
    </Card>
  </Screen>;
}
