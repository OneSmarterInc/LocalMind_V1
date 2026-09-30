// Discard and Cancel on unsaved edits ask first, in LocalMind's own pop-up.
// They used to drop the edits on one tap (quiz workspace, evaluation, monitor
// policies, account and subject editors).
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localmind-discard-'));
process.on('exit', () => fs.rmSync(tmp, {recursive:true, force:true}));
const asked = globalThis.__asked = [];
const outfile = path.join(tmp, 'guard.cjs');
await build({entryPoints:[path.join(root,'frontend/src/hooks/unsavedGuard.ts')],outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent',
  plugins:[{name:'stub',setup(b){
    b.onResolve({filter:/^@\/(ui\/Confirm|api\/client)$/},a=>({path:a.path,namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:a.path.endsWith('Confirm')
      ?`export const confirmAsync=async(title,message,ok,cancel,options)=>{globalThis.__asked.push({title,message,ok,cancel,options});return globalThis.__answer;};export const alertAsync=async()=>true;export const choiceAsync=async()=>'cancel';`
      :`export const errorMessage=e=>String(e);`,loader:'js'})); }}]});
const guard = require(outfile);

test('discarding asks, names what is lost, and only discards on yes', async () => {
  let dropped = 0; const drop = () => { dropped++; };
  globalThis.__answer = false;
  assert.equal(await guard.discardAfterAsking(drop, 'this quiz'), false);
  assert.equal(dropped, 0, 'Keep editing leaves the edits alone');
  assert.equal(asked.at(-1).title, 'Discard your changes to this quiz?');
  assert.equal(asked.at(-1).ok, 'Discard changes'); assert.equal(asked.at(-1).cancel, 'Keep editing');
  assert.equal(asked.at(-1).options.tone, 'danger');
  globalThis.__answer = true;
  assert.equal(await guard.discardAfterAsking(drop, 'this quiz'), true);
  assert.equal(dropped, 1);
});

test('no Discard or Cancel button drops unsaved edits on one tap', () => {
  const files = ['frontend/src/screens/QuizWorkspace.tsx','frontend/app/admin/monitor-policies.tsx','frontend/app/admin/user/[id].tsx','frontend/app/admin/subject/[id].tsx'];
  for (const f of files) {
    const s = fs.readFileSync(path.join(root, f), 'utf8');
    assert.doesNotMatch(s, /onPress=\{(discard|forgetLeftBehind)\}/, f);
    assert.match(s, /discardAfterAsking\(/, f);
  }
});
