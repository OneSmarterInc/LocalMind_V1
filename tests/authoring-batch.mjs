import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import test from 'node:test';
const tmp=mkdtempSync(join(tmpdir(),'lm-batch-'));
const compiled=spawnSync(process.execPath,['frontend/node_modules/typescript/bin/tsc','--strict','--target','ES2022','--module','commonjs','--skipLibCheck','--outDir',tmp,'frontend/src/authoring/batch.ts'],{encoding:'utf8'});
assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
const {runMissingBatch}=createRequire(import.meta.url)(resolve(tmp,'batch.js'));
process.on('exit',()=>rmSync(tmp,{recursive:true,force:true}));
test('failure retains completed work and restarting generates only missing modules',async()=>{
 const saved={a:{},b:{},c:{}};const calls=[];let fail=true;
 const config={ids:['a','b','c'],kind:'lesson',signal:new AbortController().signal,read:async id=>saved[id],progress:()=>{},generate:async id=>{calls.push(id);if(id==='b'&&fail)throw Error('Model interrupted');saved[id].lesson={complete:true};}};
 await assert.rejects(runMissingBatch(config),/Model interrupted/);assert.deepEqual(calls,['a','b']);assert.ok(saved.a.lesson);assert.equal(saved.c.lesson,undefined);
 fail=false;await runMissingBatch(config);assert.deepEqual(calls,['a','b','b','c']);
});
test('cancel after a completed module does not begin the next one',async()=>{
 const controller=new AbortController(),calls=[];
 await assert.rejects(runMissingBatch({ids:['a','b'],kind:'quiz',signal:controller.signal,read:async()=>({}),progress:()=>{},generate:async id=>{calls.push(id);controller.abort();}}),/cancelled/);
 assert.deepEqual(calls,['a']);
});
test('quiz batches skip saved questions but not empty arrays or lessons',async()=>{
 const calls=[];await runMissingBatch({ids:['a','b','b','c'],kind:'quiz',signal:new AbortController().signal,read:async id=>id==='a'?{questions:[{}]}:id==='b'?{questions:[]}:{lesson:{}},generate:async id=>calls.push(id),progress:()=>{}});assert.deepEqual(calls,['b','c']);
});
