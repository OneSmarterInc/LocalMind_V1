/** Date helpers for the date/time field, kept free of React so they can be tested on their own. */

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO instant -> "YYYY-MM-DDTHH:MM" (or "YYYY-MM-DD") in the device's time zone. "" for empty or invalid. */
export function toLocalText(iso: string | null | undefined, dateOnly = false): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return dateOnly ? day : `${day}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * "YYYY-MM-DD[T| ]HH:MM" read as local time -> ISO instant. Returns null for anything that is not a real
 * calendar date and time: 2026-02-31 or 25:00 are rejected, never rolled over into another day.
 */
export function parseLocalText(text: string, dateOnly = false): string | null {
  const m = text.trim().match(dateOnly ? /^(\d{4})-(\d{2})-(\d{2})$/ : /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [h, mi] = dateOnly ? [0, 0] : [Number(m[4]), Number(m[5])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const date = new Date(y, mo - 1, d, h, mi);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || date.getHours() !== h || date.getMinutes() !== mi) return null;
  return date.toISOString();
}

/** Readable local date (and time) for display, e.g. "30 Sep 2026, 17:00". */
export function formatLocal(iso: string | null | undefined, dateOnly = false): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return dateOnly ? day : `${day}, ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

export function timeZoneLabel(): string {
  const zone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ""; } })();
  const off = -new Date().getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return `${zone ? `${zone}, ` : ""}UTC${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}
