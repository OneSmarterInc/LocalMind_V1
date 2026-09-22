import type {Library} from './library';
import type {ModuleRunner} from './jobs';
import {cancelled} from './busy';

/** Restart from saved content/checkpoints; never regenerate finished modules. */
export async function generateRemaining(library:Library,bookId:string,ids:string[],signal:AbortSignal,progress:(message:string)=>void,runModule:ModuleRunner){
 const book=await library.book(bookId);
 for(const id of [...new Set(ids)]){
  cancelled(signal);
  const section=book.sections.find(s=>s.id===id);
  if(!section?.source.trim())continue;
  await runModule(id,async moduleSignal=>{
   progress(`${section.title} · lesson`);
   if(!(await library.lessons(bookId,id)).length)await library.generateLesson(bookId,id,moduleSignal,progress);
   cancelled(moduleSignal);
   progress(`${section.title} · quiz`);
   if(!(await library.quizzes(bookId,id)).length)await library.generateQuiz(bookId,id,6,moduleSignal,n=>progress(`${section.title} · ${n} questions saved`),progress);
  });
 }
}
