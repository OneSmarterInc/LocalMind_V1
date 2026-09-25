import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import { Text, View } from "react-native";
import { Badge, Card, ProgressBar, TileIcon, colors } from "@/ui";
import type { CatalogSubject } from "./catalog";

const TONES = ["green", "blue", "amber"] as const;

/** Subject tile: icon and code, name, faculty, module progress, "Continue learning". */
export function SubjectCard({ row, index, onPress }: { row: CatalogSubject; index: number; onPress: () => void }) {
  const pctDone = row.total ? Math.round((row.completed / row.total) * 100) : 0;
  const faculty = row.subject.faculty_names?.join(", ");
  return (
    <Card onPress={onPress} style={{ minHeight: 220 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <TileIcon icon="library-outline" tone={TONES[index % 3]} size={43} />
        <Badge value={row.subject.code} tone="neutral" />
      </View>
      <View style={{ marginTop: 4 }}>
        <Text style={{ fontSize: 16, fontWeight: "600", color: colors.ink }} numberOfLines={2}>{row.subject.name}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
          <Text style={{ fontSize: 11, fontWeight: "600", color: colors.primary, backgroundColor: colors.pale, paddingHorizontal: 7, paddingVertical: 1, borderRadius: 5 }}>Faculty</Text>
          <Text style={{ fontSize: 12, color: colors.muted, flex: 1 }} numberOfLines={1}>{faculty || "Not assigned yet"}</Text>
        </View>
      </View>
      <View style={{ flex: 1 }} />
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 11, color: colors.muted }}>{row.completed} of {row.total} modules completed</Text>
        <Text style={{ fontSize: 11, color: colors.ink, fontWeight: "600" }}>{pctDone}%</Text>
      </View>
      <ProgressBar value={pctDone} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: colors.rowLine, paddingTop: 10, marginTop: 2 }}>
        <Text style={{ fontSize: 11, color: colors.muted }}>Continue learning</Text>
        <Ionicons name="arrow-forward" size={15} color={colors.ink} />
      </View>
    </Card>
  );
}
