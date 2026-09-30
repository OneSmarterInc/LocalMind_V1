// One vocabulary for "something is happening": every in-progress message ends
// in "…", the AI step reads the same on the laptop and the phone, and nothing a
// student sees while waiting names a CPU, a GPU or a parser.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localmind-progress-'));
process.on('exit', () => fs.rmSync(tmp, {recursive:true, force:true}));
const outfile = path.join(tmp, 'status.cjs');
await build({entryPoints:[path.join(root,'frontend/src/private/aiStatus.ts')],outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
const s = require(outfile);
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('the AI step has one set of words with an elapsed time', () => {
  assert.equal(s.aiStatus('reading', 14.7), 'Reading the material… 14s');
  assert.equal(s.aiStatus('writing', 3), 'Writing… 3s');
  assert.equal(s.aiStatus('fixing', 2), 'Fixing the format… 2s');
  assert.equal(s.aiStatus('working', 12), 'Reading and writing… 12s');
  assert.equal(s.aiStatus('reading', -1), 'Reading the material… 0s');
});

test('the laptop uses the same words as the phone, without GPU or thread counts', () => {
  const web = read('frontend/src/private/device.web.ts');
  assert.match(web, /aiStatus\('working',/);
  assert.doesNotMatch(web, /Generating with \$\{accelerationLabel/);
  assert.match(web, /req\.progress\?\.\(AI_WAITING\)/); assert.match(web, /req\.progress\?\.\(AI_LOADING\)/);
  const accel = read('frontend/src/private/acceleration.ts');
  assert.doesNotMatch(accel, /Loading the model on this device’s (GPU|CPU)…/);
  const phone = read('frontend/src/private/device.native.ts');
  assert.match(phone, /aiStatus\(phase,/); assert.doesNotMatch(phone, /on this phone… \$\{/);
});

test('course doubts show the live status instead of one fixed line', () => {
  assert.match(read('frontend/src/private/courseDoubt.ts'), /maxTokens:650,temperature:0\.1,signal,progress,activity:'Answering your question'\}\)/);
  const ask = read('frontend/src/private/CourseAsk.tsx');
  assert.match(ask, /answerCourse\(user\.id,moduleId,q,conversation,signal,note=>\{if\(active\.current\)task\.setNote\(note\);\}\)/);
  assert.match(ask, /\{task\.note\|\|'Reading the module…'\}/);
});

test('duplicate and inconsistent progress messages are gone', () => {
  const all = ['frontend/app/student/quiz/[id].tsx','frontend/app/manage/document/[id].tsx','frontend/src/authoring/local.ts','frontend/src/private/jobs.ts',
    'frontend/src/private/ModelGate.tsx','frontend/src/private/screens/OfflineAI.tsx','frontend/src/offline/appFiles.ts','frontend/src/auth/AccountProblem.tsx','frontend/src/private/library.ts']
    .map(read).join('\n');
  for (const old of ['Restoring saved answers…','Saving your answers on this device…','Awaiting synchronization','Waiting for the parser"','Preparing on this device',
                     "'Preparing…'",'"Checking…"','Saving offline application files automatically…','Reading book on this device…'])
    assert.ok(!all.includes(old), old);
  const doc = read('frontend/app/manage/document/[id].tsx');
  assert.match(doc, /queued: "Waiting to start reading…", reading: "Reading the file…", outline: "Planning the outline…", structure: "Creating chapters and modules…"/);
  const py = read('backend/documents/services/documents.py');
  assert.match(py, /"Waiting for another book to finish reading…"/); assert.match(py, /f"Reading \{document\.original_name\}…"/);
});
