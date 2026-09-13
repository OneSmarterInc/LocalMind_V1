// Whether the LocalMind server can be reached right now.
//
// "Offline" here means the server is unreachable, which on a school LAN is
// not the same as having no internet. The API client reports every request
// outcome; while offline a light ping checks every 20 seconds and, the moment
// the server answers again, listeners (the sync) are told.
import { useEffect, useState } from "react";

type Listener = (online: boolean) => void;
let online = true;
const listeners = new Set<Listener>();
let pinger: ReturnType<typeof setInterval> | null = null;
let pingUrl = "";

export function configurePing(url: string) { pingUrl = url; }
export function isOnline() { return online; }

function set(next: boolean) {
  if (next === online) return;
  online = next;
  listeners.forEach((l) => l(next));
  if (!next && !pinger && pingUrl) {
    pinger = setInterval(async () => {
      try {
        const res = await fetch(pingUrl, { cache: "no-store" });
        if (res.ok) set(true);
      } catch { /* still unreachable */ }
    }, 20000);
  }
  if (next && pinger) { clearInterval(pinger); pinger = null; }
}

export const reportOnline = () => set(true);
export const reportOffline = () => set(false);

export function onConnectivityChange(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; }

export function useOnline(): boolean {
  const [value, setValue] = useState(online);
  useEffect(() => onConnectivityChange(setValue), []);
  return value;
}
