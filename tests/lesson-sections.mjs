// Item 20: a module merged from short book sections is taught section by section.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'frontend/package.json'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lm-lesson-sections-'));process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));
await require('esbuild').build({entryPoints:[path.join(root,'frontend/src/private/core.ts')],outfile:path.join(tmp,'core.cjs'),bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
const {headingPassages,passageHeading,lessonPassages}=require(path.join(tmp,'core.cjs'));
const merged=`## Module 1.1 — Appointment Records
An appointment table may include Patient Reference, Appointment Date, Department, Doctor, Visit Type, Arrival Time, and Status. Use anonymized identifiers in analytical datasets.

## Module 1.2 — Department Summary
A department summary can count appointments, completed visits, cancellations, and no-shows. COUNTIF and COUNTIFS are useful for category-based reporting.`;
test('each original heading in a merged module gets its own lesson part',()=>{
 const parts=headingPassages(merged,2800);
 assert.equal(parts.length,2);
 assert.equal(passageHeading(parts[0]),'Module 1.1 — Appointment Records');
 assert.equal(passageHeading(parts[1]),'Module 1.2 — Department Summary');
 assert.match(parts[1],/COUNTIFS/);
 assert.equal(lessonPassages(merged,2800).length,1,'the old split put both in one part');
});
test('text without headings is split exactly as before',()=>{
 const plain='A process is a program in execution. '.repeat(200);
 assert.deepEqual(headingPassages(plain,2800),lessonPassages(plain,2800));
});
test('a long section is still split by size, and no text is lost',()=>{
 const long=`## Long section\n${'Occupancy is occupied beds divided by available beds. '.repeat(120)}\n## Short\nCapacity planning compares admissions and discharges.`;
 const parts=headingPassages(long,2800);
 assert.ok(parts.length>=3);
 assert.ok(parts.every(p=>p.length<=2800));
 const words=s=>s.replace(/\s+/g,' ').trim();
 assert.equal(words(parts.join(' ')),words(long));
});
test('a heading directly followed by another heading stays with its section',()=>{
 const parts=headingPassages('# Chapter 1\n## Module 1.1\nBody one.\n## Module 1.2\nBody two.',2800);
 assert.equal(parts.length,2);
 assert.match(parts[0],/Chapter 1[\s\S]*Body one/);
});
