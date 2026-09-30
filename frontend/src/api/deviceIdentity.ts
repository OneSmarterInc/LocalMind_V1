// A stable ID for this installation of LocalMind.
//
// One faculty login can be open on a laptop and a phone at once. The server
// needs to tell them apart so only one of them generates a given book (see
// authoring/claims.ts). The ID is random, created once, and kept with the
// sign-in tokens: SecureStore on Android/iOS, AsyncStorage on web. It is not
// tied to the person, so signing in as someone else on the same device keeps
// the same ID, which is what "this device" means. The server names the
// device ("Chrome on Windows", "Android app") from its User-Agent.
import { getItem, setItem } from "./storage";

const KEY = "localmind.device";
let cached: string | null = null;

// Not expo-crypto: this file is imported by the API client, which must stay
// loadable without native modules. Hermes and browsers both provide
// crypto.getRandomValues; the fallback only runs on runtimes without it.
function newId(): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
let loading: Promise<string> | null = null;

/** The ID once loaded; null only before the first deviceId() call finishes. */
export function loadedDeviceId(): string | null { return cached; }

export function deviceId(): Promise<string> {
  if (cached) return Promise.resolve(cached);
  if (!loading) {
    loading = (async () => {
      let value = await getItem(KEY).catch(() => null);
      if (!value || !/^[A-Za-z0-9-]{8,64}$/.test(value)) {
        value = newId();
        await setItem(KEY, value).catch(() => {});
      }
      cached = value;
      return value;
    })().finally(() => { loading = null; });
  }
  return loading;
}
