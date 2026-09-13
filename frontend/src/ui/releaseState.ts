/**
 * Whether an attempt's or submission's result is visible to its student, mirroring the server's rule
 * (assessments.models.AssessmentAttempt.results_visible): shown immediately; released for the whole
 * quiz/assignment or for this one item; or past a scheduled release time.
 */
export function resultVisible(
  parent: { results_release?: string | null; results_release_at?: string | null; results_released_at?: string | null },
  item: { results_released_at?: string | null },
  now = Date.now(),
): boolean {
  const mode = parent.results_release ?? "immediate";
  if (mode === "immediate") return true;
  if (item.results_released_at || parent.results_released_at) return true;
  if (mode === "scheduled" && parent.results_release_at) return new Date(parent.results_release_at).getTime() <= now;
  return false;
}
