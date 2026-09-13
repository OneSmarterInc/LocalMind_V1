import * as SQLite from "expo-sqlite";
import { BLOCK, QUESTION, FIXTURE_VERSION } from "./fixture";
import type { LocalSourceStore, PracticeQuestion, SourceBlock } from "./prompts";

export async function openStore() {
  const db = await SQLite.openDatabaseAsync("localmind-device-spike.db");
  await db.execAsync(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS blocks (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, block_id TEXT NOT NULL, prompt TEXT NOT NULL, rubric TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS benchmark_runs (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, fixture TEXT NOT NULL, metadata TEXT NOT NULL);`);
  await db.withTransactionAsync(async () => {
    await db.runAsync("INSERT OR IGNORE INTO blocks(id, revision, title, body) VALUES(?,?,?,?)", BLOCK.id, BLOCK.revision, BLOCK.title, BLOCK.text);
    await db.runAsync("INSERT OR IGNORE INTO questions(id, block_id, prompt, rubric) VALUES(?,?,?,?)", QUESTION.id, QUESTION.blockId, QUESTION.prompt, JSON.stringify(QUESTION.rubric));
  });
  const source: LocalSourceStore = {
    async block(id) {
      const row = await db.getFirstAsync<{ id: string; revision: number; title: string; body: string }>("SELECT * FROM blocks WHERE id=?", id);
      return row ? { id: row.id, revision: row.revision, title: row.title, text: row.body } satisfies SourceBlock : null;
    },
    async question(id) {
      const row = await db.getFirstAsync<{ id: string; block_id: string; prompt: string; rubric: string }>("SELECT * FROM questions WHERE id=?", id);
      return row ? { id: row.id, blockId: row.block_id, prompt: row.prompt, rubric: JSON.parse(row.rubric) } satisfies PracticeQuestion : null;
    },
  };
  return { source,
    // Only timings/configuration for SYNTHETIC cases. No actual student
    // question, answer, model output, account identity, grade or learner model.
    async record(metadata: Record<string, unknown>) {
      await db.runAsync("INSERT INTO benchmark_runs(created_at,fixture,metadata) VALUES(?,?,?)", new Date().toISOString(), FIXTURE_VERSION, JSON.stringify(metadata));
    },
    async report() { return db.getAllAsync<{ created_at: string; fixture: string; metadata: string }>("SELECT created_at,fixture,metadata FROM benchmark_runs ORDER BY id"); },
    async clearMeasurements() { await db.runAsync("DELETE FROM benchmark_runs"); },
    close: () => db.closeAsync(),
  };
}
