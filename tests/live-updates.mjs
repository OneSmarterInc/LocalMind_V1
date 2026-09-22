// Follow-up fixes: timed messages close (with × or when the countdown ends),
// the generation buttons show the live state, and Enter sends a doubt.
// The first two broke because the React Compiler reused a list that was read
// from a plain variable; these tests also compile the real screens with the
// compiler and check that the lists are rebuilt when the state changes.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const front=path.join(root,'frontend');
const require=createRequire(path.join(front,'package.json'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lm-live-'));
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));
const esbuild=require('esbuild');
const build=async(entry,name,fixtures={})=>{
 await esbuild.build({entryPoints:[path.join(front,entry)],outfile:path.join(tmp,name),bundle:true,platform:'node',format:'cjs',logLevel:'silent',
  plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(fixtures,a.path)?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:fixtures[a.path]}));}}]});
 return require(path.join(tmp,name));
};
const store=await build('src/ui/toastStore.ts','toasts.cjs');
const controls=await build('src/authoring/bookControl.ts','controls.cjs',{'@/private/device':'export async function device(){return {get:async()=>undefined,put:async()=>{}};}',
 react:'export const useSyncExternalStore=(...a)=>globalThis.useSES(...a);'});
const keys=await build('src/ui/enterKey.ts','keys.cjs');

test('closing a message gives the screen a new list without it',()=>{
 let calls=0;const stop=store.subscribeToasts(()=>calls++);
 store.showToast({tone:'success',message:'Module deleted'});
 const shown=store.toastList();
 assert.equal(shown.length,1);
 store.dismissToast(shown[0].id);
 const after=store.toastList();
 assert.notEqual(after,shown,'a new list object, so React redraws');
 assert.equal(after.length,0);
 assert.equal(calls,2);
 store.dismissToast(shown[0].id);
 assert.equal(calls,2,'closing twice changes nothing and redraws nothing');
 stop();
});

test('a message that runs out of time is removed the same way',()=>{
 store.showToast({tone:'info',message:'Saved',duration:5});
 const [t]=store.toastList();
 store.dismissToast(t.id);
 assert.equal(store.toastList().some(x=>x.id===t.id),false);
});

test('generation buttons see the running and paused module as they change',()=>{
 const key=controls.controlKey('scope','book');
 const c=controls.control(key);
 let calls=0;const stop=controls.subscribeControls(()=>calls++);
 const ac=new AbortController();
 c.current={moduleId:'m1',controller:ac};controls.notifyControls();
 controls.pauseModule(key,'m2');
 controls.generateNow(key,'m3');
 assert.equal(ac.signal.aborted,true,'Generate now stops the running module at its saved part');
 assert.ok(calls>=3);
 stop();
});

test('the live view is a new object only when something changed',()=>{
 const key=controls.controlKey('scope','book2');
 let snap;globalThis.useSES=(subscribe,get)=>{snap=get;return get();};
 const first=controls.useBookControls(key);
 assert.equal(snap(),first,'no change, same object');
 controls.pauseModule(key,'m9');
 const second=snap();
 assert.notEqual(second,first);
 assert.equal(second.paused.has('m9'),true);
 controls.notifyControls();
 assert.equal(snap(),second,'a redraw with nothing new keeps the same object');
});

const compile=file=>{
 const babel=require('@babel/core');
 return babel.transformSync(fs.readFileSync(path.join(front,file),'utf8'),{filename:file,babelrc:false,configFile:false,
  presets:[[require.resolve('@babel/preset-typescript'),{isTSX:true,allExtensions:true}]],plugins:[[require.resolve('babel-plugin-react-compiler'),{}]]}).code;
};

test('after the React Compiler, the message list is rebuilt when it changes',()=>{
 const code=compile('src/ui/Toast.tsx');
 const host=code.slice(code.indexOf('function ToastHost'),code.indexOf('function ToastCard'));
 assert.doesNotMatch(host,/\btoasts\b/,'reads no plain variable');
 const at=host.indexOf('list.map(');
 assert.ok(at>0);
 assert.match(host.slice(Math.max(0,at-80),at),/!== list/,'rebuilt whenever the list changes');
});

test('after the React Compiler, the book screen reads generation state live',()=>{
 const code=compile('app/manage/document/[id].tsx');
 assert.match(code,/useBookControls\(ctlKey\)/);
 assert.doesNotMatch(code,/currentModule\(|isModulePaused\(/);
});

const key=(k,extra={})=>{const e={nativeEvent:{key:k,...extra},prevented:false,preventDefault(){this.prevented=true;},isDefaultPrevented(){return this.prevented;}};return e;};
test('Enter sends a doubt on the web, Shift+Enter makes a new line',()=>{
 let sent=0;const h=keys.enterHandler(()=>sent++,undefined,true);
 const e=key('Enter');h(e);
 assert.equal(sent,1);assert.equal(e.prevented,true,'no stray new line');
 const s=key('Enter',{shiftKey:true});h(s);
 assert.equal(sent,1);assert.equal(s.prevented,false);
 h(key('a'));assert.equal(sent,1);
});

test('Enter while a word is still being composed does not send',()=>{
 let sent=0;const h=keys.enterHandler(()=>sent++,undefined,true);
 h(key('Enter',{isComposing:true}));h(key('Enter',{keyCode:229}));
 assert.equal(sent,0);
});

test('phone apps keep their own Return key',()=>{
 const other=()=>{};
 assert.equal(keys.enterHandler(()=>{},other,false),other);
 assert.equal(keys.enterHandler(undefined,other,true),other);
});

test('both Ask a doubt boxes send on Enter',()=>{
 for(const f of ['src/private/CourseAsk.tsx','src/private/screens/PrivateBook.tsx'])
  assert.match(fs.readFileSync(path.join(front,f),'utf8'),/label="Your question"[^>]*onEnter=\{/,f);
});

test('the administrator overview offers Upload a book',()=>{
 const s=fs.readFileSync(path.join(front,'app/admin/index.tsx'),'utf8');
 assert.match(s,/title="Upload a book"[\s\S]{0,80}router\.push\("\/manage\/document\/upload"\)/);
 assert.doesNotMatch(s,/system readiness/);
});
