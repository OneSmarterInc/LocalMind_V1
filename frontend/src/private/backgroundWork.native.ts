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
  update(fraction: number, subtitle: string): void;
  end(success: boolean): void;
  addListener?(event: 'onExpired', listener: () => void): { remove(): void };
};
const native = requireOptionalNativeModule<NativeBackground>('LocalMindBackground');

const TITLE = 'LocalMind is generating';
// Jobs call the model one answer at a time with a short save in between. Keep
// the session across that gap so the notification or iOS task does not flicker.
const IDLE_MS = 8000;
let active = 0, done = 0, started = false, expired = false;
let starting: Promise<void> | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;
let askedNotifications = false;
const expiredListeners = new Set<() => void>();

native?.addListener?.('onExpired', () => {
  expired = true; started = false;
  for (const listener of [...expiredListeners]) listener();
});

function safely<T>(run: () => T, fallback: T): T { try { return run(); } catch { return fallback; } }

async function allowNotifications() {
  // Android 13+: without this the service still runs, but its notification is hidden.
  if (Platform.OS !== 'android' || askedNotifications || Number(Platform.Version) < 33) return;
  askedNotifications = true;
  const permission = 'android.permission.POST_NOTIFICATIONS' as Parameters<typeof PermissionsAndroid.request>[0];
  try { if (!(await PermissionsAndroid.check(permission))) await PermissionsAndroid.request(permission); } catch { /* keep generating */ }
}

async function start(subtitle: string) {
  if (!native || started || AppState.currentState !== 'active') return;
  if (!safely(() => native.isSupported(), false)) return;
  await allowNotifications();
  expired = false;
  started = await native.begin(TITLE, subtitle).catch(() => false);
}

function stop() {
  idle = undefined;
  if (active > 0) return;
  if (started) safely(() => native?.end(true), undefined);
  started = false; done = 0;
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
  /** One more answer requested. Starts the session when LocalMind is on screen. */
  async enter(subtitle = 'Writing your study material') {
    active++;
    if (idle) { clearTimeout(idle); idle = undefined; }
    if (!started) { starting ??= start(subtitle).finally(() => { starting = undefined; }); await starting; }
  },
  /** One answer finished (or failed). Ends the session once nothing is waiting. */
  leave() {
    active = Math.max(0, active - 1); done++;
    if (active === 0 && !idle) {
      idle = setTimeout(stop, IDLE_MS);
      (idle as { unref?: () => void }).unref?.();
    }
  },
  /** Share progress with the notification or the iOS progress bar. */
  progress(current: number, subtitle: string) {
    if (!started || !native) return;
    const total = done + Math.max(active, 1);
    const fraction = Math.max(0, Math.min(0.99, (done + Math.max(0, Math.min(1, current))) / total));
    safely(() => native.update(fraction, subtitle), undefined);
  },
  /** Called when iOS ends the background task early (time, battery or the person). */
  onExpired(listener: () => void) { expiredListeners.add(listener); return () => { expiredListeners.delete(listener); }; },
};
