// The model download belongs to the app, not to the Offline AI screen: leaving
// the screen must not stop it, a second request joins the running download,
// progress reaches the phone's background session, and only Cancel stops it.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localmind-model-setup-'));
process.on('exit', () => fs.rmSync(tmp, {recursive:true, force:true}));

const world = globalThis.__setup = {downloads:0, work:[], progress:[], finish:null, fail:null, signal:null};
const stubs = {
  './device': `export const device=async()=>({download:(report,signal,modelId)=>{const w=globalThis.__setup;w.downloads++;w.signal=signal;w.modelId=modelId;report(0.5);
    return new Promise((resolve,reject)=>{w.finish=resolve;w.fail=reject;signal.addEventListener('abort',()=>reject(new Error('Download paused at 50%.')));});}});`,
  './backgroundWork': `export const backgroundWork={enter:async(s,t)=>{globalThis.__setup.work.push(['enter',t]);},leave:()=>{globalThis.__setup.work.push(['leave']);},progress:(f,s)=>{globalThis.__setup.progress.push([f,s]);}};`,
  'react': `export const useSyncExternalStore=()=>{throw Error('not used in this test')};`,
};
const outfile = path.join(tmp, 'setup.cjs');
await build({entryPoints:[path.join(root,'frontend/src/private/modelSetup.ts')],outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent',
  plugins:[{name:'stubs',setup(b){ b.onResolve({filter:/.*/}, a => Object.hasOwn(stubs,a.path)?{path:a.path,namespace:'stub'}:undefined);
    b.onLoad({filter:/.*/,namespace:'stub'}, a => ({contents:stubs[a.path],loader:'js'})); }}]});
const {modelSetup} = require(outfile);
const tick = () => new Promise(r => setImmediate(r));

test('a download keeps its own state, joins instead of restarting, and finishes', async () => {
  const seen = [];
  const off = modelSetup.subscribe(() => seen.push(modelSetup.get().progress));
  const first = modelSetup.download('fast');
  await tick();
  const second = modelSetup.download('quality');
  assert.equal(world.downloads, 1, 'the running download is joined, not started again');
  assert.equal(world.modelId, 'fast');
  assert.equal(modelSetup.get().running, true);
  assert.equal(modelSetup.get().progress, 50);
  off(); // the screen that started it closes
  assert.equal(world.signal.aborted, false, 'closing a screen does not cancel the download');
  world.finish();
  assert.equal(await first, true); assert.equal(await second, true);
  assert.deepEqual(modelSetup.get(), {running:false, progress:100, error:'', completed:1, changes:0});
  assert.deepEqual(world.work, [['enter','LocalMind is downloading its AI model'],['leave']]);
  assert.ok(world.progress.some(([f, s]) => f === 0.5 && /Downloading… 50%/.test(s)));
  assert.ok(seen.includes(50));
});

test('only Cancel stops it, and the reason is kept for the screen', async () => {
  world.work = [];
  const running = modelSetup.download();
  await tick();
  modelSetup.cancel();
  assert.equal(await running, false);
  assert.equal(modelSetup.get().running, false);
  assert.match(modelSetup.get().error, /paused at 50%/);
  assert.deepEqual(world.work.map(w => w[0]), ['enter','leave']);
  modelSetup.clearError();
  assert.equal(modelSetup.get().error, '');
});

test('importing or removing a model elsewhere tells the setup screen to check again', () => {
  const before = modelSetup.get().changes;
  modelSetup.changed();
  assert.equal(modelSetup.get().changes, before + 1);
});
