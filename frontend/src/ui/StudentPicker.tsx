import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { errorMessage } from "@/api/client";
import { useDebounced } from "@/hooks/useDebounced";
import { Button, Card, Empty, ErrorBanner, H2, Input, Loading, P, Row, colors, space } from "@/ui";

export interface Enrollable { id: string; email: string; full_name: string; roll_number: string }

/**
 * Pick students to enroll on a subject.
 *
 * The action bar — the search box, the running count of who is selected, the
 * select-all control and the Enroll button — stays pinned above the list, so a
 * person never scrolls to the bottom of a long roll to enroll. The list scrolls
 * inside its own bounded area rather than stretching the page, which is what
 * makes a class of five thousand behave the same as a class of forty. Several
 * people are selected and enrolled in one action; the server leaves out anyone
 * already on the subject, so everything shown can actually be added.
 */
export function StudentPicker({
  subjectId,
  search,
  enroll,
  onDone,
}: {
  subjectId: string;
  search: (q: string, subject: string) => Promise<Enrollable[]>;
  enroll: (ids: string[]) => Promise<unknown>;
  onDone: () => void | Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Enrollable[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const latest = useRef(0);
  const run = useCallback(async (query: string) => {
    const request = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const rows = await search(query, subjectId);
      if (request === latest.current) setResults(rows);
    } catch (e) {
      if (request !== latest.current) return;
      setResults([]);
      setError(errorMessage(e));
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [search, subjectId]);

  // One request after typing stops, not one per keystroke. An empty box asks
  // for the first page of candidates, so clearing the field refreshes the list
  // rather than leaving stale matches on screen.
  const query = useDebounced(q);
  useEffect(() => { void run(query.trim()); return () => {
    // Invalidate all requests from the previous query, including manual retries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ++latest.current;
  }; }, [query, run]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const visibleIds = useMemo(() => results.map((r) => r.id), [results]);
  const allShown = visibleIds.length > 0 && visibleIds.every((id) => picked.includes(id));

  const confirm = async () => {
    if (!picked.length) return;
    setBusy(true);
    setError(null);
    try {
      await enroll(picked);
      setPicked([]);
      await onDone();
      await run(q.trim());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: space.md }}>
      {/* Action bar — always in view, whatever the list length. */}
      <View style={{ gap: space.sm }}>
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <H2 icon="person-add-outline">Enroll students</H2>
          <Button
            title={picked.length ? `Enroll ${picked.length} student${picked.length === 1 ? "" : "s"}` : "Enroll"}
            icon="checkmark-circle-outline"
            small
            onPress={confirm}
            busy={busy}
            disabled={!picked.length}
          />
        </Row>
        <Input
          compact
          value={q}
          onChangeText={setQ}
          placeholder="Search by name, email or roll number"
          autoCorrect={false}
        />
        <Row style={{ justifyContent: "space-between", alignItems: "center", minHeight: 26 }}>
          <P muted small>
            {picked.length
              ? `${picked.length} selected`
              : results.length
                ? `${results.length}${results.length === 50 ? "+" : ""} available`
                : ""}
          </P>
          <Row style={{ gap: space.sm }}>
            {picked.length ? <Button title="Clear" small variant="ghost" onPress={() => setPicked([])} /> : null}
            {results.length ? (
              <Button
                title={allShown ? "Deselect shown" : `Select ${results.length} shown`}
                small
                variant="ghost"
                onPress={() => setPicked(allShown ? picked.filter((id) => !visibleIds.includes(id)) : [...new Set([...picked, ...visibleIds])])}
              />
            ) : null}
          </Row>
        </Row>
      </View>

      <ErrorBanner message={error} />

      {loading && !results.length ? <Loading /> : null}
      {!loading && !results.length ? (
        <Empty
          icon="people-outline"
          text={q.trim() ? "Nobody matches that search." : "Every active student is already enrolled on this subject."}
        />
      ) : null}

      {/* The roll scrolls inside a bounded area; the page never grows with it. */}
      {results.length ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: "hidden" }}>
          <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {results.map((s, i) => {
              const on = picked.includes(s.id);
              return (
                <Pressable
                  key={s.id}
                  onPress={() => toggle(s.id)}
                  style={({ pressed }) => [{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.md,
                    paddingVertical: 10,
                    paddingHorizontal: space.md,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: colors.rowLine,
                    backgroundColor: on ? colors.tealTint : "transparent",
                  }, pressed && { opacity: 0.8 }]}
                >
                  <Ionicons
                    name={on ? "checkbox" : "square-outline"}
                    size={20}
                    color={on ? colors.primary : colors.faint}
                  />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <P style={{ fontWeight: "600" }}>{s.full_name}</P>
                    <P muted small>{s.email}{s.roll_number ? ` · ${s.roll_number}` : ""}</P>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {results.length === 50 ? <P muted small>Showing the first 50 matches. Narrow the search to find others.</P> : null}
    </Card>
  );
}
