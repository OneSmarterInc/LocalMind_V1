import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {before, after, patchRuntime} from '../frontend/scripts/patch-llama-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'frontend/package.json'));
const {build} = require('esbuild');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localmind-native-'));
process.on('exit', () => { fs.rmSync(tmp, {recursive:true, force:true}); delete globalThis.__nativeTest; });
const installed = path.join(root, 'frontend/node_modules/llama.rn');
const cpp = fs.readFileSync(path.join(installed, 'cpp/jsi/RNLlamaJSI.cpp'), 'utf8').replace(after, before);
const cmake = fs.readFileSync(path.join(installed, 'android/src/main/CMakeLists.txt'), 'utf8');
function fixture(source = cpp, version = '0.10.0') {
  const dir = fs.mkdtempSync(path.join(tmp, 'runtime-'));
  fs.mkdirSync(path.join(dir, 'cpp/jsi'), {recursive:true});
  fs.mkdirSync(path.join(dir, 'android/src/main'), {recursive:true});
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({version}));
  fs.writeFileSync(path.join(dir, 'cpp/jsi/RNLlamaJSI.cpp'), source);
  fs.writeFileSync(path.join(dir, 'android/src/main/CMakeLists.txt'), cmake);
  return dir;
}
test('patch applies to shipped 0.10.0 and a second application changes no bytes', () => {
  const dir = fixture();
  assert.equal(patchRuntime(dir), 'patched');
  const file = path.join(dir, 'cpp/jsi/RNLlamaJSI.cpp');
  const first = fs.readFileSync(file, 'utf8');
  assert.ok(first.includes(after));
  assert.equal(patchRuntime(dir), 'already patched');
  assert.equal(fs.readFileSync(file, 'utf8'), first);
});
test('patch supports Windows line endings', () => {
  const dir = fixture(cpp.replace(/\n/g, '\r\n'));
  assert.equal(patchRuntime(dir), 'patched');
  assert.equal(patchRuntime(dir), 'already patched');
  assert.ok(fs.readFileSync(path.join(dir, 'cpp/jsi/RNLlamaJSI.cpp'), 'utf8').includes(after.replace(/\n/g, '\r\n')));
});
test('patch refuses another runtime version, source drift and ambiguous targets', () => {
  assert.throws(() => patchRuntime(fixture(cpp, '0.10.1')), /expected 0.10.0/);
  assert.throws(() => patchRuntime(fixture(cpp.replace(before, 'changed'))), /Unexpected/);
  assert.throws(() => patchRuntime(fixture(cpp + before)), /Unexpected/);
});
test('patch refuses a build that would omit the patched wrapper', () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, 'android/src/main/CMakeLists.txt'), '');
  assert.throws(() => patchRuntime(dir), /no longer compiles/);
});

// Execute the real device adapter with only platform boundaries replaced. These
// are adapter regressions, not a claim to have run a model on Android hardware.
const quote = 'Photosynthesis occurs in chloroplasts.';
const harness = globalThis.__nativeTest = {
  calls:[],
  response:{answer:'Photosynthesis occurs in chloroplasts.',quote,supported:true},
  ctx:{gpu:false, release:async()=>{}, tokenize:async()=>({tokens:[1,2]}),
    getFormattedChat:async()=>({prompt:'formatted source'}), stopCompletion:()=>undefined},
};
harness.ctx.completion = async params => { harness.calls.push(params); return {text:JSON.stringify(harness.response)}; };
const stubs = {
  'expo-file-system/legacy': `export const documentDirectory='file:///docs/'; export const getInfoAsync=async()=>({exists:true,isDirectory:false,size:1});`,
  'expo-sqlite': `export const openDatabaseAsync=async()=>({execAsync:async()=>{},getFirstAsync:async(sql,key)=>({value:JSON.stringify(key==='@model-v1'?{uri:'file:///model',name:'test',hash:'test',bytes:1}:{model:'test',choice:'cpu'})})});`,
  'react-native': `export const Platform={OS:'android'};`,
  'expo-crypto': `export const randomUUID=()=> 'test-uuid';`,
  'llama.rn': `export const initLlama=async()=>globalThis.__nativeTest.ctx; export const getBackendDevicesInfo=async()=>[];`,
  './parserBridge': `export const parseNative=async()=>{throw Error('not part of this test')};`,
};
const outfile = path.join(tmp, 'adapter.cjs');
await build({entryPoints:[path.join(root,'frontend/src/private/device.native.ts')],outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent',
  plugins:[{name:'native-boundaries',setup(b){
    b.onResolve({filter:/.*/}, args => Object.hasOwn(stubs,args.path)?{path:args.path,namespace:'stub'}:undefined);
    b.onLoad({filter:/.*/,namespace:'stub'}, args => ({contents:stubs[args.path],loader:'js'}));
  }}]});
const {device} = require(outfile);
const coreFile = path.join(tmp, 'core.cjs');
await build({entryPoints:[path.join(root,'frontend/src/private/core.ts')],outfile:coreFile,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
const core = require(coreFile);
const request = (schema, signal = new AbortController().signal) => ({system:core.GROUNDING,prompt:quote,schema,maxTokens:100,temperature:0,signal});

test('lesson, quiz and doubt retain their full constrained schemas through the adapter', async () => {
  const d = await device();
  const cases = [
    [core.COMPACT_LESSON_SCHEMA,{introduction:quote,sections:[{heading:'Plants',content:quote,quote}],takeaways:[quote]},raw=>core.validateLesson(raw,quote)],
    [core.COMPACT_MCQ_SCHEMA,{question:'Where does photosynthesis occur?',options:['Chloroplasts','Roots','Soil','Flowers'],answer:0,explanation:quote,quote},raw=>core.validateMCQ(raw,quote,'s1','q1')],
    [core.ANSWER_SCHEMA,{answer:quote,quote,supported:true},raw=>core.validateAnswer(raw,quote)],
  ];
  for (const [base,response,validate] of cases) {
    harness.response=response;
    const schema=core.groundedSchema(base,quote);
    const raw=await d.complete(request(schema));
    assert.doesNotThrow(()=>validate(raw));
    const sent=harness.calls.at(-1);
    assert.deepEqual(JSON.parse(sent.json_schema),schema);
    assert.equal(sent.grammar_lazy,false);
    assert.equal(sent.messages,undefined);
    assert.ok(sent.stop.includes('<|im_end|>'));
  }
});
test('schema/runtime failure is propagated without an unconstrained second call', async () => {
  const previous=harness.ctx.completion; let calls=0;
  harness.ctx.completion=async()=>{calls++;throw Error('schema compilation failed');};
  try { await assert.rejects((await device()).complete(request(core.ANSWER_SCHEMA)),/schema compilation failed/); assert.equal(calls,1); }
  finally { harness.ctx.completion=previous; }
});
test('cancellation accepts the void-returning native stop function', async () => {
  const previous=harness.ctx.completion, stop=harness.ctx.stopCompletion;
  const controller=new AbortController(); let stopped=0;
  harness.ctx.completion=()=>new Promise(resolve=>{
    harness.ctx.stopCompletion=()=>{stopped++;resolve({text:'{}'});return undefined;};
    setImmediate(()=>controller.abort());
  });
  try { await assert.rejects((await device()).complete(request(core.ANSWER_SCHEMA,controller.signal)),/Cancelled/); assert.equal(stopped,1); }
  finally { harness.ctx.completion=previous;harness.ctx.stopCompletion=stop; }
});
