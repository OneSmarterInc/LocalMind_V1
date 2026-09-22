import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { admin } from "@/api/endpoints";
import type { AuditLog } from "@/api/types";
import { useAsync } from "@/hooks/useAsync";
import { useDebounced } from "@/hooks/useDebounced";
import { Badge, Button, Card, DetailList, Dropdown, Empty, ErrorBanner, Input, Loading, PageHeading, Row, Screen, TableFooter, TextLink, colors, fmtDate, RequestFailed } from "@/ui";
import { DateTimeField } from "@/ui/DateTimeField";

const toDay = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fromDay = (day: string) => new Date(`${day}T00:00:00`).toISOString();

/**
 * The audit log, written for reading.
 *
 * Entries used to arrive as a raw action string, a target type and the summary
 * dictionary run through JSON.stringify, which meant nobody could scan the
 * page. Every action in this system is named "<entity>.<verb>", so the entity
 * and verb are split apart and rendered as a sentence, the summary is laid out
 * as labelled values, and entries are grouped under the day they happened.
 */

type Tone = "danger" | "success" | "warning" | "accent" | "muted";

const TONES: Record<Tone, string> = {
  danger: colors.danger,
  success: colors.success,
  warning: colors.warning,
  accent: colors.accent,
  muted: colors.muted,
};

/** Verb families, matched as substrings so a new verb still lands somewhere sensible. */
function toneFor(verb: string): Tone {
  if (/delete|removed|failed|discontinu|revoked|unassigned/.test(verb)) return "danger";
  if (/creat|publish|reactivat|enroll|assigned|processed|uploaded/.test(verb)) return "success";
  if (/archiv|unpublish|closed|reset|superseded/.test(verb)) return "warning";
  if (/updat|edit|review|status/.test(verb)) return "accent";
  return "muted";
}

const ICONS: Record<Tone, keyof typeof Ionicons.glyphMap> = {
  danger: "trash-outline",
  success: "add-circle-outline",
  warning: "alert-circle-outline",
  accent: "create-outline",
  muted: "ellipse-outline",
};

const sentence = (s: string) => {
  const clean = s.replace(/[._]/g, " ").trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
};

/** "subject.deleted" becomes { entity: "subject", verb: "deleted" } */
function splitAction(action: string) {
  const dot = action.indexOf(".");
  if (dot === -1) return { entity: "", verb: action };
  return { entity: action.slice(0, dot), verb: action.slice(dot + 1) };
}

/** Renders one summary value: [old, new] pairs read as a change, lists join. */
function summaryValue(value: unknown): string {
  if (value === null || value === undefined) return "\u2014";
  if (Array.isArray(value)) {
    if (value.length === 2 && value.every((v) => typeof v !== "object")) return `${value[0]} \u2192 ${value[1]}`;
    return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ");
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const HIDDEN_KEYS = new Set(["conversation", "latency_ms", "modules", "document_id", "module_id", "subject_id", "attempt_id"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;



const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const dayLabel = (iso: string) => {
  const d = new Date(iso), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return "Today";
  if (sameDay(d, y)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
};
const timeOnly = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function DetailPairs({ log }: { log: AuditLog }) {
  const pairs = Object.entries(log.summary ?? {})
    .filter(([, v]) => v !== "" && v !== null && v !== undefined)
    // Internal identifiers and timings tell a reader nothing.
    .filter(([key, v]) => !HIDDEN_KEYS.has(key) && !(typeof v === "string" && UUID.test(v)));
  return (
    <View style={{ gap: 8, paddingHorizontal: 18, paddingBottom: 16, paddingTop: 4, backgroundColor: "#FAFBF8", borderBottomWidth: 1, borderBottomColor: colors.rowLine }}>
      <DetailList items={[
        ["Action", log.action],
        ["Target", `${log.target_type}${log.target_label ? ` · ${log.target_label}` : ""}`],
        ["Target ID", log.target_id || "—"],
        ["When", fmtDate(log.created_at)],
        ...pairs.map(([k, v]) => [sentence(k), summaryValue(v)] as [string, string]),
      ]} />
    </View>
  );
}

export default function Audit() {
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [target, setTarget] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const who = useDebounced(actor);
  const targetId = useDebounced(target);
  const validDate = (v: string) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v);
  const q = useAsync(() => admin.auditLogs({ action, actor_email: who, target_id: targetId.trim() || undefined, since: validDate(since) && since ? `${since}T00:00:00` : undefined, until: validDate(until) && until ? `${until}T23:59:59` : undefined, page }), [action, who, targetId, since, until, page]);
  const known = useAsync(() => admin.auditActions(), []);
  const reset = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };
  const rows = q.data?.results ?? [];
  const tones: Record<string, "red" | "green" | "amber" | "blue" | "neutral"> = { danger: "red", success: "green", warning: "amber", accent: "blue", muted: "neutral" };
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <PageHeading eyebrow="PLATFORM ACCOUNTABILITY" title="Audit log" subtitle="Who changed what, and when. Select an entry to see its details." />
      <ErrorBanner message={q.error} onRetry={q.reload} />
      <Card flush>
        <View style={{ paddingHorizontal: 22, paddingTop: 22, paddingBottom: 14, gap: 10 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <Input icon="search" compact containerStyle={{ flex: 1, minWidth: 220, maxWidth: 350 }} placeholder="Filter by who did it (email)" value={actor} onChangeText={reset(setActor)} accessibilityLabel="Filter by actor email" />
            <Dropdown value={action} onChange={reset(setAction)} accessibilityLabel="Filter by action"
              options={[{ value: "", label: "All actions" }, ...(known.data?.actions ?? []).map((a) => ({ value: a.value, label: `${sentence(a.value)} (${a.count})` }))]} />
          </View>
          <Row style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
            <DateTimeField dateOnly label="From date" value={since ? fromDay(since) : null} onChange={(v) => reset(setSince)(v ? toDay(v) : "")} width={190} />
            <DateTimeField dateOnly label="To date" value={until ? fromDay(until) : null} onChange={(v) => reset(setUntil)(v ? toDay(v) : "")} width={190} />
            {more ? <Input label="Target ID" compact value={target} onChangeText={reset(setTarget)} placeholder="Paste an ID" containerStyle={{ minWidth: 240 }} /> : null}
            <TextLink title={more ? "Hide target ID" : "Filter by target ID"} onPress={() => setMore((v) => !v)} />
            {(target || since || until || action || actor) ? <Button title="Clear filters" small variant="secondary" icon="close" onPress={() => { setTarget(""); setSince(""); setUntil(""); setAction(""); setActor(""); setPage(1); }} /> : null}
          </Row>
        </View>
        {q.error && !q.data ? <RequestFailed onRetry={q.reload} /> : q.loading && !q.data ? <Loading lines={3} /> : rows.length === 0 ? <Empty icon="receipt-outline" text={action || actor || target || since || until ? "Nothing matches these filters." : "Nothing has been recorded yet."} /> : (
          <View>
            {rows.map((log, i) => {
              const { entity, verb } = splitAction(log.action);
              const tone = toneFor(verb);
              const day = dayLabel(log.created_at);
              const newDay = i === 0 || dayLabel(rows[i - 1].created_at) !== day;
              const expanded = open === log.id;
              const who = log.actor_email || "System";
              const what = `${verb.replace(/_/g, " ")} ${entity ? entity.replace(/_/g, " ") : ""}`.trim();
              return (
                <View key={log.id}>
                  {newDay ? <Text style={{ paddingHorizontal: 22, paddingTop: 16, paddingBottom: 6, fontSize: 12, fontWeight: "600", color: colors.muted, backgroundColor: "#F7F9F5", borderTopWidth: 1, borderColor: colors.border }}>{day}</Text> : null}
                  <Pressable onPress={() => setOpen((o) => (o === log.id ? null : log.id))} accessibilityRole="button" accessibilityState={{ expanded }}
                    accessibilityLabel={`${who} ${what}${log.target_label ? ` ${log.target_label}` : ""}. ${expanded ? "Hide" : "Show"} details`}
                    style={(st: any) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 22, paddingVertical: 12, borderTopWidth: newDay ? 0 : 1, borderColor: colors.rowLine, backgroundColor: st.hovered || expanded ? "#FAFBF8" : colors.surface })}>
                    <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: `${TONES[tone]}18` }}>
                      <Ionicons name={ICONS[tone]} size={15} color={TONES[tone]} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontSize: 13, color: colors.ink }} numberOfLines={2}>
                        <Text style={{ fontWeight: "600" }}>{who}</Text>{log.actor_role ? <Text style={{ color: colors.muted }}> ({log.actor_role})</Text> : null} {what}{log.target_label ? <Text style={{ fontWeight: "600" }}> “{log.target_label}”</Text> : null}
                      </Text>
                    </View>
                    {entity ? <Badge value={sentence(entity)} tone={tones[tone]} /> : null}
                    <Text style={{ fontSize: 12, color: colors.muted, width: 70, textAlign: "right" }}>{timeOnly(log.created_at)}</Text>
                    <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.faint} />
                  </Pressable>
                  {expanded ? <DetailPairs log={log} /> : null}
                </View>
              );
            })}
          </View>
        )}
        {q.data && q.data.count > 0 ? (
          <TableFooter>
            <Text style={{ fontSize: 11, color: colors.muted }}>Showing {rows.length} of {q.data.count} records · page {page}</Text>
            <Row style={{ gap: 8 }}>
              <Button title="Previous" small variant="secondary" icon="chevron-back" disabled={page <= 1} onPress={() => setPage((p) => p - 1)} />
              <Button title="Next" small variant="secondary" icon="chevron-forward" disabled={!q.data.next} onPress={() => setPage((p) => p + 1)} />
            </Row>
          </TableFooter>
        ) : null}
      </Card>
    </Screen>
  );
}
