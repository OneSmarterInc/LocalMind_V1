import Constants from "expo-constants";
import { Platform } from "react-native";
import { configurePing, reportOffline, reportOnline } from "@/offline/connectivity";
import { offlineScope, readEntry, writeEntry } from "@/offline/store";
import { getItem, migrateLegacy, setItem } from "./storage";

export class ApiError extends Error {
  code: string; status: number; details?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message); this.status = status; this.code = code; this.details = details;
  }
}

const LEGACY_KEY = "localmind.tokens";
const K = { access: "localmind.access", refresh: "localmind.refresh", session: "localmind.session" };
export interface Tokens { access: string; refresh: string; session_id?: string | null }

function resolveBaseUrl(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  const extra = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;
  // When the built web client is served by the LocalMind backend itself (the
  // standalone/offline launcher), the API is same-origin: no configuration
  // needed on any machine. The Expo dev server (port 8081/8082) still falls
  // back to the configured URL.
  const sameOrigin = Platform.OS === "web" && typeof window !== "undefined" && !/:(8081|8082|19006)$/.test(window.location.host) ? window.location.origin : "";
  let url = env || sameOrigin || extra || "http://127.0.0.1:8000";
  if (Platform.OS === "android" && url.includes("127.0.0.1")) url = url.replace("127.0.0.1", "10.0.2.2");
  return url.replace(/\/$/, "");
}
export const BASE_URL = resolveBaseUrl();

let tokens: Tokens | null = null;
let onSessionLost: (() => void) | null = null;
let refreshing: { session: number; promise: Promise<boolean> } | null = null;

/**
 * Which sign-in the client is on. It changes whenever tokens are replaced by a sign-in or removed by a
 * sign-out (not when a refresh renews them). A refresh or request that started under an earlier number
 * belongs to someone who is no longer signed in: its tokens are never stored, its response is never
 * cached or shown, and it cannot sign the current person out.
 */
let session = 0;
export const currentSession = () => session;

export const tokenStore = {
  get: () => tokens,
  async load() {
    const legacy = await migrateLegacy(LEGACY_KEY);
    if (legacy) { try { await tokenStore.set(JSON.parse(legacy)); return tokens; } catch { /* fall through */ } }
    const [access, refresh, session_id] = await Promise.all([getItem(K.access), getItem(K.refresh), getItem(K.session)]);
    tokens = access && refresh ? { access, refresh, session_id } : null;
    return tokens;
  },
  async set(t: Tokens | null) {
    session += 1;
    refreshing = null;
    await writeTokens(t);
  },
  setSessionLostHandler(fn: (() => void) | null) { onSessionLost = fn; },
};

async function writeTokens(t: Tokens | null) {
  tokens = t;
  await Promise.all([setItem(K.access, t?.access ?? null), setItem(K.refresh, t?.refresh ?? null), setItem(K.session, t?.session_id ?? null)]);
}

async function refreshTokens(): Promise<boolean> {
  if (!tokens?.refresh) return false;
  if (!refreshing || refreshing.session !== session) {
    const mine = session;
    const started = tokens;
    let promise: Promise<boolean> | null = null;
    promise = (async () => {
      const renew = new AbortController();
      const renewTimer = setTimeout(() => renew.abort(), 15000);
      try {
        const res = await fetch(`${BASE_URL}/api/auth/refresh/`, { method: "POST", signal: renew.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh: started.refresh }) });
        // Signed out, or someone else signed in, while this was on its way: drop it.
        if (session !== mine || tokens !== started) return false;
        if ([502,503,504].includes(res.status)) { reportOffline(); throw new ApiError(0, "NETWORK", "The institution server is temporarily unreachable. Local data is retained."); }
        if (!res.ok) return false;
        const data = await res.json();
        if (session !== mine || tokens !== started) return false;
        await writeTokens({ ...started, access: data.access, refresh: data.refresh ?? started.refresh });
        return true;
      } catch (e) {
        if (session !== mine) throw new SessionChangedError();
        if (e instanceof ApiError) throw e;
        reportOffline();
        throw new ApiError(0, "NETWORK", "The server disconnected while renewing the session. Your local study data is retained.");
      } finally { clearTimeout(renewTimer); if (refreshing?.promise === promise) refreshing = null; }
    })();
    refreshing = { session: mine, promise: promise! };
  }
  return refreshing.promise;
}

export class SessionChangedError extends Error {
  constructor() { super("The account on this device changed while the request was running."); this.name = "SessionChangedError"; }
}

interface Options {
  method?: string; body?: unknown; form?: FormData; query?: Record<string, string | number | undefined | null>; auth?: boolean; retry?: boolean;
  /** Store a successful GET and answer it from the device when offline. Defaults to on for student reads. */
  cacheOffline?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

// Student reads that work offline: answered from the device store when the
// server cannot be reached (see src/offline). Writes never are.
const OFFLINE_READABLE = /^\/(student\/|auth\/me\/$)/;
configurePing(`${BASE_URL}/api/health/`);

/** The key the server's offline bundle uses: path plus sorted, non-empty query. */
export function offlineKey(path: string, query?: Options["query"]): string {
  const items = Object.entries(query ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => [k, String(v)] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return items.length ? `${path}?${items.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}` : path;
}

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const { method = "GET", body, form, query, auth = true, retry = true } = opts;
  const cacheable = method === "GET" && (opts.cacheOffline ?? OFFLINE_READABLE.test(path));
  // Whose request this is (sign-in and offline copy) is fixed when it starts.
  const owner = offlineScope();
  const mine = session;
  let url = `${BASE_URL}/api${path}`;
  if (query) {
    const qs = Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  }
  const headers: Record<string, string> = {};
  if (!form) headers["Content-Type"] = "application/json";
  if (auth && tokens?.access) headers.Authorization = `Bearer ${tokens.access}`;
  let res: Response;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  opts.signal?.addEventListener("abort", cancel);
  if (opts.signal?.aborted) cancel();
  const timeout = setTimeout(cancel, opts.timeoutMs ?? (method === "GET" ? 15000 : 120000));
  try { res = await fetch(url, { method, headers, signal: controller.signal, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) }); }
  catch {
    if (session !== mine || offlineScope() !== owner) throw new SessionChangedError();
    if (opts.signal?.aborted) throw new ApiError(0, "CANCELLED", "Request cancelled.");
    reportOffline();
    if (cacheable) {
      const saved = await readEntry<T>(offlineKey(path, query));
      if (session !== mine || offlineScope() !== owner) throw new SessionChangedError();
      if (saved !== undefined) return saved;
    }
    throw new ApiError(0, "NETWORK", method === "GET"
      ? "You are offline and this page has not been saved on this device yet. It will load once the server can be reached."
      : "You are offline. This needs a connection to the LocalMind server; try again when you are back online.");
  } finally { clearTimeout(timeout); opts.signal?.removeEventListener("abort", cancel); }
  reportOnline();
  if (session !== mine) throw new SessionChangedError();
  if ([502,503,504].includes(res.status) && method === "GET") {
    reportOffline();
    if (cacheable) {
      const saved = await readEntry<T>(offlineKey(path, query));
      if (session !== mine || offlineScope() !== owner) throw new SessionChangedError();
      if (saved !== undefined) return saved;
    }
    throw new ApiError(0, "NETWORK", "The institution server is temporarily unreachable. This page is not saved on this device.");
  }
  if (res.status === 401 && auth && retry && tokens) {
    if (await refreshTokens()) {
      if (session !== mine) throw new SessionChangedError();
      return api<T>(path, { ...opts, retry: false });
    }
    if (session !== mine) throw new SessionChangedError();
    await tokenStore.set(null); onSessionLost?.();
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? "HTTP_ERROR", err.message ?? `Request failed (${res.status})`, err.details);
  }
  if (session !== mine) throw new SessionChangedError();
  if (cacheable) void writeEntry(offlineKey(path, query), data, owner).catch(() => {});
  return data as T;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "VALIDATION_ERROR" && e.details) {
      const parts = Object.entries(e.details).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
      if (parts.length) return parts.join("\n");
    }
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
