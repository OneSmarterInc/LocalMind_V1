import React, { useMemo } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { colors } from "./theme";
import { parseReadingBlocks } from "./sourceBlocks";

/** Source-only reading view: keep tables and numbered procedures intelligible.
 * HTML is never injected. Tables scroll inside their own card on small screens,
 * not across the whole page. Web gets actual table/header/cell semantics.
 */
export function SourceContent({ text, large = false }: { text: string; large?: boolean }) {
  const blocks = useMemo(() => parseReadingBlocks(text), [text]);
  const size = large ? 18 : 15;
  return <View style={{ gap: 16, minWidth: 0, width: "100%" }}>
    {!blocks.length ? <Text style={{ color: colors.muted }}>This module has no text yet.</Text> : null}
    {blocks.map((block, index) => {
      if (block.kind === "heading") return <Text key={index} accessibilityRole="header"
        style={{ fontSize: size + Math.max(1, 7 - block.level), fontWeight: "600", color: colors.ink, marginTop: 8 }}>{block.text}</Text>;
      if (block.kind === "table") {
        const width = Math.max(360, block.header.length * 150);
        return <View key={index} style={{ maxWidth: "100%", borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: "hidden" }}>
          <ScrollView horizontal style={{ maxWidth: "100%" }} accessibilityLabel="Source table. Scroll horizontally to read every column.">
            {Platform.OS === "web" ? React.createElement("table", {
              style: { borderCollapse: "collapse", minWidth: width, fontSize: size, color: colors.text },
              "aria-label": "Table from the source material",
            }, React.createElement("thead", null, React.createElement("tr", null, ...block.header.map((cell, j) => React.createElement("th", {
              key: j, scope: "col", style: { padding: 12, textAlign: "left", backgroundColor: colors.pale, borderBottom: `1px solid ${colors.border}`, whiteSpace: "pre-wrap", maxWidth: 300 },
            }, cell)))), React.createElement("tbody", null, ...block.rows.map((row, k) => React.createElement("tr", { key: k }, ...row.map((cell, j) => React.createElement("td", {
              key: j, style: { padding: 12, verticalAlign: "top", whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxWidth: 300, borderBottom: `1px solid ${colors.border}` },
            }, cell)))))) : <View style={{ width }}>
              <View style={{ flexDirection: "row", backgroundColor: colors.pale }}>{block.header.map((cell, j) => <Text key={j} accessibilityRole="header" style={{ flex: 1, padding: 12, color: colors.ink, fontWeight: "600", fontSize: size }}>{cell}</Text>)}</View>
              {block.rows.map((row, k) => <View key={k} style={{ flexDirection: "row", borderTopWidth: 1, borderColor: colors.border }}>{row.map((cell, j) => <Text key={j} accessibilityLabel={`${block.header[j]}: ${cell}`} style={{ flex: 1, padding: 12, fontSize: size, color: colors.text }}>{cell}</Text>)}</View>)}
            </View>}
          </ScrollView>
          <Text style={{ padding: 8, fontSize: 12, color: colors.muted }}>Scroll within the table to see all columns on a small screen.</Text>
        </View>;
      }
      if (block.kind === "list") return <View key={index} style={{ gap: 8 }}>{block.items.map((item, k) => <View key={k} style={{ flexDirection: "row", gap: 8, paddingLeft: Math.min(item.depth, 8) * 14 }}>
        <Text style={{ minWidth: 24, fontSize: size, lineHeight: size * 1.7, color: colors.ink }}>{item.label}</Text>
        <Text style={{ flex: 1, minWidth: 0, fontSize: size, lineHeight: size * 1.7, color: colors.text }}>{item.text}</Text>
      </View>)}</View>;
      return <Text key={index} selectable style={{ fontSize: size, lineHeight: size * 1.8, color: colors.text,
        ...(block.kind === "code" ? { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", backgroundColor: colors.surface2, padding: 12 } : {}) }}>{block.text}</Text>;
    })}
  </View>;
}
