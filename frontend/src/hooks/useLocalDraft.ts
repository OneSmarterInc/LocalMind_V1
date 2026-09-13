import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Work in progress kept on this device, under the signed-in user and the item it belongs to
 * (a quiz attempt, an assignment), so a refresh, a closed tab or a remount does not lose it.
 * Nothing here is graded or sent anywhere; submitting still goes to the server.
 */
const KEY = (parts: string[]) => `localmind.draft.${parts.join(".")}`;

export async function clearLocalDraft(parts: (string | null | undefined)[]) {
  if (parts.some((p) => !p)) return;
  await AsyncStorage.removeItem(KEY(parts as string[])).catch(() => {});
}

/**
 * Loads the saved draft once `parts` are known, then saves every change shortly after it is made.
 *
 * - `restored` is null while loading, then true (a draft was restored) or false (nothing was saved).
 * - A draft that arrives after the person has started typing is discarded: their own text always wins.
 * - `flush()` writes the latest value immediately; call it before deliberately leaving the screen.
 * - `saving` is true while a write is pending or running.
 */
export function useLocalDraft<T>(parts: (string | null | undefined)[], value: T, onRestore: (saved: T) => void) {
  const ready = parts.every(Boolean);
  const key = ready ? KEY(parts as string[]) : null;
  const [restored, setRestored] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const loadedFor = useRef<string | null>(null);
  const edited = useRef(false);
  const firstValue = useRef(true);
  const valueRef = useRef(value); valueRef.current = value;
  const restoreRef = useRef(onRestore); restoreRef.current = onRestore;

  useEffect(() => {
    if (!key || loadedFor.current === key) return;
    loadedFor.current = key;
    edited.current = false; firstValue.current = true;
    setRestored(null); // not known yet for this key: callers that act on the draft must wait
    void AsyncStorage.getItem(key).then((raw) => {
      // Typing started while this was loading: that newer text stands, and the old draft is dropped.
      if (edited.current) { setRestored(false); return; }
      if (raw) { try { restoreRef.current(JSON.parse(raw) as T); setRestored(true); return; } catch { /* ignore a damaged draft */ } }
      setRestored(false);
    }).catch(() => setRestored(false));
  }, [key]);

  const write = useCallback(async (k: string, v: T) => {
    setSaving(true);
    try { await AsyncStorage.setItem(k, JSON.stringify(v)); } catch { /* the draft is a convenience, not a record */ }
    finally { setSaving(false); }
  }, []);

  useEffect(() => {
    if (!key || loadedFor.current !== key) return;
    if (restored === null) { if (!firstValue.current) edited.current = true; firstValue.current = false; return; }
    setSaving(true);
    const t = setTimeout(() => { void write(key, value); }, 300);
    return () => clearTimeout(t);
  }, [key, value, restored, write]);

  /** Writes the latest value now; awaited before leaving so the last keystroke is not lost. */
  const flush = useCallback(async () => {
    if (!key || restored === null) return;
    await write(key, valueRef.current);
  }, [key, restored, write]);

  return { restored, saving, flush };
}
