import type { Quiz } from "@/api/types";

// A committed offline submission counts immediately, before server acknowledgement.
export function quizNeedsSubmission(quiz: Quiz): boolean {
  return !(quiz.offline_pending || quiz.attempts_used || quiz.results_pending ||
    quiz.passed || quiz.best_percentage != null);
}
