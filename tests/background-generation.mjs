// Generation must keep going when the person switches to another app.
// Runs the real device adapter (device.native.ts + backgroundWork.native.ts)
// with the phone boundaries replaced: screen state, the LocalMindBackground
// native module and llama.rn. These are adapter regressions, not a claim to
// have run on iPhone or Android hardware.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localmind-background-'));
process.on('exit', () => { fs.rmSync(tmp, {recursive:true, force:true}); delete globalThis.__bg; });

const bg = globalThis.__bg = {
  state:'active', listeners:new Set(), native:null, loads:[], completions:0, onCompletion:null,
  setState(next) { this.state = next; for (const listener of [...this.listeners]) listener(next); },
};
function fakeNative({supported = true, gpu = false} = {}) {
  const expired = new Set();
  return {
    begins:0, ends:0, updates:[],
    isSupported:() => supported,
    gpuInBackground:() => gpu,
    async begin() { this.begins++; return supported; },
    update(fraction, subtitle) { this.updates.push([fraction, subtitle]); },
    end() { this.ends++; },
    addListener(event, listener) { expired.add(listener); return {remove(){ expired.delete(listener); }}; },
    expire() { for (const listener of [...expired]) listener(); },
  };
}
function context(layers) {
  const ctx = {gpu:layers > 0, stops:0, release:async()=>{}, tokenize:async()=>({tokens:[1,2]}),
    getFormattedChat:async()=>({prompt:'formatted'}),
    stopCompletion() { ctx.stops++; ctx.stopped?.(); return undefined; }};
  ctx.completion = (params, onToken) => {
    bg.completions++;
    if (bg.onCompletion) return bg.onCompletion(ctx, params, onToken);
    for (let i = 0; i < 25; i++) onToken?.({token:'x'});
    return Promise.resolve({text:'{"ok":true}'});
  };
  return ctx;
}
let bundles = 0;
async function adapter(platform) {
  const stubs = {
    'react-native': `export const Platform={OS:'${platform}',Version:34};
      export const AppState={get currentState(){return globalThis.__bg.state},addEventListener:(e,f)=>{globalThis.__bg.listeners.add(f);return {remove(){globalThis.__bg.listeners.delete(f);}};}};
      export const PermissionsAndroid={check:async()=>true,request:async()=>'granted'};`,
    'expo': `export const requireOptionalNativeModule=()=>globalThis.__bg.native;`,
    'expo-file-system/legacy': `export const documentDirectory='file:///docs/'; export const getInfoAsync=async()=>({exists:true,isDirectory:false,size:1});`,
    'expo-sqlite': `export const openDatabaseAsync=async()=>({execAsync:async()=>{},getFirstAsync:async(sql,key)=>({value:JSON.stringify(key==='@model-v1'?{uri:'file:///model',name:'test',hash:'test',bytes:1}:{model:'test',choice:'gpu'})}),runAsync:async()=>{}});`,
    'expo-device': `export const totalMemory=null;`,
    'expo-keep-awake': `export const activateKeepAwakeAsync=async()=>{}; export const deactivateKeepAwake=()=>{};`,
    'expo-crypto': `export const randomUUID=()=> 'test-uuid';`,
    'llama.rn': `export const initLlama=async o=>{globalThis.__bg.loads.push(o.n_gpu_layers);return globalThis.__bg.makeContext(o.n_gpu_layers);}; export const getBackendDevicesInfo=async()=>[];`,
    './parserBridge': `export const parseNative=async()=>{throw Error('not part of this test')};`,
  };
  const outfile = path.join(tmp, `adapter-${platform}-${++bundles}.cjs`);
  await build({entryPoints:[path.join(root,'frontend/src/private/device.native.ts')],outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent',
    plugins:[{name:'phone-boundaries',setup(b){
      b.onResolve({filter:/.*/}, args => Object.hasOwn(stubs,args.path)?{path:args.path,namespace:'stub'}:undefined);
      b.onLoad({filter:/.*/,namespace:'stub'}, args => ({contents:stubs[args.path],loader:'js'}));
    }}]});
  return require(outfile).device;
}
bg.makeContext = context;
const request = (signal = new AbortController().signal, progress = () => {}) =>
  ({system:'s', prompt:'p', schema:{type:'object'}, maxTokens:100, temperature:0, signal, progress});
// An answer that runs until the test lets it finish or the adapter stops it.
function heldAnswer() {
  let finish, started;
  const begun = new Promise(resolve => { started = resolve; });
  // Only the first answer is held; a restarted answer completes normally.
  bg.onCompletion = ctx => { bg.onCompletion = null; return new Promise(resolve => {
    ctx.stopped = () => resolve({text:'{"partial":'});
    finish = () => resolve({text:'{"ok":true}'});
    started(ctx);
  }); };
  return {begun, finish:() => finish()};
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function reset(native) {
  bg.state = 'active'; bg.listeners.clear(); bg.native = native; bg.loads = []; bg.completions = 0; bg.onCompletion = null;
}

// A fresh copy of the adapter per test: the background session is module
// state, and the native module is looked up when the code loads.
async function fresh(platform, native) { reset(native); return await (await adapter(platform))(); }

test('Android: switching apps does not stop the answer and the notification session starts once', async () => {
  const native = fakeNative(); const android = await fresh('android', native);
    const held = heldAnswer();
  const answer = android.complete(request());
  const ctx = await held.begun;
  bg.setState('background');
  await tick();
  assert.equal(ctx.stops, 0, 'the answer must not be stopped');
  held.finish();
  assert.deepEqual(await answer, {ok:true});
  bg.onCompletion = null;
  assert.deepEqual(await android.complete(request()), {ok:true});
  assert.equal(native.begins, 1, 'one notification session for consecutive answers');
  assert.equal(bg.completions, 2);
});

test('iOS 26 without background GPU: moves to the CPU off screen, finishes, then returns to the GPU', async () => {
  const native = fakeNative({supported:true, gpu:false}); const ios = await fresh('ios', native);
    const held = heldAnswer();
  const messages = [];
  const answer = ios.complete(request(undefined, m => messages.push(m)));
  const ctx = await held.begun;
  assert.equal(ctx.gpu, true, 'starts on the GPU on screen');
  bg.setState('background');
  await tick();
  assert.equal(ctx.stops, 1, 'the GPU answer is stopped before iOS forbids Metal');
  bg.onCompletion = null;
  assert.deepEqual(await answer, {ok:true});
  assert.deepEqual(bg.loads.slice(-1), [0], 'reloaded on the CPU in the background');
  assert.ok(messages.some(m => /CPU while LocalMind is in the background/.test(m)));
  bg.setState('active');
  assert.deepEqual(await ios.complete(request()), {ok:true});
  assert.deepEqual(bg.loads.slice(-1), [99], 'back on the GPU once on screen');
});

test('iOS with background GPU access keeps the same GPU answer running off screen', async () => {
  const native = fakeNative({supported:true, gpu:true}); const ios = await fresh('ios', native);
    await ios.complete(request()); // session open, GPU loaded
  const held = heldAnswer();
  const answer = ios.complete(request());
  const ctx = await held.begun;
  bg.setState('background');
  await tick();
  assert.equal(ctx.stops, 0);
  held.finish();
  assert.deepEqual(await answer, {ok:true});
  bg.setState('active');
});

test('older iOS: pauses off screen and continues by itself on return, with no error', async () => {
  const native = fakeNative({supported:false}); const ios = await fresh('ios', native);
    const held = heldAnswer();
  const messages = [];
  const answer = ios.complete(request(undefined, m => messages.push(m)));
  const ctx = await held.begun;
  bg.setState('background');
  await tick();
  assert.equal(ctx.stops, 1, 'stopped before iOS suspends the app');
  bg.onCompletion = null;
  let settled = false; answer.then(() => { settled = true; }, () => { settled = true; });
  await tick(); await tick();
  assert.equal(settled, false, 'waits while LocalMind is off screen');
  assert.ok(messages.some(m => /continues by itself when you return/.test(m)));
  bg.setState('active');
  assert.deepEqual(await answer, {ok:true});
});

test('iOS ends the background task early: the answer pauses and resumes on return', async () => {
  const native = fakeNative({supported:true, gpu:true}); const ios = await fresh('ios', native);
    const held = heldAnswer();
  const answer = ios.complete(request());
  const ctx = await held.begun;
  bg.setState('background');
  await tick();
  assert.equal(ctx.stops, 0, 'still running under the task');
  native.expire();
  await tick();
  assert.equal(ctx.stops, 1, 'stopped when iOS ended the task');
  bg.onCompletion = null;
  bg.setState('active');
  assert.deepEqual(await answer, {ok:true});
});

test('cancelling while paused off screen rejects with the normal cancel message', async () => {
  const native = fakeNative({supported:false}); const ios = await fresh('ios', native);
    const held = heldAnswer();
  const controller = new AbortController();
  const answer = ios.complete(request(controller.signal));
  await held.begun;
  bg.setState('background');
  await tick();
  controller.abort();
  await assert.rejects(answer, /Cancelled/);
  bg.setState('active');
});

test('progress reaches the notification or iOS progress bar', async () => {
  const native = fakeNative(); const android = await fresh('android', native);
    await android.complete(request());
  assert.ok(native.updates.length > 0);
  assert.ok(native.updates.every(([fraction]) => fraction >= 0 && fraction < 1));
});

test('laptop: the tab is marked busy while answers are written, without the browser\'s "Leave site?" box', async () => {
  const outfile = path.join(tmp, 'web-background.cjs');
  await build({entryPoints:[path.join(root,'frontend/src/private/backgroundWork.web.ts')],outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  const handlers = new Set(); const held = [];
  globalThis.window = {addEventListener:(e,f)=>{ if (e === 'beforeunload') handlers.add(f); }, removeEventListener:(e,f)=>{ handlers.delete(f); }};
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {configurable:true, value:{locks:{request:(name, options, callback) => { const done = callback(); held.push({name, options, done}); return done; }}}});
  try {
    const {backgroundWork} = require(outfile);
    backgroundWork.enter(); backgroundWork.enter();
    assert.equal(held.length, 1, 'one lock for the session');
    assert.equal(held[0].options.mode, 'shared');
    assert.equal(handlers.size, 0, 'no browser pop-up: the work resumes by itself after a close');
    backgroundWork.leave(); backgroundWork.leave();
    assert.equal(handlers.size, 0);
    backgroundWork.enter(); backgroundWork.leave();
    assert.equal(held.length, 1, 'the same lock is reused');
  } finally {
    delete globalThis.window;
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); else delete globalThis.navigator;
  }
});

// Recorded on the APK: 22 seconds of one unchanging "Reading the material"
// line, then "Writing… 6%", "12%" and the answer. The percentage was of the
// longest answer allowed, not of this answer.
test('the phone shows elapsed time, never a percentage of the longest answer allowed', async () => {
  const native = fakeNative(); const android = await fresh('android', native);
  const said = [];
  bg.onCompletion = async (ctx, params, onToken) => {
    await new Promise(r => setTimeout(r, 1100));
    for (let i = 0; i < 30; i++) onToken?.({token:'x'});
    await new Promise(r => setTimeout(r, 1100));
    return {text:'{"ok":true}'};
  };
  await android.complete(request(undefined, s => said.push(s)));
  assert.ok(said.some(s => /^Reading the material on this phone… \d+s$/.test(s)), said.join(' | '));
  assert.ok(said.some(s => /^Writing the answer on this phone… \d+s$/.test(s)), said.join(' | '));
  assert.ok(!said.some(s => s.includes('%')), said.join(' | '));
  const count = said.length; await new Promise(r => setTimeout(r, 1200));
  assert.equal(said.length, count, 'the clock stops when the answer is done');
});
