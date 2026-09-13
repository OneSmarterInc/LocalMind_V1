import * as SQLite from 'expo-sqlite';
import nacl from 'tweetnacl';
import { verifyPackage, fromBase64, type Package, type Learner, type ObservationEvent, INITIAL_LEARNER, requireThat } from './core';

export async function openStudyStore() {
  const db = await SQLite.openDatabaseAsync('localmind-private-study.db');
  await db.execAsync(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS packages (id TEXT NOT NULL, version INTEGER NOT NULL, envelope TEXT NOT NULL, payload TEXT NOT NULL, title TEXT NOT NULL, PRIMARY KEY(id,version));
    CREATE TABLE IF NOT EXISTS active_packages (id TEXT PRIMARY KEY, version INTEGER NOT NULL, FOREIGN KEY(id,version) REFERENCES packages(id,version));
    CREATE TABLE IF NOT EXISTS trust_keys (id TEXT PRIMARY KEY, public_key TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS learner (block_id TEXT NOT NULL, revision INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(block_id,revision));
    CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, event TEXT NOT NULL);`);
  // All writes pass through this queue. Model calls/network calls never hold a transaction.
  let tail: Promise<unknown> = Promise.resolve();
  function write<T>(work: (tx: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
    const next = tail.then(async () => { let result: T; await db.withExclusiveTransactionAsync(async tx => { result = await work(tx); }); return result!; });
    tail = next.catch(() => {}); return next;
  }
  const trusted = async () => Object.fromEntries((await db.getAllAsync<{ id: string; public_key: string }>('SELECT id,public_key FROM trust_keys')).map(r => [r.id, r.public_key]));
  const sharing = async () => (await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE id='sharing'"))?.value === 'yes';
  return {
    db,
    trusted,
    async trust(id: string, key: string) {
      requireThat(/^[A-Za-z0-9._-]{1,80}$/.test(id) && fromBase64(key).length === 32, 'Invalid publisher public key');
      await write(async tx => { await tx.runAsync('INSERT INTO trust_keys(id,public_key) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET public_key=excluded.public_key', id, key); });
    },
    async install(raw: string): Promise<Package> {
      const verified = verifyPackage(raw, await trusted(), (m, s, k) => nacl.sign.detached.verify(m, s, k));
      const p = verified.content;
      await write(async tx => {
        const same = await tx.getFirstAsync<{ payload: string }>('SELECT payload FROM packages WHERE id=? AND version=?', p.package_id, p.version);
        requireThat(!same || same.payload === verified.envelope.payload, 'This package version already exists with different content. It was not overwritten.');
        await tx.runAsync('INSERT OR IGNORE INTO packages(id,version,envelope,payload,title) VALUES(?,?,?,?,?)', p.package_id, p.version, raw, verified.envelope.payload, p.title);
      });
      // Import does NOT activate: changing the studied revision requires explicit confirmation.
      return p;
    },
    async activate(id: string, version: number) {
      await write(async tx => {
        requireThat(await tx.getFirstAsync('SELECT id FROM packages WHERE id=? AND version=?', id, version), 'Install the package first');
        await tx.runAsync('INSERT INTO active_packages(id,version) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version', id, version);
      });
    },
    async packages() { return db.getAllAsync<{ id: string; version: number; title: string; active: number }>('SELECT p.id,p.version,p.title,CASE WHEN a.version=p.version THEN 1 ELSE 0 END AS active FROM packages p LEFT JOIN active_packages a ON a.id=p.id ORDER BY p.title,p.version DESC'); },
    async content(id: string, version: number): Promise<Package> {
      const row = await db.getFirstAsync<{ envelope: string }>('SELECT envelope FROM packages WHERE id=? AND version=?', id, version);
      requireThat(row, 'Package not installed');
      // Reverify at session entry; never treat modified local bytes as publisher-signed.
      return verifyPackage(row.envelope, await trusted(), (m, s, k) => nacl.sign.detached.verify(m, s, k)).content;
    },
    async learner(blockId: string, revision: number): Promise<Learner> {
      const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM learner WHERE block_id=? AND revision=?', blockId, revision);
      return row ? JSON.parse(row.value) as Learner : { ...INITIAL_LEARNER };
    },
    async remember(blockId: string, revision: number, value: Learner) {
      await write(async tx => { await tx.runAsync('INSERT INTO learner(block_id,revision,value) VALUES(?,?,?) ON CONFLICT(block_id,revision) DO UPDATE SET value=excluded.value', blockId, revision, JSON.stringify({ needsPractice: value.needsPractice, clarifications: Math.min(100, value.clarifications), lastMove: value.lastMove })); });
    },
    sharing,
    async setSharing(on: boolean) {
      await write(async tx => {
        await tx.runAsync("INSERT INTO settings(id,value) VALUES('sharing',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", on ? 'yes' : 'no');
        if (!on) await tx.runAsync('DELETE FROM outbox');
      });
    },
    async record(event: ObservationEvent) {
      await write(async tx => {
        const on = await tx.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE id='sharing'");
        if (on?.value !== 'yes') return;
        await tx.runAsync('INSERT OR IGNORE INTO outbox(id,event) VALUES(?,?)', event.id, JSON.stringify(event));
        await tx.runAsync('DELETE FROM outbox WHERE rowid NOT IN (SELECT rowid FROM outbox ORDER BY rowid DESC LIMIT 1000)');
      });
    },
    async pending() { return (await db.getAllAsync<{ event: string }>('SELECT event FROM outbox ORDER BY rowid LIMIT 50')).map(r => JSON.parse(r.event) as ObservationEvent); },
    async acknowledge(ids: string[]) { await write(async tx => { for (const id of ids) await tx.runAsync('DELETE FROM outbox WHERE id=?', id); }); },
    async resetLearner() { await write(async tx => { await tx.runAsync('DELETE FROM learner'); await tx.runAsync('DELETE FROM outbox'); }); },
    async setModelUri(uri: string) { await write(async tx => { await tx.runAsync("INSERT INTO settings(id,value) VALUES('model',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", uri); }); },
    async modelUri() { return (await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE id='model'"))?.value ?? null; },
    async close() { await tail; await db.closeAsync(); },
  };
}
export type StudyStore = Awaited<ReturnType<typeof openStudyStore>>;
