// Item 7: the web model can live in a folder the user chooses, moves between
// locations are verified, and failures never lose the installed model.
// Browser APIs (IndexedDB, OPFS, File System Access) are small in-memory fakes.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..');
const require=createRequire(path.join(root,'frontend/package.json'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lm-model-storage-'));
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));
await require('esbuild').build({entryPoints:[path.join(root,'frontend/src/private/device.web.ts')],outfile:path.join(tmp,'web.cjs'),bundle:true,platform:'node',format:'cjs',logLevel:'silent',
 plugins:[{name:'stubs',setup(b){b.onResolve({filter:/generated\/parserAsset$/},()=>({path:'parser',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({loader:'js',contents:"export const PARSER_ASSET='/parser.js';"}));}}]});

// ---- fakes ----
class Dir{constructor(name,{failWrites=false}={}){this.name=name;this.kind='directory';this.entries=new Map();this.failWrites=failWrites;this.perm='granted';}
 async getDirectoryHandle(n,o={}){if(!this.entries.has(n)){if(!o.create)throw Object.assign(new Error('NotFound'),{name:'NotFoundError'});this.entries.set(n,new Dir(n));}return this.entries.get(n);}
 async getFileHandle(n,o={}){if(!this.entries.has(n)){if(!o.create)throw Object.assign(new Error('NotFound'),{name:'NotFoundError'});this.entries.set(n,new FileH(this,n));}return this.entries.get(n);}
 async removeEntry(n){if(!this.entries.delete(n))throw Object.assign(new Error('NotFound'),{name:'NotFoundError'});}
 async queryPermission(){return this.perm;} async requestPermission(){if(this.perm==='prompt')this.perm=this.grantOnRequest?'granted':'denied';return this.perm;}
 files(){return [...this.entries.keys()].filter(k=>this.entries.get(k) instanceof FileH).sort();}}
class FileH{constructor(dir,name){this.dir=dir;this.name=name;this.kind='file';this.bytes=new Uint8Array();}
 async getFile(){return new File([this.bytes],this.name);}
 async createWritable(){if(this.dir.failWrites)throw new Error('disk full');const parts=[];const h=this;return {write:async v=>{parts.push(new Uint8Array(v));},close:async()=>{h.bytes=new Uint8Array(Buffer.concat(parts));},abort:async()=>{}};}
 async move(n){this.dir.entries.delete(this.name);this.name=n;this.dir.entries.set(n,this);}}
function fakeIndexedDB(){const data=new Map();
 const req=()=>({});
 const store={get:k=>Object.assign(req(),{result:data.get(k)}),put:(v,k)=>{data.set(k,v);return req();},
  getAll:r=>Object.assign(req(),{result:[...data.entries()].filter(([k])=>r.includes(k)).sort().map(([,v])=>v)}),
  delete:r=>{for(const k of [...data.keys()])if(r.includes(k))data.delete(k);return req();}};
 const database={createObjectStore(){},transaction(){const t={objectStore:()=>store};setTimeout(()=>t.oncomplete?.());return t;}};
 return {open(){const r={result:database};setTimeout(()=>{r.onupgradeneeded?.();r.onsuccess?.();});return r;}};}
globalThis.IDBKeyRange={bound:(a,b)=>({includes:k=>k>=a&&k<=b})};
let opfs,picked,pickerCount=0;
function reset({pickerAvailable=true,folder}={}){
 globalThis.indexedDB=fakeIndexedDB();opfs=new Dir('opfs');picked=folder||new Dir('LocalMind models');pickerCount=0;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{storage:{getDirectory:async()=>opfs,estimate:async()=>({usage:1,quota:100}),persisted:async()=>true},hardwareConcurrency:4}});
 globalThis.window={isSecureContext:true,...(pickerAvailable?{showDirectoryPicker:async()=>{pickerCount++;return picked;}}:{})};
 globalThis.crypto??=require('node:crypto').webcrypto;
}
const load=()=>{delete require.cache[path.join(tmp,'web.cjs')];return require(path.join(tmp,'web.cjs')).device();};
const gguf=()=>new File([new Uint8Array([71,71,85,70,1,2,3,4,5,6])],'test.gguf');
const model=dir=>(dir===opfs?(opfs.entries.get('localmind-ai')||new Dir('empty')):dir).files().filter(n=>n.endsWith('.gguf'));

test('default stays in browser storage, exactly as before',async()=>{
 reset();const d=await load();
 await d.importModel({name:'test.gguf',uri:'x',file:gguf()},()=>{});
 const s=await d.status();assert.equal(s.installed,true);assert.equal(s.location,'browser');
 assert.equal(model(opfs).length,1);assert.equal((await d.storage()).location,'browser');
});
test('choosing a folder copies, verifies, names the file, and removes the browser copy',async()=>{
 reset();const d=await load();
 await d.importModel({name:'test.gguf',uri:'x',file:gguf()},()=>{});
 const st=await d.chooseModelFolder(()=>{});
 assert.equal(pickerCount,1);assert.equal(st.location,'folder');assert.equal(st.folderName,'LocalMind models');
 assert.deepEqual(model(picked),['test.gguf']);assert.deepEqual(model(opfs),[]);
 const s=await d.status();assert.equal(s.installed,true);assert.equal(s.location,'folder');
});
test('new imports go straight to the chosen folder',async()=>{
 reset();const d=await load();
 await d.chooseModelFolder(()=>{});
 await d.importModel({name:'test.gguf',uri:'x',file:gguf()},()=>{});
 assert.deepEqual(model(picked),['test.gguf']);assert.deepEqual(model(opfs),[]);
});
test('lost folder permission is reported and can be granted again',async()=>{
 reset();const d=await load();
 await d.importModel({name:'test.gguf',uri:'x',file:gguf()},()=>{});await d.chooseModelFolder(()=>{});
 picked.perm='prompt';picked.grantOnRequest=true;
 let s=await d.status();assert.equal(s.installed,false);assert.equal(s.needsPermission,true);
 assert.equal((await d.storage()).needsPermission,true);
 assert.equal(await d.grantModelFolder(),true);
 s=await d.status();assert.equal(s.installed,true);
});
test('a failed copy keeps the model where it was',async()=>{
 reset({folder:new Dir('Full disk',{failWrites:true})});const d=await load();
 await d.importModel({name:'test.gguf',uri:'x',file:gguf()},()=>{});
 await assert.rejects(d.chooseModelFolder(()=>{}),/disk full/);
 const s=await d.status();assert.equal(s.installed,true);assert.equal(s.location,'browser');
 assert.equal((await d.storage()).location,'browser');assert.equal(model(opfs).length,1);
});
test('moving back to browser storage copies and removes the folder file',async()=>{
 reset();const d=await load();
 await d.importModel({name:'test.gguf',uri:'x',file:gguf()},()=>{});await d.chooseModelFolder(()=>{});
 const st=await d.useBrowserStorage(()=>{});
 assert.equal(st.location,'browser');assert.deepEqual(model(picked),[]);assert.equal(model(opfs).length,1);
 assert.equal((await d.status()).installed,true);
});
test('browsers without folder support explain instead of failing silently',async()=>{
 reset({pickerAvailable:false});const d=await load();
 assert.equal((await d.storage()).canChooseFolder,false);
 await assert.rejects(d.chooseModelFolder(()=>{}),/Chrome or Edge/);
});
