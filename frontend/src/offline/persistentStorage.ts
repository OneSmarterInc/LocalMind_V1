/** Asking the browser to protect LocalMind's saved data from automatic clean-up.
 *
 * Chrome and Edge decide this silently, with no prompt. Other browsers
 * (Firefox) show their own permission box, which no site can restyle, and it
 * used to appear by itself while the app saved its offline files. There, the
 * request is now made only after LocalMind's own explanation, from Offline AI. */
type StorageManagerLike = { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> };
type NavigatorLike = { storage?: StorageManagerLike; userAgentData?: unknown };

const nav = (): NavigatorLike | undefined => (typeof navigator === 'undefined' ? undefined : navigator as unknown as NavigatorLike);

/** True where asking shows no browser prompt (Chromium browsers). */
export function persistIsSilent(n: NavigatorLike | undefined = nav()): boolean {
  return !!n && 'userAgentData' in n && !!n.userAgentData;
}

/** Ask only where no browser prompt appears. Used by the automatic offline save. */
export async function persistQuietly(n: NavigatorLike | undefined = nav()): Promise<void> {
  if (!persistIsSilent(n)) return;
  await n?.storage?.persist?.().catch(() => false);
}

/** From a click in Offline AI: explain first when the browser will show a
 *  prompt. `explain` is LocalMind's pop-up; false means the person declined. */
export async function persistAfterExplaining(explain: () => Promise<boolean>, n: NavigatorLike | undefined = nav()): Promise<boolean> {
  const storage = n?.storage;
  if (!storage?.persist) return false;
  if (await storage.persisted?.().catch(() => false)) return true;
  if (!persistIsSilent(n) && !(await explain())) return false;
  return storage.persist().catch(() => false);
}
