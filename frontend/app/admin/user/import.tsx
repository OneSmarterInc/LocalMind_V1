import * as DocumentPicker from "expo-document-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { Platform, Text, View } from "react-native";
import { admin } from "@/api/endpoints";
import type { ImportReport } from "@/api/types";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Badge, Button, Card, CardHead, Column, Dropdown, ErrorBanner, FormFooter, Loading, Notice, PageHeading, Screen, Split, StepList, Table, TileIcon, colors } from "@/ui";
import { OneTimeCredentials } from "@/ui/OneTimeCredentials";

type Kind = "students" | "faculty";
type RowT = { row: number; name: string; email: string; outcome: "Created" | "Account exists" | "Invalid email" | "Needs a fix"; todo: string };

export default function ImportPeople() {
  const router = useRouter();
  const p = useLocalSearchParams<{ kind?: string }>();
  const [kind, setKind] = useState<Kind>(p.kind === "faculty" ? "faculty" : "students");
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [showColumns, setShowColumns] = useState(false);
  const spec = useAsync(() => admin.importTemplate(kind), [kind]);
  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], copyToCacheDirectory: true });
    if (!r.canceled && r.assets[0]) { setFile(r.assets[0]); setReport(null); }
  };
  const download = useAction(async () => {
    const data = spec.data ?? (await admin.importTemplate(kind));
    const bytes = Uint8Array.from(atob(data.content_base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a"); a.href = url; a.download = data.filename; a.click(); URL.revokeObjectURL(url);
  });
  const upload = useAction(async () => {
    if (!file) return;
    const form = new FormData();
    if (Platform.OS === "web" && file.file) form.append("file", file.file, file.name);
    else form.append("file", { uri: file.uri, name: file.name, type: file.mimeType ?? "application/octet-stream" } as unknown as Blob);
    setReport(await admin.importUsers(kind, form));
  });
  const who = kind === "faculty" ? "faculty" : "students";

  if (report) {
    const credentials = (report.created_users ?? []).filter((u) => u.initial_password).map((u) => ({ full_name: u.full_name, email: u.email, initial_password: u.initial_password as string }));
    const rows: RowT[] = [
      ...(report.created_users ?? []).map((u) => ({ row: u.row, name: u.full_name ?? "", email: u.email, outcome: "Created" as const, todo: "Share the onboarding instructions" })),
      ...report.errors.map((e) => {
        const exists = (e.errors ?? []).every((x) => /already exists/i.test(x));
        const badEmail = !exists && (e.errors ?? []).some((x) => /email/i.test(x));
        return { row: e.row, name: "", email: e.email ?? "No email", outcome: exists ? "Account exists" as const : badEmail ? "Invalid email" as const : "Needs a fix" as const, todo: exists ? "Nothing to do; the existing account was kept" : `Correct the sheet: ${(e.errors ?? []).join("; ")}` };
      }),
    ].sort((a, b) => a.row - b.row);
    const columns: Column<RowT>[] = [
      { key: "r", label: "Excel row", flex: 0.6, render: (r) => String(r.row) },
      { key: "n", label: "Name", flex: 1.1, render: (r) => r.name || "—" },
      { key: "e", label: "Email", flex: 1.5, render: (r) => r.email },
      { key: "o", label: "Outcome", flex: 0.9, render: (r) => <Badge value={r.outcome} tone={r.outcome === "Created" ? "green" : r.outcome === "Account exists" ? "amber" : "red"} /> },
      { key: "t", label: "What to do", flex: 2.2, render: (r) => <Text style={{ fontSize: 12, color: colors.text }}>{r.todo}</Text> },
    ];
    const done = () => router.replace({ pathname: "/admin/users", params: { kind, notice: `Imported ${report.created} ${who}${report.invalid ? `; ${report.invalid} row(s) need a fix` : ""}.` } });
    return (
      <Screen>
        <PageHeading eyebrow="PEOPLE · IMPORT RESULTS" title="Review the import report" subtitle={file?.name ?? "Excel import"} right={<Button title="Go to people" icon="arrow-forward" onPress={done} />} />
        <Notice tone={report.invalid || report.already_existing ? "warning" : "success"} title={`${report.created} row${report.created === 1 ? "" : "s"} accepted. ${report.invalid + report.already_existing} need${report.invalid + report.already_existing === 1 ? "s" : ""} attention.`}
          message="Rows that were created are not created twice. Correct the marked rows in the sheet and import it again." />
        {credentials.length ? <OneTimeCredentials title={`${credentials.length} one-time password${credentials.length === 1 ? "" : "s"}`} rows={credentials} filename={`localmind-${who}-one-time-passwords.csv`} /> : null}
        <Card flush><Table noun="row" columns={columns} rows={rows} keyOf={(r) => `${r.row}-${r.email}`} minWidth={820} /></Card>
        <View style={{ flexDirection: "row", gap: 9 }}><Button title="Return to import" variant="secondary" icon="arrow-back" onPress={() => { setReport(null); setFile(null); }} /></View>
      </Screen>
    );
  }

  const required = (spec.data?.columns ?? []).filter((c) => c.required);
  const optional = (spec.data?.columns ?? []).filter((c) => !c.required);
  return (
    <Screen>
      <PageHeading eyebrow="PEOPLE · BULK IMPORT" title="Add people from Excel" subtitle="Prepare the file, check the columns, then review each row’s result."
        right={<Button title="Back to people" variant="secondary" icon="arrow-back" onPress={() => router.push({ pathname: "/admin/users", params: { kind } })} />} />
      <Split
        main={
          <Card>
            <CardHead title="Import setup" />
            <Dropdown label="Account type" value={kind} onChange={(v) => { setKind(v as typeof kind); setFile(null); }} width="100%" options={[{ value: "students", label: "Students" }, { value: "faculty", label: "Faculty" }]} />
            <View style={{ flexDirection: "row" }}>
              <Button title={showColumns ? "Hide template columns" : "View Excel template columns"} variant="secondary" icon="grid-outline" onPress={() => setShowColumns((v) => !v)} />
            </View>
            {showColumns ? (spec.loading && !spec.data ? <Loading lines={1} /> : (
              <View style={{ gap: 6, padding: 14, borderRadius: 9, backgroundColor: "#F8FAF7", borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ fontSize: 12, color: colors.ink }}><Text style={{ fontWeight: "600" }}>Required: </Text>{required.map((c) => c.name).join(", ")}</Text>
                {optional.length ? <Text style={{ fontSize: 12, color: colors.ink }}><Text style={{ fontWeight: "600" }}>Optional: </Text>{optional.map((c) => c.name).join(", ")}</Text> : null}
                <Text style={{ fontSize: 11, color: colors.muted }}>Common variations such as {(spec.data?.columns ?? []).flatMap((c) => c.aliases).slice(0, 3).join(", ")} are understood; other columns are ignored.</Text>
                {Platform.OS === "web" ? <View style={{ flexDirection: "row" }}><Button title="Download template" small variant="secondary" icon="download-outline" onPress={() => download.run()} busy={download.busy} /></View> : null}
              </View>
            )) : null}
            <View style={{ borderWidth: 1.5, borderStyle: "dashed", borderColor: file ? colors.primary : "#B8CBBB", borderRadius: 12, backgroundColor: file ? colors.pale : "#F9FCF6", alignItems: "center", paddingVertical: 30, paddingHorizontal: 20, gap: 8 }}>
              <TileIcon icon={file ? "document-text-outline" : "cloud-upload-outline"} size={48} />
              <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>{file ? file.name : "Choose the completed Excel file"}</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>{file?.size ? `${Math.max(1, Math.round(file.size / 1024))} KB` : "Use the current import template so the columns match. Only .xlsx is accepted."}</Text>
              <Button title={file ? "Choose a different file" : "Choose file"} variant="secondary" icon="document-attach-outline" onPress={pick} />
            </View>
            <ErrorBanner message={upload.error ?? download.error ?? spec.error} />
            <FormFooter note="File contents are not read or sent anywhere until you import.">
              <Button title="Cancel" variant="secondary" onPress={() => router.push({ pathname: "/admin/users", params: { kind } })} />
              <Button title={`Import ${who}`} icon="arrow-forward" onPress={() => upload.run()} busy={upload.busy} disabled={!file} />
            </FormFooter>
          </Card>
        }
        side={
          <Card>
            <CardHead title="Before you import" />
            <StepList steps={[
              ["Use the matching template", "Student and faculty columns differ."],
              ["Check the email addresses", "An account cannot use an email already registered."],
              ["Review row-by-row results", "Correct failed rows without redoing successful ones."],
            ]} />
          </Card>
        }
      />
    </Screen>
  );
}
