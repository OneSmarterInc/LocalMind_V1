import React, { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { formatLocal, parseLocalText, timeZoneLabel, toLocalText } from "./dateParts";
import { openNativeDatePicker } from "./NativeDatePicker";
import { colors } from "./theme";

export { timeZoneLabel } from "./dateParts";

/**
 * A date (and time) picker in the person's own time zone, instead of a raw timestamp. The web build uses the
 * browser's picker; phones use the system date and time pickers. Empty means "no date". The field shrinks
 * with its card (`width` is a maximum).
 */
export function DateTimeField({ label, value, onChange, hint, dateOnly = false, required, disabled, width }: {
  label: string; value: string | null | undefined; onChange: (iso: string | null) => void; hint?: string; dateOnly?: boolean; required?: boolean; disabled?: boolean; width?: number;
}) {
  const [text, setText] = useState(toLocalText(value, dateOnly));
  useEffect(() => { setText(toLocalText(value, dateOnly)); }, [value, dateOnly]);
  const invalid = !!text && !parseLocalText(text, dateOnly);
  const zone = timeZoneLabel();
  const box = { borderWidth: 1, borderColor: invalid ? colors.danger : "#D8E0D7", borderRadius: 7, backgroundColor: disabled ? "#F3F5F0" : "#FFFFFF", paddingHorizontal: 11, height: 40, fontSize: 13, color: colors.ink } as const;
  const id = `dt-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <View style={{ gap: 7, width: "100%", maxWidth: width, minWidth: 0 }}>
      <Text nativeID={id} style={{ fontSize: 12, fontWeight: "600", color: colors.ink }}>{label}{required ? <Text style={{ color: colors.danger }}> *</Text> : null}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
        {Platform.OS === "web"
          ? React.createElement("input", {
              type: dateOnly ? "date" : "datetime-local", value: text, disabled, "aria-labelledby": id, "aria-label": label,
              onChange: (e: { target: { value: string } }) => {
                setText(e.target.value);
                if (!e.target.value) onChange(null); else { const iso = parseLocalText(e.target.value, dateOnly); if (iso) onChange(iso); }
              },
              style: { ...box, flex: 1, fontFamily: "inherit", outline: "none", minWidth: 0, width: "100%", boxSizing: "border-box" },
            })
          : (
            <Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel={`${label}: ${value ? formatLocal(value, dateOnly) : "not set"}`}
              onPress={() => openNativeDatePicker({ value: value ? new Date(value) : new Date(), dateOnly, onPick: (d) => { if (dateOnly) d.setHours(0, 0, 0, 0); onChange(d.toISOString()); } })}
              style={[box, { flex: 1, justifyContent: "center" }]}>
              <Text style={{ fontSize: 13, color: value ? colors.ink : colors.faint }} numberOfLines={1}>{value ? formatLocal(value, dateOnly) : dateOnly ? "Choose a date" : "Choose a date and time"}</Text>
            </Pressable>
          )}
        {value && !disabled ? (
          <Pressable onPress={() => { setText(""); onChange(null); }} accessibilityRole="button" accessibilityLabel={`Clear ${label}`} hitSlop={6}>
            <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={{ fontSize: 11, color: invalid ? colors.danger : colors.muted }}>{invalid ? "Enter a real date and time." : `${hint ? `${hint} ` : ""}${dateOnly ? "" : `Times are in your time zone (${zone}).`}`}</Text>
    </View>
  );
}
