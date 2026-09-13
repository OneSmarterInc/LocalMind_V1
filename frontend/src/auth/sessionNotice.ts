/**
 * Set when the server rejects the session (not when the person signs out), so the sign-in page can explain why.
 * The flag stays until it is dismissed or the person signs in again: the sign-in page can mount before the
 * rejection arrives, or mount twice while routing settles, and reading must not lose it.
 */
import { useSyncExternalStore } from "react";

let expired = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export const markSessionExpired = () => { expired = true; emit(); };
export const clearSessionExpired = () => { if (expired) { expired = false; emit(); } };
export const consumeSessionExpired = () => { const was = expired; clearSessionExpired(); return was; };

export function useSessionExpired() {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => expired, () => expired);
}
