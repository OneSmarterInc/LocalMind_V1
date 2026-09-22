/**
 * The list of timed messages ("toasts"), kept outside React so any code can
 * show one. The list is replaced on every change, never edited in place, and
 * screens read it through useToasts() so the React Compiler always sees the
 * current list.
 */
import { useSyncExternalStore } from "react";

export type ToastTone = "info" | "success" | "warning" | "danger";
export type ToastInput = { tone?: ToastTone; title?: string; message: string; duration?: number };
export type Toast = Required<Pick<ToastInput, "tone" | "message">> & { id: number; title?: string; duration: number };

const DURATION: Record<ToastTone, number> = { success: 6000, info: 6000, warning: 10000, danger: 0 };

let seq = 0;
let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showToast(input: ToastInput) {
  const tone = input.tone ?? "info";
  // The same message already on screen is not stacked twice.
  if (toasts.some((t) => t.message === input.message && t.title === input.title)) return;
  const toast: Toast = { id: ++seq, tone, title: input.title, message: input.message, duration: input.duration ?? DURATION[tone] };
  toasts = [...toasts, toast].slice(-3);
  emit();
}
export function dismissToast(id: number) {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}
// The list is replaced (never changed in place) on every update, so React sees
// each change. Reading it through useSyncExternalStore also keeps the React
// Compiler from reusing an old list: before this, a closed message stayed on
// screen and its countdown sat at "1s".
export const subscribeToasts = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const toastList = () => toasts;
export function useToasts() { return useSyncExternalStore(subscribeToasts, toastList, toastList); }
