import React, { useEffect, useState } from "react";
import { manage } from "@/api/endpoints";
import type { Document, Outline } from "@/api/types";
import { useAsync } from "@/hooks/useAsync";
import { Chip, Label, Loading, P, Row } from "@/ui";

export interface Target { subject_id?: string; chapter_id?: string; module_id?: string }

/** Pick subject -> published book -> chapter or module. Emits exactly one target id. */
export function TargetPicker({ value, onChange, allowSubject }: { value: Target; onChange: (t: Target) => void; allowSubject?: boolean }) {
  const subjects = useAsync(() => manage.subjects(), []);
  const [subjectId, setSubjectId] = useState(value.subject_id ?? "");
  const [docId, setDocId] = useState("");
  const docs = useAsync(() => (subjectId ? manage.documents({ subject: subjectId, status: "published" }) : Promise.resolve([] as Document[])), [subjectId]);
  const outline = useAsync(() => (docId ? manage.outline(docId) : Promise.resolve(null as Outline | null)), [docId]);
  useEffect(() => { setDocId(""); }, [subjectId]);
  return (
    <>
      <Label>Subject</Label>
      {subjects.loading ? <Loading /> : <Row>{subjects.data?.filter((s) => s.status === "active").map((s) => <Chip key={s.id} label={s.code} selected={subjectId === s.id} onPress={() => { setSubjectId(s.id); onChange(allowSubject ? { subject_id: s.id } : {}); }} />)}</Row>}
      {subjectId ? <><Label>Book</Label><Row>{docs.data?.map((d) => <Chip key={d.id} label={d.title} selected={docId === d.id} onPress={() => { setDocId(d.id); onChange(allowSubject ? { subject_id: subjectId } : {}); }} />)}{docs.data?.length === 0 ? <P muted small>No published books.</P> : null}</Row></> : null}
      {outline.data ? (
        <>
          <Label>Chapter or module</Label>
          {outline.data.chapters.map((c) => (
            <Row key={c.id}>
              <Chip label={`Ch ${c.order}: ${c.title}`} selected={value.chapter_id === c.id} onPress={() => onChange({ chapter_id: c.id })} />
              {c.modules.map((m) => <Chip key={m.id} label={`${c.order}.${m.order} ${m.title}`} selected={value.module_id === m.id} onPress={() => onChange({ module_id: m.id })} />)}
            </Row>
          ))}
        </>
      ) : null}
    </>
  );
}
