// Whether the LocalMind server can be reached right now.
//
// "Offline" here means the server is unreachable, which on a school LAN is
// not the same as having no internet. The API client reports every request
// outcome; failed requests trigger a separate reachability check. While offline a bounded ping backs off from roughly 5 seconds and, the moment
// the server answers again, listeners (the sync) are told.
import { useEffect, useState } from "react";
import { ConnectionCheck } from './connectionCheck';
import { RecoveryProbe } from './recovery';

type Listener = (online: boolean) => void;
let online = true;
const listeners = new Set<Listener>();
let pingUrl = "";
const confirmation=new ConnectionCheck(()=>pingUrl,()=>set(false));
const recovery=new RecoveryProbe(()=>pingUrl,()=>set(true));

export function configurePing(url: string) { confirmation.stop();recovery.stop();pingUrl = url;if(!online)recovery.start(); }
export function isOnline() { return online; }

function set(next: boolean) {
  if (next === online) return;
  online = next;
  listeners.forEach((l) => l(next));
  if(next)recovery.stop();else recovery.start();
}

export const reportOnline = () => { confirmation.stop();set(true); };
// Request failures do not switch the whole application offline. Confirm first.
export const reportConnectionFailure = () => { if(online)confirmation.start(); };

export function onConnectivityChange(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; }

export function useOnline(): boolean {
  const [value, setValue] = useState(online);
  useEffect(() => onConnectivityChange(setValue), []);
  return value;
}
