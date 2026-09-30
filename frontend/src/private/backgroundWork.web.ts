/** Keeps browser generation running while the person uses other tabs or apps.
 *
 * The model already runs in Web Workers, which browsers keep running in a
 * background tab. What can stop it is the browser freezing or unloading a tab
 * it thinks is idle (energy or memory saver). Holding a Web Lock while
 * generating marks the tab as busy, which browsers take into account before
 * freezing or discarding it.
 *
 * It no longer asks before the tab is closed. That question is the browser's
 * own "Leave site?" box, which no site can replace with its own pop-up, and
 * the work it protected resumes by itself: lessons and quizzes continue from
 * their last saved part, and the model download from the bytes it kept.
 * Unsaved edits still ask (useDraft), because those would really be lost. */
type LockManager = { request(name: string, options: { mode: 'shared' }, callback: () => Promise<void>): Promise<unknown> };
// Jobs ask for one answer at a time with a short save in between: keep the
// tab marked busy across that gap.
const IDLE_MS = 8000;
let active = 0;
let release: (() => void) | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;

function markBusy() {
  if (typeof window === 'undefined') return;
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks?.request) return;
  const held = new Promise<void>(resolve => { release = resolve; });
  locks.request('localmind-generation', { mode: 'shared' }, () => held).catch(() => {});
}

function markIdle() {
  idle = undefined;
  if (active > 0 || typeof window === 'undefined') return;
  release?.(); release = undefined;
}

export const backgroundWork = {
  // Same shape as the phone version; the browser has no notification or
  // progress bar to name, so the title and progress are not used here.
  enter(_subtitle?: string, _title?: string) {
    active++;
    if (idle) { clearTimeout(idle); idle = undefined; return; }
    if (active === 1) markBusy();
  },
  leave() {
    active = Math.max(0, active - 1);
    if (active === 0 && !idle) idle = setTimeout(markIdle, IDLE_MS);
  },
  progress(_fraction: number, _subtitle: string) { /* nothing to update in a browser */ },
  detail(_text: string, _title?: string) { /* no notification in a browser */ },
  show(_job: { title: string; text: string; fraction?: number } | null) { /* no notification in a browser */ },
  setReady(_summary: { title: string; text: string } | null) { /* no notification in a browser */ },
};

/** Same shape as the phone version: the browser has no notification prompt. */
export function setNotificationExplainer(_explain: (() => Promise<boolean>) | undefined) { /* nothing to explain in a browser */ }
