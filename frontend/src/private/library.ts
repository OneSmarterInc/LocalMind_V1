import { randomUUID } from 'expo-crypto';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { BASE_URL, currentSession, SessionChangedError } from '@/api/client';
import { device } from './device';
import { cancelled } from './busy';
import type { LocalFile } from './device.types';
import { ANSWER_SCHEMA, groundedSchema, GROUNDING, COMPACT_LESSON_SCHEMA, COMPACT_MCQ_SCHEMA, markQuiz, requireThat, retrieve, text, validateAnswer, validateBook, validateLesson, validateMCQ, type PrivateBook, type Lesson, type MCQ, type SourceVisual } from './core';
export type QuizVersion = { id: string; bookId: string; sectionId: string; createdAt: string; questions: MCQ[] };
export type LessonVersion = { id: string; sectionId: string; createdAt: string; lesson: Lesson };
export type PracticeResult = { id: string; quizId: string; createdAt: string; answers: Record<string, number> } & ReturnType<typeof markQuiz>;
export type PrivateChat = { id: string; question: string; answer: string; quote: string; supported: boolean; createdAt: string };
export const fingerprint = (s: string) => bytesToHex(sha256(utf8ToBytes(s)));

/** Separate storage namespace from ERP downloads. No private record is synchronized. */
export class Library {
  readonly prefix: string;
  private session: number;
  constructor(readonly owner: string) {
    requireThat(!!owner, 'Sign in on this device to open your private library');
    this.prefix = `private:${fingerprint(`${BASE_URL}|${owner}`)}:`; this.session = currentSession();
  }
  guard() { if (currentSession() !== this.session) throw new SessionChangedError(); }
  private key(book: string) { return `${this.prefix}book:${book}`; }
  private work(book: string) { return `${this.prefix}work:${book}:`; }
  async books(): Promise<PrivateBook[]> { this.guard(); const rows = await (await device()).list<PrivateBook>(`${this.prefix}book:`); this.guard(); return rows.map(validateBook).sort((a, b) => b.importedAt.localeCompare(a.importedAt)); }
  async book(id: string) { this.guard(); requireThat(/^[a-f0-9]{64}$/.test(id), 'Invalid private book ID'); const b = await (await device()).get<PrivateBook>(this.key(id)); this.guard(); requireThat(b, 'This book is no longer in your private library'); return validateBook(b); }
  async import(file: LocalFile, shared?: { id: string; title: string; sha256?: string }, signal?: AbortSignal, progress?: (message: string) => void) {
    cancelled(signal); this.guard(); progress?.("Reading book on this device…"); const d = await device(); const parsed = await d.parse(file, signal, progress); this.guard(); cancelled(signal);
    if (shared?.sha256) requireThat(parsed.hash === shared.sha256, 'Downloaded book checksum mismatch. Nothing was imported.');
    const original = await d.get<PrivateBook>(this.key(parsed.hash)); this.guard();
    // Re-importing pre-OCR content creates a new revision without breaking its saved lessons/attempts.
    const upgraded = !!original && original.importVersion !== 2;
    const id = upgraded ? fingerprint(`${parsed.hash}|source-images-v2`) : parsed.hash;
    const existing = await d.get<PrivateBook>(this.key(id)); this.guard(); if (existing) return { book: validateBook(existing), duplicate: true };
    const book: PrivateBook = { importVersion: 2, assetSet: randomUUID(), id, title: ((shared?.title || file.name.replace(/\.[^.]+$/, '')) + (upgraded ? ' · new extraction' : '')).slice(0, 300), originalName: file.name, importedAt: new Date().toISOString(), origin: shared ? 'shared' : 'personal', ...(shared ? { sourceId: shared.id } : {}), sections: parsed.sections, warnings: [...parsed.warnings, ...(upgraded ? ['The earlier import and its practice history are unchanged. This copy uses the new extraction.'] : [])] };
    // Store assets separately so listing books does not load every page bitmap.
    const assetPrefix = `${this.work(id)}visual:${book.assetSet}:`;
    try {
      for (const [index, visual] of (parsed.visuals || []).entries()) { progress?.(`Saving image ${index + 1} of ${parsed.visuals?.length} on this device`); this.guard(); cancelled(signal); await d.put(`${assetPrefix}${visual.id}`, visual); }
      this.guard(); cancelled(signal); await d.put(this.key(id), validateBook(book));
    } catch (e) { await d.removePrefix(assetPrefix); throw e; }
    this.guard(); return { book, duplicate: false };
  }
  async remove(id: string) { await this.book(id); this.guard(); const d = await device(); await d.removePrefix(this.key(id)); await d.removePrefix(this.work(id)); this.guard(); }
  async visuals(bookId: string, sectionId: string): Promise<SourceVisual[]> {
    const book = await this.book(bookId), section = book.sections.find(s => s.id === sectionId);
    requireThat(section, 'Choose a module in this book'); const d = await device();
    const rows = await Promise.all((section.visualIds || []).map(id => d.get<SourceVisual>(`${this.work(bookId)}visual:${book.assetSet}:${id}`)));
    this.guard(); requireThat(rows.every(Boolean), 'A source image is missing. Import the book again.');
    return rows as SourceVisual[];
  }
  async lessons(bookId: string, sectionId: string) { await this.book(bookId); const rows = await (await device()).list<LessonVersion>(`${this.work(bookId)}lesson:${sectionId}:`); this.guard(); return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async quizzes(bookId: string, sectionId: string) { await this.book(bookId); const rows = await (await device()).list<QuizVersion>(`${this.work(bookId)}quiz:${sectionId}:`); this.guard(); return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async generateLesson(bookId: string, sectionId: string, signal: AbortSignal) {
    const book = await this.book(bookId); const section = book.sections.find(s => s.id === sectionId); requireThat(section, 'Choose a module in this book');
    const d = await device();
    const raw = await d.complete({ system: GROUNDING, prompt: `Explain the key idea in this module. Write one short introductory sentence, exactly ONE explanatory section (at most 60 words) with an exact supporting quote, and ONE short takeaway. Do not repeat the quote in the explanation.\nMODULE: ${section.title}\nSTORED BOOK REFERENCE:\n${section.source}`, schema: groundedSchema(COMPACT_LESSON_SCHEMA, section.source), maxTokens: 520, temperature: 0.2, signal });
    const lesson = validateLesson(raw, section.source); this.guard(); requireThat(!signal.aborted, 'Cancelled'); await this.book(bookId);
    const version: LessonVersion = { id: randomUUID(), sectionId, createdAt: new Date().toISOString(), lesson };
    await d.put(`${this.work(bookId)}lesson:${sectionId}:${version.id}`, version); this.guard(); return version;
  }
  async generateQuiz(bookId: string, sectionId: string, count: number, signal: AbortSignal, progress: (done: number) => void) {
    requireThat(Number.isInteger(count) && count >= 1 && count <= 10, 'Choose between 1 and 10 questions');
    const book = await this.book(bookId); const section = book.sections.find(s => s.id === sectionId); requireThat(section, 'Choose a module');
    requireThat(section.source.length >= count * 150, `This short module may not support ${count} distinct questions. Choose fewer questions.`);
    const d = await device(), questions: MCQ[] = []; const previous = (await this.quizzes(bookId, sectionId))[0];
    for (let n = 0; n < count; n++) {
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        this.guard(); requireThat(!signal.aborted, 'Cancelled. Your earlier quizzes are unchanged.');
        try {
          const avoid = [...questions.map(q => q.question), ...(previous?.questions.map(q => q.question) || [])].slice(-12).map(q => q.slice(0, 100)).join('\n');
          const raw = await d.complete({ system: GROUNDING, prompt: `Write ONE useful multiple-choice practice question. Exactly four distinct options; answer is a zero-based index (0–3). Include a short explanation (at most 40 words) and an exact source quote. Keep the question and choices concise. Do not simply test whether a sentence appears in the book. Avoid repeating these earlier questions:\n${avoid}\nSTORED BOOK REFERENCE:\n${section.source}\nQuestion ${n + 1}; attempt ${attempt + 1}.`, schema: groundedSchema(COMPACT_MCQ_SCHEMA, section.source), maxTokens: 520, temperature: 0.2, signal });
          const question = validateMCQ(raw, section.source, sectionId, randomUUID());
          requireThat(![...questions,...(previous?.questions || [])].some(q => q.question.toLowerCase().trim() === question.question.toLowerCase().trim()), 'The AI repeated a question. Try fewer questions or another module.');
          questions.push(question); lastError = undefined; break;
        } catch (e) { lastError = e; if (signal.aborted) throw e; }
      }
      if (lastError) throw lastError; progress(n + 1);
    }
    requireThat(questions.length === count, 'Incomplete quiz: nothing was saved'); await this.book(bookId); this.guard(); requireThat(!signal.aborted, 'Cancelled');
    const version: QuizVersion = { id: randomUUID(), bookId, sectionId, createdAt: new Date().toISOString(), questions };
    await d.put(`${this.work(bookId)}quiz:${sectionId}:${version.id}`, version); this.guard(); return version;
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
  async ask(bookId: string, sectionId: string, question: string, signal: AbortSignal) {
    const b = await this.book(bookId), s = b.sections.find(x => x.id === sectionId); requireThat(s, 'Choose a module'); requireThat(s.source.trim(), 'This page has no recognised text. View its original image; the text tutor cannot interpret image-only content.'); text(question, 1000, 'question');
    const history = (await this.chats(bookId, sectionId)).slice(-2).map(h => `Earlier question: ${h.question.slice(0, 300)}`).join('\n');
    const d = await device(), reference = retrieve(s.source, question);
    const raw = await d.complete({ system: GROUNDING, prompt: `Answer the student's question only from this reference. If it does not contain the answer, set supported=false.\nSTORED BOOK REFERENCE:\n${reference}\n${history}\nSTUDENT QUESTION:\n${question}`, schema: ANSWER_SCHEMA, maxTokens: 650, temperature: 0.1, signal });
    const answer = validateAnswer(raw, reference); await this.book(bookId); requireThat(!signal.aborted, 'Cancelled');
    const row: PrivateChat = { id: randomUUID(), question, ...answer, createdAt: new Date().toISOString() };
    await d.put(`${this.work(bookId)}chat:${sectionId}:${row.id}`, row); this.guard(); return row;
  }
}
