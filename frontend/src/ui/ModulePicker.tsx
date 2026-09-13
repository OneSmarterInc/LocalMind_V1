import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { manage } from "@/api/endpoints";
import type { Document, Outline } from "@/api/types";
import { useAsync } from "@/hooks/useAsync";
import { Chip, Label, Loading, P, Row, colors, radius, radiusSm, space } from "@/ui";
import { scrollFix } from "./workspace";

/**
 * Choose the modules a quiz or an assignment is written from.
 *
 * The old picker emitted exactly one target, because the API accepted exactly
 * one: a module or a chapter. A quiz that covers "momentum, impulse and the
 * third law" had no way to say so, and picking the chapter dragged in eleven
 * other modules. This emits a set of module ids, and the backend resolves a
 * single id back to a plain module quiz so nothing downstream changed shape.
 *
 * Chapters carry their own checkbox for select-all, and show a partial mark
 * when only some of their modules are chosen.
 */
export function ModulePicker({ value, onChange, subjectId, onSubjectChange, disabled }: {
  value: string[];
  onChange: (moduleIds: string[]) => void;
  subjectId?: string;
  onSubjectChange?: (id: string) => void;
  disabled?: boolean;
}) {
  const subjects = useAsync(() => manage.subjects(), []);
  const [subject, setSubject] = useState(subjectId ?? "");
  const [docId, setDocId] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const docs = useAsync(() => (subject ? manage.documents({ subject, status: "published" }) : Promise.resolve([] as Document[])), [subject]);
  const outline = useAsync(() => (docId ? manage.outline(docId) : Promise.resolve(null as Outline | null)), [docId]);

  // Pick the only book automatically: a subject usually has one, and making
  // someone choose from a list of one is a step for nothing.
  useEffect(() => { if (docs.data?.length === 1) setDocId(docs.data[0].id); }, [docs.data]);
  useEffect(() => { if (subjectId && subjectId !== subject) setSubject(subjectId); }, [subjectId, subject]);

  const chosen = useMemo(() => new Set(value), [value]);
  const chapters = useMemo(() => outline.data?.chapters ?? [], [outline.data]);
  const chapterCount = useMemo(() => {
    const names = new Set<string>();
    chapters.forEach((c) => c.modules.forEach((m) => { if (m.id && chosen.has(m.id)) names.add(c.id ?? c.title); }));
    return names.size;
  }, [chapters, chosen]);

  const toggle = (id: string) => onChange(chosen.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  const toggleChapter = (ids: string[]) => {
    const all = ids.every((i) => chosen.has(i));
    onChange(all ? value.filter((x) => !ids.includes(x)) : [...new Set([...value, ...ids])]);
  };

  return (
    <View style={{ gap: space.sm }}>
      {onSubjectChange || !subjectId ? (
        <>
          <Label>Subject</Label>
          {subjects.loading ? <Loading /> : (
            <Row>
              {subjects.data?.filter((s) => s.status === "active").map((s) => (
                <Chip key={s.id} label={s.code} selected={subject === s.id}
                  onPress={() => { setSubject(s.id); setDocId(""); onChange([]); onSubjectChange?.(s.id); }} />
              ))}
            </Row>
          )}
        </>
      ) : null}

      {subject && (docs.data?.length ?? 0) > 1 ? (
        <>
          <Label>Book</Label>
          <Row>{docs.data?.map((d) => <Chip key={d.id} label={d.title} selected={docId === d.id} onPress={() => { setDocId(d.id); onChange([]); }} />)}</Row>
        </>
      ) : null}
      {subject && docs.data?.length === 0 ? <P muted small>This subject has no published book yet.</P> : null}

      {outline.loading ? <Loading /> : null}
      {chapters.length ? (
        <View style={p.box}>
          <View style={p.bar}>
            <Text style={p.barText}>
              {value.length
                ? `${value.length} module${value.length === 1 ? "" : "s"} selected across ${chapterCount} chapter${chapterCount === 1 ? "" : "s"}`
                : "Nothing selected"}
            </Text>
            {value.length && !disabled ? (
              <Pressable onPress={() => onChange([])}><Text style={p.clear}>Clear</Text></Pressable>
            ) : null}
          </View>
          <ScrollView style={[scrollFix, { maxHeight: 300 }]} contentContainerStyle={{ padding: 6 }} nestedScrollEnabled>
            {chapters.map((c) => {
              const ids = c.modules.map((m) => m.id!).filter(Boolean);
              const on = ids.filter((i) => chosen.has(i)).length;
              const key = c.id ?? c.title;
              const expanded = open === key || on > 0;
              return (
                <View key={key}>
                  <View style={p.ch}>
                    <Box state={on === 0 ? "off" : on === ids.length ? "on" : "part"} onPress={() => !disabled && toggleChapter(ids)} />
                    <Pressable style={p.chName} accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setOpen(expanded && on === 0 ? null : key)}>
                      <Ionicons name={expanded ? "chevron-down" : "chevron-forward"} size={13} color={colors.faint} />
                      <Text style={p.chText} numberOfLines={1}>{c.title}</Text>
                      <Text style={p.chCount}>{on ? `${on}/${ids.length}` : ids.length}</Text>
                    </Pressable>
                  </View>
                  {expanded ? (
                    <View style={p.mods}>
                      {c.modules.map((m) => (
                        <Pressable key={m.id} onPress={() => !disabled && m.id && toggle(m.id)}
                          accessibilityRole="checkbox" accessibilityLabel={m.title} accessibilityState={{ checked: !!(m.id && chosen.has(m.id)), disabled: !!disabled }}
                          style={({ pressed }) => [p.m, pressed && { opacity: 0.85 }]}>
                          <Box state={m.id && chosen.has(m.id) ? "on" : "off"} />
                          <Text style={[p.mText, m.id && chosen.has(m.id) && { color: colors.text }]} numberOfLines={1}>{m.title}</Text>
                          {m.source_missing ? <Ionicons name="alert-circle" size={13} color={colors.danger} /> : null}
                          {m.availability === "open" ? <View style={p.dot} /> : null}
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function Box({ state, onPress }: { state: "on" | "off" | "part"; onPress?: () => void }) {
  const body = (
    <View style={[p.box2, state !== "off" && { borderColor: colors.primary }, state === "on" && { backgroundColor: colors.primary }]}>
      {state === "on" ? <Ionicons name="checkmark" size={11} color={colors.primaryText} /> : null}
      {state === "part" ? <View style={p.dash} /> : null}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} hitSlop={6} accessibilityRole="checkbox" accessibilityState={{ checked: state === "on" ? true : state === "part" ? "mixed" : false }}>{body}</Pressable> : body;
}

const p = StyleSheet.create({
  box: { borderWidth: 1, borderColor: colors.border, borderRadius: radius, overflow: "hidden" },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm, paddingVertical: 11, paddingHorizontal: space.md, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  barText: { fontSize: 13, color: colors.muted, flex: 1 },
  clear: { fontSize: 13, color: colors.primary, fontWeight: "600" },
  ch: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 9, paddingHorizontal: 10, borderRadius: radiusSm },
  chName: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  chText: { flex: 1, fontSize: 13.5, fontWeight: "600", color: colors.text },
  chCount: { fontSize: 12, color: colors.faint },
  mods: { marginLeft: 24, paddingLeft: 10, borderLeftWidth: 1, borderColor: colors.border },
  m: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 7, paddingHorizontal: 10, borderRadius: radiusSm },
  mText: { flex: 1, fontSize: 13.5, color: colors.muted },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  box2: { width: 16, height: 16, borderRadius: 4, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  dash: { width: 8, height: 2, borderRadius: 1, backgroundColor: colors.primary },
});
