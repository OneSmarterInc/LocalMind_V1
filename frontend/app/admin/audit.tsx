import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Platform, Pressable, type PressableStateCallbackType, Text, View } from "react-native";
import { admin } from "@/api/endpoints";
import type { AuditCategory, AuditLog } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { useDebounced } from "@/hooks/useDebounced";
import { Avatar, Badge, Button, Card, Chip, Dropdown, Empty, ErrorBanner, Input, Loading, Notice, PageHeading, RequestFailed, Row, Screen, Stat, StatRow, TableFooter, TextLink, colors, fmtDate, useWide } from "@/ui";
import { DateTimeField } from "@/ui/DateTimeField";
import type { Tone } from "@/ui/theme";

/**
 * The audit log, written to be read.
 *
 * Each event is one sentence ("Priya Shah published the book Operations
 * Management"), grouped under the day it happened, with an outcome tag and a
 * red edge on failures. Category chips replace the list of raw action names;
 * the details panel shows what changed as old -> new and tucks identifiers
 * away under "Technical details". Every action is named "<entity>.<verb>".
 */

// Keep in step with backend/audit/categories.py (a backend test checks it).
export const CATEGORY_OF: Record<string, AuditCategory> = {
  document: "content", chapter: "content", module: "content", lesson: "content", lessons: "content", authoring: "content",
  quiz: "quiz", auto_quiz: "quiz",
  user: "people", users: "people",
  subject: "class", faculty: "class", student: "class",
  auth: "auth",
  tutor: "ai", ai_monitor: "ai",
};

const CATEGORIES: { key: AuditCategory | "all" | "failures"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "content", label: "Books and lessons" },
  { key: "quiz", label: "Quizzes" },
  { key: "people", label: "Accounts" },
  { key: "class", label: "Subjects and enrolment" },
  { key: "auth", label: "Sign-in" },
  { key: "ai", label: "AI tutor" },
  { key: "failures", label: "Failures only" },
];

type Range = "today" | "7d" | "30d" | "all" | "custom";
const RANGES: { key: Range; label: string }[] = [
  { key: "today", label: "Today" }, { key: "7d", label: "7 days" }, { key: "30d", label: "30 days" },
  { key: "all", label: "All time" }, { key: "custom", label: "Custom" },
];

const ROLES = [
  { value: "", label: "Anyone" }, { value: "admin", label: "Administrators" }, { value: "faculty", label: "Faculty" },
  { value: "student", label: "Students" }, { value: "system", label: "System" },
];

/** What each entity is called in a sentence. */
const NOUN: Record<string, string> = {
  document: "the book", chapter: "the chapter", module: "the module", lesson: "the lesson", lessons: "lessons for",
  authoring: "device work on", quiz: "the quiz", auto_quiz: "the automatic quiz for", user: "the account of",
  users: "accounts", subject: "the subject", faculty: "", student: "", auth: "", tutor: "the AI tutor about", ai_monitor: "the AI incident",
};

/** Hand-written sentences where "<verb> <noun>" would read badly. */
const PHRASE: Record<string, (target: string) => string> = {
  "auth.login": () => "signed in",
  "auth.logout": () => "signed out",
  "auth.login_failed": (t) => `failed to sign in${t ? ` as ${t}` : ""}`,
  "auth.login_locked": (t) => `locked sign-in for ${t || "an account"}`,
  "faculty.assigned_subject": (t) => `assigned faculty to ${t || "a subject"}`,
  "faculty.unassigned_subject": (t) => `removed faculty from ${t || "a subject"}`,
  "student.enrolled": (t) => `enrolled a student in ${t || "a subject"}`,
  "student.enrollment_discontinued": (t) => `ended an enrolment in ${t || "a subject"}`,
  "tutor.ask": (t) => `asked the AI tutor${t ? ` about ${t}` : ""}`,
  "tutor.ask_failed": (t) => `could not get an AI tutor answer${t ? ` about ${t}` : ""}`,
  "tutor.remediation": (t) => `got a follow-up from the AI tutor${t ? ` on ${t}` : ""}`,
  "document.processing_failed": (t) => `could not process ${t || "a book"}`,
  "document.processing_started": (t) => `started processing ${t || "a book"}`,
  "document.processed": (t) => `finished processing ${t || "a book"}`,
  "users.imported": () => "imported accounts from Excel",
  "user.password_changed": (t) => `changed the password${t ? ` for ${t}` : ""}`,
  "user.password_reset_by_admin": (t) => `reset the password for ${t || "an account"}`,
  "user.password_reset_to_shared": (t) => `reset ${t || "an account"} to the shared password`,
  "quiz.results_released": (t) => `released results for ${t || "a quiz"}`,
  "quiz.attempt_submitted": (t) => `submitted ${t || "a quiz"}`,
  "quiz.attempt_started": (t) => `started ${t || "a quiz"}`,
  "module.opened_on_publish": (t) => `opened ${t || "a module"} on publish`,
  "authoring.device_received": (t) => `synchronized work on ${t || "a module"}`,
};

function splitAction(action: string) {
  const dot = action.indexOf(".");
  return dot === -1 ? { entity: "", verb: action } : { entity: action.slice(0, dot), verb: action.slice(dot + 1) };
}

const words = (s: string) => s.replace(/[._]/g, " ").trim();
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Neha Joshi <neha@x.edu>" (how accounts label themselves) reads as "Neha Joshi". */
const cleanLabel = (s: string) => s.replace(/\s*<[^>]+>\s*$/, "").trim();

export function describe(log: AuditLog) {
  const { entity, verb } = splitAction(log.action);
  const target = cleanLabel(log.target_label || "");
  const custom = PHRASE[log.action];
  if (custom) return { verb: custom(target), object: "" };
  const noun = NOUN[entity] ?? words(entity);
  return { verb: `${words(verb)}${noun ? ` ${noun}` : ""}`, object: target };
}

/** Tags where the verb itself reads badly as a label. */
const TAG: Record<string, { label: string; tone: Tone }> = {
  login: { label: "Signed in", tone: "neutral" }, logout: { label: "Signed out", tone: "neutral" },
  ask: { label: "Asked", tone: "neutral" }, remediation: { label: "Follow-up", tone: "neutral" },
  assigned_subject: { label: "Assigned", tone: "green" }, unassigned_subject: { label: "Removed", tone: "red" },
  enrollment_discontinued: { label: "Enrolment ended", tone: "red" }, device_received: { label: "Synchronized", tone: "blue" },
  attempt_started: { label: "Started", tone: "neutral" }, attempt_submitted: { label: "Submitted", tone: "green" },
  attempt_reevaluated: { label: "Regraded", tone: "blue" }, opened_on_publish: { label: "Opened", tone: "green" },
  new_version: { label: "New version", tone: "blue" }, auto_held: { label: "Held", tone: "amber" }, auto_published: { label: "Published", tone: "green" },
  password_changed: { label: "Password changed", tone: "blue" }, password_reset_by_admin: { label: "Password reset", tone: "amber" },
  password_reset_to_shared: { label: "Password reset", tone: "amber" }, processing_started: { label: "Processing", tone: "neutral" },
};

/** Outcome tag text and colour, from the verb. */
function outcome(log: AuditLog): { label: string; tone: Tone } {
  const { verb } = splitAction(log.action);
  if (log.action === "auth.login_locked") return { label: "Locked out", tone: "amber" };
  if (log.failed ?? /failed$/.test(verb)) return { label: "Failed", tone: "red" };
  const fixed = TAG[verb];
  if (fixed) return fixed;
  const label = capital(words(verb));
  if (/delete|removed|discontinu|revoked|unassigned/.test(verb)) return { label, tone: "red" };
  if (/archiv|unpublish|locked|reset|superseded|held/.test(verb)) return { label, tone: "amber" };
  if (/creat|publish|reactivat|enroll|assigned|processed|uploaded|released|opened|imported|unarchived/.test(verb)) return { label, tone: "green" };
  if (/updat|edit|review|changed|tidied|received/.test(verb)) return { label, tone: "blue" };
  return { label, tone: "neutral" };
}

const HIDDEN_KEYS = new Set(["conversation", "latency_ms", "modules", "document_id", "module_id", "subject_id", "attempt_id", "operation"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Change = { key: string; before?: string; after: string };
function changes(log: AuditLog): Change[] {
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "boolean" ? (v ? "yes" : "no") : typeof v === "object" ? JSON.stringify(v) : String(v));
  return Object.entries(log.summary ?? {})
    .filter(([k, v]) => v !== "" && v !== null && v !== undefined && !HIDDEN_KEYS.has(k) && !(typeof v === "string" && UUID.test(v)))
    .map(([k, v]) => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x !== "object")
      ? { key: capital(words(k)), before: show(v[0]), after: show(v[1]) }
      : { key: capital(words(k)), after: Array.isArray(v) ? v.map(show).join(", ") : show(v) });
}

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const dayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
function dayLabel(iso: string) {
  const d = new Date(iso), now = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  const name = d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
  return diff === 0 ? `Today, ${name}` : diff === 1 ? `Yesterday, ${name}` : name;
}

function sinceFor(range: Range): string | undefined {
  const now = new Date(), midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === "today") return midnight.toISOString();
  if (range === "7d") return new Date(midnight.getTime() - 6 * 86400000).toISOString();
  if (range === "30d") return new Date(midnight.getTime() - 29 * 86400000).toISOString();
  return undefined;
}
const endOfDay = (iso: string) => { const d = new Date(iso); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).toISOString(); };
const startOfDay = (iso: string) => { const d = new Date(iso); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString(); };

const ROLE_LABEL: Record<string, string> = { admin: "Admin", faculty: "Faculty", student: "Student" };

function Entry({ log, open, onToggle, onTarget, onActor, wide }: {
  log: AuditLog; open: boolean; onToggle: () => void; onTarget: () => void; onActor: () => void; wide: boolean;
}) {
  const { verb, object } = describe(log);
  const tag = outcome(log);
  const who = log.actor_name || log.actor_email || "System";
  const system = !log.actor_email;
  const rows = changes(log);
  const failed = tag.label === "Failed" || tag.label === "Locked out";
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: colors.rowLine, borderLeftWidth: 3, borderLeftColor: failed ? colors.danger : "transparent", backgroundColor: open ? "#FBFCFA" : undefined }}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${who} ${verb} ${object}. ${open ? "Hide" : "Show"} details`}>
        {(st: PressableStateCallbackType & { hovered?: boolean }) => (
          <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start", paddingVertical: 13, paddingHorizontal: 18, backgroundColor: st.hovered && !open ? "#FBFCFA" : undefined }}>
            {wide ? <Text style={{ width: 64, paddingTop: 8, fontSize: 12, color: colors.muted }}>{time(log.created_at)}</Text> : null}
            {system
              ? <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "#EEF0EC", alignItems: "center", justifyContent: "center" }}><Ionicons name="hardware-chip-outline" size={16} color={colors.muted} /></View>
              : <Avatar name={who} size={34} tone={log.actor_role === "admin" ? "blue" : "green"} />}
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <Text style={{ fontSize: 14, color: colors.ink, lineHeight: 20 }}>
                <Text style={{ fontWeight: "600" }}>{who}</Text>
                {log.actor_role && ROLE_LABEL[log.actor_role] ? <Text style={{ fontSize: 11, color: colors.muted }}>{`  ${ROLE_LABEL[log.actor_role]}  `}</Text> : " "}
                {verb}{object ? " " : ""}{object ? <Text style={{ fontWeight: "600" }}>{object}</Text> : null}
              </Text>
              {!wide ? <Text style={{ fontSize: 12, color: colors.faint }}>{time(log.created_at)}</Text> : null}
            </View>
            <View style={{ paddingTop: 4, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Badge value={tag.label} tone={tag.tone} />
              <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.faint} />
            </View>
          </View>
        )}
      </Pressable>
      {open ? (
        <View style={{ marginLeft: wide ? 128 : 64, marginRight: 18, marginBottom: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: "#FFFFFF", overflow: "hidden" }}>
          {rows.length ? (
            <View style={{ padding: 14, gap: 7 }}>
              <Text style={{ fontSize: 11.5, fontWeight: "600", color: colors.muted }}>What changed</Text>
              {rows.map((c) => (
                <View key={c.key} style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  <Text style={{ width: 150, fontSize: 13, color: colors.muted }}>{c.key}</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, flex: 1, minWidth: 160 }}>
                    {c.before !== undefined ? <Text style={{ fontSize: 13, color: colors.danger, backgroundColor: "#FFF0EE", paddingHorizontal: 5, borderRadius: 4, textDecorationLine: "line-through" }}>{c.before}</Text> : null}
                    {c.before !== undefined ? <Ionicons name="arrow-forward" size={13} color={colors.faint} style={{ marginTop: 3 }} /> : null}
                    <Text style={[{ fontSize: 13, color: colors.text }, c.before !== undefined && { color: "#28583D", backgroundColor: "#E9F3EB", paddingHorizontal: 5, borderRadius: 4 }]}>{c.after}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
          <View style={{ padding: 14, gap: 4, backgroundColor: colors.surface2, borderTopWidth: rows.length ? 1 : 0, borderTopColor: colors.rowLine }}>
            <Text style={{ fontSize: 11.5, fontWeight: "600", color: colors.muted, marginBottom: 2 }}>Technical details</Text>
            {[
              ["Action", log.action],
              ["Item", `${log.target_type || "—"}${log.target_id ? ` · ${log.target_id}` : ""}`],
              ["Account", log.actor_email || "System"],
              ["IP address", log.ip_address || "—"],
              ["Exact time", fmtDate(log.created_at)],
            ].map(([k, v]) => (
              <Text key={k} style={{ fontSize: 12, color: colors.muted }} selectable>{k}  <Text style={{ color: colors.text }}>{v}</Text></Text>
            ))}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.rowLine }}>
            {log.target_id ? <TextLink title="Everything that happened to this item" onPress={onTarget} /> : null}
            {log.actor_email ? <TextLink title={`Everything ${log.actor_name?.split(" ")[0] || "this person"} did`} onPress={onActor} /> : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function pageList(page: number, pages: number): (number | "…")[] {
  const set = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  sorted.forEach((p, i) => { if (i && p - sorted[i - 1]! > 1) out.push("…"); out.push(p); });
  return out;
}

export default function Audit() {
  const wide = useWide(760);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<AuditCategory | "all" | "failures">("all");
  const [range, setRange] = useState<Range>("7d");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [role, setRole] = useState("");
  const [target, setTarget] = useState<{ id: string; label: string } | null>(null);
  const [person, setPerson] = useState<{ email: string; label: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const q = useDebounced(search);

  const since = range === "custom" ? (from ? startOfDay(from) : undefined) : sinceFor(range);
  const until = range === "custom" && to ? endOfDay(to) : undefined;
  const base = { q: q.trim() || undefined, since, until, role: role || undefined, target_id: target?.id, actor_email: person?.email };
  const query = { ...base, category: category === "all" ? undefined : category };
  const todaySince = sinceFor("today");

  const list = useAsync(() => admin.auditLogs({ ...query, page }), [q, since, until, role, target?.id, person?.email, category, page]);
  const summary = useAsync(() => admin.auditSummary({ ...base, today_since: todaySince }), [q, since, until, role, target?.id, person?.email]);
  const exporter = useAction(async () => {
    const data = await admin.auditExport(query);
    const blob = new Blob([data.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = data.filename; a.click(); URL.revokeObjectURL(url);
    return data;
  });

  const reset = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(1); setOpen(null); };
  const rows = useMemo(() => list.data?.results ?? [], [list.data]);
  const groups = useMemo(() => {
    const out: { key: string; label: string; rows: AuditLog[] }[] = [];
    for (const r of rows) {
      const k = dayKey(r.created_at);
      const last = out[out.length - 1];
      if (last && last.key === k) last.rows.push(r); else out.push({ key: k, label: dayLabel(r.created_at), rows: [r] });
    }
    return out;
  }, [rows]);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.count / 25)) : 1;
  const s = summary.data;
  const anyFilter = !!(q || role || target || person || category !== "all" || range !== "7d");
  const clearAll = () => { setSearch(""); setRole(""); setTarget(null); setPerson(null); setCategory("all"); setRange("7d"); setFrom(null); setTo(null); setPage(1); setOpen(null); };
  const rangeText = range === "custom" ? [from && `from ${new Date(from).toLocaleDateString()}`, to && `to ${new Date(to).toLocaleDateString()}`].filter(Boolean).join(" ") || "Custom range" : RANGES.find((r) => r.key === range)!.label;

  return (
    <Screen refreshing={list.loading} onRefresh={() => { list.reload(); summary.reload(); }}>
      <PageHeading eyebrow="PLATFORM ACCOUNTABILITY" title="Audit log" subtitle="Who changed what, and when, across the whole platform."
        right={Platform.OS === "web" ? <Button title="Download CSV" icon="download-outline" small variant="secondary" busy={exporter.busy} disabled={!list.data?.count} onPress={() => exporter.run()} /> : null} />
      <ErrorBanner message={list.error ?? exporter.error} onRetry={list.error ? list.reload : undefined} />

      {wide ? (
        <StatRow>
          <Stat label="Events today" value={s?.events_today} icon="pulse-outline" />
          <Stat label="People active today" value={s?.people_today} icon="people-outline" />
          <Stat label="Books published this week" value={s?.published_week} icon="book-outline" />
          <Stat label="Failures and lockouts this week" value={s?.failures_week} icon="alert-circle-outline" helper={s && s.failures_week ? "Filter with Failures only" : null} />
        </StatRow>
      ) : (
        <Card>
          <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 14 }}>
            {([["Events today", s?.events_today], ["Active today", s?.people_today], ["Published this week", s?.published_week], ["Failures this week", s?.failures_week]] as const).map(([label, value], i) => (
              <View key={label} style={{ width: "50%", gap: 2 }}>
                <Text style={{ fontSize: 22, fontWeight: "600", color: i === 3 && value ? colors.danger : colors.ink }}>{value ?? "—"}</Text>
                <Text style={{ fontSize: 12, color: colors.muted }}>{label}</Text>
              </View>
            ))}
          </View>
        </Card>
      )}

      <Card flush>
        <View style={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, gap: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <Input icon="search" compact containerStyle={{ flex: 1, minWidth: 240 }} placeholder="Search by person, email, or item name" value={search} onChangeText={reset(setSearch)} accessibilityLabel="Search the audit log" />
            {wide ? (
              <View style={{ flexDirection: "row", borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: "hidden" }} accessibilityRole="radiogroup" accessibilityLabel="Date range">
              {RANGES.map((r, i) => (
                <Pressable key={r.key} onPress={() => reset(setRange)(r.key)} accessibilityRole="radio" accessibilityState={{ checked: range === r.key }}>
                  <Text style={{ paddingHorizontal: 12, paddingVertical: 8, fontSize: 12.5, color: range === r.key ? colors.primary : colors.muted, fontWeight: range === r.key ? "600" : "400", backgroundColor: range === r.key ? colors.pale : "#FFFFFF", borderLeftWidth: i ? 1 : 0, borderLeftColor: colors.border }}>{r.label}</Text>
                </Pressable>
              ))}
            </View>
            ) : <Dropdown value={range} onChange={reset(setRange)} options={RANGES.map((r) => ({ value: r.key, label: r.label }))} accessibilityLabel="Date range" />}
            <Dropdown value={role} onChange={reset(setRole)} options={ROLES} accessibilityLabel="Filter by role" />
          </View>
          {range === "custom" ? (
            <Row style={{ alignItems: "flex-start" }}>
              <DateTimeField dateOnly label="From date" value={from} onChange={reset(setFrom)} width={200} />
              <DateTimeField dateOnly label="To date" value={to} onChange={reset(setTo)} width={200} />
            </Row>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {CATEGORIES.map((c) => {
              const count = !s ? undefined : c.key === "all" ? s.total : c.key === "failures" ? s.failures : s.categories[c.key];
              return <Chip key={c.key} label={c.label} count={count} selected={category === c.key} onPress={() => reset(setCategory)(c.key)} />;
            })}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <Text style={{ fontSize: 12, color: colors.muted }}>Showing</Text>
            <Badge value={rangeText} tone="blue" />
            {target ? <Chip label={`Item: ${target.label}  ✕`} selected onPress={() => reset(setTarget)(null)} /> : null}
            {person ? <Chip label={`Person: ${person.label}  ✕`} selected onPress={() => reset(setPerson)(null)} /> : null}
            {anyFilter ? <TextLink title="Clear all" onPress={clearAll} /> : null}
          </View>
        </View>

        {list.error && !list.data ? <RequestFailed onRetry={list.reload} />
          : list.loading && !list.data ? <Loading lines={4} />
          : rows.length === 0 ? <Empty icon="receipt-outline" text={anyFilter ? "Nothing matches these filters." : "Nothing has been recorded in the last 7 days."} action={anyFilter ? <Button title="Clear filters" small variant="secondary" onPress={clearAll} /> : <Button title="Show all time" small variant="secondary" onPress={() => reset(setRange)("all")} />} />
          : groups.map((g) => (
            <View key={g.key}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 9, backgroundColor: colors.surface2, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>{g.label}</Text>
                <Text style={{ fontSize: 12, color: colors.faint }}>{g.rows.length} {g.rows.length === 1 ? "event" : "events"}</Text>
              </View>
              {g.rows.map((log) => (
                <Entry key={log.id} log={log} wide={wide} open={open === log.id}
                  onToggle={() => setOpen((o) => (o === log.id ? null : log.id))}
                  onTarget={() => { setTarget({ id: log.target_id, label: cleanLabel(log.target_label) || log.target_type }); setCategory("all"); setRange("all"); setPage(1); setOpen(null); }}
                  onActor={() => { setPerson({ email: log.actor_email, label: log.actor_name || log.actor_email }); setRange("all"); setPage(1); setOpen(null); }} />
              ))}
            </View>
          ))}

        {list.data && list.data.count > 0 ? (
          <TableFooter>
            <Text style={{ fontSize: 12, color: colors.muted }}>Showing {(page - 1) * 25 + 1}–{(page - 1) * 25 + rows.length} of {list.data.count} events</Text>
            <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
              <Button title="" icon="chevron-back" small variant="secondary" accessibilityLabel="Previous page" disabled={page <= 1} onPress={() => { setPage((p) => p - 1); setOpen(null); }} />
              {pageList(page, pages).map((p, i) => p === "…"
                ? <Text key={`gap${i}`} style={{ paddingHorizontal: 4, color: colors.faint }}>…</Text>
                : <Button key={p} title={String(p)} small variant={p === page ? "primary" : "secondary"} accessibilityLabel={`Page ${p}`} onPress={() => { setPage(p); setOpen(null); }} />)}
              <Button title="" icon="chevron-forward" small variant="secondary" accessibilityLabel="Next page" disabled={!list.data.next} onPress={() => { setPage((p) => p + 1); setOpen(null); }} />
            </View>
          </TableFooter>
        ) : null}
      </Card>
      {list.data && list.data.count > 10000 && Platform.OS === "web" ? <Notice tone="info" title="Large export" message="CSV downloads include the newest 10,000 events that match your filters." /> : null}
    </Screen>
  );
}
