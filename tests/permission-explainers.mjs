// LocalMind's own pop-ups in front of the browser's and the phone's prompts.
// Android's "Allow notifications?", the browser's folder chooser and access
// box, and Firefox's storage prompt are system prompts no app can replace, so
// the app explains first and lets the person decline before they appear.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localmind-explainers-'));
process.on('exit', () => fs.rmSync(tmp, {recursive:true, force:true}));
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const w = globalThis.__w = {granted:false, requests:0, explained:0, answer:true, asked:[]};

async function bundle(entry, stubs, name) {
  const outfile = path.join(tmp, `${name}.cjs`);
  await build({entryPoints:[path.join(root, entry)], outfile, bundle:true, platform:'node', format:'cjs', logLevel:'silent',
    plugins:[{name:'stubs', setup(b){ b.onResolve({filter:/.*/}, a => Object.hasOwn(stubs, a.path) ? {path:a.path, namespace:'stub'} : undefined);
      b.onLoad({filter:/.*/, namespace:'stub'}, a => ({contents:stubs[a.path], loader:'js'})); }}]});
  return require(outfile);
}

const bg = await bundle('frontend/src/private/backgroundWork.native.ts', {
  'react-native': `export const Platform={OS:'android',Version:34};export const AppState={currentState:'active',addEventListener:()=>({remove(){}})};
    export const PermissionsAndroid={check:async()=>globalThis.__w.granted,request:async()=>{globalThis.__w.requests++;return 'granted';}};`,
  'expo': `export const requireOptionalNativeModule=()=>({isSupported:()=>true,begin:async()=>true,update(){},end(){},gpuInBackground:()=>false});`,
}, 'bg');

test('Android: LocalMind explains before the system prompt, and "Not now" skips the system prompt', async () => {
  bg.setNotificationExplainer(async () => { w.explained++; return false; });
  await bg.backgroundWork.enter(); bg.backgroundWork.leave();
  assert.equal(w.explained, 1); assert.equal(w.requests, 0, 'declined in LocalMind: Android never asks');
});

test('the explanation is remembered on this device, per answer', async () => {
  const ex = await bundle('frontend/src/private/permissionExplainers.ts', {
    '@react-native-async-storage/async-storage': `export default {getItem:async()=>null,setItem:async()=>{}};`,
    '@/ui/Confirm': `export const confirmAsync=async(t,m,ok,cancel)=>{globalThis.__w.asked.push({t,m,ok,cancel});return globalThis.__w.answer;};`,
    './backgroundWork': `export const setNotificationExplainer=()=>{};`,
  }, 'ex');
  const m = new Map(); const store = {getItem:async k=>m.get(k)??null, setItem:async(k,v)=>{m.set(k,v);}};
  w.answer = false;
  assert.equal(await ex.explainNotifications(store), false);
  assert.equal(w.asked.at(-1).ok, 'Continue'); assert.equal(w.asked.at(-1).cancel, 'Not now');
  assert.match(w.asked.at(-1).m, /Android will ask you to allow notifications next/);
  const count = w.asked.length;
  assert.equal(await ex.explainNotifications(store), false, 'Not now is remembered');
  assert.equal(w.asked.length, count, 'and not asked again');
  m.clear(); w.answer = true;
  assert.equal(await ex.explainNotifications(store), true);
  assert.equal(await ex.explainNotifications(store), true);
  assert.equal(w.asked.length, count + 1);
});

test('browser storage: asked quietly only where there is no prompt, otherwise after LocalMind explains', async () => {
  const ps = await bundle('frontend/src/offline/persistentStorage.ts', {}, 'ps');
  let calls = 0; const storage = {persist:async()=>{calls++;return true;}, persisted:async()=>false};
  await ps.persistQuietly({storage}); assert.equal(calls, 0, 'Firefox-like browser: no automatic prompt');
  await ps.persistQuietly({storage, userAgentData:{brands:[]}}); assert.equal(calls, 1, 'Chrome/Edge: silent, so it is asked');
  let explained = 0;
  assert.equal(await ps.persistAfterExplaining(async () => { explained++; return false; }, {storage}), false);
  assert.equal(explained, 1); assert.equal(calls, 1, 'declined in LocalMind: the browser never asks');
  assert.equal(await ps.persistAfterExplaining(async () => true, {storage}), true); assert.equal(calls, 2);
});

test('folder access and the folder chooser are explained first, and the app registers the explainers', () => {
  const offline = read('frontend/src/private/screens/OfflineAI.tsx');
  assert.match(offline, /if \(!\(await confirmChooseFolder\(\)\)\) return; const s = await \(await device\(\)\)\.chooseModelFolder!/);
  assert.match(offline, /if \(!\(await confirmFolderAccess\(\)\)\) return; const ok = await \(await device\(\)\)\.grantModelFolder/);
  assert.match(offline, /persistAfterExplaining\(confirmProtectStorage\)/);
  assert.match(read('frontend/src/private/ModelGate.tsx'), /if \(!\(await confirmFolderAccess\(\)\)\) return; const d = await device\(\); if \(await d\.grantModelFolder/);
  assert.match(read('frontend/src/private/device.web.ts'), /await persistQuietly\(\);/);
  assert.doesNotMatch(read('frontend/src/private/device.web.ts'), /navigator\.storage\.persist\?\.\(\)/);
  assert.match(read('frontend/app/_layout.tsx'), /import '@\/private\/permissionExplainers';/);
  assert.doesNotMatch(read('frontend/src/private/backgroundWork.web.ts'), /addEventListener\('beforeunload'/);
  assert.match(read('frontend/src/hooks/useDraft.ts'), /beforeunload/, 'unsaved edits still ask, since they would be lost');
});
