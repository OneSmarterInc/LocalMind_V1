// The on-device model's replies are parsed by extractJsonObject in
// src/private/device.native.ts. These are the shapes a phone actually
// produced: a markdown fence, a sentence of preamble, a <think> block.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'frontend/src/private/device.native.ts'), 'utf8');
const start = source.indexOf('export function extractJsonObject');
assert.ok(start > 0, 'extractJsonObject not found in device.native.ts');
const end = source.indexOf('\n}\n', start) + 3;
// Strip the few type annotations so the real implementation runs as plain JS.
const body = source.slice(start, end).replace(/\(raw:string\)/, '(raw)').replace(/let failure:unknown;/, 'let failure;');

const file = join(mkdtempSync(join(tmpdir(), 'localmind-ai-')), 'extract.mjs');
writeFileSync(file, `function requireThat(c,m){if(!c)throw new Error(m);}\n${body}`);
// import() takes a URL: a plain Windows path (C:\...) is read as the
// scheme "c:" and refused, so the test failed on Windows only.
const {extractJsonObject} = await import(pathToFileURL(file).href);

test('plain object', () => assert.deepEqual(extractJsonObject('{"a":1}'), {a: 1}));
test('markdown json fence', () => assert.deepEqual(extractJsonObject('```json\n{"a":1}\n```'), {a: 1}));
test('plain fence', () => assert.deepEqual(extractJsonObject('```\n{"a":1}\n```'), {a: 1}));
test('sentence of preamble', () => assert.deepEqual(extractJsonObject('The answer is:\n{"a":1}'), {a: 1}));
test('closed think block', () => assert.deepEqual(extractJsonObject('<think>weighing {options}</think>{"a":1}'), {a: 1}));
test('unclosed think block is refused', () => assert.throws(() => extractJsonObject('<think>only reasoning'), /structured answer/));
test('nested object keeps the outermost', () => assert.deepEqual(extractJsonObject('x {"a":{"b":2}} y'), {a: {b: 2}}));
test('trailing prose', () => assert.deepEqual(extractJsonObject('{"a":1}\nHope that helps!'), {a: 1}));
test('no object at all is refused', () => assert.throws(() => extractJsonObject('I cannot answer that.'), /structured answer/));
test('malformed json is still refused', () => assert.throws(() => extractJsonObject('{"a":')));
test('fence inside a string value', () => assert.deepEqual(extractJsonObject('{"a":"see ```code```"}'), {a: 'see ```code```'}));
