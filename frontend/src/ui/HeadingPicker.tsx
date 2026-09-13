import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, TouchableWithoutFeedback, View, useWindowDimensions } from "react-native";
import { useDebounced } from "@/hooks/useDebounced";
import { Empty, Input, Label, P, colors, radius, radiusSm, space } from "@/ui";

export interface Heading { index: number; level: number; title: string; start_page?: number; end_page?: number }

/**
 * Choose which heading in the book a module maps to.
 *
 * This used to render one chip per heading inline, for every module row on the
 * page. That is fine for the two-heading sample books but a real textbook has
 * well over a hundred: a 160-heading physics book produced a wall of several
 * thousand chips on one screen, titles truncated at 40 characters mid-word and
 * no way to search. Now the current mapping shows as a single button that
 * opens a searchable list, indented by heading level so a chapter reads
 * differently from a sub-section.
 */
export function HeadingPicker({
  headings,
  value,
  onChange,
  disabled,
}: {
  headings: Heading[];
  value: number | null | undefined;
  onChange: (index: number | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const query = useDebounced(q, 150);
  const { width, height } = useWindowDimensions();
  const current = headings.find((h) => h.index === value);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return headings;
    return headings.filter((h) => h.title.toLowerCase().includes(needle));
  }, [headings, query]);

  const choose = (index: number | null) => {
    onChange(index);
    setOpen(false);
    setQ("");
  };

  const label = current ? current.title : value === null || value === undefined ? "None — uses the text below" : `Heading ${value}`;

  return (
    <View style={{ gap: 6 }}>
      <Label>Source heading</Label>
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        style={({ pressed }) => [{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          borderWidth: 1,
          borderColor: colors.borderStrong,
          borderRadius: radiusSm,
          paddingHorizontal: 12,
          paddingVertical: 10,
          backgroundColor: colors.bg,
          opacity: disabled ? 0.5 : 1,
        }, pressed && { opacity: 0.8 }]}
      >
        <Ionicons name={current ? "bookmark-outline" : "remove-circle-outline"} size={16} color={current ? colors.primary : colors.faint} />
        <P small style={{ flex: 1, color: current ? colors.text : colors.muted }} >{label}</P>
        {!disabled ? <Ionicons name="chevron-down" size={16} color={colors.muted} /> : null}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setOpen(false)}>
          <View style={{ flex: 1, backgroundColor: "rgba(3,8,11,0.72)", alignItems: "center", justifyContent: "center", padding: space.lg }}>
            <TouchableWithoutFeedback>
              <View style={{
                width: "100%",
                maxWidth: Math.min(640, width - 32),
                maxHeight: height * 0.8,
                backgroundColor: colors.surface,
                borderRadius: radius,
                borderWidth: 1,
                borderColor: colors.borderStrong,
                padding: space.lg,
                gap: space.sm,
              }}>
                <P style={{ fontWeight: "700" }}>Map this module to a heading</P>
                <Input
                  compact
                  autoFocus
                  value={q}
                  onChangeText={setQ}
                  placeholder={`Search ${headings.length} headings`}
                />
                <ScrollView style={{ maxHeight: height * 0.5 }} keyboardShouldPersistTaps="handled">
                  <Option
                    title="None — the module carries its own pasted text"
                    indent={0}
                    selected={value === null || value === undefined}
                    onPress={() => choose(null)}
                  />
                  {matches.map((h) => (
                    <Option
                      key={h.index}
                      title={h.title}
                      indent={Math.max(0, h.level - 1)}
                      pages={h.start_page ? `p. ${h.start_page}${h.end_page && h.end_page !== h.start_page ? `–${h.end_page}` : ""}` : undefined}
                      selected={h.index === value}
                      onPress={() => choose(h.index)}
                    />
                  ))}
                  {matches.length === 0 ? <Empty text="No heading matches that search." icon="search-outline" /> : null}
                </ScrollView>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

function Option({ title, indent, pages, selected, onPress }: { title: string; indent: number; pages?: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingVertical: 9,
        paddingRight: space.sm,
        paddingLeft: space.sm + indent * 18,
        borderRadius: 8,
        backgroundColor: selected ? colors.tealTint : "transparent",
      }, pressed && { backgroundColor: colors.surface2 }]}
    >
      <Ionicons
        name={selected ? "radio-button-on" : "radio-button-off"}
        size={16}
        color={selected ? colors.primary : colors.faint}
      />
      <P small style={{ flex: 1, fontWeight: indent === 0 ? "700" : "400" }}>{title}</P>
      {pages ? <P muted small>{pages}</P> : null}
    </Pressable>
  );
}
