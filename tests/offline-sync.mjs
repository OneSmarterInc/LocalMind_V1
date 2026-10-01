// Offline copy refresh. It used to run every minute: staff fetched the whole
// teaching corpus one request at a time (about 260 a minute for a two-book
// teacher) and rewrote storage each time, and students downloaded the whole
// course. Now: a full refresh every 15 minutes while on screen, queued course
// work retried every minute, nothing while hidden, no timed refresh under Data
// Saver, storage rewritten only when the copy changed, and students get an
// "unchanged" answer instead of the course again.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'frontend/package.json'));
const {build} = require('esbuild');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localmind-sync-'));
process.on('exit', () => fs.rmSync(tmp, {recursive:true, force:true}));
const w = globalThis.__sync = {state:'active', calls:[], replaced:0, events:[], flushed:0, staff:{'/faculty/subjects/':[1]}, server:null, store:{}};
const stubs = {
  'react': `export const useEffect=()=>{};export const useState=v=>[v,()=>{}];`,
  'react-native': `export const AppState={get currentState(){return globalThis.__sync.state}};`,
  '@/api/client': `export const currentSession=()=>1;export async function api(path,opts){globalThis.__sync.calls.push({path,query:opts&&opts.query});return globalThis.__sync.server(opts&&opts.query);}`,
  './connectivity': `export const onConnectivityChange=()=>()=>{};`,
  './store': `const s=globalThis.__sync.store;export const META={version:'meta:version',lastSync:'meta:last'};export const offlineScope=()=>'u1';
    export async function readEntry(k){return s[k];}export async function writeEntry(k,v){s[k]=v;}export async function replaceEntries(){globalThis.__sync.replaced++;}`,
  './staffBundle': `export async function staffBundle(){return JSON.parse(JSON.stringify(globalThis.__sync.staff));}`,
  './coursework': `export async function courseEvents(){return globalThis.__sync.events;}export async function flushCourseWork(){globalThis.__sync.flushed++;globalThis.__sync.events=[];}`,
};
const outfile = path.join(tmp, 'sync.cjs');
await build({entryPoints:[path.join(root,'frontend/src/offline/sync.ts')], outfile, bundle:true, platform:'node', format:'cjs', logLevel:'silent',
  plugins:[{name:'stubs', setup(b){ b.onResolve({filter:/.*/}, a => Object.hasOwn(stubs, a.path) ? {path:a.path, namespace:'stub'} : undefined);
    b.onLoad({filter:/.*/, namespace:'stub'}, a => ({contents:stubs[a.path], loader:'js'})); }}]});
const sync = require(outfile);
let now = 1_000_000_000_000; Date.now = () => now;
const reset = () => { w.calls = []; w.replaced = 0; w.flushed = 0; for (const k of Object.keys(w.store)) delete w.store[k]; };

test('student: the saved version is sent, and an unchanged answer is not written again', async () => {
  reset();
  w.server = q => q && q.since === 'v1' ? {version:'v1', generated_at:'x', unchanged:true} : {version:'v1', generated_at:'x', entries:{'/student/subjects/':[1]}};
  await sync.startOfflineSync('student'); await new Promise(r => setTimeout(r, 0)); sync.stopOfflineSync();
  await sync.startOfflineSync('student'); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(w.calls.map(c => c.query), [undefined, {since:'v1'}]);
  assert.equal(w.replaced, 1, 'the course is written once, not again when unchanged');
  assert.ok(w.store['meta:last'], 'the time of the last sync is still recorded');
  sync.stopOfflineSync();
});

test('staff: the version is a fingerprint of the copy, so an unchanged copy is not rewritten', async () => {
  reset();
  assert.equal(sync.copyVersion({a:[1]}), sync.copyVersion({a:[1]}));
  assert.notEqual(sync.copyVersion({a:[1]}), sync.copyVersion({a:[2]}));
  await sync.startOfflineSync('faculty'); await new Promise(r => setTimeout(r, 0));
  now += sync.FULL_SYNC_MS; await sync.syncNow();
  assert.equal(w.replaced, 1, 'same copy twice: one write');
  w.staff = {'/faculty/subjects/':[1,2]}; await sync.syncNow();
  assert.equal(w.replaced, 2, 'a changed copy is written');
  sync.stopOfflineSync();
});

test('the timer: queued work every minute, full refresh every 15 minutes, nothing while hidden or under Data Saver', async () => {
  reset(); w.state = 'active';
  w.server = () => ({version:'v2', generated_at:'x', entries:{}});
  await sync.startOfflineSync('student'); await new Promise(r => setTimeout(r, 0));
  w.calls = []; w.flushed = 0; // the start-up sync also sends queued work
  assert.equal(await sync.syncTick(), 'idle', 'just synced, nothing waiting');
  w.events = [{id:'e1'}];
  assert.equal(await sync.syncTick(), 'retried'); assert.equal(w.flushed, 1); assert.equal(w.calls.length, 0, 'retrying queued work downloads nothing');
  now += sync.FULL_SYNC_MS - 1000;
  assert.equal(await sync.syncTick(), 'idle');
  now += 2000;
  w.state = 'background';
  assert.equal(await sync.syncTick(), 'hidden'); assert.equal(w.calls.length, 0);
  w.state = 'active';
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {value:{connection:{saveData:true}}, configurable:true, writable:true});
  assert.equal(await sync.syncTick(), 'idle', 'Data Saver: no timed refresh'); assert.equal(w.calls.length, 0);
  if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator); else delete globalThis.navigator;
  assert.equal(await sync.syncTick(), 'full'); assert.equal(w.calls.length, 1);
  sync.stopOfflineSync();
});

test('returning to the app refreshes only a copy older than two minutes', async () => {
  reset();
  w.server = () => ({version:'v3', generated_at:'x', entries:{}});
  await sync.startOfflineSync('student'); await new Promise(r => setTimeout(r, 0));
  w.calls = [];
  now += 60 * 1000; await sync.syncIfStale(); assert.equal(w.calls.length, 0);
  now += sync.FOREGROUND_MIN_MS; await sync.syncIfStale(); assert.equal(w.calls.length, 1);
  sync.stopOfflineSync();
});

test('the app wires the minute timer and the foreground check', () => {
  const src = fs.readFileSync(path.join(root, 'frontend/src/offline/sync.ts'), 'utf8');
  assert.match(src, /timer = setInterval\(\(\) => \{ void syncTick\(\); \}, RETRY_MS\)/);
  assert.doesNotMatch(src, /setInterval\(\(\) => \{ void syncNow\(\); \}, 60 \* 1000\)/);
  assert.match(fs.readFileSync(path.join(root, 'frontend/src/auth/AuthContext.tsx'), 'utf8'), /void syncIfStale\(\);/);
});
