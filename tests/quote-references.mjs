import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lm-quotes-'));
const file=path.join(tmp,'refs.cjs');
await require('esbuild').build({entryPoints:[new URL('../frontend/src/private/quoteReferences.ts',import.meta.url).pathname],outfile:file,bundle:true,platform:'node',format:'cjs'});
const {quoteReferences}=require(file);
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));
const first='A process is a program in execution.';
const second='The scheduler selects the next process to run.';
const schema={type:'object',properties:{questions:{type:'array',items:{type:'object',properties:{quote:{type:'string',enum:[first,second]},question:{type:'string'}}}}}};
test('short references restore exact nested citations and leave prose untouched',()=>{
 const original=structuredClone(schema),prompt=`REFERENCE:\n${first}\n${second}`;
 const wire=quoteReferences(schema,prompt);
 assert.deepEqual(schema,original);
 assert.ok(wire.prompt.includes(`[Q1] ${first}`));
 assert.ok(wire.prompt.includes(`[Q2] ${second}`));
 assert.deepEqual(wire.schema.properties.questions.items.properties.quote.enum,['Q1','Q2']);
 const response={questions:[{quote:'Q2',question:'Q1 is just prose here'}]};
 assert.deepEqual(wire.restore(response),{questions:[{quote:second,question:'Q1 is just prose here'}]});
 assert.equal(response.questions[0].quote,'Q2');
 assert.ok(JSON.stringify(wire.schema).length<JSON.stringify(schema).length);
});
test('all source text survives in order without duplication',()=>{
 const prompt=`REFERENCE:\n${first}\n${second}`;
 const wire=quoteReferences(schema,prompt);
 assert.equal(wire.prompt.split('\nFor each quote field')[0].replace(/\[Q\d+\] /g,''),prompt);
});
test('overlapping or absent candidates remain exact literals',()=>{
 const full='A process is a program in execution. It has state.';
 const s={properties:{quote:{type:'string',enum:[full,first,'Absent from this source.','']}}};
 const wire=quoteReferences(s,full);
 assert.deepEqual(wire.schema.properties.quote.enum,['Q1',first,'Absent from this source.','']);
 assert.deepEqual(wire.restore({quote:''}),{quote:''});
 assert.deepEqual(wire.restore({quote:first}),{quote:first});
});
test('schemas without grounded enums are unchanged',()=>{
 const plain={properties:{quote:{type:'string'}}};
 const wire=quoteReferences(plain,first);
 assert.equal(wire.schema,plain);assert.equal(wire.prompt,first);
});
