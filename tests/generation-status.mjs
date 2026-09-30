// The phone notification and the job list say what is being written, for
// what, and how far along, in plain words; the bar counts finished items and
// only moves forward; Android says when lessons and quizzes are ready.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localmind-status-'));
process.on('exit', () => fs.rmSync(tmp, {recursive:true, force:true}));
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
async function bundle(entry, stubs, name) {
  const outfile = path.join(tmp, `${name}.cjs`);
  await build({entryPoints:[path.join(root, entry)], outfile, bundle:true, platform:'node', format:'cjs', logLevel:'silent',
    plugins:[{name:'stubs', setup(b){ b.onResolve({filter:/.*/}, a => Object.hasOwn(stubs, a.path) ? {path:a.path, namespace:'stub'} : undefined);
      b.onLoad({filter:/.*/, namespace:'stub'}, a => ({contents:stubs[a.path], loader:'js'})); }}]});
  return require(outfile);
}
const w = globalThis.__n = {updates:[], ends:[], state:'active'};
const ws = await bundle('frontend/src/private/workStatus.ts', {}, 'ws');

test('titles say what is being written and for what', () => {
  assert.equal(ws.jobTitle({kind:'doubt', label:'Chapter 4'}), 'Answering your question');
  assert.equal(ws.jobTitle({kind:'lesson', label:'Chapter 4'}), 'Writing a lesson — Chapter 4');
  assert.equal(ws.jobTitle({kind:'staff-auto', label:'Cyber Security'}), 'Writing lessons and quizzes — Cyber Security');
  assert.equal(ws.jobTitle({kind:'staff-batch', label:'your book', work:'quizzes'}), 'Writing quizzes — your book');
  assert.equal(ws.jobTitle({kind:'staff-quiz-selection', label:'Midterm'}), 'Writing a quiz — Midterm');
  assert.equal(ws.jobStateLabel('running'), 'Working'); assert.equal(ws.jobStateLabel('completed'), 'Saved'); assert.equal(ws.jobStateLabel('queued'), 'Waiting');
});

test('the bar counts finished items and never goes back within a job', () => {
  const f = ws.progressFraction;
  assert.equal(f('Reading the material… 14s'), undefined, 'no count: busy bar');
  assert.equal(f('Module 1 of 4 · Lesson · Part 1 of 2 · Writing… 3s'), 0);
  assert.equal(f('Module 1 of 4 · Lesson · Part 2 of 2 · Writing… 3s'), 0.125);
  assert.equal(f('Module 2 of 4 · Lesson · Part 1 of 2 · Reading the material… 1s'), 0.25);
  assert.equal(f('Preparing questions 4–6 of 10'), 0.3);
  const line = ['Module 1 of 3 · Lesson · Part 1 of 3','Module 1 of 3 · Lesson · Part 2 of 3','Module 1 of 3 · Lesson · Part 3 of 3','Module 2 of 3 · Lesson · Part 1 of 3','Module 3 of 3 · Quiz'].map(f);
  for (let i = 1; i < line.length; i++) assert.ok(line[i] > line[i-1], `step ${i} moves forward: ${line}`);
  assert.ok(line.every(x => x < 1));
});

test('the ready message names what finished and leaves doubts out', () => {
  assert.equal(ws.readySummary([{kind:'doubt', label:'Chapter 4'}]), null);
  assert.deepEqual(ws.readySummary([{kind:'staff-auto', label:'Cyber Security'}]), {title:'Lessons and quizzes ready', text:'Cyber Security: saved on this phone. Open LocalMind to review.'});
  assert.equal(ws.readySummary([{kind:'lesson', label:'Chapter 4'}]).title, 'Lesson ready');
  assert.equal(ws.readySummary([{kind:'lesson', label:'A'},{kind:'lesson', label:'B'}]).title, 'Lessons ready');
  assert.match(ws.readySummary([{kind:'quiz', label:'A'},{kind:'quiz', label:'B'}]).text, /^2 items: saved/);
});

const bg = await bundle('frontend/src/private/backgroundWork.native.ts', {
  'react-native': `export const Platform={OS:'android',Version:34};export const AppState={get currentState(){return globalThis.__n.state},addEventListener:()=>({remove(){}})};
    export const PermissionsAndroid={check:async()=>true,request:async()=>'granted'};`,
  'expo': `export const requireOptionalNativeModule=()=>({isSupported:()=>true,begin:async(t,s)=>{globalThis.__n.begin=[t,s];return true;},
    update:(f,s,t)=>globalThis.__n.updates.push([f,s,t]),end:(ok,t,x)=>globalThis.__n.ends.push([ok,t,x]),gpuInBackground:()=>false});`,
}, 'bg');

test('the notification follows the running job, shows a busy bar while writing, and says when work is ready', async () => {
  bg.backgroundWork.show({title:'Writing lessons — Cyber Security', text:'Module 2 of 5 · Lesson · Starting…', fraction:0.2});
  await bg.backgroundWork.enter();
  assert.deepEqual(w.begin, ['Writing lessons — Cyber Security', 'Module 2 of 5 · Lesson · Starting…'], 'the session opens with the job, not a generic title');
  bg.backgroundWork.detail('Writing… 3s');
  assert.equal(w.updates.length, 1, 'a job describes itself; the AI step alone does not override it');
  bg.backgroundWork.show({title:'Writing a quiz — Chapter 4', text:'Question 1 of 6'});
  assert.deepEqual(w.updates.at(-1), [-1, 'Question 1 of 6', 'Writing a quiz — Chapter 4'], 'title changes with the job; no count means a busy bar');
  bg.backgroundWork.setReady({title:'Lessons ready', text:'Cyber Security: saved on this phone. Open LocalMind to review.'});
  w.state = 'background'; bg.backgroundWork.leave();
  await new Promise(r => setTimeout(r, 8200));
  assert.deepEqual(w.ends.at(-1), [true, 'Lessons ready', 'Cyber Security: saved on this phone. Open LocalMind to review.']);
});

test('no ready message when LocalMind is on screen', async () => {
  w.state = 'active'; bg.backgroundWork.show(null);
  await bg.backgroundWork.enter('Starting…', 'Answering your question');
  assert.deepEqual(w.begin, ['Answering your question', 'Starting…']);
  bg.backgroundWork.detail('Reading the material… 4s');
  assert.deepEqual(w.updates.at(-1), [-1, 'Reading the material… 4s', 'Answering your question'], 'without a job, the AI step is the text');
  bg.backgroundWork.setReady({title:'Quiz ready', text:'x'});
  bg.backgroundWork.leave(); await new Promise(r => setTimeout(r, 8200));
  assert.deepEqual(w.ends.at(-1), [true, '', '']);
});

test('the job bridge describes the running job and summarises finished work', async () => {
  const seen = globalThis.__seen = {show:[], ready:[]};
  const jn = await bundle('frontend/src/private/jobNotifications.ts', {
    './backgroundWork': `export const backgroundWork={show:j=>globalThis.__seen.show.push(j),setReady:r=>globalThis.__seen.ready.push(r)};`,
    './jobs': `export const generationJobs={subscribe(){},snapshot:()=>[]};`,
  }, 'jn');
  jn.describe([{id:1, kind:'staff-auto', label:'Cyber Security', state:'running', note:'Module 2 of 4 · Lesson · Part 1 of 2 · Writing… 3s'}]);
  assert.deepEqual(seen.show.at(-1), {title:'Writing lessons and quizzes — Cyber Security', text:'Module 2 of 4 · Lesson · Part 1 of 2 · Writing… 3s', fraction:0.25});
  jn.describe([{id:1, kind:'staff-auto', label:'Cyber Security', state:'completed', note:'Saved on this device'}]);
  assert.equal(seen.show.at(-1), null);
  assert.equal(seen.ready.at(-1).title, 'Lessons and quizzes ready');
});

test('JavaScript and the Android/iOS code agree on the notification calls', () => {
  const js = read('frontend/src/private/backgroundWork.native.ts');
  assert.match(js, /native\.update\(shown\.fraction, shown\.text, shown\.title\)/);
  assert.match(js, /native\?\.end\(true, tell\?\.title \?\? '', tell\?\.text \?\? ''\)/);
  const kt = read('frontend/modules/localmind-background/android/src/main/java/expo/modules/localmindbackground/LocalMindBackgroundModule.kt');
  assert.match(kt, /Function\("update"\) \{ fraction: Double, subtitle: String, title: String ->/);
  assert.match(kt, /Function\("end"\) \{ _: Boolean, readyTitle: String, readyText: String ->/);
  const sw = read('frontend/modules/localmind-background/ios/LocalMindBackgroundModule.swift');
  assert.match(sw, /Function\("update"\) \{ \(fraction: Double, subtitle: String, title: String\) in/);
  assert.match(sw, /Function\("end"\) \{ \(success: Bool, _: String, _: String\) in/);
  const svc = read('frontend/modules/localmind-background/android/src/main/java/expo/modules/localmindbackground/GenerationService.kt');
  assert.match(svc, /progress = if \(fraction < 0\) -1 else/); assert.match(svc, /fun ready\(context: Context, readyTitle: String, readyText: String\)/);
});

test('job rows and progress lines use plain words and "N of M"', () => {
  assert.match(read('frontend/src/private/GenerationJobs.tsx'), /<P>\{jobTitle\(j\)\}<\/P><Badge value=\{jobStateLabel\(j\.state\)\}\/>/);
  assert.doesNotMatch(read('frontend/app/manage/local-batch.tsx'), /Book · local/);
  assert.doesNotMatch(read('frontend/src/private/screens/PrivateBook.tsx'), /label:`\$\{section\.title\} · \$\{kind\}`/);
  assert.match(read('frontend/src/authoring/batch.ts'), /Module \$\{n\+1\} of \$\{ids\.length\}/);
  assert.match(read('frontend/src/private/library.ts'), /Part \$\{index\+1\} of \$\{passages\.length\}/);
  assert.doesNotMatch(read('frontend/src/private/library.ts'), /Generate again after an interruption to resume/);
  assert.match(read('frontend/src/authoring/automatic.ts'), /Module \$\{modules\.indexOf\(m\)\+1\} of \$\{modules\.length\}/);
  assert.match(read('frontend/app/_layout.tsx'), /import '@\/private\/jobNotifications';/);
});
