import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Platform } from "react-native";
import { confirmLeave, registerGuard } from "./unsavedGuard";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * While `active`: asks the browser to confirm before the page is closed or reloaded, and on phones asks
 * before the hardware back button leaves the screen.
 */
export function useUnsavedWarning(active: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    if (Platform.OS === "web") {
      const win = globalThis as unknown as { addEventListener?: Function; removeEventListener?: Function };
      if (typeof win.addEventListener !== "function") return;
      const onBefore = (e: { preventDefault: () => void; returnValue?: string }) => { e.preventDefault(); e.returnValue = ""; };
      win.addEventListener("beforeunload", onBefore);
      return () => { win.removeEventListener!("beforeunload", onBefore); };
    }
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      void confirmLeave().then((ok) => { if (ok && router.canGoBack()) router.back(); });
      return true;
    });
    return () => sub.remove();
  }, [active, router]);
}

/** Unsaved drafts left on another record of the same kind, by record id (kept for this app session). */
const stash = new Map<string, { draft: unknown; label: string }>();

/**
 * A local editable copy of one server record (identified by its `id`).
 * - A reload of the same record replaces the copy only while there are no unsaved edits.
 * - If the screen is reused for a different record while edits are unsaved, those edits stay with their own
 *   record (restored when it is opened again) and are never shown on, or saved to, the new record.
 * - `markSaved(sent)` clears only what was actually sent: edits typed while the save was running stay unsaved.
 * - While dirty, in-app navigation and the back button ask Save / Discard / Stay.
 */
export function useDraft<T extends { id: string }>(source: T | null | undefined, opts: { label: (d: T) => string; save: () => Promise<boolean> }) {
  const dirtyAfterSave = useRef(false);
  const [draft, setDraft] = useState<T | null>(null);
  const [dirty, setDirty] = useState(false);
  const [changedMeanwhile, setChangedMeanwhile] = useState(false);
  const [leftBehind, setLeftBehind] = useState<{ id: string; label: string } | null>(null);
  const draftRef = useRef<T | null>(null); draftRef.current = draft;
  const dirtyRef = useRef(false);
  const lastSource = useRef<T | null>(null);
  const expectReload = useRef(false);
  const optsRef = useRef(opts); optsRef.current = opts;

  const setClean = (v: boolean) => { dirtyRef.current = !v; setDirty(!v); };

  useEffect(() => {
    if (source == null) return;
    const current = draftRef.current;
    if (current && current.id !== source.id) {
      // The screen now shows another record.
      if (dirtyRef.current) {
        const label = optsRef.current.label(current);
        stash.set(current.id, { draft: clone(current), label });
        setLeftBehind({ id: current.id, label });
      }
      lastSource.current = source;
      const kept = stash.get(source.id);
      if (kept) { stash.delete(source.id); setDraft(kept.draft as T); setClean(false); setLeftBehind((l) => (l?.id === source.id ? null : l)); }
      else { setDraft(clone(source)); setClean(true); }
      setChangedMeanwhile(false);
      return;
    }
    const differs = lastSource.current != null && !same(lastSource.current, source);
    lastSource.current = source;
    if (dirtyRef.current) {
      if (differs && !expectReload.current) setChangedMeanwhile(true);
      expectReload.current = false;
      return;
    }
    expectReload.current = false;
    setDraft(clone(source)); setChangedMeanwhile(false);
  }, [source]);

  const edit = useCallback((fn: (d: T) => T) => { setClean(false); setDraft((d) => (d ? fn(d) : d)); }, []);
  const discard = useCallback(() => {
    setClean(true); setChangedMeanwhile(false);
    if (lastSource.current != null) setDraft(clone(lastSource.current));
  }, []);
  /** Call after a successful save with the draft that was sent, before reloading. */
  const markSaved = useCallback((sent: T) => {
    expectReload.current = true;
    setChangedMeanwhile(false);
    const stillDirty = !(draftRef.current && same(draftRef.current, sent));
    dirtyAfterSave.current = stillDirty;
    if (!stillDirty) setClean(true);
  }, []);
  const forgetLeftBehind = useCallback(() => { if (leftBehind) stash.delete(leftBehind.id); setLeftBehind(null); }, [leftBehind]);

  useEffect(() => {
    if (!dirty || !draft) return;
    return registerGuard({
      label: optsRef.current.label(draft),
      save: async () => { dirtyAfterSave.current = false; return optsRef.current.save(); },
      // Text typed while that save was running is still unsaved, so leaving now would lose it.
      isDirty: () => dirtyRef.current,
      discard,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, draft?.id, discard]);
  useUnsavedWarning(dirty);
  return { draft, edit, dirty, discard, markSaved, changedMeanwhile, leftBehind, forgetLeftBehind };
}
