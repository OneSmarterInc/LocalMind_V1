import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { errorMessage } from "@/api/client";
import { useDebounced } from "@/hooks/useDebounced";
import { Button, Card, Empty, ErrorBanner, H2, Input, Loading, P, Row, colors, space } from "@/ui";

export interface Enrollable { id: string; email: string; full_name: string; roll_number: string }

/**
 * Pick students to enrol on a subject.
 *
 * The old version made you type at least two characters, press Search, and
 * enrol one person at a time, so putting a class of forty on a subject meant
 * forty searches. Clearing the box also left the previous results on screen,
 * which made it look like they still matched.
 *
 * This searches as you type after a short pause, shows the first page of
 * candidates before you type anything so the list can simply be browsed, and
 * lets several people be selected and enrolled in one go. The server leaves
 * out anyone already on the subject, so everything shown can actually be
 * added. Emptying the box resets the results rather than stranding them.
 */
export function StudentPicker({
  subjectId,
  search,
  enrol,
  onDone,
}: {
  subjectId: string;
  search: (q: string, subject: string) => Promise<Enrollable[]>;
  enrol: (ids: string[]) => Promise<unknown>;
  onDone: () => void | Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Enrollable[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      setResults(await search(query, subjectId));
    } catch (e) {
      setResults([]);
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [search, subjectId]);

  // One request after typing stops, not one per keystroke. An empty box is a
  // valid query here — it asks for the first page of candidates — so clearing
  // the field refreshes the list instead of leaving stale matches.
  const query = useDebounced(q);
  useEffect(() => { void run(query.trim()); }, [query, run]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const visibleIds = useMemo(() => results.map((r) => r.id), [results]);
  const allShown = visibleIds.length > 0 && visibleIds.every((id) => picked.includes(id));

  const confirm = async () => {
    if (!picked.length) return;
    setBusy(true);
    setError(null);
    try {
      await enrol(picked);
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
    <Card>
      <Row style={{ justifyContent: "space-between" }}>
        <H2 icon="person-add-outline">Enrol students</H2>
        {results.length ? (
          <Button
            title={allShown ? "Clear Selection" : `Select All ${results.length}`}
            small
            variant="ghost"
            onPress={() => setPicked(allShown ? [] : visibleIds)}
          />
        ) : null}
      </Row>
      <Input
        compact
        value={q}
        onChangeText={setQ}
        placeholder="Search by name, email or roll number"
        autoCorrect={false}
      />
      <ErrorBanner message={error} />
      {loading && !results.length ? <Loading /> : null}
      {!loading && !results.length ? (
        <Empty
          icon="people-outline"
          text={q.trim() ? "Nobody matches that search." : "Every active student is already enrolled on this subject."}
        />
      ) : null}
      <View style={{ gap: space.xs }}>
        {results.map((s) => {
          const on = picked.includes(s.id);
          return (
            <Pressable
              key={s.id}
              onPress={() => toggle(s.id)}
              style={({ pressed }) => [{
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                paddingVertical: 9,
                paddingHorizontal: space.sm,
                borderRadius: 8,
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
      </View>
      {results.length === 50 ? <P muted small>Showing the first 50. Narrow the search to see others.</P> : null}
      <Button
        title={picked.length ? `Enrol ${picked.length} Student${picked.length === 1 ? "" : "s"}` : "Enrol Selected"}
        icon="checkmark-circle-outline"
        small
        onPress={confirm}
        busy={busy}
        disabled={!picked.length}
      />
    </Card>
  );
}
