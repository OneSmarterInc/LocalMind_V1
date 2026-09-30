import { backgroundWork } from './backgroundWork';
import { generationJobs, type Job } from './jobs';
import { jobTitle, progressFraction, readySummary } from './workStatus';

/** Keeps the phone notification describing the job that is running: its
 * title (\"Writing lessons — Chapter 4\"), its progress line, and a bar that
 * counts finished items. When the work ends, the lessons and quizzes finished
 * in the session become the \"ready\" message (Android, when LocalMind is not
 * on screen). Imported once by the root layout; in a browser backgroundWork
 * ignores all of this. */
const finished = new Map<number, Job>();
let busy = false;

export function describe(jobs: readonly Job[]) {
  const live = jobs.filter(j => j.state === 'queued' || j.state === 'running');
  // A new round of work after everything was idle starts a new summary.
  if (live.length && !busy) finished.clear();
  busy = live.length > 0;
  for (const j of jobs) if (j.state === 'completed') finished.set(j.id, j);
  const running = jobs.find(j => j.state === 'running');
  backgroundWork.show(running ? { title: jobTitle(running), text: running.note || 'Starting…', fraction: progressFraction(running.note) } : null);
  backgroundWork.setReady(readySummary([...finished.values()]));
}

generationJobs.subscribe(() => describe(generationJobs.snapshot()));
