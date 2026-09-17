import React, { useRef, useState } from 'react';
import { Platform, Switch, View } from 'react-native';
import * as Picker from 'expo-document-picker';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/api/client';
import { manage } from '@/api/endpoints';
import { useAsync } from '@/hooks/useAsync';
import { Screen, Card, PageHeading, CardHead, H2, P, Button, Input, Row, ErrorBanner, Notice, Empty, Badge, Dropdown, Split, TileIcon, colors, confirmAsync, confirmDeleteAsync } from '@/ui';
import { sharedBooks, deleteSharedBook, type SharedBook } from '../catalogue';
import { MAX_BOOK_BYTES } from '../core';

/** A file size a person reads at a glance, rather than a raw byte count. */
function fileSize(bytes: number) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

/** Sharing books only. No block editor, model keys or teaching-aid approval steps. */
export default function SharedLibrary() {
  const user = useAuth().user;
  const q = useAsync(() => sharedBooks(true), []), subjects = useAsync(() => manage.subjects(), []);
  const [title, setTitle] = useState(''), [subject, setSubject] = useState('');
  const [file, setFile] = useState<Picker.DocumentPickerAsset | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const lock = useRef(false);
  const action = async (fn: () => Promise<void>) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await fn(); await q.reload(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { lock.current = false; setBusy(false); }
  };
  const choose = async () => {
    const result = await Picker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (!result.canceled) { setFile(result.assets[0]); if (!title) setTitle(result.assets[0].name.replace(/\.[^.]+$/, '')); }
  };
  const upload = () => action(async () => {
    if (!file) throw new Error('Choose a book first.');
    if ((file.size || 0) > MAX_BOOK_BYTES) throw new Error('Choose a book up to 100 MB.');
    if (user?.role !== 'admin' && !subject) throw new Error('Choose the subject whose students should receive this book.');
    if (!(await confirmAsync('Share this book for private study?', 'Students in the selected audience can download a full copy and study every module privately, without progression locks. Share only material you are permitted to distribute. Their private activity will not be reported to you.', 'Upload and share', 'Cancel'))) return;
    const form = new FormData(); form.append('title', title.trim()); form.append('share_confirmed', 'true');
    if (subject) form.append('subject_id', subject);
    if (Platform.OS === 'web' && file.file) form.append('file', file.file);
    else form.append('file', { uri: file.uri, name: file.name, type: file.mimeType || 'application/octet-stream' } as unknown as Blob);
    await api('/faculty/private-library/', { method: 'POST', form });
    setFile(null); setTitle(''); setNotice('Book shared. Students can add it from “From my institution” in their Private library.');
  });
  const toggle = (b: SharedBook, active: boolean) => action(async () => {
    await api(`/faculty/private-library/${b.id}/`, { method: 'PATCH', body: { active } });
    setNotice(active ? 'Book is available for new downloads.' : 'New downloads are disabled. Copies already saved on student devices are not remotely deleted.');
  });
  const remove = (b: SharedBook) => action(async () => {
    if (!(await confirmDeleteAsync(`Remove “${b.title}”?`, 'This stops new downloads and deletes the stored file. Copies students have already saved to their own devices are not removed.', { okLabel: 'Remove book' }))) return;
    await deleteSharedBook(b.id);
    setNotice('Book removed. It is no longer available for students to download.');
  });
  const own = (q.data || []).filter(b => b.kind === 'shared');
  const available = own.filter(b => b.active).length;

  const uploadCard = (
    <Card>
      <CardHead title="Upload a book" subtitle="PDF (including English scans), DOCX, TXT or Markdown · up to 100 MB" icon="cloud-upload-outline" />
      <Input label="Book title" value={title} maxLength={300} onChangeText={setTitle} editable={!busy} placeholder="e.g. Electric Charges and Fields" />
      <Dropdown label="Who can add this book?" value={subject} options={[...(user?.role === 'admin' ? [{ value: '', label: 'All students' }] : [{ value: '', label: 'Choose a subject' }]), ...(subjects.data || []).map(s => ({ value: s.id, label: `${s.code} · ${s.name}` }))]} onChange={v => { if (!busy) setSubject(v); }} />
      <Row style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Button title={file ? 'Choose a different file' : 'Choose book file'} variant="secondary" icon="document-attach-outline" onPress={() => { void choose().catch(e => setError(String(e))); }} disabled={busy} />
        {file ? <P small muted>{file.name}{file.size ? ` · ${fileSize(file.size)}` : ''}</P> : null}
      </Row>
      <Row><Button title="Upload and share book" icon="cloud-upload-outline" busy={busy} disabled={!file || !title.trim() || (user?.role !== 'admin' && !subject)} onPress={upload} /></Row>
      <P small muted>No question bank, content blocks, teaching aids or publisher keys are required. This does not create an official classroom quiz or change existing assessment records.</P>
    </Card>
  );

  return <Screen refreshing={q.loading} onRefresh={q.reload}>
    <PageHeading eyebrow="PRIVATE STUDY BOOKS" title="Books for private study" subtitle="Share a book. Students create their own lessons, quizzes and doubt sessions on their devices." />
    <ErrorBanner message={error || q.error || subjects.error} onRetry={q.reload} />
    {!!notice && <Notice tone="success" message={notice} />}
    <Split
      main={
        <Card>
          <CardHead title="Shared private-study books" subtitle={own.length ? `${own.length} book${own.length === 1 ? '' : 's'} · ${available} available to download` : undefined} />
          {!own.length
            ? <Empty icon="book-outline" title="No extra books shared yet" text="Upload a book on the right. Published books from enrolled subjects also appear automatically in each student's Private library." />
            : <View style={{ gap: 10 }}>
                {own.map(b => (
                  <View key={b.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, gap: 12, backgroundColor: colors.surface }}>
                    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <Row style={{ gap: 12, flex: 1, minWidth: 0, alignItems: 'flex-start' }}>
                        <TileIcon icon="document-text-outline" />
                        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                          <H2>{b.title}</H2>
                          <P small muted>{b.subject || 'All students'} · {b.original_name}{b.file_size ? ` · ${fileSize(b.file_size)}` : ''}</P>
                        </View>
                      </Row>
                      <Badge value={b.active ? 'Available' : 'Not shared'} tone={b.active ? 'green' : 'neutral'} />
                    </Row>
                    <View style={{ height: 1, backgroundColor: colors.rowLine }} />
                    <Row style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <Row style={{ gap: 10, alignItems: 'center' }}>
                        <Switch accessibilityLabel={`Share ${b.title}`} value={b.active} disabled={busy} onValueChange={v => { void toggle(b, v); }} />
                        <P small muted>Available for students to download</P>
                      </Row>
                      <Button title="Remove" small variant="danger" icon="trash-outline" disabled={busy} onPress={() => { void remove(b); }} />
                    </Row>
                  </View>
                ))}
              </View>}
        </Card>
      }
      side={
        <View style={{ gap: 16 }}>
          {uploadCard}
          <Notice title="Course books are included" message="Published course books are visible to students with active access to that subject. Private copies have no quiz-based progression locks. Classroom access and official assessments keep their own rules." />
        </View>
      }
    />
  </Screen>;
}
