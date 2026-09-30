/** What LocalMind is working on, in words a person can read: the title of
 * the phone notification and of each row in the job list, the notification's
 * progress bar, and the \"ready\" message when the work is done.
 *
 * Before this, the notification said \"LocalMind is generating / Writing your
 * study material\" for everything (a doubt included), kept the first title for
 * the whole session, and moved its bar by words written against the longest
 * answer allowed, so it jumped back at each lesson part. Rows in the job list
 * read \"Book · local lessons\" or \"Chapter 4 · doubt\", with states such as
 * \"running\" in lower case. */
export type Work = 'doubt' | 'lesson' | 'quiz' | 'lessons' | 'quizzes' | 'both';
export type JobLike = { kind: string; label: string; work?: Work; state?: string };

const FROM_KIND: Record<string, Work> = {
  doubt: 'doubt', lesson: 'lesson', quiz: 'quiz',
  'staff-lesson': 'lesson', 'staff-quiz': 'quiz', 'staff-quiz-selection': 'quiz', 'staff-auto': 'both',
};

export const workOf = (job: JobLike): Work | undefined => job.work ?? FROM_KIND[job.kind];

/** \"Writing lessons — Chapter 4\", \"Answering your question\". */
export function jobTitle(job: JobLike): string {
  const name = job.label.trim();
  switch (workOf(job)) {
    case 'doubt': return 'Answering your question';
    case 'lesson': return name ? `Writing a lesson — ${name}` : 'Writing a lesson';
    case 'quiz': return name ? `Writing a quiz — ${name}` : 'Writing a quiz';
    case 'lessons': return name ? `Writing lessons — ${name}` : 'Writing lessons';
    case 'quizzes': return name ? `Writing quizzes — ${name}` : 'Writing quizzes';
    case 'both': return name ? `Writing lessons and quizzes — ${name}` : 'Writing lessons and quizzes';
    default: return name || 'LocalMind is working';
  }
}

const STATE: Record<string, string> = { queued: 'Waiting', running: 'Working', completed: 'Saved', failed: 'Failed', cancelled: 'Cancelled' };
/** The job list's badge: \"Working\", not \"running\". */
export const jobStateLabel = (state: string): string => STATE[state] ?? state;

/** Share of the work finished, from the counts in a progress line.
 *
 * Progress lines name finished items as \"Module 2 of 5 · Part 1 of 3 · …\"
 * or \"Question 4 of 10\" (a range such as \"Preparing questions 4–6 of 10\"
 * counts from its first number). The first count is the outer one, a second
 * one refines it. Item N of M means N − 1 are finished, so the bar only ever
 * moves forward as items finish. Undefined when the line has no count: the
 * notification then shows a busy bar instead of a made-up percentage. */
export function progressFraction(note: string | undefined): number | undefined {
  if (!note) return undefined;
  const counts = [...note.matchAll(/(\d+)(?:\s*[–-]\s*\d+)?\s+of\s+(\d+)/g)]
    .map(m => [Number(m[1]), Number(m[2])] as const).filter(([n, of]) => of > 0 && n >= 0 && n <= of);
  if (!counts.length) return undefined;
  const [[n1, of1], inner] = counts;
  let share = Math.max(0, n1 - 1) / of1;
  if (inner) share += (Math.max(0, inner[0] - 1) / inner[1]) / of1;
  return Math.max(0, Math.min(0.99, share));
}

/** The \"ready\" notification after lessons and quizzes finish (Android).
 *  Answers to doubts are left out: the person is watching for those. */
export function readySummary(done: JobLike[]): { title: string; text: string } | null {
  const made = done.filter(j => workOf(j) && workOf(j) !== 'doubt');
  if (!made.length) return null;
  const has = (w: Work[]) => made.some(j => w.includes(workOf(j)!));
  const lessons = has(['lesson', 'lessons', 'both']), quizzes = has(['quiz', 'quizzes', 'both']);
  const title = lessons && quizzes ? 'Lessons and quizzes ready' : lessons ? (made.length === 1 && workOf(made[0]) === 'lesson' ? 'Lesson ready' : 'Lessons ready') : (made.length === 1 && workOf(made[0]) === 'quiz' ? 'Quiz ready' : 'Quizzes ready');
  const names = [...new Set(made.map(j => j.label.trim()).filter(Boolean))];
  const where = names.length === 1 ? `${names[0]}: ` : names.length > 1 ? `${names.length} items: ` : '';
  return { title, text: `${where}saved on this phone. Open LocalMind to review.` };
}
