import * as Picker from 'expo-document-picker';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { Brand } from '@/ui/Shell';
import { Button, Card, ErrorBanner, H2, Loading, Notice, P, ProgressBar, Row, colors } from '@/ui';
import { device } from './device';
import { deviceFit } from './deviceFit';
import type { ModelStatus } from './device.types';
import { chooseAndDownload, type ModelChoices } from './modelPrompts';
import { modelSetup, useModelSetup } from './modelSetup';

/** Every signed-in person needs the local AI model on the device they use.
 *
 * Covers the app until this device has a model: after sign-in, and again if
 * the model is removed or goes missing. It sits above the navigator instead of
 * redirecting, so nothing the person had open is unmounted or lost.
 * Options: download (the size is shown; mobile data is allowed), import a
 * .gguf, or, on a computer whose model folder needs permission again, allow
 * access. Sign out is always available. A computer that cannot run the model
 * (see deviceFit) may continue without it, because blocking it would lock the
 * person out for good. */
export function ModelGate() {
  const { logout } = useAuth();
  const setup = useModelSetup();
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [checked, setChecked] = useState(false);
  const [choices, setChoices] = useState<ModelChoices | null>(null);
  const [error, setError] = useState(''), [note, setNote] = useState('');
  const [importing, setImporting] = useState<number | null>(null);
  const [skipped, setSkipped] = useState(false);
  const alive = useRef(true);
  const fit = Platform.OS === 'web' ? deviceFit() : { ok: true as const };

  const check = useCallback(async () => {
    try {
      const d = await device();
      const s = await d.status();
      if (alive.current) setStatus(s);
      if (!s.installed && d.models) { const c = await d.models().catch(() => null); if (alive.current && c) setChoices(c); }
    } catch (e) {
      // If the status cannot be read, do not lock the person out.
      if (alive.current) { setStatus({ installed: true }); console.warn('[LocalMind] model status unavailable', e); }
    } finally { if (alive.current) setChecked(true); }
  }, []);

  useEffect(() => {
    alive.current = true; void check();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') void check(); });
    return () => { alive.current = false; sub.remove(); };
  }, [check]);
  // A download finished (here or in Offline AI), or the model was removed or imported there.
  useEffect(() => { void check(); }, [setup.completed, setup.changes, check]);

  if (!checked) return <View style={[StyleSheet.absoluteFill, styles.cover]}><Loading /></View>;
  if (status?.installed || skipped) return null;

  const download = async () => {
    setError(''); setNote(''); modelSetup.clearError();
    try { await chooseAndDownload(choices, n => setNote(n)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const importModel = async () => {
    setError(''); setNote('');
    try {
      const selected = await Picker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (selected.canceled) return;
      const f = selected.assets[0];
      setImporting(0);
      await (await device()).importModel({ name: f.name, uri: f.uri, size: f.size, file: f.file }, p => setImporting(Math.round(p * 100)));
      modelSetup.changed();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setImporting(null); }
  };
  const allowFolder = async () => {
    setError('');
    try { const d = await device(); if (await d.grantModelFolder?.()) modelSetup.changed(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const busy = setup.running || importing !== null;
  const recommended = choices?.models.find(m => m.id === choices.recommended) ?? choices?.models[0];

  return (
    <View style={[StyleSheet.absoluteFill, styles.cover]} accessibilityViewIsModal>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={{ marginBottom: 18 }}><Brand /></View>
        <Card>
          <H2>Set up offline AI on this device</H2>
          <P>LocalMind writes lessons and quizzes and answers doubts with an AI model that runs on this device. Download it once to continue; your books and questions are never sent to the model publisher.</P>
          {recommended ? <P muted>Recommended for this phone: {recommended.title} · {recommended.downloadSize}. You can download it on Wi‑Fi or mobile data.</P> : null}
          {!fit.ok ? <Notice inline tone="warning" title="This device may not run the offline AI" message={`${fit.reason} You can continue without it: reading, quizzes and sync still work.`} /> : null}
          {status?.needsPermission ? <Notice inline tone="warning" title="Folder access needed" message="Your model is saved in a folder on this computer. The browser needs your permission again to read it." action={<Button title="Allow folder access" small onPress={() => void allowFolder()} disabled={busy} />} /> : null}
          <ErrorBanner message={error || setup.error} />
          {note ? <Notice inline tone="success" message={note} /> : null}
          {setup.running ? <>
            <ProgressBar value={setup.progress} />
            <P>{setup.progress > 0 ? `${setup.progress}% — ${setup.progress >= 98 ? 'verifying' : 'downloading'}` : 'Preparing…'}</P>
            <P muted>You can switch to another app; the download keeps going.</P>
            <Row><Button title="Cancel download" variant="secondary" onPress={() => modelSetup.cancel()} /></Row>
          </> : importing !== null ? <>
            <ProgressBar value={importing} /><P>Importing… {importing}%</P>
          </> : <Row>
            <Button title="Download model" icon="download-outline" onPress={() => void download()} disabled={busy} />
            <Button title="Import a .gguf file" icon="folder-open-outline" variant="secondary" onPress={() => void importModel()} disabled={busy} />
          </Row>}
        </Card>
        <Row>
          {!fit.ok ? <Button title="Continue without offline AI" variant="ghost" onPress={() => setSkipped(true)} disabled={busy} /> : null}
          <Button title="Sign out" variant="ghost" icon="log-out-outline" onPress={() => { modelSetup.cancel(); void logout(); }} />
        </Row>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { backgroundColor: colors.bg, zIndex: 1000, justifyContent: 'center' },
  page: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 14, width: '100%', maxWidth: 640, alignSelf: 'center' },
});
