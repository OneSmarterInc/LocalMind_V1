import { admin } from "@/api/endpoints";
import { choiceAsync, confirmDeleteAsync } from "@/ui/Confirm";

type Counts = { students?: number; books?: number };
/** Administrator-only. Returns "deleted", "archived" or null (cancelled).
 * Subjects with students suggest archiving, which keeps every record. */
export async function deleteSubjectFlow(s: { id: string; code: string; name: string; status: string }, counts: Counts = {}) {
  const students = counts.students ?? 0, books = counts.books ?? 0;
  if (students > 0 && s.status !== "archived") {
    const pick = await choiceAsync(`${s.name} has ${students} student${students === 1 ? "" : "s"}`,
      "Archiving hides the subject and keeps every record, so it can be restored later. Deleting removes everything permanently.",
      { confirm: "Archive instead", extra: "Delete anyway", cancel: "Cancel" });
    if (pick === "cancel") return null;
    if (pick === "confirm") { await admin.subjectStatus(s.id, "archived"); return "archived" as const; }
  }
  const ok = await confirmDeleteAsync(`Delete ${s.name} permanently?`,
    `This removes ${books} book${books === 1 ? "" : "s"} with their modules, lessons and quizzes, ${students} enrollment${students === 1 ? "" : "s"}, every quiz attempt and score, and all faculty assignments. It cannot be undone.`,
    { detail: `${s.code} · ${s.name}`, okLabel: "Delete subject", confirmText: s.code });
  if (!ok) return null;
  await admin.deleteSubject(s.id);
  return "deleted" as const;
}
