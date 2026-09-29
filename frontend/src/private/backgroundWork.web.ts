/** Keeps browser generation running while the person uses other tabs or apps.
 *
 * The model already runs in Web Workers, which browsers keep running in a
 * background tab. What can stop it is the browser freezing or unloading a tab
 * it thinks is idle (energy or memory saver). Holding a Web Lock while
 * generating marks the tab as busy, which browsers take into account before
 * freezing or discarding it. Closing or refreshing the tab would lose the
 * answer being written, so the browser asks before leaving. */
type LockManager = { request(name: string, options: { mode: 'shared' }, callback: () => Promise<void>): Promise<unknown> };
// Jobs ask for one answer at a time with a short save in between: keep the
// tab marked busy across that gap.
const IDLE_MS = 8000;
let active = 0;
let release: (() => void) | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;

function beforeUnload(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ''; }

function markBusy() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeunload', beforeUnload);
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks?.request) return;
  const held = new Promise<void>(resolve => { release = resolve; });
  locks.request('localmind-generation', { mode: 'shared' }, () => held).catch(() => {});
}

function markIdle() {
  idle = undefined;
  if (active > 0 || typeof window === 'undefined') return;
  window.removeEventListener('beforeunload', beforeUnload);
  release?.(); release = undefined;
}

export const backgroundWork = {
  enter() {
    active++;
    if (idle) { clearTimeout(idle); idle = undefined; return; }
    if (active === 1) markBusy();
  },
  leave() {
    active = Math.max(0, active - 1);
    if (active === 0 && !idle) idle = setTimeout(markIdle, IDLE_MS);
  },
};
