import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Text, View } from "react-native";
import { Badge, Card, ProgressBar, TileIcon, colors } from "@/ui";

const TONES = ["green", "blue", "amber"] as const;

/** A teaching subject tile built from the faculty analytics summary. */
export function TeachingSubjectCard({ summary, index, onPress }: { summary: any; index: number; onPress: () => void }) {
  const s = summary;
  const value = Math.round(s.modules?.completion_percentage ?? 0);
  const books = s.documents?.published ?? 0;
  return (
    <Card onPress={onPress} style={{ minHeight: 210 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <TileIcon icon="library-outline" tone={TONES[index % 3]} size={43} />
        <Badge value={s.subject.code} tone="neutral" />
      </View>
      <Text style={{ fontSize: 16, fontWeight: "600", color: colors.ink, marginTop: 4 }} numberOfLines={2}>{s.subject.name}</Text>
      <Text style={{ fontSize: 12, color: colors.muted }}>{s.students_enrolled} enrolled student{s.students_enrolled === 1 ? "" : "s"} · {books} book{books === 1 ? "" : "s"}</Text>
      <View style={{ flex: 1 }} />
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 11, color: colors.muted }}>Class completion</Text>
        <Text style={{ fontSize: 11, color: colors.ink, fontWeight: "600" }}>{value}%</Text>
      </View>
      <ProgressBar value={value} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: colors.rowLine, paddingTop: 10, marginTop: 2 }}>
        <Text style={{ fontSize: 11, color: colors.muted }}>Open subject</Text>
        <Ionicons name="arrow-forward" size={15} color={colors.ink} />
      </View>
    </Card>
  );
}
