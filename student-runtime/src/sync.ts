import type { StudyStore } from './store';
import { requireThat } from './core';

// A build-time publisher endpoint, never a URL taken from downloaded content.
// Keep empty until operator privacy/logging/consent review is complete.
export const OBSERVATION_URL = process.env.EXPO_PUBLIC_STUDY_OBSERVATION_URL || '';
let inflight: Promise<void> | null = null;
let controller: AbortController | null = null;
export function stopSharingRequest() { controller?.abort(); }

export function syncObservations(store: StudyStore): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    if (!OBSERVATION_URL || !(await store.sharing())) return;
    requireThat(/^https:\/\//.test(OBSERVATION_URL), 'Optional sharing requires an HTTPS publisher endpoint');
    const events = await store.pending();
    if (!events.length || !(await store.sharing())) return;
    const abort = new AbortController(); controller = abort;
    const timeout = setTimeout(() => abort.abort(), 10000);
    try {
      // Only explicitly projected flag events. The store's learner table is never read here.
      const res = await fetch(OBSERVATION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'omit', body: JSON.stringify({ events }), signal: abort.signal });
      if (!res.ok) throw new Error('Optional observations were not sent; they remain queued. Studying is unaffected.');
      const result = await res.json() as { accepted?: unknown };
      const sent = new Set(events.map(e => e.id));
      requireThat(Array.isArray(result.accepted) && result.accepted.every(id => typeof id === 'string' && sent.has(id)), 'Invalid observation acknowledgement');
      await store.acknowledge(result.accepted as string[]);
    } finally { clearTimeout(timeout); controller = null; }
  })().finally(() => { inflight = null; });
  return inflight;
}
