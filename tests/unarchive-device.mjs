import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'frontend/package.json'));
const fixture={
 '@/private/device': 'export async function device(){return globalThis.store;}',
 '@/authoring/local': 'export class LocalAuthoring{constructor(owner){const session=globalThis.session;this.library={prefix:owner+":",guard(){if(session!==globalThis.session)throw Error("Session changed");}};}}',
 '@/api/endpoints': 'export const manage={document:(...args)=>globalThis.getDocument(...args),unarchiveDocument:(...args)=>globalThis.unarchive(...args)};',
 '@/api/client': 'export class ApiError extends Error{}',
 '@/private/library': 'export class Library{}',
 '@/private/jobs': 'export const generationJobs={};',
 '@/private/useGenerationJobs': 'export const jobScope=x=>x;',
 '@/ui': 'export const confirmAsync=async()=>true;',
};
const result=await require('esbuild').build({entryPoints:[path.join(root,'frontend/src/documents/remove.ts')],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'fixtures',setup(b){
 b.onResolve({filter:/.*/},a=>Object.hasOwn(fixture,a.path)?{path:a.path,namespace:'fixture'}:undefined);
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:fixture[a.path],loader:'js'}));
}}]});
const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
const {unarchiveBook,clearRemovedBook}=module.exports;
function setup(){globalThis.session=1;const records=new Map([['owner:removed:book',true],['other:removed:book',true]]);
 globalThis.store={get:async k=>records.get(k),removePrefix:async k=>records.delete(k)};
 globalThis.getDocument=async(id,cacheOffline)=>{assert.equal(cacheOffline,false);return {status:'unpublished'};};
 globalThis.unarchive=async()=>({status:'unpublished'});return records;
}
test('successful unarchive clears only this owner book flag',async()=>{const rows=setup();await unarchiveBook('book','owner');assert.equal(rows.has('owner:removed:book'),false);assert.equal(rows.has('other:removed:book'),true);});
test('failed unarchive retains the local removal flag',async()=>{const rows=setup();globalThis.unarchive=async()=>{throw Error('Forbidden');};await assert.rejects(unarchiveBook('book','owner'),/Forbidden/);assert.equal(rows.get('owner:removed:book'),true);});
test('fresh cross-device restoration clears a stale local flag',async()=>{const rows=setup();await clearRemovedBook('book','owner');assert.equal(rows.has('owner:removed:book'),false);});
test('archived or unreachable server never re-enables generation from stale list data',async()=>{const rows=setup();globalThis.getDocument=async()=>({status:'archived'});await clearRemovedBook('book','owner');assert.equal(rows.get('owner:removed:book'),true);globalThis.getDocument=async()=>{throw Error('Offline');};await assert.rejects(clearRemovedBook('book','owner'),/Offline/);assert.equal(rows.get('owner:removed:book'),true);});
test('account switching during the request cannot clear a flag',async()=>{const rows=setup();globalThis.unarchive=async()=>{globalThis.session=2;};await assert.rejects(unarchiveBook('book','owner'),/Session changed/);assert.equal(rows.get('owner:removed:book'),true);});
