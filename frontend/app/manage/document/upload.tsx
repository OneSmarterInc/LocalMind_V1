import * as DocumentPicker from "expo-document-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { ApiError } from "@/api/client";
import { manage } from "@/api/endpoints";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Button, Card, CardHead, Dropdown, ErrorBanner, FormFooter, Input, Notice, PageHeading, Screen, Split, StepList, Stepper, TileIcon, colors } from "@/ui";

export default function UploadBook() {
  const router = useRouter();
  const params = useLocalSearchParams<{ subject?: string }>();
  const subjects = useAsync(() => manage.subjects(), []);
  const [subjectId, setSubjectId] = useState(params.subject ?? "");
  const [title, setTitle] = useState("");
  const [outlineStrategy, setOutlineStrategy] = useState("source");
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const active = (subjects.data ?? []).filter((s) => s.status === "active");
  const onlyOne = active.length === 1 ? active[0].id : null;
  useEffect(() => { if (!subjectId && onlyOne) setSubjectId(onlyOne); }, [subjectId, onlyOne]);
  const pick = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword"], copyToCacheDirectory: true });
    if (!res.canceled && res.assets[0]) { setFile(res.assets[0]); if (!title) setTitle(res.assets[0].name.replace(/\.[^.]+$/, "")); }
  };
  const upload = useAction(async () => {
    setDuplicate(null);
    if (!file) return;
    const form = new FormData();
    form.append("subject_id", subjectId); form.append("title", title.trim());
    form.append("outline_strategy", outlineStrategy);
    if (Platform.OS === "web" && file.file) form.append("file", file.file, file.name);
    else form.append("file", { uri: file.uri, name: file.name, type: file.mimeType ?? "application/octet-stream" } as unknown as Blob);
    let doc;
    try { doc = await manage.upload(form); } catch (e) {
      const existing = (e as ApiError)?.details?.document_id;
      if (typeof existing === "string") setDuplicate(existing);
      throw e;
    }
    await manage.process(doc.id).catch(() => {});
    router.replace(`/manage/document/${doc.id}`);
  });
  const size = file?.size ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : "";
  return (
    <Screen>
      <PageHeading eyebrow="BOOKS & MODULES" title="Let’s add a book." subtitle="We’ll walk you from source material to student-ready modules."
        right={<Button title="Back to books" variant="secondary" icon="arrow-back" onPress={() => router.push("/manage/books")} />} />
      <Stepper steps={["Upload a book", "Review the outline", "Publish to students"]} active={0} />
      <Split
        main={
          <Card>
            <CardHead title="Book details" />
            {subjects.data && active.length === 0 ? <Notice tone="warning" message="You have no active subject. Ask your administrator to assign one." /> : null}
            <Dropdown label="Subject *" value={subjectId} onChange={setSubjectId} placeholder="Choose a subject" width="100%" options={active.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} />
            <Dropdown label="Chapter and module structure" value={outlineStrategy} onChange={setOutlineStrategy}
              width="100%" options={[{ value: "source", label: "Keep the document’s headings (recommended)" },
                { value: "ai", label: "Suggest a structure with AI" }]} />
            <Notice message={outlineStrategy === "source"
              ? "Your headings, order, and section names will be kept. You can review and edit them before publishing."
              : "AI may regroup or tidy headings. An incomplete suggestion falls back to the document’s own structure."} />
            <Input label="Book title" required value={title} onChangeText={setTitle} placeholder="As students should see it" hint="A clear title helps students find the right book." />
            <View style={{ borderWidth: 1.5, borderStyle: "dashed", borderColor: "#B8CBBB", borderRadius: 12, backgroundColor: "#F9FCF6", alignItems: "center", paddingVertical: 30, paddingHorizontal: 20, gap: 8 }}>
              <TileIcon icon="cloud-upload-outline" size={48} />
              <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>Choose your source book</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>PDF or Word (.docx) · Up to 100 MB</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 }}>
                <Button title="Choose file" variant="secondary" onPress={pick} />
                <Text style={{ fontSize: 12, color: colors.muted }}>{file ? `${file.name}${size ? ` · ${size}` : ""}` : "No file chosen"}</Text>
              </View>
            </View>
            <ErrorBanner message={upload.error} />
            {duplicate ? <Button title="Open the existing book" icon="open-outline" variant="secondary" onPress={() => router.replace(`/manage/document/${duplicate}`)} /> : null}
            <FormFooter note={file ? `Ready to upload ${file.name}.` : "The book is read and split into modules after upload."}>
              <Button title="Cancel" variant="secondary" onPress={() => router.push("/manage/books")} />
              <Button title="Upload and process" icon="arrow-forward" onPress={() => upload.run()} busy={upload.busy} disabled={!file || !subjectId || !title.trim()} />
            </FormFooter>
          </Card>
        }
        side={
          <Card>
            <CardHead title="A few things to know" />
            <StepList steps={[
              ["Start with a readable file", "Selectable PDF text or Word headings give the cleanest outline."],
              ["Review what was extracted", "You stay in control of chapter titles, modules, and source text."],
              ["Publish when you are ready", "Students see the content after publication."],
            ]} />
            <View style={{ height: 1, backgroundColor: colors.border }} />
            <Text style={{ fontSize: 11, color: colors.muted, lineHeight: 17 }}>Legacy .doc support depends on the server’s converter. If one is refused, save it as .docx and try again.</Text>
          </Card>
        }
      />
    </Screen>
  );
}
