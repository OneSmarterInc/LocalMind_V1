// Where downloaded student content lives on the device.
//
// Web: IndexedDB, which holds far more than localStorage's ~5 MB and is
// available on plain-http LAN addresses. Phones and tablets: AsyncStorage,
// one key per entry.
//
// Every content entry is stored under the signed-in user's id ("u:<id>:<path>").
// Only the device-level pointers (who owns the copy, their saved profile) are
// global. While nobody is signed in the scope is empty, so a request or a
// download that finishes after sign-out has nowhere to write and nothing to read.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const PREFIX = "localmind.offline.";
const DB_NAME = "localmind-offline";
const STORE = "entries";

/** Device-level keys; everything else is per user. */
export const META = { owner: "@owner", me: "@me", lastSync: "@last-sync", version: "@version" };
const GLOBAL = new Set([META.owner, META.me]);

let scope: string | null = null;
/** Set to the signed-in user's id; null while nobody is signed in. */
export function setOfflineScope(userId: string | null) { scope = userId; }
export function offlineScope() { return scope; }

const scoped = (key: string, owner: string | null = scope) => (GLOBAL.has(key) ? key : owner ? `u:${owner}:${key}` : null);

let dbPromise: Promise<IDBDatabase | null> | null = null;
function idb(): Promise<IDBDatabase | null> {
  if (Platform.OS !== "web" || typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  return dbPromise;
}

/** Runs one transaction; rejects when it fails so a failed save is never reported as saved. */
function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    try {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? (req.result as T) : undefined);
      t.onerror = () => reject(t.error ?? new Error("Offline storage failed"));
      t.onabort = () => reject(t.error ?? new Error("Offline storage was interrupted (the device may be out of space)"));
    } catch (e) { reject(e); }
  });
}

export async function readEntry<T = unknown>(key: string): Promise<T | undefined> {
  const k = scoped(key);
  if (!k) return undefined;
  try {
    const db = await idb();
    if (db) return await tx<T>(db, "readonly", (s) => s.get(k));
    const raw = await AsyncStorage.getItem(PREFIX + k);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch { return undefined; }
}

/** Writes one entry for `owner` (default: the current user). Dropped if that user is no longer signed in. */
export async function writeEntry(key: string, value: unknown, owner: string | null = scope): Promise<void> {
  if (!GLOBAL.has(key) && (!owner || owner !== scope)) return;
  const k = scoped(key, owner)!;
  const db = await idb();
  if (db) { await tx(db, "readwrite", (s) => s.put(value, k)); return; }
  await AsyncStorage.setItem(PREFIX + k, JSON.stringify(value));
}

async function scopedKeys(owner: string): Promise<string[]> {
  const prefix = `u:${owner}:`;
  const db = await idb();
  if (db) return ((await tx<IDBValidKey[]>(db, "readonly", (s) => s.getAllKeys())) ?? []).map(String).filter((k) => k.startsWith(prefix));
  return (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX + prefix)).map((k) => k.slice(PREFIX.length));
}

/**
 * Replaces the user's saved copy with a fresh download: new entries are written and anything the new
 * download no longer contains (a module that was locked, a book that was unpublished) is removed.
 * Rejects on a storage failure; does nothing if `owner` signed out meanwhile.
 */
export async function replaceEntries(entries: Record<string, unknown>, owner: string): Promise<void> {
  if (owner !== scope) return;
  const keep = new Set(Object.keys(entries).map((k) => `u:${owner}:${k}`));
  const meta = new Set([META.lastSync, META.version].map((k) => `u:${owner}:${k}`));
  const stale = (await scopedKeys(owner)).filter((k) => !keep.has(k) && !meta.has(k));
  if (owner !== scope) return;
  const db = await idb();
  if (db) {
    await tx(db, "readwrite", (s) => {
      for (const k of stale) s.delete(k);
      for (const [k, v] of Object.entries(entries)) s.put(v, `u:${owner}:${k}`);
    });
    return;
  }
  if (stale.length) await AsyncStorage.multiRemove(stale.map((k) => PREFIX + k));
  await AsyncStorage.multiSet(Object.entries(entries).map(([k, v]) => [PREFIX + `u:${owner}:${k}`, JSON.stringify(v)]));
}

export async function clearAll(): Promise<void> {
  const db = await idb();
  if (db) { await tx(db, "readwrite", (s) => s.clear()).catch(() => {}); return; }
  const keys = (await AsyncStorage.getAllKeys().catch(() => [] as readonly string[])).filter((k) => k.startsWith(PREFIX));
  if (keys.length) await AsyncStorage.multiRemove(keys).catch(() => {});
}
