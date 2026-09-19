import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'frontend/package.json'));
const {build}=require('esbuild');
async function compile(contents,plugins=[]){
 const b=await build({stdin:{contents,resolveDir:path.join(root,'frontend')},bundle:true,platform:'node',format:'cjs',write:false,plugins});
 const m={exports:{}};new Function('require','module','exports',b.outputFiles[0].text)(require,m,m.exports);return m.exports;
}
const {TabRouter,portalRouter,tabRouterOverride}=await compile("export {TabRouter} from '@react-navigation/routers';export {portalRouter} from './src/hooks/portalRouter';export {tabRouterOverride} from 'expo-router/build/layouts/TabRouter';");
const routes={
 admin:[['user/new','users',{kind:'faculty'}],['user/import','users',{kind:'students'}],['user/[id]','users',{kind:'faculty'}],['subject/new','subjects',{}],['subject/[id]','subjects',{}],['incident/[id]','monitoring',{}],['monitor-policies','monitoring',{}],['system','index',{}],['content','index',{}]],
 manage:[['document/[id]','books',{}],['document/upload','books',{}],['local-authoring/[id]','document/[id]',{id:'book',tab:'outline',module:'module'}],['local-batch','books',{}],['subject/[id]','subjects',{}],['student/[id]','subject/[id]',{id:'subject',tab:'students'}],['quiz/new','quizzes',{}],['quiz/[id]','quizzes',{}],['attempt/[id]','quiz/[id]',{id:'quiz',tab:'attempts'}],['local-quizzes','quizzes',{}]],
 student:[['module/[id]','document/[id]',{id:'book'}],['document/[id]','subject/[id]',{id:'subject'}],['attempt/[id]','quizzes',{}],['quiz/[id]','quizzes',{}],['private-book/[id]','private-library',{}]],
};
function setup(names,initial){
 const options={routeNames:names,routeParamList:{},routeGetIdList:{}};
 const original=TabRouter({initialRouteName:initial,backBehavior:'fullHistory'});
 const router={...original,...portalRouter(original)};
 return {original,router,options,state:router.getInitialState(options)};
}
function act(x,type,name,params={},state=x.state){return x.router.getStateForAction(state,{type,target:state.key,payload:{name,params}},x.options);}
for(const [portal,pairs] of Object.entries(routes)){
 const layout=fs.readFileSync(path.join(root,`frontend/app/${portal}/_layout.tsx`),'utf8');
 const names=[...layout.matchAll(/Tabs.Screen name="([^"]+)"/g)].map(m=>m[1]);
 test(`${portal} installs the compatible router with full browser history`,()=>{
  assert.match(layout,/PortalTabs as Tabs/);assert.match(layout,/backBehavior="fullHistory"/);assert.match(layout,/UNSTABLE_router=\{portalRouter\}/);
 });
 for(const [from,to,params] of pairs){
  test(`${portal}: direct-entry ${from} returns to ${to} with context`,()=>{
   const x=setup(names,from),next=act(x,'POP_TO',to,params);
   assert.ok(next);assert.equal(next.routes[next.index].name,to);assert.deepEqual(next.routes[next.index].params,params);assert.equal(next.history.length,1);
  });
 }
}
test('plain tab router reproduces rejected stack actions; adapter supports them',()=>{
 const x=setup(['books','document','result'],'document');
 for(const type of ['POP_TO','REPLACE']){
  const action={type,payload:{name:'books'}};
  assert.equal(x.original.getStateForAction(x.state,action,x.options),null);
  assert.equal(act(x,type,'books').routes[0].name,'books');
 }
});
test('completion replaces current history entry; Back skips completed form',()=>{
 const x=setup(['home','form','result'],'home');
 const form=act(x,'NAVIGATE','form');const result=act(x,'REPLACE','result',{id:'saved'},form);
 assert.equal(result.history.length,form.history.length);
 const back=x.router.getStateForAction(result,{type:'GO_BACK'},x.options);
 assert.equal(back.routes[back.index].name,'home');
});
test('parent traversal restores the requested list filter and removes later visits',()=>{
 const x=setup(['home','users','detail'],'home');
 let s=act(x,'NAVIGATE','users',{kind:'faculty'});
 s=act(x,'NAVIGATE','detail',{id:'one'},s);
 s=act(x,'NAVIGATE','users',{kind:'students'},s);
 s=act(x,'NAVIGATE','detail',{id:'two'},s);
 s=act(x,'POP_TO','users',{kind:'faculty'},s);
 assert.equal(s.history.length,2);assert.deepEqual(s.routes[s.index].params,{kind:'faculty'});
});
test('same-screen replacement clears obsolete draft query parameters',()=>{
 const x=setup(['home','drafts'],'home');
 const selected=act(x,'NAVIGATE','drafts',{id:'draft'});
 const all=act(x,'REPLACE','drafts',{},selected);
 assert.deepEqual(all.routes[all.index].params,{});assert.equal(all.history.length,selected.history.length);
});
test('unknown targets and other navigator actions remain unhandled',()=>{
 const x=setup(['home','books'],'home');
 assert.equal(act(x,'REPLACE','missing'),null);
 assert.equal(x.router.getStateForAction(x.state,{type:'REPLACE',target:'other',payload:{name:'books'}},x.options),null);
});
const {useBackTo}=await compile("export {useBackTo} from './src/hooks/useBackTo';",[{name:'hook-fixture',setup(b){
 b.onResolve({filter:/^(react|expo-router|\.\/unsavedGuard|\.\/webHistory)$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='react'?'export const useCallback=f=>f;':a.path==='expo-router'?'export const useRouter=()=>globalThis.navigationRouter;':a.path==='./unsavedGuard'?'export const confirmLeave=()=>globalThis.navigationConfirm();':'export const parentHref=to=>typeof to==="string"?to:to.pathname;export const backToKnownWebParent=()=>globalThis.knownParent;',loader:'js'}));
}}]);
test('parent buttons honor Stay and use history before the direct-entry fallback',async()=>{
 const calls=[];globalThis.navigationRouter={dismissTo:to=>calls.push(to)};
 globalThis.navigationConfirm=async()=>false;globalThis.knownParent=false;
 const back=useBackTo();back('/manage/books');await new Promise(r=>setImmediate(r));assert.deepEqual(calls,[]);
 globalThis.navigationConfirm=async()=>true;globalThis.knownParent=true;
 back('/manage/books');await new Promise(r=>setImmediate(r));assert.deepEqual(calls,[]);
 globalThis.knownParent=false;back('/manage/books');await new Promise(r=>setImmediate(r));assert.deepEqual(calls,['/manage/books']);
});

test('stock Expo override leaves dismissTo unhandled and appends on replace to first tab',()=>{
 const x=setup(['home','form','result'],'home');
 const stock={...x.original,...tabRouterOverride(x.original)};
 const form=act(x,'NAVIGATE','form');
 assert.equal(stock.getStateForAction(form,{type:'POP_TO',payload:{name:'home'}},x.options),null);
 const old=stock.getStateForAction(form,{type:'REPLACE',payload:{name:'home'}},x.options);
 assert.equal(old.history.length,3);
 const fixed=act(x,'REPLACE','home',{},form);
 assert.equal(fixed.history.length,2);
});
