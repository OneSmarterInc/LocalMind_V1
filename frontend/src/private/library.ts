import {resumeParts, type Checkpoint} from './performance';
import {generationJobs} from './jobs';
import { randomUUID } from 'expo-crypto';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { BASE_URL, currentSession, SessionChangedError } from '@/api/client';
import { device } from './device';
import { cancelled } from './busy';
import type { LocalFile } from './device.types';
import { MAX_READING_CHARS, MAX_SECTION_CHARS, ANSWER_SCHEMA, groundedSchema, GROUNDING, COMPACT_LESSON_SCHEMA, COMPACT_MCQ_SCHEMA, markQuiz, requireThat, bookReference, pageSource, lessonPassages, text, validateAnswer, validateBook, validateLesson, validateMCQ, type PrivateBook, type Lesson, type MCQ, type SourceVisual } from './core';
export type QuizVersion = { id: string; bookId: string; sectionId: string; createdAt: string; questions: MCQ[] };
export type LessonVersion = { id: string; sectionId: string; createdAt: string; lesson: Lesson };
export type PracticeResult = { id: string; quizId: string; createdAt: string; answers: Record<string, number> } & ReturnType<typeof markQuiz>;
export type PrivateChat = { id: string; question: string; answer: string; quote: string; supported: boolean; createdAt: string };
export const fingerprint = (s: string) => bytesToHex(sha256(utf8ToBytes(s)));

/** Separate storage namespace from ERP downloads. No private record is synchronized. */
export class Library {
  readonly prefix: string;
  private session: number;
  constructor(readonly owner: string, domain: 'private'|'authoring' = 'private') {
    requireThat(!!owner, 'Sign in on this device to open your private library');
    this.prefix = `${domain}:${fingerprint(`${BASE_URL}|${owner}`)}:`; this.session = currentSession();
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
    let passages=lessonPassages(sourceText,2800);requireThat(passages.length,'This module has no readable text.');
    const d=await device(), model=await d.status();
    const lessonKey=(parts:string[])=>`${this.work(bookId)}checkpoint:lesson:${sectionId}:${fingerprint(JSON.stringify({version:1,passages:parts,title:section.title,model:model.hash||model.name}))}:`;
    // Finish existing 800-character checkpoints before using larger passages.
    const legacyPassages=lessonPassages(sourceText);
    if(await d.get(lessonKey(legacyPassages)))passages=legacyPassages;
    const key=lessonKey(passages);
    const checkpoint=await d.get<Checkpoint<Lesson>>(key)||{id:randomUUID(),parts:[]};
    const parts=await resumeParts({checkpoint,total:passages.length,signal,
      save:async row=>{this.guard();await d.put(key,row);this.guard();},
      progress:done=>progress?.(`${done} of ${passages.length} lesson parts saved. Generate again after an interruption to resume.`),
      generate:async index=>{
        this.guard();const source=passages[index];
        const raw=await d.complete({system:GROUNDING,prompt:`Teach this entire source passage in plain language. Explain its definitions, relationships, examples and formulas when present. Do not just name the main idea. Write one introductory sentence, one explanatory section and one takeaway. Each call covers one consecutive part of the module. Use an exact supporting quote.\nMODULE: ${section.title} — part ${index+1} of ${passages.length}\nSTORED BOOK REFERENCE:\n${source}`,schema:groundedSchema(COMPACT_LESSON_SCHEMA,source),maxTokens:700,temperature:0.2,signal,
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
    const sources=lessonPassages(pageSource(book.sections,sectionId),2400); requireThat(sources.length,'No readable source was extracted. Check the original page and import it again.');
    const d = await device(), model=await d.status();
    const key=`${this.work(bookId)}checkpoint:quiz:${sectionId}:${fingerprint(JSON.stringify({version:1,sources,count,model:model.hash||model.name,...(excluded.length?{excluded}:{})}))}:`;
    const checkpoint=await d.get<Checkpoint<MCQ>&{retryCursor?:number}>(key)||{id:randomUUID(),parts:[]};
    const primary=sources.flatMap(source=>lessonPassages(source,900));
    // A section quota must not trap authoring on a heading or exhausted passage.
    // Callers may provide the rest of this SAME module, never another module.
    const alternatives=moduleSource?lessonPassages(moduleSource,900):[];
    const focuses=[...new Set([...primary,...alternatives])].filter(source=>source.trim().length>=8);
    requireThat(focuses.length,'This module has too little readable text for a grounded quiz.');
    const questions=checkpoint.parts;progress(questions.length);
    // The minimum worth saving. A thin module (a page of chapter objectives)
    // honestly holds two or three distinct questions, not six; without a floor
    // the loop below ground through every attempt for every missing question,
    // failing each time, so a finished 2-question quiz sat "Working" for a
    // minute before giving up. Once we have this many, running dry is success,
    // not failure — we keep what we have and stop.
    const floor=Math.min(count,2);
    // A hard ceiling on wasted work. Two consecutive questions that each burn
    // all their attempts means the module is exhausted; there is no point
    // asking a thin module the same thing eight more ways. This caps the tail
    // no matter what, so a job always finishes promptly instead of hanging.
    let emptyRuns=0;
    for (let n = questions.length; n < count; n++) {
      let lastError: unknown;
      const retryStart=checkpoint.retryCursor||0;
      for (let attempt = 0; attempt < 3; attempt++) {
        this.guard(); requireThat(!signal.aborted, 'Cancelled. Your earlier quizzes are unchanged.');
        try {
          const offset=Math.floor(n*focuses.length/count)+retryStart+attempt;
          const unused=focuses.filter(source=>!questions.some(q=>source.includes(q.quote)));
          const candidates=unused.length?unused:focuses;
          const source=candidates[offset%candidates.length];
          const avoid = [...excluded,...questions.map(q => q.question)].map(q => q.slice(0, 160)).join('\n');
          const raw = await d.complete({ system: GROUNDING, prompt: `Write ONE useful multiple-choice practice question. Exactly four distinct options; answer is a zero-based index (0–3). Write each option as the answer text ONLY — never begin an option with \"A.\", \"B)\", \"1.\" or any other label, because the app adds the letters itself. Include a short explanation (at most 40 words) and an exact source quote. Keep the question and choices concise. Do not simply test whether a sentence appears in the book. Choose a specific fact from the supplied reference that has not been tested, and ask about that fact rather than the module title. If the reference is itself a list of objectives or outcomes, ask about the substance of one of them.\nDo not repeat these questions already accepted in THIS quiz:\n${avoid}\nSTORED BOOK REFERENCE:\n${source}\nQuestion ${n + 1}; attempt ${retryStart + attempt + 1}.`, schema: groundedSchema(COMPACT_MCQ_SCHEMA, source), maxTokens: 450, temperature: 0.25 + attempt * 0.15, signal, progress:message=>detail?.(`Question ${n+1}/${count} · ${message}`) });
          const question = validateMCQ(raw, source, sectionId, randomUUID());
          requireThat(! [...excluded,...questions.map(q=>q.question)].some(q => q.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim() === question.question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()), `The model could not produce another distinct question. ${questions.length} of ${count} questions are saved. Select Generate quiz again to resume.`);
          this.guard();cancelled(signal);
          await d.put(key,{id:checkpoint.id,parts:[...questions,question]});this.guard();
          questions.push(question); checkpoint.retryCursor=0; lastError = undefined; break;
        } catch (e) {
          lastError = e; if (signal.aborted || /timed out|storage|quota/i.test(String(e))) throw e;
          checkpoint.retryCursor=retryStart+attempt+1;
          this.guard();await d.put(key,checkpoint);this.guard();
          detail?.(`Question ${n+1}/${count}: retrying with another passage (${attempt+1}/3).`);
        }
      }
      // Ran out of attempts for this question. If we already have enough to be
      // a usable quiz, stop here and keep them — the module simply has no more
      // distinct questions in it, which is a finished quiz, not an error. Only
      // when we have too few to be worth anything do we surface the failure.
      if (lastError) {
        if (questions.length >= floor) break;
        // Two questions in a row that burned every attempt means the module is
        // exhausted. This used to rethrow, which threw away the questions that
        // HAD been written: a module that honestly holds one good question was
        // reported as a failure and left with nothing. Stop instead, and keep
        // what was written for the reviewer to judge.
        if (++emptyRuns >= 2) break;
        continue;
      }
      emptyRuns=0;
      progress(n + 1);
    }
    // One real question is a short quiz for a reviewer to look at. Nothing at all
    // is a failure. The bar used to be ``floor`` here as well, so a finished
    // one-question quiz on a thin module was discarded and the module was marked
    // Failed — a content limit reported as a software fault.
    requireThat(questions.length >= 1, 'No question could be generated from this module. Its source is too thin or too repetitive for a grounded quiz.'); await this.book(bookId); this.guard(); requireThat(!signal.aborted, 'Cancelled');
    const version: QuizVersion = { id: checkpoint.id, bookId, sectionId, createdAt: new Date().toISOString(), questions };
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
    const b = await this.book(bookId), s = b.sections.find(x => x.id === sectionId); requireThat(s, 'Choose a module'); requireThat(s.source.trim(), 'This page has no recognised text. View its original image; the text tutor cannot interpret image-only content.'); text(question, 1000, 'question');
    const history = (/\b(it|that|this|they|those|these|why|more)\b/i.test(question) ? (await this.chats(bookId, sectionId)).slice(-1) : []).map(h => `Earlier question: ${h.question.slice(0, 300)}`).join('\n');
    const d = await device(), reference = bookReference(b.sections, sectionId, question);
    const raw = await d.complete({ system: GROUNDING, prompt: `Answer concisely in at most 120 words, using only this reference. If it does not contain the answer, set supported=false.\nSTORED BOOK REFERENCE:\n${reference}\n${history}\nSTUDENT QUESTION:\n${question}`, schema: groundedSchema(ANSWER_SCHEMA, reference, question), maxTokens: 420, temperature: 0.1, signal, progress });
    const answer = validateAnswer(raw, reference); await this.book(bookId); requireThat(!signal.aborted, 'Cancelled');
    const row: PrivateChat = { id: randomUUID(), question, ...answer, createdAt: new Date().toISOString() };
    await d.put(`${this.work(bookId)}chat:${sectionId}:${row.id}`, row); this.guard(); return row;
  }
}
