import { useEffect, useState } from "react";
import { meta } from "@/api/endpoints";

export interface Choice { value: string; label: string }

/**
 * Status filters, read from the server rather than restated in each screen.
 *
 * Every list used to carry its own array of status strings, which quietly went
 * out of step whenever the matching TextChoices class changed. The API derives
 * these from the models, so a status that is added, renamed or retired shows up
 * here without a frontend edit. The result is cached for the session because
 * the enums cannot change while the app is open.
 */
let cache: Record<string, Choice[]> | null = null;
let inflight: Promise<Record<string, Choice[]>> | null = null;

export function useChoices(set: string): Choice[] {
  const [choices, setChoices] = useState<Choice[]>(() => cache?.[set] ?? []);
  useEffect(() => {
    let alive = true;
    if (cache) { setChoices(cache[set] ?? []); return; }
    if (!inflight) inflight = meta.choices().then((d) => { cache = d; return d; }).finally(() => { inflight = null; });
    inflight.then((d) => { if (alive) setChoices(d[set] ?? []); }).catch(() => { if (alive) setChoices([]); });
    return () => { alive = false; };
  }, [set]);
  return choices;
}

/** The same list with the leading "All" entry every filter row starts with. */
export function useFilterChoices(set: string): Choice[] {
  return [{ value: "", label: "All" }, ...useChoices(set)];
}
