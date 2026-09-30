import { requireOptionalNativeModule } from 'expo';
import { AppState, PermissionsAndroid, Platform } from 'react-native';

/** Keeps on-device generation running while the person uses other apps.
 *
 * Android: a foreground service with a "LocalMind is generating" notification.
 * While it shows, Android treats LocalMind as doing work the person started and
 * does not stop or slow it in the background.
 *
 * iOS 26 and later: a continued-processing task. iOS shows a system progress
 * bar and lets the work continue in other apps. The GPU is available there only
 * where iOS grants background GPU access; elsewhere the model uses the CPU
 * while LocalMind is off screen (see device.native.ts).
 *
 * Older iOS has no such permission. There, and whenever iOS ends the task,
 * mayRunInBackground() is false and the device adapter pauses the current
 * answer, then continues automatically when LocalMind is opened again.
 *
 * The native module lives in modules/localmind-background. It is optional so
 * that a build without it (or a test) behaves like older iOS, never crashes. */
type NativeBackground = {
  isSupported(): boolean;
  gpuInBackground(): boolean;
  begin(title: string, subtitle: string): Promise<boolean>;
  /** fraction < 0 shows a busy bar. */
  update(fraction: number, subtitle: string, title: string): void;
  /** readyTitle non-empty (Android): replace the progress notification with
   *  a "ready" one the person can tap. iOS ignores it. */
  end(success: boolean, readyTitle: string, readyText: string): void;
  addListener?(event: 'onExpired', listener: () => void): { remove(): void };
};
const native = requireOptionalNativeModule<NativeBackground>('LocalMindBackground');

const TITLE = 'LocalMind is working';
// Jobs call the model one answer at a time with a short save in between. Keep
// the session across that gap so the notification or iOS task does not flicker.
const IDLE_MS = 8000;
let active = 0, started = false, expired = false;
/** What the notification shows now. The job list (jobNotifications) sets the
 *  title and text of the job running; without a job (course doubts, the model
 *  download) the work itself does. */
let shown = { title: TITLE, text: '', fraction: -1 };
let fromJob = false;
let ready: { title: string; text: string } | null = null;
function push() {
  if (!started || !native) return;
  safely(() => native.update(shown.fraction, shown.text, shown.title), undefined);
}
let starting: Promise<void> | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;
let askedNotifications = false;
const expiredListeners = new Set<() => void>();

native?.addListener?.('onExpired', () => {
  expired = true; started = false;
  for (const listener of [...expiredListeners]) listener();
});

function safely<T>(run: () => T, fallback: T): T { try { return run(); } catch { return fallback; } }

/** LocalMind's own explanation, shown before Android's permission prompt.
 * Registered by the app (permissionExplainers) so this file stays free of UI.
 * Resolves true to go on to Android's prompt. */
let explainNotifications: (() => Promise<boolean>) | undefined;
export function setNotificationExplainer(explain: (() => Promise<boolean>) | undefined) { explainNotifications = explain; }

async function allowNotifications() {
  // Android 13+: without this the service still runs, but its notification is hidden.
  if (Platform.OS !== 'android' || askedNotifications || Number(Platform.Version) < 33) return;
  askedNotifications = true;
  const permission = 'android.permission.POST_NOTIFICATIONS' as Parameters<typeof PermissionsAndroid.request>[0];
  try {
    if (await PermissionsAndroid.check(permission)) return;
    // Android's prompt used to appear on its own the first time AI work
    // started, with no word from LocalMind about why. Explain first; "Not now"
    // skips Android's prompt and the work carries on without a notification.
    if (explainNotifications && !(await explainNotifications())) return;
    await PermissionsAndroid.request(permission);
  } catch { /* keep generating */ }
}

async function start(subtitle: string, title: string) {
  if (!native || started || AppState.currentState !== 'active') return;
  if (!safely(() => native.isSupported(), false)) return;
  await allowNotifications();
  expired = false;
  // A job already described itself (jobNotifications); otherwise use what the
  // work that started the session said about itself.
  if (!fromJob) shown = { title, text: subtitle, fraction: -1 };
  started = await native.begin(shown.title, shown.text).catch(() => false);
  push();
}

function stop() {
  idle = undefined;
  if (active > 0) return;
  // The "ready" message only when the person is elsewhere: on screen they can
  // already see the lesson or quiz appear.
  const tell = ready && AppState.currentState !== 'active' ? ready : null;
  if (started) safely(() => native?.end(true, tell?.title ?? '', tell?.text ?? ''), undefined);
  started = false; ready = null;
  if (!fromJob) shown = { title: TITLE, text: '', fraction: -1 };
}

export const backgroundWork = {
  /** True when work may continue while LocalMind is not on screen. */
  mayRunInBackground() {
    if (Platform.OS !== 'ios') return true;
    return started && !expired;
  },
  /** True when the GPU may be used while LocalMind is not on screen. */
  gpuInBackground() {
    if (Platform.OS !== 'ios') return true;
    return started && !expired && !!native && safely(() => native.gpuInBackground(), false);
  },
  /** One more piece of work (an answer, the model download). Starts the
   * session when LocalMind is on screen. */
  async enter(subtitle = 'Starting…', title = TITLE) {
    active++;
    if (idle) { clearTimeout(idle); idle = undefined; }
    if (!started) { starting ??= start(subtitle, title).finally(() => { starting = undefined; }); await starting; }
  },
  /** One answer finished (or failed). Ends the session once nothing is waiting. */
  leave() {
    active = Math.max(0, active - 1);
    if (active === 0 && !idle) {
      idle = setTimeout(stop, IDLE_MS);
      (idle as { unref?: () => void }).unref?.();
    }
  },
  /** A real share of the work done (the model download). */
  progress(current: number, subtitle: string) {
    if (fromJob) return;
    shown = { ...shown, text: subtitle, fraction: Math.max(0, Math.min(0.99, current)) };
    push();
  },
  /** The work's own status line ("Reading the material… 14s"), used when no
   *  job is describing it; a job's line already contains it. */
  detail(text: string, title?: string) {
    if (fromJob) return;
    shown = { title: title ?? shown.title, text, fraction: -1 };
    push();
  },
  /** From the job list: the job running now, or null when none is. */
  show(job: { title: string; text: string; fraction?: number } | null) {
    fromJob = !!job;
    if (job) { shown = { title: job.title, text: job.text, fraction: job.fraction ?? -1 }; push(); }
  },
  /** What to say when this session's lessons and quizzes are done. */
  setReady(summary: { title: string; text: string } | null) { ready = summary; },
  /** Called when iOS ends the background task early (time, battery or the person). */
  onExpired(listener: () => void) { expiredListeners.add(listener); return () => { expiredListeners.delete(listener); }; },
};
