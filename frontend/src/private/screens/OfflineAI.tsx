import { accelerationLabel } from '../acceleration';
import {useSyncState, syncNow} from '@/offline/sync';
import {useAppFilesStatus} from "@/offline/appFiles";
import React, { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Picker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { Screen, Card, PageHeading, H2, P, Row, Button, ErrorBanner, Notice, ProgressBar, Badge, confirmAsync } from '@/ui';
import { device } from '../device';
import { deviceFit } from '../deviceFit';
import { useAuth } from '@/auth/AuthContext';
import { MODEL } from '../modelSpec';
import type { ModelStatus, ModelStorage } from '../device.types';

const gb=(n?:number)=>n===undefined?'unknown':`${(n/1024**3).toFixed(n<1024**3?2:1)} GB`;

export default function OfflineAI() {
  const router = useRouter();
  const appFilesStatus=useAppFilesStatus();
  const contentSync=useSyncState();
  const {user}=useAuth();const student=user?.role==='student';
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [storage, setStorage] = useState<ModelStorage | null>(null);
  const refreshStorage = async () => { const d = await device(); const s = d.storage ? await d.storage().catch(() => null) : null; if (alive.current) setStorage(s); };
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null), alive = useRef(true), locked = useRef(false);
  useEffect(() => { alive.current = true; void device().then(d => d.status()).then(s => { if (alive.current) setStatus(s); }).catch(e => { if (alive.current) setError(String(e.message || e)); }); void refreshStorage(); return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const run = async (fn: (signal: AbortSignal) => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setProgress(0); setError(''); setNotice('');
    const abort = new AbortController(); controller.current = abort;
    try { await fn(abort.signal); const s = await (await device()).status(); if (alive.current) setStatus(s); await refreshStorage(); }
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
  const fit = Platform.OS === 'web' ? deviceFit() : { ok: true as const };
  return <Screen>
    <PageHeading title="Offline AI" subtitle="Download a model to run AI on this device." right={<Button title={student?"Private library":"Books & modules"} variant="secondary" icon="library-outline" onPress={() => router.push(student?'/student/private-library':'/manage/books')} disabled={busy} />} />
    {!fit.ok ? <Notice inline tone="warning" title="This device may not run the offline AI" message={`${fit.reason} Reading, quizzes and sync still work. For AI lessons on a phone, install the LocalMind app or use a computer.`} /> : null}
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
      <P muted>After the model and book are installed, lesson generation, quiz generation and doubt solving run here without an internet connection or an AI API key. Checking an existing multiple-choice quiz does not need a model.</P>
      <P muted>The included download is a compact model, not a guarantee of answer quality. Compare explanations and generated questions with the original book. You may import a compatible larger GGUF when this device has enough memory.</P>
      <Row><Button title={status?.installed ? 'Download replacement model' : `Download model · ${MODEL.downloadSize}`} icon="download-outline" onPress={download} disabled={busy} /><Button title="Import a .gguf file" variant="secondary" icon="folder-open-outline" onPress={importModel} disabled={busy} /></Row>
      {busy && <><ProgressBar value={progress} /><P>{progress > 0 ? `${progress}% — downloading or verifying` : 'Preparing…'}</P><Button title="Cancel download" variant="secondary" onPress={() => controller.current?.abort()} /></>}
      {status?.installed && <Button title="Remove model only" variant="secondary" disabled={busy} onPress={() => { void run(async () => { if (await confirmAsync('Remove this local model?', 'Books, lessons and quizzes will remain. New AI work will require importing or downloading a model again.', 'Remove model', 'Keep model')) { await (await device()).removeModel(); if (alive.current) setNotice('Model removed. Your saved study material is unchanged.'); } }); }} />}
    </Card>
    {storage ? <Card>
      <Row><H2>Where the model is stored</H2><Badge value={storage.location === 'folder' ? 'Your folder' : storage.location === 'app' ? 'App storage' : 'Browser storage'} tone={storage.needsPermission ? 'amber' : 'green'} /></Row>
      {storage.location === 'app' ? <P>{`On this device, in the app's own folder: ${storage.path}`}</P> : null}
      {storage.location === 'folder' ? <P>{`In the folder you chose on this computer: ${storage.folderName}. You can see the .gguf file in File Explorer or Finder.`}</P> : null}
      {storage.location === 'browser' ? <P>{"On this computer's disk, inside this browser's private storage. It is not visible in File Explorer, and clearing this site's data in the browser deletes it."}</P> : null}
      {storage.location !== 'app' ? <P muted>{`Browser storage used by LocalMind: ${gb(storage.usedBytes)} of ${gb(storage.quotaBytes)} available. ${storage.persistent ? 'Protected from automatic clean-up.' : 'Not yet protected from automatic clean-up; select “Check and save offline app files” below to request it.'}`}</P> : null}
      {storage.needsPermission ? <Notice tone="warning" title="Folder access needed" message="The browser needs your permission again to read the model folder." action={<Button title="Allow folder access" small disabled={busy} onPress={() => { void run(async () => { const ok = await (await device()).grantModelFolder?.(); if (alive.current) setNotice(ok ? 'Folder access allowed. The model is ready.' : 'Access was not allowed. Allow it, or switch back to browser storage.'); }); }} />} /> : null}
      {storage.canChooseFolder ? <Row>
        <Button title={storage.location === 'folder' ? 'Choose a different folder' : 'Save model to a folder on this computer'} icon="folder-outline" variant="secondary" disabled={busy} onPress={() => { void run(async signal => { const s = await (await device()).chooseModelFolder!(report, signal); if (alive.current) setNotice(`Model storage set to your folder “${s.folderName}”.${status?.installed ? ' The model was copied and verified.' : ' Downloads and imports will be saved there.'}`); }); }} />
        {storage.location === 'folder' ? <Button title="Use browser storage instead" variant="secondary" disabled={busy} onPress={() => { void run(async signal => { if (!(await confirmAsync('Move the model into browser storage?', 'The model is copied and verified, then removed from your folder.', 'Move model', 'Cancel'))) return; await (await device()).useBrowserStorage!(report, signal); if (alive.current) setNotice('The model is now in browser storage.'); }); }} /> : null}
      </Row> : storage.location === 'browser' ? <P muted>Saving to a folder you choose needs Chrome or Edge on a computer. This browser keeps the model in its private storage.</P> : null}
    </Card> : null}
    <Card><H2>Content on this device</H2>
      <P>{contentSync.running ? 'Saving content for offline use…' : contentSync.lastSync ? 'Your content copy is saved on this device.' : 'Preparing your first content copy. Keep LocalMind connected until this finishes.'}</P>
      {contentSync.lastSync && <P muted>Last saved: {new Date(contentSync.lastSync).toLocaleString()}</P>}
      <P muted>Books, lessons, quizzes and generation sources save automatically while connected to LocalMind. New content must reach this device once before it can open offline. Install the model above to generate new material offline.</P>
      {contentSync.error && <P muted>Content refresh did not finish. {contentSync.lastSync ? 'Your previous saved copy is retained.' : 'Connect to LocalMind and retry.'}</P>}
      <Button title="Refresh saved content" variant="secondary" busy={contentSync.running} onPress={()=>{void syncNow();}}/>
    </Card>
    <Card><H2>Scanned books and original visuals</H2><P>English OCR is included in the offline application files. Scanned PDF pages are recognised on this device; original pages, including tables and diagrams, are saved for reading and lessons. No OCR API key is needed.</P><P muted>OCR can misread numbers and formulas. Check the preserved page. The local text model uses recognised text; it does not interpret image-only diagrams.</P></Card>
    <Card><H2>Ready to reopen offline</H2><P>Use the same installed application or browser profile. Closing the app must not delete your books. Clearing app storage or browser site data will remove them.</P>
      {Platform.OS === 'web' && <P muted>A browser needs HTTPS or localhost, enough free storage, and the application files saved below. A plain HTTP address on another computer is not an independently installed offline app.</P>}
      {Platform.OS === 'web' && <P>{appFilesStatus}</P>}
      <P muted>Preparation runs automatically while the app is open and connected. The button below is only for a manual check or recovery.</P>
      <Button title="Check and save offline app files" variant="secondary" disabled={busy} onPress={() => { void run(async () => { const note = await (await device()).prepareOffline(); if (alive.current) setNotice(note); }); }} />
    </Card>
  </Screen>;
}
