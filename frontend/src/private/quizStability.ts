import {lessonPassages, requireThat} from './core';

/**
 * Build smaller, varied source passages for a multi-question quiz.
 * A rich module should not ask the local model to create every question from
 * the same 2,400-character block because small local models then tend to
 * repeat the same high-salience question.
 */
export function quizPassages(source:string,count:number):string[]{
  requireThat(Number.isInteger(count)&&count>=1&&count<=10,'Choose between 1 and 10 questions');
  const clean=source.trim();
  requireThat(clean,'No readable source was extracted. Check the original page and import it again.');
  const target=Math.max(1,Math.min(10,count));
  // Aim for roughly one focused passage per requested question when the source
  // is long enough, while retaining enough context for a useful MCQ.
  const size=Math.max(500,Math.min(900,Math.ceil(clean.length/target)));
  const passages=lessonPassages(clean,size).filter(Boolean);
  return passages.length?passages:[clean];
}

const questionKey=(value:string)=>value
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu,' ')
  .replace(/\s+/g,' ')
  .trim();

/** Case, punctuation and whitespace changes do not make a repeated question new. */
export function sameQuestion(a:string,b:string):boolean{
  return questionKey(a)===questionKey(b);
}

/**
 * Duplicate/format failures are retried automatically. Hard device failures
 * (timeout, cancellation, storage) still stop immediately so the UI can tell
 * the student what actually happened.
 */
export const QUIZ_GENERATION_ATTEMPTS=5;
