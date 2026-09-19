import { device } from './device';
import { generationJobs } from './jobs';
import { jobScope } from './useGenerationJobs';
import type { Library } from './library';
export type PendingDoubt = { question: string; state: 'queued' | 'running' | 'interrupted'; error?: string; createdAt: string };
const key = (l: Library, book: string, section: string) => `${l.prefix}work:${book}:pending-doubt:${section}`;
export async function pendingDoubt(l: Library, book: string, section: string) {
  l.guard(); const row = await (await device()).get<PendingDoubt>(key(l,book,section)); l.guard();
  if (!row) return null;
  const active = generationJobs.list(jobScope(l.prefix)).some(j => j.bookId === book && j.sectionId === section && j.kind === 'doubt' && ['queued','running'].includes(j.state));
  return active ? row : {...row, state: 'interrupted' as const};
}
const starting = new Set<string>();
export async function queueDoubt(l: Library, book: string, section: string, question: string, run: (signal: AbortSignal, progress: (s:string)=>void)=>Promise<unknown>) {
  l.guard(); generationJobs.requireDoubtsAvailable(); const scope=jobScope(l.prefix);
  if(generationJobs.list(scope).some(j=>j.bookId===book&&j.sectionId===section&&j.kind==='doubt'&&['queued','running'].includes(j.state)))return;
  const storageKey=key(l,book,section);
  if(starting.has(storageKey))return;
  starting.add(storageKey);
  try {
  const d=await device();
  const row:PendingDoubt={question,state:'queued',createdAt:new Date().toISOString()};
  await d.put(storageKey,row);l.guard();
  try {
    generationJobs.enqueue({scope,bookId:book,sectionId:section,kind:'doubt',label:question.slice(0,100)},async(signal,progress)=>{
      try { l.guard();await d.put(storageKey,{...row,state:'running'});await run(signal,progress);l.guard();await d.removePrefix(storageKey); }
      catch(e){ l.guard();await d.put(storageKey,{...row,state:'interrupted',error:signal.aborted?'Answer cancelled. You can retry.':e instanceof Error?e.message:String(e)});throw e; }
    });
  }catch(e){l.guard();await d.put(storageKey,{...row,state:'interrupted',error:String(e)});throw e;}
  } finally { starting.delete(storageKey); }
}
