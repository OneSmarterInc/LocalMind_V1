import React, { useRef, useState } from 'react';
import { Platform, Switch } from 'react-native';
import * as Picker from 'expo-document-picker';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/api/client';
import { manage } from '@/api/endpoints';
import { useAsync } from '@/hooks/useAsync';
import { Screen, Card, PageHeading, CardHead, H2, P, Button, Input, Row, ErrorBanner, Notice, Empty, Badge, Dropdown, confirmAsync } from '@/ui';
import { sharedBooks, type SharedBook } from '../catalogue';
import { MAX_BOOK_BYTES } from '../core';

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
    if ((file.size || 0) > MAX_BOOK_BYTES) throw new Error('Choose a book up to 35 MB.');
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
  const own = (q.data || []).filter(b => b.kind === 'shared');
  return <Screen refreshing={q.loading} onRefresh={q.reload}>
    <PageHeading title="Books for private study" subtitle="Share a book. Students create their own lessons, quizzes and doubt sessions on their devices." />
    <ErrorBanner message={error || q.error || subjects.error} onRetry={q.reload} />
    {!!notice && <Notice tone="success" message={notice} />}
    <Card><CardHead title="Upload a book" subtitle="PDF (including English scans), DOCX, TXT or Markdown · up to 35 MB" />
      <Input label="Book title" value={title} maxLength={300} onChangeText={setTitle} editable={!busy} />
      <Dropdown label="Who can add this book?" value={subject} options={[...(user?.role === 'admin' ? [{ value: '', label: 'All students' }] : [{ value: '', label: 'Choose a subject' }]), ...(subjects.data || []).map(s => ({ value: s.id, label: `${s.code} · ${s.name}` }))]} onChange={v => { if (!busy) setSubject(v); }} />
      <Row><Button title={file ? 'Choose a different file' : 'Choose book file'} variant="secondary" icon="document-attach-outline" onPress={() => { void choose().catch(e => setError(String(e))); }} disabled={busy} />{file && <P>{file.name}</P>}</Row>
      <Row><Button title="Upload and share book" icon="cloud-upload-outline" busy={busy} disabled={!file || !title.trim() || (user?.role !== 'admin' && !subject)} onPress={upload} /></Row>
      <P muted>No question bank, content blocks, teaching aids or publisher keys are required. This does not create an official classroom quiz or change existing assessment records.</P>
    </Card>
    <Card><H2>Shared private-study books</H2>{!own.length ? <Empty title="No extra books shared yet" text="Upload a book above. Published books from enrolled subjects also appear automatically in each student's Private library." /> : own.map(b => <Card key={b.id}><Row><H2>{b.title}</H2><Badge value={b.active ? 'Available' : 'Not shared'} tone={b.active ? 'green' : 'neutral'} /></Row><P muted>{b.subject || 'All students'} · {b.original_name}</P><Row><P>Available for students to download</P><Switch accessibilityLabel={`Share ${b.title}`} value={b.active} disabled={busy} onValueChange={v => { void toggle(b, v); }} /></Row></Card>)}</Card>
    <Notice title="Course books are included" message="Published course books are visible to students with active access to that subject. Private copies have no quiz-based progression locks. Classroom access and official assessments keep their own rules." />
  </Screen>;
}
