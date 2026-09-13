import React, { useState } from "react";
import { Platform, Text, View } from "react-native";
import { Button, Card, H2, Notice, P, Row, colors, space } from "./index";

export interface IssuedCredential { full_name?: string | null; email: string; initial_password: string }

const mono = Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, Menlo, Consolas, monospace" });

/** A spreadsheet treats a cell starting with = + - @ as a formula. Names come
 * from an uploaded sheet, so neutralise that before handing the file back. */
function csvCell(value: string): string {
  const v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${v.replace(/"/g, '""')}"`;
}

export function credentialsCsv(rows: IssuedCredential[]): string {
  const lines = [["name", "email", "one_time_password"].join(",")];
  for (const r of rows) lines.push([csvCell(r.full_name ?? ""), csvCell(r.email), csvCell(r.initial_password)].join(","));
  return lines.join("\r\n") + "\r\n";
}

function downloadCsv(filename: string, rows: IssuedCredential[]) {
  const blob = new Blob([credentialsCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/**
 * One-time passwords, shown once in the response that created them.
 *
 * The server keeps only the hash, so this card is the only place the password
 * ever appears. It says so, offers a CSV on the web for a class list, and the
 * caller decides what "Done" does (usually back to People).
 */
export function OneTimeCredentials({ rows, title, onDone, filename = "localmind-one-time-passwords.csv" }: {
  rows: IssuedCredential[]; title: string; onDone?: () => void; filename?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!rows.length) return null;
  const canCopy = Platform.OS === "web" && typeof navigator !== "undefined" && !!navigator.clipboard;
  const copy = async () => {
    const text = rows.length === 1 ? rows[0].initial_password : rows.map((r) => `${r.email}\t${r.initial_password}`).join("\n");
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  };
  return (
    <Card accent={colors.warning}>
      <H2 icon="key-outline">{title}</H2>
      <Notice tone="warning" message="Shown only now. The platform stores no readable copy, so hand these over before leaving this screen. A lost password is replaced with Reset Password on the person's account; each one must be changed at first sign-in." />
      <View style={{ gap: 2 }}>
        {rows.map((r) => (
          <Row key={r.email} style={{ gap: space.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            {rows.length > 1 ? <P small style={{ flex: 2 }}>{r.full_name || "—"}</P> : null}
            <P muted small style={{ flex: 2 }}>{r.email}</P>
            <Text selectable style={{ flex: 2, color: colors.text, fontFamily: mono, fontSize: 15, fontWeight: "700", letterSpacing: 0.5 }}>{r.initial_password}</Text>
          </Row>
        ))}
      </View>
      <Row>
        {canCopy ? <Button title={copied ? "Copied" : rows.length === 1 ? "Copy password" : "Copy all"} icon="copy-outline" small variant="secondary" onPress={copy} /> : null}
        {Platform.OS === "web" && rows.length > 1 ? <Button title="Download CSV" icon="download-outline" small variant="secondary" onPress={() => downloadCsv(filename, rows)} /> : null}
        {onDone ? <Button title="Done" small onPress={onDone} /> : null}
      </Row>
    </Card>
  );
}
