import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const {build}=require('esbuild');
const built=await build({entryPoints:[new URL('../frontend/src/private/acceleration.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',write:false});
const m={exports:{}};new Function('module','exports',built.outputFiles[0].text)(m,m.exports);
const {loadAccelerated,offloadedLayers,accelerationLabel}=m.exports;
function setup(load,gpuAvailable=true){
 const calls=[],disposed=[],controller=new AbortController();
 return {calls,disposed,controller,options:{gpuAvailable,signal:controller.signal,
 create:observe=>({observe}),load:async(e,n)=>{calls.push(n);await load(e,n,controller);},dispose:async e=>{disposed.push(e);}}};
}
test('GPU offload evidence is parsed, unrelated messages cannot claim acceleration',()=>{
 assert.equal(offloadedLayers(['load_tensors: offloaded 29/29 layers to GPU']),29);
 assert.equal(offloadedLayers(['GPU is available',{}]),undefined);
 assert.equal(offloadedLayers(['offloaded 0/29 layers to GPU']),0);
});
test('requests GPU layers and reports confirmed offload',async()=>{
 const x=setup(async e=>e.observe('offloaded 29/29 layers to GPU'));
 const r=await loadAccelerated(x.options);assert.deepEqual(x.calls,[99]);assert.equal(r.status.accelerator,'gpu');assert.equal(x.disposed.length,0);
});
test('absent GPU skips GPU initialization',async()=>{
 const x=setup(async()=>{},false);const r=await loadAccelerated(x.options);
 assert.deepEqual(x.calls,[0]);assert.equal(r.status.accelerator,'cpu');
});
test('GPU load failure releases worker before CPU retry',async()=>{
 const x=setup(async(e,n)=>{if(n)throw Error('GPU memory exhausted');assert.equal(x.disposed.length,1);});
 const r=await loadAccelerated(x.options);assert.deepEqual(x.calls,[99,0]);assert.equal(r.status.accelerator,'cpu');assert.match(r.status.accelerationNote,/GPU loading failed/);
});
test('silent runtime CPU fallback is reported as CPU',async()=>{
 const x=setup(async e=>e.observe('offloaded 0/29 layers to GPU'));assert.equal((await loadAccelerated(x.options)).status.accelerator,'cpu');
});
test('missing telemetry never claims confirmed GPU',async()=>{
 const x=setup(async()=>{});const r=await loadAccelerated(x.options);assert.equal(r.status.accelerator,'unconfirmed');assert.match(accelerationLabel(r.status),/unconfirmed/);
});
test('cancel during GPU loading disposes worker and does not retry',async()=>{
 const x=setup(async(e,n,c)=>c.abort());await assert.rejects(loadAccelerated(x.options),{name:'AbortError'});assert.deepEqual(x.calls,[99]);assert.equal(x.disposed.length,1);
});
test('failed CPU retry also disposes and surfaces error',async()=>{
 const x=setup(async()=>{throw Error('bad model');});await assert.rejects(loadAccelerated(x.options),/bad model/);assert.equal(x.disposed.length,2);
});
