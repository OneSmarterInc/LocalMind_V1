import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Picker from 'expo-document-picker';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { Brand } from '@/ui/Shell';
import { Button, Card, ErrorBanner, H2, Loading, Notice, P, ProgressBar, Row, colors, showToast } from '@/ui';
import { device } from './device';
import { deviceFit } from './deviceFit';
import type { ModelStatus } from './device.types';
import { chooseAndDownload, type ModelChoices } from './modelPrompts';
import { modelSetup, useModelSetup } from './modelSetup';
import { SETUP_REMINDER, clearPutOff, putOffSetup, setupPutOff } from './modelSkip';
import { confirmCancelDownload, confirmContinueWithoutModel, confirmFolderAccess } from './modelDialogs';
import { confirmSignOut } from '@/hooks/unsavedGuard';

/** People already reminded in this run of the app, so the reminder appears
 *  once per start rather than on every return to the app. */
const reminded = new Set<string>();

/** Every signed-in person needs the local AI model on the device they use.
 *
 * Covers the app until this device has a model: after sign-in, and again if
 * the model is removed or goes missing. It sits above the navigator instead of
 * redirecting, so nothing the person had open is unmounted or lost.
 * Options: download (the size is shown; mobile data is allowed), import a
 * .gguf, or, on a computer whose model folder needs permission again, allow
 * access. Sign out is always available.
 *
 * Anyone can continue without the model, on the laptop, Android and iOS. Only
 * a computer that cannot run it used to be allowed to, so a phone short of
 * storage, or an administrator who never uses AI, could not get past this
 * screen. The choice is remembered for this account on this device (see
 * modelSkip), a short reminder appears once per start, and the AI features
 * themselves still say to set up the model in Offline AI. */
export function ModelGate() {
  const { logout, user } = useAuth();
  const userId = user?.id;
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
      if (s.installed) void clearPutOff(AsyncStorage, userId);
      else {
        // Read before the screen is shown, so someone who chose to continue
        // without the model does not see it flash up on every start.
        const later = await setupPutOff(AsyncStorage, userId);
        if (alive.current && later) setSkipped(true);
      }
      if (alive.current) setStatus(s);
      if (!s.installed && d.models) { const c = await d.models().catch(() => null); if (alive.current && c) setChoices(c); }
    } catch (e) {
      // If the status cannot be read, do not lock the person out.
      if (alive.current) { setStatus({ installed: true }); console.warn('[LocalMind] model status unavailable', e); }
    } finally { if (alive.current) setChecked(true); }
  }, [userId]);

  useEffect(() => {
    alive.current = true; void check();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') void check(); });
    return () => { alive.current = false; sub.remove(); };
  }, [check]);
  // A download finished (here or in Offline AI), or the model was removed or imported there.
  useEffect(() => { void check(); }, [setup.completed, setup.changes, check]);

  const putOff = checked && skipped && !status?.installed;
  useEffect(() => {
    if (!putOff || !userId || reminded.has(userId)) return;
    reminded.add(userId);
    showToast(SETUP_REMINDER);
  }, [putOff, userId]);

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
    try { if (!(await confirmFolderAccess())) return; const d = await device(); if (await d.grantModelFolder?.()) modelSetup.changed(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const busy = setup.running || importing !== null;
  // Each choice asks first, in LocalMind's own pop-up: skipping used to
  // happen on one tap, and Sign out here skipped the warning that signing out
  // removes this device's offline copy (every other Sign out asks).
  const continueWithout = async () => {
    if (!(await confirmContinueWithoutModel(modelSetup.get().running))) return;
    void putOffSetup(AsyncStorage, userId); if (alive.current) setSkipped(true);
  };
  const signOut = async () => { if (!(await confirmSignOut())) return; modelSetup.cancel(); void logout(); };
  const cancelDownload = async () => { if (await confirmCancelDownload()) modelSetup.cancel(); };
  const recommended = choices?.models.find(m => m.id === choices.recommended) ?? choices?.models[0];

  return (
    <View style={[StyleSheet.absoluteFill, styles.cover]} accessibilityViewIsModal>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={{ marginBottom: 18 }}><Brand /></View>
        <Card>
          <H2>Set up offline AI on this device</H2>
          <P>LocalMind writes lessons and quizzes and answers doubts with an AI model that runs on this device. Download it once to continue; your books and questions are never sent to the model publisher.</P>
          {recommended ? <P muted>Recommended for this phone: {recommended.title} · {recommended.downloadSize}. You can download it on Wi‑Fi or mobile data.</P> : null}
          {!fit.ok ? <Notice inline tone="warning" title="This device may not run the offline AI" message={fit.reason} /> : null}
          {status?.needsPermission ? <Notice inline tone="warning" title="Folder access needed" message="Your model is saved in a folder on this computer. The browser needs your permission again to read it." action={<Button title="Allow folder access" small onPress={() => void allowFolder()} disabled={busy} />} /> : null}
          <ErrorBanner message={error || setup.error} />
          {note ? <Notice inline tone="success" message={note} /> : null}
          {setup.running ? <>
            <ProgressBar value={setup.progress} />
            <P>{setup.progress > 0 ? `${setup.progress}% — ${setup.progress >= 98 ? 'verifying' : 'downloading'}` : 'Preparing…'}</P>
            <P muted>You can switch to another app; the download keeps going.</P>
            <Row><Button title="Cancel download" variant="secondary" onPress={() => void cancelDownload()} /></Row>
          </> : importing !== null ? <>
            <ProgressBar value={importing} /><P>Importing… {importing}%</P>
          </> : <Row>
            <Button title="Download model" icon="download-outline" onPress={() => void download()} disabled={busy} />
            <Button title="Import a .gguf file" icon="folder-open-outline" variant="secondary" onPress={() => void importModel()} disabled={busy} />
          </Row>}
        </Card>
        <P muted>Not now? Reading, quizzes and sync work without it. You can set it up any time from Offline AI.</P>
        <Row>
          {/* A running download keeps going in the background, so continuing
              does not stop it; an import is tied to this screen, so wait. */}
          <Button title={setup.running ? 'Continue while it downloads' : 'Continue without offline AI'} variant="secondary" icon="arrow-forward-outline" onPress={() => void continueWithout()} disabled={importing !== null} />
          <Button title="Sign out" variant="ghost" icon="log-out-outline" onPress={() => void signOut()} />
        </Row>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { backgroundColor: colors.bg, zIndex: 1000, justifyContent: 'center' },
  page: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 14, width: '100%', maxWidth: 640, alignSelf: 'center' },
});
