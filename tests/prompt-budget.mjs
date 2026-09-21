import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const {build}=require('esbuild');
const built=await build({entryPoints:[fileURLToPath(new URL('../frontend/src/private/promptBudget.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false});
const m={exports:{}};new Function('module','exports',built.outputFiles[0].text)(m,m.exports);
const {exceedsContext,avoidList,CONTEXT_OVERFLOW_MESSAGE,AVOID_RECENT,AVOID_CHARS}=m.exports;
// Same pattern library.ts uses to trigger its passage-halving retry.
const RETRY=/(?:exceeds|exceeded|too long|too large).*context|context.*(?:exceeds|exceeded|too long|too large|limit)/i;
const system='x'.repeat(620);
test('overflow message triggers the existing passage-halving retry',()=>{assert.match(CONTEXT_OVERFLOW_MESSAGE,RETRY);});
test('single-module lesson and quiz prompts still fit',()=>{
 assert.equal(exceedsContext(system,'p'.repeat(600)+'s'.repeat(3200),800),false);
 assert.equal(exceedsContext(system,'p'.repeat(600)+'q'.repeat(6*160)+'s'.repeat(3200),1200),false);
});
test('old 30-question avoid list overflowed; capped list fits',()=>{
 const questions=Array.from({length:29},(_,i)=>`Question ${i} `+'w'.repeat(200));
 const old=questions.map(q=>q.slice(0,160)).join('\n');
 assert.equal(exceedsContext(system,'p'.repeat(600)+old+'s'.repeat(3200),1200),true);
 assert.equal(exceedsContext(system,'p'.repeat(600)+avoidList(questions)+'s'.repeat(3200),1200),false);
});
test('avoid list keeps only the most recent questions, truncated',()=>{
 const questions=Array.from({length:20},(_,i)=>`Q${i} `+'z'.repeat(300));
 const lines=avoidList(questions).split('\n');
 assert.equal(lines.length,AVOID_RECENT);assert.ok(lines[0].startsWith('Q12 '));
 assert.ok(lines.every(l=>l.length<=AVOID_CHARS));
 assert.equal(avoidList([]),'');
});
