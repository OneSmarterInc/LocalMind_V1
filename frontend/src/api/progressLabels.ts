/** The label a student sees on a finished module put back in progress
 * (learning.services.refresh_completion on the server). */
export function reopenedLabel(reason?: string | null): string | null {
  return reason === "new_quiz" ? "New quiz published" : reason === "updated" ? "Content updated" : null;
}
