import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, TouchableWithoutFeedback, View, useWindowDimensions } from "react-native";
import { useDebounced } from "@/hooks/useDebounced";
import { Empty, Input, P, colors, radius, radiusSm, space } from "@/ui";

export interface SelectOption { value: string; label: string; hint?: string }

/**
 * One control for choosing from a list that may be long.
 *
 * Rendering every option as a chip works for four or five and falls apart
 * beyond that: the audit filter grew to twenty-five chips and took up more of
 * the page than the entries it filtered. This shows the current choice as a
 * single button and opens a searchable list.
 */
export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder = "Search",
  icon = "funnel-outline",
  width = 260,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const query = useDebounced(q, 150);
  const { width: vw, height } = useWindowDimensions();
  const current = options.find((o) => o.value === value);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [options, query]);

  const choose = (next: string) => { onChange(next); setOpen(false); setQ(""); };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          borderWidth: 1,
          borderColor: value ? colors.primary : colors.borderStrong,
          borderRadius: radiusSm,
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: value ? colors.tealTint : colors.bg,
          minWidth: width,
        }, pressed && { opacity: 0.8 }]}
      >
        <Ionicons name={icon} size={15} color={value ? colors.primary : colors.muted} />
        <P small style={{ flex: 1, color: value ? colors.text : colors.muted }}>{current ? current.label : label}</P>
        {value ? (
          <Pressable onPress={() => onChange("")} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.muted} />
          </Pressable>
        ) : <Ionicons name="chevron-down" size={15} color={colors.muted} />}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setOpen(false)}>
          <View style={{ flex: 1, backgroundColor: "rgba(3,8,11,0.72)", alignItems: "center", justifyContent: "center", padding: space.lg }}>
            <TouchableWithoutFeedback>
              <View style={{
                width: "100%",
                maxWidth: Math.min(560, vw - 32),
                maxHeight: height * 0.8,
                backgroundColor: colors.surface,
                borderRadius: radius,
                borderWidth: 1,
                borderColor: colors.borderStrong,
                padding: space.lg,
                gap: space.sm,
              }}>
                <P style={{ fontWeight: "700" }}>{label}</P>
                <Input compact autoFocus value={q} onChangeText={setQ} placeholder={placeholder} />
                <ScrollView style={{ maxHeight: height * 0.55 }} keyboardShouldPersistTaps="handled">
                  {matches.map((o) => (
                    <Pressable
                      key={o.value || "__all"}
                      onPress={() => choose(o.value)}
                      style={({ pressed }) => [{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.sm,
                        paddingVertical: 9,
                        paddingHorizontal: space.sm,
                        borderRadius: 8,
                        backgroundColor: o.value === value ? colors.tealTint : "transparent",
                      }, pressed && { backgroundColor: colors.surface2 }]}
                    >
                      <Ionicons
                        name={o.value === value ? "radio-button-on" : "radio-button-off"}
                        size={16}
                        color={o.value === value ? colors.primary : colors.faint}
                      />
                      <P small style={{ flex: 1 }}>{o.label}</P>
                      {o.hint ? <P muted small>{o.hint}</P> : null}
                    </Pressable>
                  ))}
                  {matches.length === 0 ? <Empty text="Nothing matches that." icon="search-outline" /> : null}
                </ScrollView>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
}
