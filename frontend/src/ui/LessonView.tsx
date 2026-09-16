import {SourceFigures, type Figure} from "./SourceFigures";
import {useRouter} from "expo-router";
import { SourceContent } from "./SourceContent";
import React from "react";
import { Text, View } from "react-native";
import type { Lesson } from "@/api/types";
import { Button, Badge, Card, Eyebrow, colors } from "./index";

type VisualLesson = Lesson & { source_visuals?: Figure[]; visual_review_document?: string };

/** A structured lesson: label and badge, title, short intro, objectives, source
 * figures/tables/diagrams, numbered sections and key terms. The visual regions
 * are original crops from the uploaded source; full PDF pages are never shown
 * here. Shared by the student Lesson tab and the faculty preview. */
export function LessonView({ lesson, badge = "Saved AI lesson", footer }: { lesson: Lesson; badge?: string | null; footer?: React.ReactNode }) {
  const router=useRouter();
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
      {lesson.sections.map((s, i) => (
        <View key={i} style={{ gap: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: "600", color: colors.ink }}>{String(i + 1).padStart(2, "0")} · {s.heading}</Text>
          <SourceContent text={s.explanation} />
          <SourceFigures visuals={visuals.filter(v=>((s as typeof s & {visual_ids?:string[]}).visual_ids || []).includes(v.id))}/>
          {s.source_reference ? <Text style={{ fontSize: 11, color: colors.muted }}>From the book: {s.source_reference}</Text> : null}
        </View>
      ))}
      <SourceFigures visuals={visuals.filter(v=>!lesson.sections.some(s=>((s as typeof s & {visual_ids?:string[]}).visual_ids || []).includes(v.id)))}/>
      {(lesson as VisualLesson).visual_review_document ? <Button title="Source picture report" small variant="secondary" onPress={()=>router.push(`/manage/document-visuals/${(lesson as VisualLesson).visual_review_document}`)}/> : null}
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
