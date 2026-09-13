import { manage } from "@/api/endpoints";
import { useAsync } from "@/hooks/useAsync";

export type SubjectModule = {
  id: string; title: string; number: number; chapter: string; chapter_id: string; document_id: string; document_title: string;
  source_text: string; availability?: string; start_page?: number | null; end_page?: number | null;
};

/**
 * Every module of a subject's books, numbered through each book, with its text.
 * Used for choosing quiz/assignment sources and for showing those sources.
 */
export function useSubjectModules(subjectId: string | null | undefined, publishedOnly = false) {
  return useAsync(async () => {
    if (!subjectId) return [] as SubjectModule[];
    const docs = await manage.documents({ subject: subjectId, status: publishedOnly ? "published" : undefined });
    const out: SubjectModule[] = [];
    for (const d of docs) {
      if (["uploaded", "processing", "error"].includes(d.status)) continue;
      const outline = await manage.outline(d.id).catch(() => null);
      if (!outline) continue;
      let n = 0;
      for (const ch of outline.chapters) for (const m of ch.modules) {
        if (!m.id) continue;
        n += 1;
        out.push({ id: m.id, title: m.title, number: n, chapter: ch.title, chapter_id: ch.id ?? "", document_id: d.id, document_title: d.title, source_text: m.source_text ?? "", availability: m.availability });
      }
    }
    return out;
  }, [subjectId, publishedOnly]);
}
