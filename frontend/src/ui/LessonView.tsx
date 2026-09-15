import { SourceContent } from "./SourceContent";
import React from "react";
import { Image, Text, View } from "react-native";
import type { Lesson } from "@/api/types";
import { Badge, Card, Eyebrow, colors } from "./index";

type SourceVisual = {
  id: string;
  kind?: "figure" | "diagram" | "table" | string;
  page?: number | null;
  caption?: string;
  width?: number | null;
  height?: number | null;
  data_url: string;
};
type VisualLesson = Lesson & { source_visuals?: SourceVisual[] };

/** A structured lesson: label and badge, title, short intro, objectives, source
 * figures/tables/diagrams, numbered sections and key terms. The visual regions
 * are original crops from the uploaded source; full PDF pages are never shown
 * here. Shared by the student Lesson tab and the faculty preview. */
export function LessonView({ lesson, badge = "Saved AI lesson", footer }: { lesson: Lesson; badge?: string | null; footer?: React.ReactNode }) {
  const visuals = (lesson as VisualLesson).source_visuals || [];
  return (
    <Card style={{ paddingHorizontal: 32, paddingVertical: 28, gap: 18 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <Eyebrow>YOUR GUIDED LESSON</Eyebrow>
        {badge ? <Badge value={badge} tone="green" /> : null}
      </View>
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 22, fontWeight: "600", color: colors.ink, letterSpacing: -0.5 }}>{lesson.title}</Text>
        {lesson.summary ? <Text style={{ fontSize: 14, lineHeight: 24, color: colors.muted }}>{lesson.summary}</Text> : null}
      </View>
      {lesson.learning_objectives.length ? (
        <View style={{ borderWidth: 1, borderColor: "#DDE8D8", backgroundColor: "#F3F6EE", borderRadius: 10, paddingHorizontal: 18, paddingVertical: 15, gap: 6 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>By the end, you should be able to</Text>
          {lesson.learning_objectives.map((o, i) => <Text key={i} style={{ fontSize: 13, lineHeight: 22, color: "#3F5045" }}>•  {o}</Text>)}
        </View>
      ) : null}
      {visuals.length ? (
        <View style={{ gap: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: "600", color: colors.ink }}>Visuals from the source</Text>
          <Text style={{ fontSize: 12, lineHeight: 19, color: colors.muted }}>Only the original figure, diagram, chart or table region is shown — not the surrounding page text.</Text>
          {visuals.map((visual) => {
            const ratio = visual.width && visual.height ? visual.width / visual.height : 1.5;
            return <View key={visual.id} style={{ gap: 7, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, backgroundColor: "white" }}>
              <Image source={{ uri: visual.data_url }} accessibilityLabel={visual.caption || "Source visual"} resizeMode="contain"
                style={{ width: "100%", aspectRatio: Math.max(0.35, Math.min(3.5, ratio)), backgroundColor: "white" }} />
              <Text style={{ fontSize: 11, color: colors.muted }}>{visual.caption || "Source visual"}{visual.page ? ` · page ${visual.page}` : ""}</Text>
            </View>;
          })}
        </View>
      ) : null}
      {lesson.sections.map((s, i) => (
        <View key={i} style={{ gap: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: "600", color: colors.ink }}>{String(i + 1).padStart(2, "0")} · {s.heading}</Text>
          <SourceContent text={s.explanation} />
          {s.source_reference ? <Text style={{ fontSize: 11, color: colors.muted }}>From the book: {s.source_reference}</Text> : null}
        </View>
      ))}
      {lesson.key_terms.length ? (
        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 16, fontWeight: "600", color: colors.ink }}>Terms to remember</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {lesson.key_terms.map((t, i) => (
              <View key={i} style={{ flexGrow: 1, flexBasis: 240, borderWidth: 1, borderColor: colors.border, borderRadius: 9, padding: 12, backgroundColor: "#F8FAF7" }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{t.term}</Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 3 }}>{t.definition}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {footer}
    </Card>
  );
}
