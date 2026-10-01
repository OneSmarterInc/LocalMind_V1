import {staffBundle} from './staffBundle';
import {courseEvents, flushCourseWork} from './coursework';
// Upload durable course events, then download the authorized course copy.
// Private study data is never included; content replacement cannot erase unsent work.
//
// One request to /api/student/offline/ returns the student's own GET
// responses (subjects, books, every open module with its text, lesson and
// quizzes, the latest tutor conversation per module), keyed by the path the
// app asks for. They replace the student's saved copy on the device; the API
// client answers from there whenever the server cannot be reached.
//
// Staff copies include authorized teaching pages and revisioned generation sources.
// Runs when a user signs in or the app starts online, when the server
// becomes reachable again after being offline, when the app returns to the
// foreground (if the copy is more than two minutes old), and every fifteen
// minutes while it stays open and visible. A download belongs to
// the user who started it: if that user signs out before it finishes, its
// result is thrown away and the next user starts their own.
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { api, currentSession } from "@/api/client";
import { onConnectivityChange } from "./connectivity";
import { META, offlineScope, readEntry, replaceEntries, writeEntry } from "./store";

interface Bundle { version: string; generated_at: string; entries?: Record<string, unknown>; unchanged?: boolean }

/** How often the full copy is refreshed while the app stays open.
 *
 * It used to be every minute. For staff that meant one request per module
 * (three, two carrying the module's whole text), per quiz and per subject,
 * about 260 requests a minute for a two-book teacher, and the whole copy was
 * rewritten into storage each time because its "version" was the clock. For a
 * student it meant downloading the entire course every minute. Screens online
 * always read from the server, so this only decides how fresh the offline
 * copy is. */
export const FULL_SYNC_MS = 15 * 60 * 1000;
/** Pending offline course work (quiz answers, reading) is retried this often. */
export const RETRY_MS = 60 * 1000;
/** Returning to the app refreshes the copy only if it is older than this. */
export const FOREGROUND_MIN_MS = 2 * 60 * 1000;

/** A short, stable fingerprint of the staff copy, so storage is rewritten only
 *  when something changed (FNV-1a over the JSON). */
export function copyVersion(entries: Record<string, unknown>): string {
  const text = JSON.stringify(entries);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `s${(h >>> 0).toString(16)}:${text.length}`;
}

/** The browser's Data Saver setting (Chrome, Edge, Android browsers). */
function savingData(): boolean {
  const nav = typeof navigator === "undefined" ? undefined : (navigator as unknown as { connection?: { saveData?: boolean } });
  return !!nav?.connection?.saveData;
}

/** In front of the person: a visible tab or the app on screen. */
function onScreen(): boolean {
  if (typeof document !== "undefined" && typeof document.visibilityState === "string" && document.visibilityState !== "visible") return false;
  return AppState.currentState === undefined || AppState.currentState === "active";
}
export interface SyncState { running: boolean; lastSync: string | null; error: string | null }

let state: SyncState = { running: false, lastSync: null, error: null };
const listeners = new Set<(s: SyncState) => void>();
function publish(next: Partial<SyncState>) { state = { ...state, ...next }; listeners.forEach((l) => l(state)); }

let activeRole = "student";
let inflight: { owner: string; promise: Promise<void> } | null = null;

export function syncNow(): Promise<void> {
  const owner = offlineScope();
  const mine = currentSession();
  if (!owner) return Promise.resolve();
  if (inflight && inflight.owner === owner) return inflight.promise;
  let promise: Promise<void> | null = null;
  promise = (async () => {
    publish({ running: true, error: null });
    try {
      const role = activeRole;
      if (role === 'student') await flushCourseWork();
      const previous = await readEntry<string>(META.version);
      let bundle: Bundle;
      if (role === 'student') {
        // The server answers {unchanged: true} with no course when the saved
        // version is still current, instead of sending the whole course again.
        // A server without that support ignores "since" and sends it all.
        bundle = await api<Bundle>("/student/offline/", { cacheOffline: false, query: previous ? { since: previous } : undefined });
      } else {
        const entries = await staffBundle(owner, role);
        bundle = { version: copyVersion(entries), generated_at: new Date().toISOString(), entries };
      }
      if (offlineScope() !== owner || currentSession() !== mine) return; // signed out (or someone else signed in) meanwhile
      if (!bundle.unchanged && bundle.entries && bundle.version !== previous) await replaceEntries(bundle.entries, owner, role === 'student' ? undefined : ['/faculty/', '/admin/subjects/', '/admin/analytics/', '/meta/']);
      if (offlineScope() !== owner || currentSession() !== mine) return;
      const now = new Date().toISOString();
      lastFullSync = Date.now();
      await writeEntry(META.version, bundle.version, owner);
      await writeEntry(META.lastSync, now, owner);
      publish({ running: false, lastSync: now });
    } catch (e) {
      if (offlineScope() === owner && currentSession() === mine) publish({ running: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (inflight?.promise === promise) inflight = null;
      // A retired run must not change the next sign-in’s status.
    }
  })();
  inflight = { owner, promise };
  return promise;
}

let lifecycle = 0;
let lastFullSync = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/** Refresh the copy if it is older than maxAgeMs (returning to the app). */
export function syncIfStale(maxAgeMs = FOREGROUND_MIN_MS): Promise<void> {
  return Date.now() - lastFullSync >= maxAgeMs ? syncNow() : Promise.resolve();
}

/** Once a minute: retry pending offline course work, and every FULL_SYNC_MS
 *  refresh the whole copy. Nothing runs while the app or tab is out of sight,
 *  and the timed refresh is skipped while the browser saves data (signing in,
 *  reconnecting, returning to the app and the refresh buttons still sync). */
export async function syncTick(): Promise<'hidden' | 'full' | 'retried' | 'idle'> {
  if (!onScreen()) return 'hidden';
  if (Date.now() - lastFullSync >= FULL_SYNC_MS && !savingData()) { await syncNow(); return 'full'; }
  if (activeRole === 'student') {
    const waiting = await courseEvents().catch(() => []);
    if (waiting.length) { await flushCourseWork().catch(() => {}); return 'retried'; }
  }
  return 'idle';
}
let unsubscribe: (() => void) | null = null;

/** Keep the signed-in role’s authorized content available on this device. */
export async function startOfflineSync(role = "student") {
  stopOfflineSync();
  activeRole = role;
  const started = lifecycle;
  const lastSync = (await readEntry<string>(META.lastSync)) ?? null;
  if (started !== lifecycle) return;
  publish({ lastSync, error: null });
  void syncNow();
  timer = setInterval(() => { void syncTick(); }, RETRY_MS);
  unsubscribe = onConnectivityChange((online) => { if (online) void syncNow(); });
}

export function stopOfflineSync() {
  lifecycle += 1;
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
