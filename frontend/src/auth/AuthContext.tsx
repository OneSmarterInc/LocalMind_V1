import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { ApiError, tokenStore } from "@/api/client";
import { META, clearAll, readEntry, setOfflineScope, writeEntry } from "@/offline/store";
import { clearSessionExpired, markSessionExpired } from "./sessionNotice";
import { startOfflineSync, stopOfflineSync, syncNow } from "@/offline/sync";
import { auth as authApi } from "@/api/endpoints";
import type { LoginResponse, Role, User } from "@/api/types";

interface AuthState {
  ready: boolean; user: User | null; mustChangePassword: boolean; sessionId: string | null;
  login: (role: Role, email: string, password: string) => Promise<LoginResponse>;
  completePasswordChange: (current: string, next: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}
const Ctx = createContext<AuthState | null>(null);
const HEARTBEAT_MS = 4 * 60 * 1000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [mustChange, setMustChange] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Signing out removes everything downloaded for offline use: the next
  // person on this device must not see another student's lessons or scores.
  const clear = useCallback(async () => {
    // Drop the scope first: a download or request still in flight can no longer write.
    setOfflineScope(null); stopOfflineSync(); await clearAll();
    await tokenStore.set(null); setUser(null); setMustChange(false); setSessionId(null);
  }, []);

  /** Remember who this device's offline copy belongs to, and keep it fresh for students. */
  const adopt = useCallback(async (me: User) => {
    const owner = await readEntry<string>(META.owner);
    if (owner && owner !== me.id) { setOfflineScope(null); stopOfflineSync(); await clearAll(); }
    setOfflineScope(me.id);
    await writeEntry(META.owner, me.id);
    await writeEntry(META.me, me);
    if (me.role === "student" && !me.must_change_password) void startOfflineSync(); else stopOfflineSync();
  }, []);

  useEffect(() => {
    tokenStore.setSessionLostHandler(() => { markSessionExpired(); void clear(); });
    (async () => {
      const t = await tokenStore.load();
      if (t) {
        try {
          const me = await authApi.me(); await adopt(me); setUser(me); setMustChange(me.must_change_password); setSessionId(t.session_id ?? null);

        } catch (e) {
          // No server: carry on with the saved profile so a student can keep
          // studying what was downloaded. Only a real rejection signs out.
          const saved = e instanceof ApiError && e.code === "NETWORK" ? await readEntry<User>(META.me) : undefined;
          if (saved) { setOfflineScope(saved.id); setUser(saved); setMustChange(saved.must_change_password); setSessionId(t.session_id ?? null); if (saved.role === "student") void startOfflineSync(); }
          else await clear();
        }
      }
      setReady(true);
    })();
    return () => tokenStore.setSessionLostHandler(null);
  }, [clear, adopt]);

  // Heartbeat while a user is signed in and the app is in the foreground.
  useEffect(() => {
    const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
    const start = () => { stop(); if (user) timer.current = setInterval(() => { authApi.heartbeat(sessionId).catch(() => {}); }, HEARTBEAT_MS); };
    start();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        if (user) authApi.heartbeat(sessionId).catch(() => {});
        if (user?.role === "student") void syncNow();  // back in the app: refresh the offline copy
        start();
      } else stop();
    });
    return () => { stop(); sub.remove(); };
  }, [user, sessionId]);

  const login = useCallback(async (role: Role, email: string, password: string) => {
    clearSessionExpired();
    const res = await authApi.login(role, email, password);
    await tokenStore.set({ access: res.access, refresh: res.refresh, session_id: res.session_id });
    await adopt({ ...res.user, must_change_password: res.must_change_password });
    setUser(res.user); setMustChange(res.must_change_password); setSessionId(res.session_id);
    return res;
  }, [adopt]);

  const completePasswordChange = useCallback(async (current: string, next: string) => {
    const res = await authApi.changePassword(current, next);
    const t = tokenStore.get();
    await tokenStore.set({ access: res.access, refresh: res.refresh, session_id: t?.session_id ?? null });
    await adopt({ ...res.user, must_change_password: false });
    setUser(res.user); setMustChange(false);
  }, [adopt]);

  const logout = useCallback(async () => {
    const t = tokenStore.get();
    if (t) { try { await authApi.logout(t.refresh, t.session_id ?? null); } catch { /* token may already be dead */ } }
    await clear();
  }, [clear]);

  const refreshUser = useCallback(async () => { const me = await authApi.me(); setUser(me); setMustChange(me.must_change_password); }, []);

  const value = useMemo(() => ({ ready, user, mustChangePassword: mustChange, sessionId, login, completePasswordChange, logout, refreshUser }),
    [ready, user, mustChange, sessionId, login, completePasswordChange, logout, refreshUser]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() { const v = useContext(Ctx); if (!v) throw new Error("useAuth outside AuthProvider"); return v; }
