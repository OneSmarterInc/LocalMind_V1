// Regression tests for the portal fixes: role routing, visibility-gated polling,
// the offline manifest and the icon imports that decide the web payload.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..');
const front=path.join(root,'frontend');
const require=createRequire(path.join(front,'package.json'));
const esbuild=require('esbuild');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lm-portal-fixes-'));
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));
const bundle=async(entry,out,fixtures={})=>{await esbuild.build({entryPoints:[path.join(front,entry)],outfile:path.join(tmp,out),bundle:true,platform:'node',format:'cjs',jsx:'automatic',logLevel:'silent',plugins:[{name:'fixtures',setup(b){
 b.onResolve({filter:/.*/},a=>Object.hasOwn(fixtures,a.path)?{path:a.path,namespace:'fixture'}:/^react(?:\/|$)/.test(a.path)?{path:require.resolve(a.path),external:true}:undefined);
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:fixtures[a.path]}));}}]});return require(path.join(tmp,out));};

test('every role maps to its own workspace and an unknown role maps to nothing',async()=>{
 const {homeFor}=await bundle('src/auth/home.ts','home.cjs');
 assert.equal(homeFor('student'),'/student');assert.equal(homeFor('faculty'),'/manage');assert.equal(homeFor('admin'),'/admin');
 for(const odd of ['teacher','',undefined,null,'Admin'])assert.equal(homeFor(odd),null);
});

const routeFixtures={
 'expo-router':`import React from 'react';export function Redirect({href}){return React.createElement('span',{'data-redirect':href})};export const usePathname=()=>globalThis.pathFixture||'/nowhere';`,
 '@/auth/AuthContext':`export const useAuth=()=>globalThis.authFixture;`,
 'react-native':`import React from 'react';const box=({children})=>React.createElement('div',null,children);export const View=box,ScrollView=box,Pressable=box;export const Text=({children})=>React.createElement('p',null,children);`,
 '@/ui':`import React from 'react';export const colors={};export const Loading=()=>React.createElement('span',{'data-loading':true});`,
};
test('an unrecognised saved role shows a recovery screen instead of redirecting in a loop',async()=>{
 const Index=(await bundle('app/index.tsx','index.cjs',routeFixtures)).default;
 const NotFound=(await bundle('app/+not-found.tsx','notfound.cjs',routeFixtures)).default;
 globalThis.authFixture={ready:true,user:{role:'teacher'},mustChangePassword:false,refreshUser:async()=>{},logout:async()=>{}};
 for(const Screen of [Index,NotFound]){
  const html=renderToStaticMarkup(React.createElement(Screen));
  assert.doesNotMatch(html,/data-redirect/);assert.match(html,/Try again/);assert.match(html,/Sign out/);
 }
 globalThis.authFixture={ready:true,user:{role:'faculty'},mustChangePassword:false};
 assert.match(renderToStaticMarkup(React.createElement(NotFound)),/data-redirect="\/manage"/);
 globalThis.pathFixture='/student/assignments/4';globalThis.authFixture={ready:true,user:{role:'student'},mustChangePassword:false};
 assert.match(renderToStaticMarkup(React.createElement(NotFound)),/data-redirect="\/student\/quizzes"/);
});

test('display polls pause while the tab is hidden and catch up the moment it is visible',async()=>{
 const {everyVisible}=await bundle('src/hooks/visibleInterval.ts','visible.cjs');
 const listeners=new Set();const doc={visibilityState:'visible',addEventListener:(t,f)=>listeners.add(f),removeEventListener:(t,f)=>listeners.delete(f)};
 globalThis.document=doc;
 let ticks=0;const stop=everyVisible(()=>{ticks++;},20);
 await new Promise(r=>setTimeout(r,70));const visibleTicks=ticks;assert.ok(visibleTicks>=2,`ticked ${visibleTicks}`);
 doc.visibilityState='hidden';for(const f of listeners)f();
 await new Promise(r=>setTimeout(r,70));assert.equal(ticks,visibleTicks,'no ticks while hidden');
 doc.visibilityState='visible';for(const f of listeners)f();assert.equal(ticks,visibleTicks+1,'one immediate refresh on return');
 stop();assert.equal(listeners.size,0);const after=ticks;await new Promise(r=>setTimeout(r,50));assert.equal(ticks,after,'stopped');
 delete globalThis.document;
 let native=0;const stopNative=everyVisible(()=>{native++;},15);await new Promise(r=>setTimeout(r,60));stopNative();
 assert.ok(native>=2,'without a document it is a plain interval (iOS/Android)');
});

test('the offline manifest leaves out the stable-name parser and keeps the hashed one the app loads',()=>{
 const dist=path.join(tmp,'site','dist');fs.mkdirSync(path.join(dist,'private-assets'),{recursive:true});
 for(const f of ['index.html','private-assets/parser.js','private-assets/parser-0123456789abcdef0123.js','private-assets/runtime-loader.js'])fs.writeFileSync(path.join(dist,f),f);
 const r=spawnSync(process.execPath,[path.join(front,'scripts/build-offline-manifest.mjs')],{cwd:path.dirname(dist),encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 const {files}=JSON.parse(fs.readFileSync(path.join(dist,'offline-files.json'),'utf8'));
 assert.ok(files.includes('/private-assets/parser-0123456789abcdef0123.js'));assert.ok(files.includes('/index.html'));
 assert.ok(!files.includes('/private-assets/parser.js'));
});

test('every icon comes from the Ionicons module, so the web build ships one icon font, not nineteen',()=>{
 const barrel=/from\s*['"]@expo\/vector-icons['"]/;const offenders=[];
 const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){if(e.name!=='generated')walk(p);}else if(/\.tsx?$/.test(e.name)&&barrel.test(fs.readFileSync(p,'utf8')))offenders.push(path.relative(front,p));}};
 walk(path.join(front,'app'));walk(path.join(front,'src'));
 assert.deepEqual(offenders,[]);
});

test('ids can be created on a plain-http address, where browsers withhold crypto.randomUUID',async()=>{
 const {installRandomUUID}=await bundle('src/platform/randomUUID.ts','uuid.cjs');
 const real=globalThis.crypto;const bytes=require('node:crypto');
 const insecure={getRandomValues:a=>bytes.randomFillSync(a)};
 Object.defineProperty(globalThis,'crypto',{value:insecure,configurable:true});
 try{
  installRandomUUID();assert.equal(typeof insecure.randomUUID,'function');
  const ids=new Set();for(let i=0;i<2000;i++){const id=insecure.randomUUID();assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);ids.add(id);}
  assert.equal(ids.size,2000,'unique');
  const native=()=> 'native';const secure={getRandomValues:insecure.getRandomValues,randomUUID:native};
  Object.defineProperty(globalThis,'crypto',{value:secure,configurable:true});installRandomUUID();
  assert.equal(secure.randomUUID,native,'a native randomUUID is never replaced');
 }finally{Object.defineProperty(globalThis,'crypto',{value:real,configurable:true});}
});
