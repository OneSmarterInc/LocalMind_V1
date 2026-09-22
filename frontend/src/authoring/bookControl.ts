/**
 * Controls for the automatic book preparation job.
 *
 * The book job works through modules in book order. Before each module it
 * asks this registry what to do next, so a person can:
 *   - "Generate now" a module: it runs next. If another module is being
 *     written, that one stops at its last saved part and continues later.
 *   - Pause a module: it is skipped until resumed. If it is being written,
 *     it stops at its last saved part.
 *   - Pause the whole book ("held"): the job stops and does not restart on
 *     its own until someone resumes it. The hold is saved on the device.
 *
 * Nothing finished is generated twice: every module keeps its checkpoint
 * (finished lesson parts and quiz questions), and generation resumes from it.
 */
import { useSyncExternalStore } from 'react';
import { device } from '@/private/device';

type Current = { moduleId: string; controller: AbortController; reason?: 'priority' | 'pause' };
export type BookControl = { priority: string[]; paused: Set<string>; current?: Current };

const controls = new Map<string, BookControl>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => { version++; listeners.forEach((l) => l()); };

export const controlKey = (scope: string, documentId: string) => `${scope}|${documentId}`;
export function control(key: string): BookControl {
  let c = controls.get(key);
  if (!c) { c = { priority: [], paused: new Set() }; controls.set(key, c); }
  return c;
}
export function subscribeControls(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function notifyControls() { emit(); }

/** Run this module next. The module being written, if different, pauses at its saved point and continues later. */
export function generateNow(key: string, moduleId: string) {
  const c = control(key);
  c.paused.delete(moduleId);
  c.priority = [moduleId, ...c.priority.filter((x) => x !== moduleId)];
  if (c.current && c.current.moduleId !== moduleId && !c.current.reason) { c.current.reason = 'priority'; c.current.controller.abort(); }
  emit();
}

/** Skip this module until it is resumed. If it is being written, stop at its last saved part. */
export function pauseModule(key: string, moduleId: string) {
  const c = control(key);
  c.paused.add(moduleId);
  c.priority = c.priority.filter((x) => x !== moduleId);
  if (c.current?.moduleId === moduleId && !c.current.reason) { c.current.reason = 'pause'; c.current.controller.abort(); }
  emit();
}

export const currentModule = (key: string) => controls.get(key)?.current?.moduleId;
export const isModulePaused = (key: string, moduleId: string) => !!controls.get(key)?.paused.has(moduleId);
export const isSwitching = (key: string) => !!controls.get(key)?.current?.reason;

/** What a screen shows for one book, read in a way React (and the React
 * Compiler) always sees as current: which module is being written and which
 * are paused. A new object is returned only when something changed. */
export type ControlView = { running?: string; paused: ReadonlySet<string> };
const views = new Map<string, { version: number; view: ControlView }>();
function viewOf(key: string): ControlView {
  const cached = views.get(key);
  if (cached && cached.version === version) return cached.view;
  const c = controls.get(key);
  const next: ControlView = { running: c?.current?.moduleId, paused: new Set(c?.paused ?? []) };
  const same = cached && cached.view.running === next.running && cached.view.paused.size === next.paused.size && [...next.paused].every((id) => cached.view.paused.has(id));
  const view = same ? cached!.view : next;
  views.set(key, { version, view });
  return view;
}
export function useBookControls(key: string): ControlView {
  return useSyncExternalStore(subscribeControls, () => viewOf(key), () => viewOf(key));
}

const heldKey = (prefix: string, documentId: string) => `${prefix}automatic-held:${documentId}`;
/** Whole-book pause, saved on this device so reopening the book does not restart it. */
export async function isHeld(prefix: string, documentId: string) { return (await (await device()).get<boolean>(heldKey(prefix, documentId))) === true; }
export async function setHeld(prefix: string, documentId: string, held: boolean) { await (await device()).put(heldKey(prefix, documentId), held); emit(); }
