import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'frontend/package.json'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lm-connection-'));
await require('esbuild').build({entryPoints:[path.join(root,'frontend/src/offline/connectivity.ts')],outfile:path.join(tmp,'connectivity.cjs'),bundle:true,platform:'node',format:'cjs',external:['react'],nodePaths:[path.join(root,'frontend/node_modules')]});
// React is external so hooks and the application share the same package instance.
const Module=require('node:module');const compiled=fs.readFileSync(path.join(tmp,'connectivity.cjs'),'utf8');
function fresh(){const m=new Module(path.join(root,'frontend/connection-test.cjs'));m.filename=path.join(root,'frontend/connection-test.cjs');m.paths=Module._nodeModulePaths(path.join(root,'frontend'));m._compile(compiled,m.filename);m.exports.configurePing('/api/health/');return m.exports;}
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
test('failed background requests do not toggle the app when health responds, including HTTP errors',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const status of [200,401,500,503]){
  let calls=0;const c=fresh(),events=[];c.onConnectivityChange(v=>events.push(v));
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('',{status});});
  c.reportConnectionFailure();c.reportConnectionFailure();await flush();
  assert.equal(calls,1);assert.equal(c.isOnline(),true);assert.deepEqual(events,[]);c.configurePing('');
 }
});
test('one failed health check followed by success stays online',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0;const c=fresh();
 t.mock.method(globalThis,'fetch',async()=>{if(++calls===1)throw Error('transient');return new Response('ok');});
 c.reportConnectionFailure();await flush();assert.equal(c.isOnline(),true);
 t.mock.timers.tick(1000);await flush();assert.equal(calls,2);assert.equal(c.isOnline(),true);c.configurePing('');
});
test('confirmed outage retains offline detection and automatically recovers',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let reachable=false;const c=fresh(),events=[];
 c.onConnectivityChange(v=>events.push(v));
 t.mock.method(globalThis,'fetch',async()=>{if(!reachable)throw Error('disconnected');return new Response('ok');});
 c.reportConnectionFailure();await flush();assert.equal(c.isOnline(),true);
 t.mock.timers.tick(1000);await flush();assert.equal(c.isOnline(),false);assert.deepEqual(events,[false]);
 reachable=true;t.mock.timers.tick(6000);await flush();assert.equal(c.isOnline(),true);assert.deepEqual(events,[false,true]);c.configurePing('');
});
test('a successful API response invalidates a delayed failed health check',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let reject;const c=fresh(),events=[];c.onConnectivityChange(v=>events.push(v));
 t.mock.method(globalThis,'fetch',()=>new Promise((resolve,r)=>{reject=r;}));
 c.reportConnectionFailure();c.reportOnline();reject(Error('late failure'));await flush();t.mock.timers.tick(20000);await flush();
 assert.equal(c.isOnline(),true);assert.deepEqual(events,[]);c.configurePing('');
});
test('repeated request failures share a bounded health check instead of flooding the server',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0;const c=fresh();
 t.mock.method(globalThis,'fetch',(_,opts)=>{calls++;return new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(Error('timeout'))));});
 for(let i=0;i<100;i++)c.reportConnectionFailure();assert.equal(calls,1);
 t.mock.timers.tick(5000);await flush();assert.equal(c.isOnline(),true);
 t.mock.timers.tick(1000);await flush();assert.equal(calls,2);
 t.mock.timers.tick(5000);await flush();assert.equal(c.isOnline(),false);c.configurePing('');
});
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));
