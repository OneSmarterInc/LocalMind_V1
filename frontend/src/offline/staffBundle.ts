import {api, currentSession, offlineKey, SessionChangedError} from '@/api/client';
import type {Document, Outline, Quiz, Subject, Paginated} from '@/api/types';
import {offlineScope} from './store';

/** Download authorized teaching records before their pages are opened.
 * Only successful server responses enter the bundle; an interrupted refresh
 * leaves the previous complete copy intact. Private drafts live separately.
 */
export async function staffBundle(owner: string, role: string) {
  const entries: Record<string, unknown> = {};
  const session = currentSession();
  const guard = () => { if (offlineScope() !== owner || currentSession() !== session) throw new SessionChangedError(); };
  async function get<T>(path: string, query?: Record<string, string | number>) {
    guard();
    const value = await api<T>(path, {query, cacheOffline: false, revalidate: true});
    guard(); entries[offlineKey(path, query)] = value; return value;
  }
  async function list<T>(path: string) {
    const first = await get<T[] | Paginated<T>>(path);
    if (Array.isArray(first)) return first;
    const rows = [...first.results]; let next = first.next;
    for (let page = 2; next; page++) {
      if (page > 2000) throw Error('The teaching copy is too large to finish downloading.');
      const more = await get<Paginated<T>>(path, {page}); rows.push(...more.results); next = more.next;
    }
    entries[path] = rows; return rows;
  }
  await get('/meta/choices/');
  const subjects = await list<Subject>('/faculty/subjects/');
  const docs = await list<Document>('/faculty/documents/');
  const quizzes = await list<Quiz>('/faculty/quizzes/');
  // Detail pages are saved even if the user has never opened them.
  for (const quiz of quizzes) {
    await Promise.all([get(`/faculty/quizzes/${quiz.id}/`), list(`/faculty/quizzes/${quiz.id}/attempts/`)]);
  }
  for (const doc of docs) {
    await get(`/faculty/documents/${doc.id}/`);
    const outline = await get<Outline>(`/faculty/documents/${doc.id}/outline/`);
    for (const chapter of outline.chapters) for (const module of chapter.modules) {
      if (!module.id) continue;
      // Three independent reads at a time, rather than an unbounded request burst.
      await Promise.all([
        get(`/faculty/modules/${module.id}/`),
        get(`/faculty/modules/${module.id}/lesson/`),
        get(`/faculty/modules/${module.id}/local-authoring/`),
      ]);
    }
  }
  await get('/faculty/analytics/overview/');
  await get('/faculty/analytics/activity/');
  for (const subject of subjects) {
    await get(`/faculty/subjects/${subject.id}/students/`);
    await get(`/faculty/analytics/subjects/${subject.id}/`);
    await get(`/faculty/analytics/subjects/${subject.id}/students/`);
    await get(`/faculty/analytics/subjects/${subject.id}/modules/`);
  }
  if (role === 'admin') {
    const adminSubjects = await list<Subject>('/admin/subjects/');
    for (const subject of adminSubjects) await get(`/admin/subjects/${subject.id}/`);
    await get('/admin/analytics/platform/');
    await get('/admin/analytics/platform/subjects/');
  }
  return entries;
}
