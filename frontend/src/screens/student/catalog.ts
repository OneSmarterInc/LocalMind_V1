import { student } from "@/api/endpoints";
import type { Subject } from "@/api/types";
import { useAsync } from "@/hooks/useAsync";

export type CatalogModule = {
  module_id: string; title: string; chapter: string; document: string; availability: string; status: string;
  best_quiz_percentage: number | null; quiz_attempts: number; learning_seconds: number; last_viewed_at: string | null;
  subject: Subject;
};
export type CatalogSubject = { subject: Subject; modules: CatalogModule[]; completed: number; total: number; quizAverage: number | null; learningSeconds: number };

/**
 * Everything the student overview, subject list, quiz list and progress page
 * need to relate modules to subjects: the enrolled subjects and, per subject,
 * the existing analytics endpoint (module status, best quiz, reading time).
 */
export function useStudentCatalog() {
  return useAsync(async () => {
    const subjects = await student.subjects();
    const rows: CatalogSubject[] = await Promise.all(subjects.map(async (s) => {
      const a = await student.subjectAnalytics(s.id).catch(() => null);
      const modules: CatalogModule[] = (a?.modules ?? []).map((m: Omit<CatalogModule, "subject">) => ({ ...m, subject: s }));
      return {
        subject: s, modules,
        completed: modules.filter((m) => m.status === "completed").length,
        total: modules.length,
        quizAverage: a?.quiz_average ?? null,
        learningSeconds: a?.time?.learning_seconds ?? 0,
      };
    }));
    const byModule = new Map<string, CatalogModule>();
    rows.forEach((r) => r.modules.forEach((m) => byModule.set(m.module_id, m)));
    return { subjects: rows, byModule };
  }, []);
}

/** The module to continue: most recently viewed unfinished one, else the first open one not started. */
export function nextModule(rows: CatalogSubject[]): CatalogModule | null {
  const all = rows.flatMap((r) => r.modules).filter((m) => m.availability === "open");
  const going = all.filter((m) => m.status === "in_progress" || m.status === "needs_review")
    .sort((a, b) => (b.last_viewed_at ?? "").localeCompare(a.last_viewed_at ?? ""));
  return going[0] ?? all.find((m) => m.status === "not_started") ?? null;
}

export const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };
