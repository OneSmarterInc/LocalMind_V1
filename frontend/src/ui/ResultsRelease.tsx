import React from "react";
import { View } from "react-native";
import { OptionCard } from "@/ui";
import { DateTimeField } from "./DateTimeField";

export type ReleaseMode = "immediate" | "held" | "scheduled";

/** "When can students see results?": three choices, the scheduled one with its time. */
export function ResultsRelease({ value, at, onChange, disabled }: {
  value: ReleaseMode;
  at: string | null;
  onChange: (mode: ReleaseMode, at: string | null) => void;
  disabled?: boolean;
  kind?: "quiz" | "assignment";
}) {
  const options: { key: ReleaseMode; label: string; sub: string }[] = [
    { key: "immediate", label: "After each submission", sub: "Show the result as soon as the attempt has been evaluated." },
    { key: "held", label: "When I release them", sub: "Evaluate now; keep scores and answer feedback hidden until release." },
    { key: "scheduled", label: "At a scheduled time", sub: "Release after the selected date and time." },
  ];
  return (
    <View style={{ gap: 8, width: "100%" }}>
      {options.map((o) => (
        <OptionCard key={o.key} title={o.label} text={o.sub} selected={value === o.key} disabled={disabled} onPress={() => onChange(o.key, o.key === "scheduled" ? at : null)} />
      ))}
      {value === "scheduled" ? (
        <DateTimeField label="Release at" value={at} onChange={(v) => onChange("scheduled", v)} disabled={disabled} hint="Everyone who has submitted by then sees their result at that moment." width={360} />
      ) : null}
    </View>
  );
}

export function releaseSummary(mode: ReleaseMode, at?: string | null, pending?: number) {
  if (mode === "immediate") return "";
  if (mode === "scheduled" && at) return `results ${new Date(at).toLocaleDateString()}`;
  if (pending) return `${pending} to release`;
  return mode === "held" ? "held until released" : "";
}
