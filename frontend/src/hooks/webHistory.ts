/** Browser history integration shared by all portals. Preserve the router's state
 * and history IDs; add only our own index for reversible guarded traversals. */
import { confirmLeave, hasUnsavedWork } from './unsavedGuard';
const INDEX = '__localmindHistoryIndex';
let installed = false;
let position = 0;
const paths = new Map<number, string>();

export function installWebHistoryGuard() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const history = window.history;
  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  const path = () => window.location.pathname + window.location.search;
  position = Number.isInteger(history.state?.[INDEX]) ? history.state[INDEX] : 0;
  replace({ ...history.state, [INDEX]: position }, '');
  paths.set(position, path());
  history.pushState = (state, title, url) => {
    for (const index of paths.keys()) if (index > position) paths.delete(index);
    push({ ...state, [INDEX]: ++position }, title, url);
    paths.set(position, path());
  };
  history.replaceState = (state, title, url) => {
    replace({ ...state, [INDEX]: position }, title, url);
    paths.set(position, path());
  };
  let restoring = false;
  let asking = false;
  let destination: number | null = null;
  let approved: number | null = null;
  window.addEventListener('popstate', (event) => {
    const target = event.state?.[INDEX];
    if (!Number.isInteger(target)) return; // External documents use beforeunload.
    if (approved === target) {
      approved = null; position = target; paths.set(position, path()); return;
    }
    if (restoring || asking) {
      event.stopImmediatePropagation();
      if (target !== position) { history.go(position - target); return; }
      if (!restoring) return;
      restoring = false; asking = true;
      void confirmLeave().then(ok => {
        const next = destination; destination = null; asking = false;
        if (ok && next !== null && next !== position) { approved = next; history.go(next - position); }
      }).catch(() => { destination = null; asking = false; });
      return;
    }
    if (target !== position && hasUnsavedWork()) {
      // Roll the address bar back before displaying a dialog. The router never
      // receives the rejected traversal, so URL, page and draft remain aligned.
      event.stopImmediatePropagation();
      destination = target; restoring = true; history.go(position - target);
      return;
    }
    position = target; paths.set(position, path());
  }, true);
}

export function backToKnownWebParent(target: string): boolean {
  if (!installed || typeof window === 'undefined') return false;
  const expected = new URL(target, window.location.origin);
  const matches = (path: string) => {
    const actual = new URL(path, window.location.origin);
    return actual.pathname.replace(/\/$/, '') === expected.pathname.replace(/\/$/, '') &&
      [...expected.searchParams].every(([key, value]) => actual.searchParams.get(key) === value);
  };
  for (let index = position - 1; index >= 0; index--) {
    const previous = paths.get(index);
    if (previous && matches(previous)) { window.history.go(index - position); return true; }
  }
  return false;
}

export function parentHref(to: string | { pathname: string; params?: Record<string, unknown> }): string {
  if (typeof to === 'string') return to;
  const params = { ...to.params };
  const path = to.pathname.replace(/\[([^\]]+)\]/g, (_, key: string) => { const value = params[key]; delete params[key]; return encodeURIComponent(String(value ?? '')); });
  const query = Object.entries(params).filter(([, value]) => value != null).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&');
  return path + (query ? `?${query}` : '');
}
