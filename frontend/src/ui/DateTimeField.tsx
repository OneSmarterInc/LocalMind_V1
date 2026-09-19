import React, { useCallback, useEffect, useRef, useState } from "react";
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
  const picker = useRef<HTMLInputElement | null>(null);
  const display = useCallback((iso: string | null | undefined) => { const local = toLocalText(iso, dateOnly); if (!local) return ""; const [day, time] = local.split("T"); const [y,m,d] = day.split("-"); return `${m}-${d}-${y}${time ? ` ${time}` : ""}`; }, [dateOnly]);
  const parse = (v: string) => { const m = v.match(/^(\d{2})-(\d{2})-(\d{4})(?: (\d{2}:\d{2}))?$/); return m && (dateOnly || m[4]) ? parseLocalText(`${m[3]}-${m[1]}-${m[2]}${dateOnly ? "" : `T${m[4] || "00:00"}`}`, dateOnly) : null; };
  const [text, setText] = useState(display(value));
  useEffect(() => { setText(display(value)); }, [value, dateOnly, display]);
  const invalid = !!text && !parse(text);
  const zone = timeZoneLabel();
  const box = { borderWidth: 1, borderColor: invalid ? colors.danger : "#D8E0D7", borderRadius: 7, backgroundColor: disabled ? "#F3F5F0" : "#FFFFFF", paddingHorizontal: 11, height: 40, fontSize: 13, color: colors.ink } as const;
  const id = `dt-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <View style={{ gap: 7, width: "100%", maxWidth: width, minWidth: 0 }}>
      <Text nativeID={id} style={{ fontSize: 12, fontWeight: "600", color: colors.ink }}>{label}{required ? <Text style={{ color: colors.danger }}> *</Text> : null}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
        {Platform.OS === "web"
          ? <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
              {React.createElement("input", {
                type: "text", value: text, disabled, placeholder: dateOnly ? "MM-DD-YYYY" : "MM-DD-YYYY HH:MM", "aria-labelledby": id, "aria-invalid": invalid, "data-date-field": true,
                onChange: (e: {target: {value: string}}) => { setText(e.target.value); if (!e.target.value) onChange(null); else { const iso = parse(e.target.value); if (iso) onChange(iso); } },
                style: { border: `1px solid ${invalid ? colors.danger : "#D8E0D7"}`, borderRadius: 7, padding: "0 11px", height: 40, color: colors.ink, background: "white", flex: 1, fontSize: 13, fontFamily: "inherit", minWidth: 0, width: "100%", boxSizing: "border-box" },
              })}
              {React.createElement("input", { ref: picker, type: dateOnly ? "date" : "datetime-local", value: toLocalText(value,dateOnly), tabIndex: -1, "aria-hidden": true,
                onChange: (e: {target:{value:string}}) => { const iso=parseLocalText(e.target.value,dateOnly); if(iso){setText(display(iso));onChange(iso);} },
                style: { position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" },
              })}
              <Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel={`Choose ${label}`} onPress={()=>{picker.current?.showPicker?.();}}><Text style={{fontSize:12,color:colors.primary}}>Calendar</Text></Pressable>
            </View>
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
      <Text style={{ fontSize: 11, color: invalid ? colors.danger : colors.muted }}>{invalid ? "Use MM-DD-YYYY and a valid 24-hour time." : `${hint ? `${hint} ` : ""}${dateOnly ? "" : `Times are in your time zone (${zone}).`}`}</Text>
    </View>
  );
}

export function requireValidDates() {
  if (Platform.OS === "web" && typeof document !== "undefined" && document.querySelector('[data-date-field][aria-invalid="true"]')) throw new Error("Correct the highlighted date before saving.");
}
