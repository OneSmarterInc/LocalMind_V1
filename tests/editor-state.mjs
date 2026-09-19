import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..');
const require=createRequire(path.join(root,'frontend/package.json'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lm-editor-'));
const fixtures={
 react:`export const useState=(...a)=>globalThis.hooks.state(...a);export const useRef=(...a)=>globalThis.hooks.ref(...a);export const useEffect=(...a)=>globalThis.hooks.effect(...a);export const useCallback=(...a)=>globalThis.hooks.callback(...a);`,
 'expo-router':`const navigation={addListener:()=>()=>{},dispatch:()=>{}};const router={canGoBack:()=>true,back:()=>{}};export const useNavigation=()=>navigation;export const useRouter=()=>router;export const useFocusEffect=fn=>{globalThis.focusRefresh=fn;};`,
 'react-native':`export const Platform={get OS(){return globalThis.testPlatform||'test';}};export const BackHandler={addEventListener:()=>({remove(){}})};`,
 '@/api/client':`export class ApiError extends Error{};export class SessionChangedError extends Error{};export const errorMessage=e=>String(e);`,
};
await require('esbuild').build({stdin:{contents:`export {useDraft} from '${root}/frontend/src/hooks/useDraft';export {useAsync} from '${root}/frontend/src/hooks/useAsync';export {clearDraftStash} from '${root}/frontend/src/hooks/draftStash';`,resolveDir:root,loader:'ts'},outfile:path.join(tmp,'hooks.cjs'),bundle:true,platform:'node',plugins:[{name:'fixtures',setup(b){
 b.onResolve({filter:/.*/},a=>a.path.endsWith('unsavedGuard')?{path:'guard',namespace:'fixture'}:Object.hasOwn(fixtures,a.path)?{path:a.path,namespace:'fixture'}:undefined);
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='guard'?'export const confirmLeave=async()=>true; export const registerGuard=()=>()=>{};':fixtures[a.path]}));
}}]});
const {useDraft,useAsync,clearDraftStash}=require(path.join(tmp,'hooks.cjs'));
const sameDeps=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
function mount(render){
 const slots=[];let cursor=0,pending=[],changed=true,result;
 const h={
  state(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;changed=true;}}];},
  ref(value){const i=cursor++;return slots[i]??(slots[i]={current:value});},
  effect(fn,deps){const i=cursor++,old=slots[i];if(!sameDeps(old?.deps,deps)){slots[i]={deps,cleanup:old?.cleanup};pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}},
  callback(fn,deps){const i=cursor++;if(!sameDeps(slots[i]?.deps,deps))slots[i]={deps,fn};return slots[i].fn;},
 };
 return {flush(){globalThis.hooks=h;changed=true;for(let n=0;changed;n++){assert.ok(n<30,'render must settle');changed=false;cursor=0;result=render();const effects=pending;pending=[];effects.forEach(fn=>fn());}return result;},unmount(){slots.forEach(s=>s.cleanup?.());}};
}
test('dirty editor survives refreshed data, saves only sent edits, and recovers after unmount',()=>{
 clearDraftStash();let source={id:'a',name:'original'};const options={label:()=> 'profile',save:async()=>true};
 let h=mount(()=>useDraft(source,options));let state=h.flush();state.edit(d=>({...d,name:'edited'}));state=h.flush();assert.equal(state.dirty,true);
 source={id:'a',name:'server refresh'};state=h.flush();assert.equal(state.draft.name,'edited');assert.equal(state.changedMeanwhile,true);
 const sent=state.draft;state.edit(d=>({...d,name:'newer edit'}));state=h.flush();state.markSaved(sent);state=h.flush();assert.equal(state.dirty,true);
 h.unmount();h=mount(()=>useDraft(source,options));state=h.flush();assert.equal(state.draft.name,'newer edit');assert.equal(state.dirty,true);state.discard();h.flush();h.unmount();
});
test('record switch never renders the previous draft under a new resource',()=>{
 clearDraftStash();let source={id:'a',name:'first'};const h=mount(()=>useDraft(source,{label:()=> 'profile',save:async()=>true}));let state=h.flush();state.edit(d=>({...d,name:'first edited'}));h.flush();source={id:'b',name:'second'};state=h.flush();assert.equal(state.draft.id,'b');assert.equal(state.draft.name,'second');h.unmount();
});
test('sign-out invalidates recovery before an old editor unmounts',()=>{
 clearDraftStash();const source={id:'same',name:'original'};const render=()=>useDraft(source,{label:()=> 'profile',save:async()=>true});const first=mount(render);first.flush().edit(d=>({...d,name:'private edit'}));first.flush();clearDraftStash();first.unmount();const second=mount(render);assert.equal(second.flush().draft.name,'original');second.unmount();
});
test('async resource changes clear old data and ignore an older response',async()=>{
 let id='a';const deferred={};const h=mount(()=>useAsync(()=>new Promise((resolve,reject)=>{deferred[id]={resolve,reject};}),[id]));h.flush();deferred.a.resolve('A');await new Promise(r=>setImmediate(r));assert.equal(h.flush().data,'A');
 let state=h.flush();void state.reload();const old=deferred.a;id='b';state=h.flush();assert.equal(state.data,null);assert.equal(state.loading,true);old.resolve('late A');await new Promise(r=>setImmediate(r));assert.equal(h.flush().data,null);deferred.b.reject(new Error('B failed'));await new Promise(r=>setImmediate(r));state=h.flush();assert.equal(state.data,null);assert.match(state.error,/B failed/);h.unmount();
});
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));

test('overlapping lifecycle refreshes coalesce but explicit mutation reload stays fresh',async()=>{
 globalThis.testPlatform='web';const events={};
 globalThis.document={visibilityState:'visible',addEventListener:(n,f)=>{events[n]=f;},removeEventListener:()=>{}};
 globalThis.addEventListener=(n,f)=>{events[n]=f;};globalThis.removeEventListener=()=>{};
 const requests=[];const h=mount(()=>useAsync(()=>new Promise(resolve=>requests.push(resolve)),[]));
 try {
  const state=h.flush();events.focus();events.visibilitychange();globalThis.focusRefresh();globalThis.focusRefresh();assert.equal(requests.length,1);
  const explicit=state.reload();assert.equal(requests.length,2);
  requests[1]('fresh');await explicit;requests[0]('stale');await new Promise(r=>setImmediate(r));assert.equal(h.flush().data,'fresh');
  events.focus();assert.equal(requests.length,3);requests[2]('next');await new Promise(r=>setImmediate(r));assert.equal(h.flush().data,'next');
 } finally {h.unmount();delete globalThis.testPlatform;delete globalThis.document;delete globalThis.addEventListener;delete globalThis.removeEventListener;}
});
