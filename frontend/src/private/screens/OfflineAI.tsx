import React, { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Picker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { Screen, Card, PageHeading, H2, P, Row, Button, ErrorBanner, Notice, ProgressBar, Badge, confirmAsync } from '@/ui';
import { device } from '../device';
import { MODEL } from '../modelSpec';
import type { ModelStatus } from '../device.types';

export default function OfflineAI() {
  const router = useRouter();
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
    <PageHeading title="Offline AI" subtitle="One local model for your private library and course doubts." right={<Button title="Private library" variant="secondary" icon="library-outline" onPress={() => router.push('/student/private-library')} disabled={busy} />} />
    <ErrorBanner message={error} />
    {!!notice && <Notice tone="success" message={notice} />}
    <Card>
      <Row><H2>Model on this device</H2><Badge value={status?.installed ? 'Downloaded' : 'Not downloaded'} tone={status?.installed ? 'green' : 'neutral'} /></Row>
      <P>{status?.name || MODEL.title}</P>
      {Platform.OS==='web' && status?.loaded && <P muted>Local inference: {status.threads || 1} CPU thread(s). One response at a time.</P>}
      <P muted>After the model and book are installed, lesson generation, quiz generation and doubt solving run here without an internet connection or an AI API key. Checking an existing multiple-choice quiz does not need a model.</P>
      <P muted>The included download is a compact model, not a guarantee of answer quality. Compare explanations and generated questions with the original book. You may import a compatible larger GGUF when this device has enough memory.</P>
      <Row><Button title={status?.installed ? 'Download replacement model' : `Download model · ${MODEL.downloadSize}`} icon="download-outline" onPress={download} disabled={busy} /><Button title="Import a .gguf file" variant="secondary" icon="folder-open-outline" onPress={importModel} disabled={busy} /></Row>
      {busy && <><ProgressBar value={progress} /><P>{progress > 0 ? `${progress}% — downloading or verifying` : 'Preparing…'}</P><Button title="Cancel download" variant="secondary" onPress={() => controller.current?.abort()} /></>}
      {status?.installed && <Button title="Remove model only" variant="secondary" disabled={busy} onPress={() => { void run(async () => { if (await confirmAsync('Remove this local model?', 'Books, lessons and quizzes will remain. New AI work will require importing or downloading a model again.', 'Remove model', 'Keep model')) { await (await device()).removeModel(); if (alive.current) setNotice('Model removed. Your saved study material is unchanged.'); } }); }} />}
    </Card>
    <Card><H2>Scanned books and original visuals</H2><P>English OCR is included in the offline application files. Scanned PDF pages are recognised on this device; original pages, including tables and diagrams, are saved for reading and lessons. No OCR API key is needed.</P><P muted>OCR can misread numbers and formulas. Check the preserved page. The local text model uses recognised text; it does not interpret image-only diagrams.</P></Card>
    <Card><H2>Ready to reopen offline</H2><P>Use the same installed application or browser profile. Closing the app must not delete your books. Clearing app storage or browser site data will remove them.</P>
      {Platform.OS === 'web' && <P muted>A browser needs HTTPS or localhost, enough free storage, and the application files saved below. A plain HTTP address on another computer is not an independently installed offline app.</P>}
      <Button title="Check and save offline app files" variant="secondary" disabled={busy} onPress={() => { void run(async () => { const note = await (await device()).prepareOffline(); if (alive.current) setNotice(note); }); }} />
    </Card>
  </Screen>;
}
