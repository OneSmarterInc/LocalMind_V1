/** The one status line shown while the AI model works, on every screen and
 *  device: the Private library and course Ask a doubt, lessons and quizzes.
 *
 * The phone used to say \"Reading the material on this phone… 14s\" and the
 * laptop \"Generating with GPU · 12s\": the same step in two vocabularies, one
 * of them technical. Now both use these words and an elapsed time. The phone
 * can tell reading from writing (it sees the first word arrive); the browser
 * runtime returns the whole answer at once, so the laptop shows one step. */
export type AiPhase = 'reading' | 'writing' | 'fixing' | 'working';

const WORDS: Record<AiPhase, string> = {
  reading: 'Reading the material',
  writing: 'Writing',
  fixing: 'Fixing the format',
  working: 'Reading and writing',
};

export function aiStatus(phase: AiPhase, seconds: number): string {
  return `${WORDS[phase]}… ${Math.max(0, Math.floor(seconds))}s`;
}

/** Before the model starts: another answer is being written first. */
export const AI_WAITING = 'Waiting for the AI model…';
/** The model file is being loaded into memory. */
export const AI_LOADING = 'Loading the AI model…';
