// Everyone can continue without the offline AI model, on the laptop, Android
// and iOS. Seen on localmind.onesmarter.com/admin: the setup screen offered
// only Download, Import and Sign out, because "Continue without offline AI"
// was shown only on a computer too weak to run the model. A phone short of
// storage, or an administrator who never uses AI, could not get past it.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localmind-setup-later-'));
process.on('exit', () => fs.rmSync(tmp, {recursive:true, force:true}));
const outfile = path.join(tmp, 'skip.cjs');
await build({entryPoints:[path.join(root,'frontend/src/private/modelSkip.ts')],outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
const skip = require(outfile);
const gate = fs.readFileSync(path.join(root,'frontend/src/private/ModelGate.tsx'),'utf8');

const memory = () => { const m = new Map(); return {m, getItem:async k=>m.has(k)?m.get(k):null, setItem:async(k,v)=>{m.set(k,v);}, removeItem:async k=>{m.delete(k);}}; };

test('the choice is remembered for this account on this device, and only for it', async () => {
  const store = memory();
  assert.equal(await skip.setupPutOff(store, 'anshu'), false);
  await skip.putOffSetup(store, 'anshu');
  assert.equal(await skip.setupPutOff(store, 'anshu'), true);
  assert.equal(await skip.setupPutOff(store, 'someone-else'), false, 'another account on the same device is still asked');
});

test('installing a model clears the choice, so removing it later asks again', async () => {
  const store = memory();
  await skip.putOffSetup(store, 'anshu');
  await skip.clearPutOff(store, 'anshu');
  assert.equal(await skip.setupPutOff(store, 'anshu'), false);
});

test('storage that fails never locks anyone out and never hides the screen by mistake', async () => {
  const broken = {getItem:async()=>{throw Error('x');}, setItem:async()=>{throw Error('x');}, removeItem:async()=>{throw Error('x');}};
  assert.equal(await skip.setupPutOff(broken, 'anshu'), false);
  await skip.putOffSetup(broken, 'anshu');
  await skip.clearPutOff(broken, 'anshu');
  assert.equal(await skip.setupPutOff(memory(), undefined), false);
});

test('the continue button is offered on every device, not only on a computer that cannot run the model', () => {
  assert.doesNotMatch(gate, /!fit\.ok \? <Button title="Continue without offline AI"/);
  assert.match(gate, /title=\{setup\.running \? 'Continue while it downloads' : 'Continue without offline AI'\}/);
  assert.match(gate, /onPress=\{\(\) => void continueWithout\(\)\} disabled=\{importing !== null\}/, 'a running download does not block it');
  assert.match(gate, /if \(!\(await confirmContinueWithoutModel\(modelSetup\.get\(\)\.running\)\)\) return;\s*void putOffSetup\(AsyncStorage, userId\); if \(alive\.current\) setSkipped\(true\);/);
});

test('the setup screen reads the choice before showing, clears it on install, and reminds once per start', () => {
  assert.match(gate, /if \(s\.installed\) void clearPutOff\(AsyncStorage, userId\)/);
  assert.match(gate, /const later = await setupPutOff\(AsyncStorage, userId\)/);
  assert.match(gate, /if \(!putOff \|\| !userId \|\| reminded\.has\(userId\)\) return;\s*reminded\.add\(userId\);\s*showToast\(SETUP_REMINDER\)/);
  assert.match(skip.SETUP_REMINDER.message, /Offline AI/);
});
