import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..');
const require=createRequire(path.join(root,'frontend/package.json'));
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lm-auth-navigation-'));
const fixtures={
 'expo-router':`import React from 'react';
 export function Stack({children}){return React.createElement('nav',null,children)}
 Stack.Screen=({name})=>React.createElement('span',{'data-screen':name});
 Stack.Protected=({guard,children})=>guard?children:null;
 export function Redirect({href}){return React.createElement('span',{'data-redirect':href})}`,
 '@/auth/AuthContext':`export const useAuth=()=>globalThis.authFixture;export const AuthProvider=({children})=>children;`,
 'react-native':`import React from 'react';export const Platform={OS:'test'};export const View=({children})=>React.createElement('div',null,children);export const ScrollView=View,Text=View,Pressable=View;`,
 '@/ui':`import React from 'react';export const colors={};export const Loading=()=>React.createElement('span',{'data-loading':true});export const DialogHost=()=>null;`,
 '@/private/GenerationJobs':`import React from 'react';export const GenerationHost=()=>React.createElement('span',{'data-generation':true});`,
 '@/private/ParserHost':`export default function ParserHost(){return null}`,
 '@/ui/NativeDatePicker':`export const NativeDatePickerHost=()=>null;`,
 'react-native-safe-area-context':`export const SafeAreaProvider=({children})=>children;`,
 'expo-status-bar':`export const StatusBar=()=>null;`,
};
try {
 for(const file of ['_layout','index'])await require('esbuild').build({entryPoints:[path.join(root,`frontend/app/${file}.tsx`)],outfile:path.join(tmp,`${file}.cjs`),bundle:true,platform:'node',format:'cjs',jsx:'automatic',plugins:[{name:'fixtures',setup(b){
 b.onResolve({filter:/.*/},a=>Object.hasOwn(fixtures,a.path)?{path:a.path,namespace:'fixture'}:/^react(?:\/|$)/.test(a.path)?{path:require.resolve(a.path),external:true}:undefined);
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:fixtures[a.path]}));
 }}]});
 const {AppNavigator}=require(path.join(tmp,'_layout.cjs'));
 const Index=require(path.join(tmp,'index.cjs')).default;
 const render=(state)=>{globalThis.authFixture=state;return renderToStaticMarkup(React.createElement(AppNavigator));};
 test('authentication hydration waits without mounting protected screens or redirecting',()=>{
  const html=render({ready:false,user:null,mustChangePassword:false});
  assert.match(html,/data-loading/);assert.doesNotMatch(html,/data-screen|data-generation/);
 });
 for(const [role,screens,home] of [
  [null,['index','login/index','login/student','login/faculty','login/admin'],'/login'],
  ['student',['index','change-password','student'],'/student'],
  ['faculty',['index','change-password','manage'],'/manage'],
  ['admin',['index','change-password','manage','admin'],'/admin'],
 ])test(`${role||'signed out'}: mounted navigator, correct route permissions and landing page`,()=>{
  const html=render({ready:true,user:role?{role}:null,mustChangePassword:false});
  assert.match(html,/<nav>/);
  assert.deepEqual([...html.matchAll(/data-screen="([^"]+)"/g)].map(m=>m[1]),screens);
  assert.equal(html.includes('data-generation'),!!role);
  assert.match(renderToStaticMarkup(React.createElement(Index)),new RegExp(`data-redirect="${home}"`));
 });
 test('mandatory password change blocks all workspaces and generation',()=>{
  const html=render({ready:true,user:{role:'admin'},mustChangePassword:true});
  assert.deepEqual([...html.matchAll(/data-screen="([^"]+)"/g)].map(m=>m[1]),['index','change-password']);
  assert.doesNotMatch(html,/data-generation/);
  assert.match(renderToStaticMarkup(React.createElement(Index)),/data-redirect="\/change-password"/);
 });
} finally { fs.rmSync(tmp,{recursive:true,force:true}); }
