import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lm-history-'));
await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../frontend/src/hooks/webHistory.ts',import.meta.url))],outfile:path.join(dir,'history.cjs'),bundle:true,platform:'node',plugins:[{name:'guards',setup(b){b.onResolve({filter:/unsavedGuard$/},()=>({path:'guards',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const hasUnsavedWork=()=>globalThis.dirty; export const confirmLeave=()=>globalThis.confirmLeaving();'}));}}]});
function setup(){
 delete require.cache[require.resolve(path.join(dir,'history.cjs'))];
 const entries=[{state:{id:'root'},url:'/manage'}];let index=0;const listeners=[];const delivered=[];
 const location={origin:'http://localhost',pathname:'/manage',search:''};
 const locate=url=>{const parsed=new URL(url,location.origin);location.pathname=parsed.pathname;location.search=parsed.search;};
 const history={get state(){return entries[index].state;},pushState(state,title,url){entries.splice(++index);entries.push({state,url});locate(url);},replaceState(state,title,url){entries[index]={state,url:url??entries[index].url};locate(entries[index].url);},go(delta){const next=index+delta;if(next<0||next>=entries.length)return;index=next;locate(entries[index].url);queueMicrotask(()=>{let stopped=false;const event={state:entries[index].state,stopImmediatePropagation(){stopped=true;}};for(const fn of listeners){fn(event);if(stopped)break;}if(!stopped)delivered.push(location.pathname+location.search);});}};
 globalThis.window={history,location,addEventListener(name,fn){if(name==='popstate')listeners.push(fn);}};
 globalThis.dirty=false;globalThis.confirmLeaving=async()=>false;
 const api=require(path.join(dir,'history.cjs'));api.installWebHistoryGuard();
 return {api,history,location,delivered,entries};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('cancelled Back restores URL and never delivers a navigation to the router',async()=>{
 const x=setup();x.history.pushState({id:'list'},'','/manage/books');x.history.pushState({id:'detail'},'','/manage/document/one');globalThis.dirty=true;
 x.history.go(-1);await settle();assert.equal(x.location.pathname,'/manage/document/one');assert.deepEqual(x.delivered,[]);assert.equal(x.history.state.id,'detail');
});
test('accepted Back and Forward each navigate once after the guard',async()=>{
 const x=setup();x.history.pushState({id:'list'},'','/manage/books');x.history.pushState({id:'detail'},'','/manage/document/one');let prompts=0;globalThis.dirty=true;globalThis.confirmLeaving=async()=>{prompts++;globalThis.dirty=false;return true;};
 x.history.go(-1);await settle();assert.equal(x.location.pathname,'/manage/books');assert.deepEqual(x.delivered,['/manage/books']);
 globalThis.dirty=true;x.history.go(1);await settle();assert.equal(x.location.pathname,'/manage/document/one');assert.equal(prompts,2);assert.equal(x.delivered.length,2);
});
test('contextual parent traverses existing history without inserting a duplicate',async()=>{
 const x=setup();x.history.pushState({id:'quiz'},'','/manage/quiz/one?tab=attempts');x.history.pushState({id:'attempt'},'','/manage/attempt/two?quiz=one');
 assert.equal(x.api.backToKnownWebParent('/manage/quiz/one?tab=attempts'),true);await settle();assert.equal(x.location.pathname,'/manage/quiz/one');assert.equal(x.entries.length,3);
 assert.equal(x.api.backToKnownWebParent('/admin/subjects'),false);
});
test('parent URL interpolates resource IDs and retains contextual query parameters',()=>{
 const {api}=setup();assert.equal(api.parentHref({pathname:'/manage/quiz/[id]',params:{id:'one',tab:'attempts'}}),'/manage/quiz/one?tab=attempts');
});
process.on('exit',()=>fs.rmSync(dir,{recursive:true,force:true}));
