import {resumeParts, type Checkpoint} from './performance';
import {generationJobs} from './jobs';
import { randomUUID } from 'expo-crypto';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { BASE_URL, currentSession, SessionChangedError } from '@/api/client';
import { device } from './device';
import { cancelled } from './busy';
import type { LocalFile } from './device.types';
import { MAX_READING_CHARS, MAX_SECTION_CHARS, ANSWER_SCHEMA, groundedSchema, GROUNDING, COMPACT_LESSON_SCHEMA, COMPACT_MCQ_SCHEMA, compactMcqBatchSchema, markQuiz, requireThat, bookReference, pageSource, lessonPassages, text, validateAnswer, validateBook, validateLesson, validateMCQ, type PrivateBook, type Lesson, type MCQ, type SourceVisual } from './core';
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
    let passages=lessonPassages(sourceText,2800);requireThat(passages.length,'This module has no readable text.');
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
        const raw=await d.complete({system:GROUNDING,prompt:`Teach this entire source passage in plain language. Explain its definitions, relationships, examples and formulas when present. Do not just name the main idea. Write one introductory sentence, one explanatory section and one takeaway. Each call covers one consecutive part of the module. Use an exact supporting quote.\nMODULE: ${section.title} — part ${index+1} of ${passages.length}\nSTORED BOOK REFERENCE:\n${source}`,schema:groundedSchema(COMPACT_LESSON_SCHEMA,source),maxTokens:800,temperature:0.2,signal,
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
    const focuses=[...new Set([...sources,...alternatives])].filter(source=>source.trim().length>=8);
    requireThat(focuses.length,'This module has too little readable text for a grounded quiz.');
    const questions=checkpoint.parts;progress(questions.length);
    const normalized=(value:string)=>value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    const duplicate=(question:string)=>[...excluded,...questions.map(q=>q.question)].some(q=>normalized(q)===normalized(question));
    let exhausted=0;

    const save=async()=>{this.guard();await d.put(key,{id:checkpoint.id,parts:[...questions]});this.guard();};
    let lastReason='';
    const accept=(raw:unknown,source:string):boolean=>{
      try {
        const question=validateMCQ(raw,source,sectionId,randomUUID());
        requireThat(!duplicate(question.question),'The model repeated a question already in this quiz.');
        questions.push(question);return true;
      } catch(e){ lastReason=e instanceof Error?e.message:String(e); return false; }
    };
    // Prefer passages no accepted question has quoted yet, so a multi-passage module
    // spreads its questions instead of mining the same paragraph repeatedly.
    const unusedFocuses=()=>{const fresh=focuses.filter(s=>!questions.some(q=>s.includes(q.quote)));return fresh.length?fresh:focuses;};

    while(questions.length<count) {
      this.guard();requireThat(!signal.aborted,'Cancelled. Your earlier quizzes are unchanged.');
      const remaining=count-questions.length;
      const wanted=Math.min(3,remaining);
      const pool=unusedFocuses();
      const source=pool[(Math.floor(questions.length*pool.length/count)+exhausted)%pool.length];
      const avoid=[...excluded,...questions.map(q=>q.question)].map(q=>q.slice(0,160)).join('\n');
      let accepted=0;
      try {
        detail?.(`Questions ${questions.length+1}-${questions.length+wanted}/${count} · preparing one local AI batch`);
        const raw=await d.complete({system:GROUNDING,prompt:`Write exactly ${wanted} useful, DISTINCT multiple-choice practice questions from this module reference. Each question needs exactly four distinct answer choices, a zero-based answer index (0-3), a concise explanation (at most 40 words), and an exact supporting quote. Options must contain answer text only; never prefix A/B/C/D or 1/2/3/4. Test different specific facts rather than repeating the module title or asking whether a sentence appears in the book.\nDo not repeat these already accepted questions:\n${avoid}\nSTORED BOOK REFERENCE:\n${source}`,schema:groundedSchema(compactMcqBatchSchema(wanted),source),maxTokens:wanted===3?1200:wanted===2?850:550,temperature:0.25,signal,progress:message=>detail?.(`Quiz ${questions.length}/${count} · ${message}`)});
        const batch=raw&&typeof raw==='object'&&!Array.isArray(raw)?(raw as {questions?:unknown[]}).questions:undefined;
        if(Array.isArray(batch))for(const item of batch){if(questions.length>=count)break;if(accept(item,source))accepted++;}
      } catch (e) {
        if(signal.aborted || /timed out|storage|quota/i.test(String(e))) throw e;
        detail?.('Batch generation needed a targeted retry.');
      }

      if(accepted){await save();progress(questions.length);exhausted=0;}
      // Only regenerate missing/invalid items. This is deliberately individual so one
      // bad item never throws away a good batch.
      const missing=Math.min(wanted-accepted,count-questions.length);
      let repairedAny=false;
      for(let i=0;i<missing;i++){
        let repaired=false;
        for(let attempt=0;attempt<2&&!repaired;attempt++){
          this.guard();requireThat(!signal.aborted,'Cancelled. Your earlier quizzes are unchanged.');
          const retryPool=unusedFocuses();
          const retrySource=retryPool[(questions.length+attempt+exhausted)%retryPool.length];
          const retryAvoid=[...excluded,...questions.map(q=>q.question)].map(q=>q.slice(0,160)).join('\n');
          try {
            detail?.(`Question ${questions.length+1}/${count} · repairing only the missing item (${attempt+1}/2)`);
            const raw=await d.complete({system:GROUNDING,prompt:`Write ONE useful multiple-choice practice question. Exactly four distinct options; answer is a zero-based index (0-3). Options are answer text only with no A/B/C/D labels. Include a concise explanation and an exact source quote. Test a specific fact not already covered.${lastReason?` Fix this previous validation problem: ${lastReason.slice(0,240)}.`:''}\nDo not repeat these questions:\n${retryAvoid}\nSTORED BOOK REFERENCE:\n${retrySource}`,schema:groundedSchema(COMPACT_MCQ_SCHEMA,retrySource),maxTokens:450,temperature:0.3+attempt*0.1,signal,progress:message=>detail?.(`Question ${questions.length+1}/${count} · ${message}`)});
            repaired=accept(raw,retrySource);
            if(repaired){repairedAny=true;await save();progress(questions.length);}
          } catch(e){if(signal.aborted||/timed out|storage|quota/i.test(String(e)))throw e;}
        }
        // Two attempts failed on this item. Repeating them for every missing
        // slot repeats the same work; let the next round choose another passage.
        if(!repaired)break;
      }
      if(!accepted && !repairedAny && questions.length<count){
        if(++exhausted>=2)break;
      } else exhausted=0;
      if(questions.length>=count)break;
    }

    requireThat(questions.length >= 1, 'No question could be generated from this module. Its source is too thin or too repetitive for a grounded quiz.');
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
    const history = (/\b(it|that|this|they|those|these|why|more)\b/i.test(question) ? (await this.chats(bookId, sectionId)).slice(-1) : []).map(h => `Earlier question: ${h.question.slice(0, 300)}`).join('\n');
    const d = await device(), reference = bookReference(b.sections, sectionId, question);
    generationJobs.requireDoubtsAvailable();
    const raw = await d.complete({ system: GROUNDING, prompt: `Answer concisely in at most 120 words, using only this reference. If it does not contain the answer, set supported=false.\nSTORED BOOK REFERENCE:\n${reference}\n${history}\nSTUDENT QUESTION:\n${question}`, schema: groundedSchema(ANSWER_SCHEMA, reference, question), maxTokens: 420, temperature: 0.1, signal, progress });
    const answer = validateAnswer(raw, reference); await this.book(bookId); requireThat(!signal.aborted, 'Cancelled');
    const row: PrivateChat = { id: randomUUID(), question, ...answer, createdAt: new Date().toISOString() };
    await d.put(`${this.work(bookId)}chat:${sectionId}:${row.id}`, row); this.guard(); return row;
  }
}
