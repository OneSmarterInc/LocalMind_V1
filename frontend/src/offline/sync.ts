import {flushCourseWork} from './coursework';
// Upload durable course events, then download the authorized course copy.
// Private study data is never included; content replacement cannot erase unsent work.
//
// One request to /api/student/offline/ returns the student's own GET
// responses (subjects, books, every open module with its text, lesson and
// quizzes, the latest tutor conversation per module), keyed by the path the
// app asks for. They replace the student's saved copy on the device; the API
// client answers from there whenever the server cannot be reached.
//
// Runs when a student signs in or the app starts online, when the server
// becomes reachable again after being offline, when the app returns to the
// foreground, and every ten minutes while it stays open. A download belongs to
// the user who started it: if that user signs out before it finishes, its
// result is thrown away and the next user starts their own.
import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { onConnectivityChange } from "./connectivity";
import { META, offlineScope, readEntry, replaceEntries, writeEntry } from "./store";

interface Bundle { version: string; generated_at: string; entries: Record<string, unknown> }
export interface SyncState { running: boolean; lastSync: string | null; error: string | null }

let state: SyncState = { running: false, lastSync: null, error: null };
const listeners = new Set<(s: SyncState) => void>();
function publish(next: Partial<SyncState>) { state = { ...state, ...next }; listeners.forEach((l) => l(state)); }

let inflight: { owner: string; promise: Promise<void> } | null = null;

export function syncNow(): Promise<void> {
  const owner = offlineScope();
  if (!owner) return Promise.resolve();
  if (inflight && inflight.owner === owner) return inflight.promise;
  let promise: Promise<void> | null = null;
  promise = (async () => {
    publish({ running: true, error: null });
    try {
      await flushCourseWork();
      const bundle = await api<Bundle>("/student/offline/", { cacheOffline: false });
      if (offlineScope() !== owner) return; // signed out (or someone else signed in) meanwhile
      const previous = await readEntry<string>(META.version);
      if (bundle.version !== previous) await replaceEntries(bundle.entries, owner);
      if (offlineScope() !== owner) return;
      const now = new Date().toISOString();
      await writeEntry(META.version, bundle.version, owner);
      await writeEntry(META.lastSync, now, owner);
      publish({ running: false, lastSync: now });
    } catch (e) {
      if (offlineScope() === owner) publish({ running: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (inflight?.promise === promise) inflight = null;
      if (offlineScope() !== owner) publish({ running: false });
    }
  })();
  inflight = { owner, promise };
  return promise;
}

let timer: ReturnType<typeof setInterval> | null = null;
let unsubscribe: (() => void) | null = null;

/** Start keeping this student's offline copy fresh. */
export async function startOfflineSync() {
  stopOfflineSync();
  publish({ lastSync: (await readEntry<string>(META.lastSync)) ?? null, error: null });
  void syncNow();
  timer = setInterval(() => { void syncNow(); }, 10 * 60 * 1000);
  unsubscribe = onConnectivityChange((online) => { if (online) void syncNow(); });
}

export function stopOfflineSync() {
  if (timer) { clearInterval(timer); timer = null; }
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  inflight = null;
  publish({ running: false, lastSync: null, error: null });
}

export function useSyncState(): SyncState {
  const [value, setValue] = useState(state);
  useEffect(() => { listeners.add(setValue); return () => { listeners.delete(setValue); }; }, []);
  return value;
}
