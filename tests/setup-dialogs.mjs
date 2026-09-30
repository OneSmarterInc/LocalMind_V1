// The offline AI setup choices ask first, in LocalMind's own pop-up (never a
// browser or phone system prompt): continuing without the model, stopping a
// download, and signing out from the setup screen.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localmind-setup-dialogs-'));
process.on('exit', () => fs.rmSync(tmp, {recursive:true, force:true}));
const asked = globalThis.__asked = [];
const outfile = path.join(tmp, 'dialogs.cjs');
await build({entryPoints:[path.join(root,'frontend/src/private/modelDialogs.ts')],outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent',
  plugins:[{name:'stub',setup(b){ b.onResolve({filter:/^@\/ui\/Confirm$/},()=>({path:'confirm',namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:`export const confirmAsync=async(title,message,ok,cancel,options)=>{globalThis.__asked.push({title,message,ok,cancel,options});return globalThis.__answer;};`,loader:'js'})); }}]});
const dialogs = require(outfile);
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('continuing without the model says what stops working and offers to set it up', async () => {
  globalThis.__answer = false;
  assert.equal(await dialogs.confirmContinueWithoutModel(false), false);
  const d = asked.at(-1);
  assert.equal(d.ok, 'Continue anyway'); assert.equal(d.cancel, 'Set it up now');
  assert.match(d.message, /Reading, quizzes and sync work/); assert.match(d.message, /asking doubts will not work/);
  globalThis.__answer = true;
  assert.equal(await dialogs.confirmContinueWithoutModel(true), true);
  assert.match(asked.at(-1).title, /while the model downloads/);
  assert.match(asked.at(-1).message, /keeps going in the background/);
});

test('stopping a download says the downloaded part is kept', async () => {
  globalThis.__answer = true;
  assert.equal(await dialogs.confirmCancelDownload(), true);
  assert.equal(asked.at(-1).ok, 'Stop download'); assert.match(asked.at(-1).message, /is kept/);
});

test('the setup screen and Offline AI use these pop-ups, and Sign out warns like everywhere else', () => {
  const gate = read('frontend/src/private/ModelGate.tsx');
  assert.match(gate, /const signOut = async \(\) => \{ if \(!\(await confirmSignOut\(\)\)\) return; modelSetup\.cancel\(\); void logout\(\); \}/);
  assert.match(gate, /title="Sign out"[^\n]*?onPress=\{\(\) => void signOut\(\)\}/);
  assert.match(gate, /title="Cancel download"[^\n]*?onPress=\{\(\) => void cancelDownload\(\)\}/);
  assert.doesNotMatch(gate, /onPress=\{\(\) => modelSetup\.cancel\(\)\}/);
  const offline = read('frontend/src/private/screens/OfflineAI.tsx');
  assert.match(offline, /title="Cancel download"[^\n]*?confirmCancelDownload\(\)\.then/);
});
