import {UploadStatus} from '@/authoring/UploadStatus';
import { useBackTo } from "@/hooks/useBackTo";
import * as DocumentPicker from "expo-document-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import {useAuth} from "@/auth/AuthContext";
import { useOnline } from "@/offline/connectivity";
import {BookUploads} from "@/authoring/uploads";
import { manage } from "@/api/endpoints";
import { useAction, useAsync } from "@/hooks/useAsync";
import { Button, Card, CardHead, Dropdown, ErrorBanner, FormFooter, Input, Loading, Notice, PageHeading, Screen, Split, StepList, Stepper, TileIcon, colors, fmtSize } from "@/ui";

// What the server's parser can actually read, and the limit the page states.
const ACCEPTED = ["pdf", "docx", "doc"];
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export default function UploadBook() {
  const router = useRouter();
  const back = useBackTo();
  const {user}=useAuth();
  const online = useOnline();
  const uploads=useMemo(()=>user?new BookUploads(user.id):null,[user]);
  const params = useLocalSearchParams<{ subject?: string }>();
  const subjects = useAsync(() => manage.subjects(), []);
  const [subjectId, setSubjectId] = useState(params.subject ?? "");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const active = (subjects.data ?? []).filter((s) => s.status === "active");
  const onlyOne = active.length === 1 ? active[0].id : null;
  useEffect(() => { if (!subjectId && onlyOne) setSubjectId(onlyOne); }, [subjectId, onlyOne]);
  const [rejected, setRejected] = useState<string | null>(null);
  const pick = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword"], copyToCacheDirectory: true });
    if (res.canceled || !res.assets[0]) return;
    const chosen = res.assets[0];
    const extension = (chosen.name.match(/\.([^.]+)$/)?.[1] ?? "").toLowerCase();
    if (!ACCEPTED.includes(extension)) {
      // Say so now. The OS dialog lets a person switch to "All files", and the
      // filter above is only a suggestion to it.
      setRejected(`${chosen.name} is a .${extension || "file"}. LocalMind reads PDF and Word (.docx) books.`);
      setFile(null);
      return;
    }
    if (chosen.size && chosen.size > MAX_UPLOAD_BYTES) {
      setRejected(`${chosen.name} is ${fmtSize(chosen.size)}. The limit is 100 MB. Split the book into chapters and add them one at a time.`);
      setFile(null);
      return;
    }
    setRejected(null);
    setFile(chosen);
    if (!title) setTitle(chosen.name.replace(/\.[^.]+$/, ""));
  };
  const upload = useAction(async () => {
    if (!file||!uploads) return;
    const saved=await uploads.enqueue(file,title,subjectId);
    if(saved.state==='synced'&&saved.documentId){await uploads.dismiss(saved.id);router.replace(`/manage/document/${saved.documentId}`);}
    else {setFile(null);setTitle('');}

  });
  const size = fmtSize(file?.size);
  return (
    <Screen>
      <PageHeading eyebrow="BOOKS & MODULES" title="Let’s add a book." subtitle="We’ll walk you from source material to student-ready modules."
        right={<Button title="Back to books" variant="secondary" icon="arrow-back" onPress={() => back("/manage/books")} />} />
      {user?<UploadStatus owner={user.id}/>:null}
      {/* Offline, the server cannot outline the book, so nothing can be generated from
          an upload that is still queued. The device importer does the whole job without
          a server — outline, lessons and quizzes — so offer it here instead of leaving
          the page looking broken. The chosen subject travels with the link. */}
      {!online ? (
        <Notice tone="warning" title="The server is unavailable."
          message="An upload waits here until the server is back, and it cannot be split into modules before then. Prepare the book on this device instead: it is outlined here, you can generate lessons and quizzes with the offline model, and everything synchronizes when the server returns."
          action={<Button title="Prepare on this device" icon="arrow-forward" onPress={() => router.push({ pathname: "/manage/local-books", params: subjectId ? { subject: subjectId } : {} })} />} />
      ) : null}
      <Stepper steps={["Upload a book", "Review the outline", "Publish to students"]} active={0} />
      <Split
        main={
          <Card>
            <CardHead title="Book details" />
            <ErrorBanner message={subjects.error} onRetry={subjects.reload} />
            {subjects.loading && !subjects.data ? <Loading lines={1} /> : null}
            {rejected ? <Notice inline tone="warning" title="That file cannot be used" message={rejected} /> : null}
            {subjects.data && active.length === 0 ? <Notice inline tone="warning" message={user?.role === "admin" ? "There is no active subject yet. Create one under Subjects first." : "You have no active subject. Ask your administrator to assign one."} /> : null}
            <Dropdown label="Subject *" value={subjectId} onChange={setSubjectId} placeholder="Choose a subject" width="100%" options={active.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} />
            <Notice message="Chapters and modules follow the book’s own headings and content. Review the extracted outline before publishing. Lesson and quiz generation continues on your device." />
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

            <FormFooter note={file ? `Ready to upload ${file.name}.` : "The book is read and split into modules after upload."}>
              <Button title="Cancel" variant="secondary" onPress={() => back("/manage/books")} />
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
