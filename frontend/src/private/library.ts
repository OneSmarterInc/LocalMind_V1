import {resumeParts, type Checkpoint} from './performance';
import {generationJobs} from './jobs';
import { randomUUID } from 'expo-crypto';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { BASE_URL, currentSession, SessionChangedError } from '@/api/client';
import { device } from './device';
import { cancelled } from './busy';
import { avoidList } from './promptBudget';
import type { LocalFile } from './device.types';
import { isFollowUp, MAX_READING_CHARS, MAX_SECTION_CHARS, ANSWER_SCHEMA, groundedSchema, GROUNDING, COMPACT_LESSON_SCHEMA, COMPACT_MCQ_SCHEMA, compactMcqBatchSchema, markQuiz, requireThat, bookReference, pageSource, lessonPassages, headingPassages, passageHeading, text, validateAnswer, validateBook, validateLesson, validateMCQ, type PrivateBook, type Lesson, type MCQ, type SourceVisual } from './core';
export type QuizVersion = { id: string; bookId: string; sectionId: string; createdAt: string; requestedCount?: number; questions: MCQ[] };
export type LessonVersion = { id: string; sectionId: string; createdAt: string; lesson: Lesson };
export type PracticeResult = { id: string; quizId: string; createdAt: string; answers: Record<string, number> } & ReturnType<typeof markQuiz>;
export type PrivateChat = { id: string; question: string; answer: string; quote: string; supported: boolean; createdAt: string };
export const fingerprint = (s: string) => bytesToHex(sha256(utf8ToBytes(s)));

/** Separate storage namespace from ERP downloads. No private record is synchronized. */
export class Library {
  readonly prefix: string;
  private session: number;
  constructor(readonly owner: string, domain: 'private'|'authoring' = 'private', session=currentSession()) {
    requireThat(!!owner, 'Sign in on this device to open your private library');
    this.prefix = `${domain}:${fingerprint(`${BASE_URL}|${owner}`)}:`; this.session = session;
  }
  guard() { if (currentSession() !== this.session) throw new SessionChangedError(); }
  private key(book: string) { return `${this.prefix}book:${book}`; }
  private work(book: string) { return `${this.prefix}work:${book}:`; }
  async seed(book: PrivateBook) { this.guard(); await (await device()).put(this.key(book.id), validateBook(book)); this.guard(); }
  async books(): Promise<PrivateBook[]> { this.guard(); const rows = await (await device()).list<PrivateBook>(`${this.prefix}book:`); this.guard(); return rows.map(validateBook).sort((a, b) => b.importedAt.localeCompare(a.importedAt)); }
  async book(id: string) { this.guard(); requireThat(/^[a-f0-9]{64}$/.test(id), 'Invalid private book ID'); const b = await (await device()).get<PrivateBook>(this.key(id)); this.guard(); requireThat(b, 'This book is no longer in your private library'); return validateBook(b); }
  async viewState(bookId: string, key: string) { await this.book(bookId); const row=await (await device()).get<string>(`${this.work(bookId)}view:${key}`); this.guard(); return row || ''; }
  async saveViewState(bookId: string, key: string, value: string) { await this.book(bookId); await (await device()).put(`${this.work(bookId)}view:${key}`,value); this.guard(); }
  async correctSource(bookId:string, sectionId:string, source:string) {
    const book=await this.book(bookId);const section=book.sections.find(s=>s.id===sectionId);requireThat(section,'Choose a module');
    const limit=section.readingUnit?MAX_READING_CHARS:MAX_SECTION_CHARS;
    requireThat(!!source.trim()&&source.length<=limit,`Enter between 1 and ${limit} source characters.`);
    await generationJobs.cancelBook(`${this.prefix}session:${currentSession()}`,bookId);
    const d=await device();const key=`${this.work(bookId)}original-source:${sectionId}`;
    if(await d.get(key)===undefined)await d.put(key,section.source);
    section.source=source.trim();this.guard();await d.put(this.key(bookId),validateBook(book));this.guard();
  }
  async import(file: LocalFile, shared?: { id: string; title: string; sha256?: string }, signal?: AbortSignal, progress?: (message: string) => void) {
    cancelled(signal); this.guard(); progress?.("Reading book on this device…");
    const d = await device(), assetSet=randomUUID();let assetPrefix='';let committed=false;
    const resolveId=async(hash:string)=>{
      const original=await d.get<PrivateBook>(this.key(hash));this.guard();
      return original&&original.importVersion!==5?fingerprint(`${hash}|source-layout-v5`):hash;
    };
    try {
      const parsed=await d.parse(file,signal,progress,async(visual,hash)=>{
        this.guard();cancelled(signal);
        if(!assetPrefix)assetPrefix=`${this.work(await resolveId(hash))}visual:${assetSet}:`;
        await d.put(`${assetPrefix}${visual.id}`,visual);
        this.guard();cancelled(signal);
      });
      this.guard();cancelled(signal);
      if(shared?.sha256)requireThat(parsed.hash===shared.sha256,'Downloaded book checksum mismatch. Nothing was imported.');
      const id=await resolveId(parsed.hash), upgraded=id!==parsed.hash;
      const existing=await d.get<PrivateBook>(this.key(id));this.guard();
      if(existing)return {book:validateBook(existing),duplicate:true};
      const book:PrivateBook={importVersion:5,sourceHash:parsed.hash,assetSet,id,title:((shared?.title||file.name.replace(/\.[^.]+$/,''))+(upgraded?' · new extraction':'')).slice(0,300),originalName:file.name,importedAt:new Date().toISOString(),origin:shared?'shared':'personal',...(shared?{sourceId:shared.id}:{}),sections:parsed.sections,warnings:[...parsed.warnings,...(upgraded?['The earlier import and its practice history are unchanged. This copy uses the new extraction.']:[])]};
      // Compatibility for parsers that return images instead of streaming them.
      assetPrefix ||= `${this.work(id)}visual:${assetSet}:`;
      for(const visual of parsed.visuals||[]){this.guard();cancelled(signal);await d.put(`${assetPrefix}${visual.id}`,visual);}
      this.guard();cancelled(signal);await d.put(this.key(id),validateBook(book));committed=true;
      this.guard();return {book,duplicate:false};
    } catch(e) {
      if(e instanceof Error && /quota|disk.*full|storage.*full/i.test(e.name+' '+e.message))
        throw new Error('This device has insufficient storage for the book images. Free some device storage and try again. No new book was saved.');
      throw e;
    } finally {if(!committed&&assetPrefix)await d.removePrefix(assetPrefix);}
  }

  async remove(id: string) { await generationJobs.cancelBook(`${this.prefix}session:${currentSession()}`,id); await this.book(id); this.guard(); const d = await device(); await d.removePrefix(this.key(id)); await d.removePrefix(this.work(id)); this.guard(); }
  async visuals(bookId: string, sectionId: string): Promise<SourceVisual[]> {
    const book = await this.book(bookId), section = book.sections.find(s => s.id === sectionId);
    requireThat(section, 'Choose a module in this book'); const d = await device();
    const rows = await Promise.all((section.visualIds || []).map(id => d.get<SourceVisual>(`${this.work(bookId)}visual:${book.assetSet}:${id}`)));
    this.guard(); requireThat(rows.every(Boolean), 'A source image is missing. Import the book again.');
    return rows as SourceVisual[];
  }
  async lessons(bookId: string, sectionId: string) { await this.book(bookId); const rows = await (await device()).list<LessonVersion>(`${this.work(bookId)}lesson:${sectionId}:`); this.guard(); return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async quizzes(bookId: string, sectionId: string) { await this.book(bookId); const rows = await (await device()).list<QuizVersion>(`${this.work(bookId)}quiz:${sectionId}:`); this.guard(); return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async generateLesson(bookId: string, sectionId: string, signal: AbortSignal, progress?: (message:string)=>void) {
    const book = await this.book(bookId); const section = book.sections.find(s => s.id === sectionId); requireThat(section, 'Choose a module in this book');
    const sourceText=pageSource(book.sections, sectionId);
    let passages=headingPassages(sourceText,2800);requireThat(passages.length,'This module has no readable text.');
    const d=await device(), model=await d.status();
    const lessonKey=(parts:string[])=>`${this.work(bookId)}checkpoint:lesson:${sectionId}:${fingerprint(JSON.stringify({version:1,passages:parts,title:section.title,model:model.hash||model.name}))}:`;
    // Resume checkpoints created by earlier builds before starting the larger, faster passages.
    const previousPassages=lessonPassages(sourceText,2800);
    const legacyPassages=lessonPassages(sourceText);
    if(await d.get(lessonKey(previousPassages)))passages=previousPassages;
    else if(await d.get(lessonKey(legacyPassages)))passages=legacyPassages;
    const key=lessonKey(passages);
    const checkpoint=await d.get<Checkpoint<Lesson>>(key)||{id:randomUUID(),parts:[]};
    const parts=await resumeParts({checkpoint,total:passages.length,signal,
      save:async row=>{this.guard();await d.put(key,row);this.guard();},
      progress:done=>progress?.(`${done} of ${passages.length} lesson parts saved. Generate again after an interruption to resume.`),
      generate:async index=>{
        this.guard();const source=passages[index];
        const raw=await d.complete({system:GROUNDING,prompt:`Teach this entire source passage in plain language. Explain its definitions, relationships, examples and formulas when present. Do not just name the main idea. Write one introductory sentence, one explanatory section and one takeaway. Each call covers one consecutive part of the module. Use an exact supporting quote.\nMODULE: ${section.title}${passageHeading(source)?` (this part: ${passageHeading(source)})`:''} — part ${index+1} of ${passages.length}\nSTORED BOOK REFERENCE:\n${source}`,schema:groundedSchema(COMPACT_LESSON_SCHEMA,source),maxTokens:800,temperature:0.2,signal,
          progress:message=>progress?.(`Part ${index+1}/${passages.length} · ${message}`)});
        return validateLesson(raw,source);
      }});
    const lesson:Lesson={introduction:parts[0].introduction,sections:parts.flatMap(p=>p.sections),takeaways:parts.flatMap(p=>p.takeaways)};
    this.guard();cancelled(signal);await this.book(bookId);
    const version:LessonVersion={id:checkpoint.id,sectionId,createdAt:new Date().toISOString(),lesson};
    await d.put(`${this.work(bookId)}lesson:${sectionId}:${version.id}`,version);this.guard();await d.removePrefix(key);return version;
  }
  async generateQuiz(bookId: string, sectionId: string, count: number, signal: AbortSignal, progress: (done: number) => void, detail?: (message:string)=>void, excluded: string[] = [], moduleSource?: string) {
    requireThat(Number.isInteger(count) && count >= 1 && count <= 10, 'Choose between 1 and 10 questions');
    const book = await this.book(bookId); const section = book.sections.find(s => s.id === sectionId); requireThat(section, 'Choose a module');
    // Keep one quiz per module, but author several questions in each model response.
    // This removes repeated prompt-prefill/model-call overhead without changing the saved quiz shape.
    const sources=lessonPassages(pageSource(book.sections,sectionId),3200); requireThat(sources.length,'No readable source was extracted. Check the original page and import it again.');
    const d = await device(), model=await d.status();
    const key=`${this.work(bookId)}checkpoint:quiz:${sectionId}:${fingerprint(JSON.stringify({version:2,sources,count,model:model.hash||model.name,...(excluded.length?{excluded}:{})}))}:`;
    const checkpoint=await d.get<Checkpoint<MCQ>>(key)||{id:randomUUID(),parts:[]};
    const alternatives=moduleSource?lessonPassages(moduleSource,3200):[];
    let focuses=[...new Set([...sources,...alternatives])].filter(source=>source.trim().length>=8);
    requireThat(focuses.length,'This module has too little readable text for a grounded quiz.');
    const questions=checkpoint.parts;progress(questions.length);
    const normalized=(value:string)=>value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    const duplicate=(question:string)=>[...excluded,...questions.map(q=>q.question)].some(q=>normalized(q)===normalized(question));
    let cursor=0, singleOnly=false, passageLimit=3200;
    // One bounded budget for the request, rather than retries nested per missing item.
    const budget=Math.min(24,Math.max(4,count*2,focuses.length+1));

    const save=async()=>{this.guard();await d.put(key,{id:checkpoint.id,parts:[...questions]});this.guard();};
    let lastReason='';
    const accept=(raw:unknown,source:string):boolean=>{
      try {
        const question=validateMCQ(raw,source,sectionId,randomUUID());
        requireThat(!duplicate(question.question),'The model repeated a question already in this quiz.');
        questions.push(question);return true;
      } catch(e){ lastReason=e instanceof Error?e.message:String(e); return false; }
    };
    // Advance on every attempt, including rejected output. Previously failed
    // questions kept selecting the first passages and never reached later facts.
    const visits=new Map<string,number>();
    for(let attempt=0;attempt<budget&&questions.length<count;attempt++) {
      this.guard();cancelled(signal);
      const pool=focuses.filter(s=>!questions.some(q=>s.includes(q.quote)));
      const candidates=pool.length?pool:focuses;
      const least=Math.min(...candidates.map(s=>visits.get(s)||0));
      const fresh=candidates.filter(s=>(visits.get(s)||0)===least);
      const source=fresh[cursor++%fresh.length];
      visits.set(source,(visits.get(source)||0)+1);
      const wanted=singleOnly?1:Math.min(3,count-questions.length);
      const avoid=avoidList([...excluded,...questions.map(q=>q.question)]);
      let raw:unknown;
      try {
        detail?.(`Quiz ${questions.length}/${count} · ${wanted===1?'one question':'one local AI batch'} (attempt ${attempt+1}/${budget})`);
        raw=await d.complete({system:GROUNDING,prompt:`Write ${wanted===1?'ONE useful multiple-choice practice question':`exactly ${wanted} useful, DISTINCT multiple-choice practice questions`}. Each question needs exactly four distinct answer choices, a zero-based answer index (0-3), a concise explanation (at most 30 words), and an exact supporting quote. Keep each choice under 15 words. Options must contain answer text only; never prefix A/B/C/D or 1/2/3/4. Test specific facts from the reference.\nDo not repeat these accepted questions:\n${avoid}\n${lastReason?`Correct this problem from the previous attempt: ${lastReason.slice(0,240)}\n`:''}STORED BOOK REFERENCE:\n${source}`,schema:groundedSchema(wanted===1?COMPACT_MCQ_SCHEMA:compactMcqBatchSchema(wanted),source),maxTokens:wanted===3?1200:wanted===2?850:650,temperature:0.25,signal,progress:message=>detail?.(`Quiz ${questions.length}/${count} · ${message}`)});
      } catch(e) {
        this.guard();cancelled(signal);
        lastReason=e instanceof Error?e.message:String(e);
        // A smaller context preserves grounding without repeating an oversized
        // prompt. Split rather than discard the rest of the reference.
        if(/(?:exceeds|exceeded|too long|too large).*context|context.*(?:exceeds|exceeded|too long|too large|limit)/i.test(lastReason)&&passageLimit>800){
          passageLimit=Math.max(800,Math.floor(passageLimit/2));
          focuses=focuses.flatMap(s=>lessonPassages(s,passageLimit));
          singleOnly=true;
          continue;
        }
        // Runtime/storage failures are not evidence of poor source material.
        // Only truncated/invalid model output benefits from a smaller response.
        if(!/incomplete|JSON|unexpected token|unterminated/i.test(lastReason))throw e;
        singleOnly=true;
        continue;
      }
      this.guard();cancelled(signal);
      const batch=wanted===1?[raw]:raw&&typeof raw==='object'&&!Array.isArray(raw)?(raw as {questions?:unknown[]}).questions:undefined;
      let accepted=0;
      if(Array.isArray(batch))for(const item of batch){
        if(questions.length>=count)break;
        if(accept(item,source)){
          // Persist each validated question before processing any more output.
          await save();progress(questions.length);accepted++;
        }
      }
      else lastReason='The model did not return a questions array.';
      if(accepted<wanted)singleOnly=true;
    }

    requireThat(questions.length >= 1, `Quiz generation stopped without a valid question after ${budget} attempts. ${lastReason||'The model returned no questions.'} Your saved work is retained; retry to resume.`);
    // A thin module may honestly support fewer questions than requested; keep useful grounded work.
    if(questions.length<count)detail?.(`${questions.length} grounded question(s) could be produced from this module.${lastReason?` Last rejection: ${lastReason}`:''}`);
    await this.book(bookId);this.guard();requireThat(!signal.aborted,'Cancelled');
    const version: QuizVersion = { id: checkpoint.id, bookId, sectionId, createdAt: new Date().toISOString(), requestedCount: count, questions };
    await d.put(`${this.work(bookId)}quiz:${sectionId}:${version.id}`, version); this.guard();await d.removePrefix(key); return version;
  }
  async attempts(bookId: string, quizId: string): Promise<PracticeResult[]> { await this.book(bookId); const rows = await (await device()).list<PracticeResult>(`${this.work(bookId)}attempt:${quizId}:`); this.guard(); return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); }
  async draft(bookId: string, quizId: string) { await this.book(bookId); const row = await (await device()).get<Record<string, number>>(`${this.work(bookId)}draft:${quizId}`); this.guard(); return row || {}; }
  async saveDraft(bookId: string, quizId: string, answers: Record<string, number>) { await this.book(bookId); this.guard(); await (await device()).put(`${this.work(bookId)}draft:${quizId}`, answers); this.guard(); }
  async check(quiz: QuizVersion, answers: Record<string, number>) {
    const stored = (await this.quizzes(quiz.bookId, quiz.sectionId)).find(q => q.id === quiz.id); requireThat(stored, 'The quiz version is not stored on this device');
    const result: PracticeResult = { id: randomUUID(), quizId: stored.id, createdAt: new Date().toISOString(), answers: { ...answers }, ...markQuiz(stored.questions, answers) };
    await (await device()).put(`${this.work(quiz.bookId)}attempt:${stored.id}:${result.id}`, result); this.guard(); return result;
  }
  async chats(bookId: string, sectionId: string) { await this.book(bookId); const rows = await (await device()).list<PrivateChat>(`${this.work(bookId)}chat:${sectionId}:`); this.guard(); return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  async ask(bookId: string, sectionId: string, question: string, signal: AbortSignal, progress?: (message:string)=>void) {
    generationJobs.requireDoubtsAvailable();
    const b = await this.book(bookId), s = b.sections.find(x => x.id === sectionId); requireThat(s, 'Choose a module'); requireThat(s.source.trim(), 'This page has no recognised text. View its original image; the text tutor cannot interpret image-only content.'); text(question, 1000, 'question');
    // Four turns, and the answers as well as the questions. A follow-up like
    // "explain this in detail" refers to the answer before it, which the model
    // could not see: it received earlier QUESTIONS only, so the safest thing it
    // could do was repeat itself or give up.
    const turns = (await this.chats(bookId, sectionId)).slice(-4);
    const previous = turns.filter(t => t.supported).slice(-1)[0];
    const followUp = isFollowUp(question) && !!previous;
    // A follow-up has no subject of its own, so searching the book with its own
    // words finds the wrong passage, or none. Search with the subject of the
    // conversation and the answer being asked about.
    const subject = followUp ? [...turns].reverse().find(t => !isFollowUp(t.question))?.question || '' : question;
    const transcript = turns.map(t => `STUDENT: ${t.question.slice(0, 250)}\nTUTOR: ${(t.answer || '').slice(0, 600)}`).join('\n\n');
    const d = await device(), reference = bookReference(b.sections, sectionId, followUp ? `${subject} ${previous!.answer}`.slice(0, 600) : question);
    generationJobs.requireDoubtsAvailable();
    // A follow-up is an instruction about the previous answer. Saying so, and
    // showing that answer, is what turns "in detail" into a fuller version
    // instead of the same paragraph or a refusal.
    const task = followUp
      ? `The student is asking you to rewrite YOUR PREVIOUS ANSWER, below, the way they describe. Do not repeat it unchanged and do not add anything the reference does not support. Follow their instruction: shorter means shorter, one line means one sentence, simpler means plainer words, in detail means more of what the reference says about it.\nYOUR PREVIOUS ANSWER:\n${previous!.answer}\nTHEIR INSTRUCTION:\n${question}`
      : `Answer the question from the reference alone, in at most 120 words. If the reference does not contain the answer, set supported=false.\nSTUDENT QUESTION:\n${question}`;
    const raw = await d.complete({ system: GROUNDING, prompt: `Use only this stored book reference. Everything you write must come from it.\nSTORED BOOK REFERENCE:\n${reference}\n\nCONVERSATION SO FAR:\n${transcript || '(none)'}\n\n${task}`, schema: groundedSchema(ANSWER_SCHEMA, reference, followUp ? `${subject} ${question}` : question), maxTokens: followUp ? 600 : 420, temperature: 0.1, signal, progress });
    const answer = validateAnswer(raw, reference); await this.book(bookId); requireThat(!signal.aborted, 'Cancelled');
    const row: PrivateChat = { id: randomUUID(), question, ...answer, createdAt: new Date().toISOString() };
    await d.put(`${this.work(bookId)}chat:${sectionId}:${row.id}`, row); this.guard(); return row;
  }
}
