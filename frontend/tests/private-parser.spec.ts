import {test,expect} from '@playwright/test';
import fs from 'node:fs';

test('bundled native parser HTML recognises a scan with no network and a restrictive CSP',async({page,context})=>{
 test.setTimeout(120000);
 const code=fs.readFileSync('src/private/generated/parser.ts','utf8');
 const html=JSON.parse(code.slice(code.indexOf('export const PARSER_HTML=')+'export const PARSER_HTML='.length).trim().replace(/;$/,''));
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.evaluate(()=>{(window as any).__nativeMessages=[];(window as any).ReactNativeWebView={postMessage:(s:string)=>(window as any).__nativeMessages.push(JSON.parse(s))};});
 await context.setOffline(true);await page.setContent(html);
 await page.waitForFunction(()=>!!(window as any).__LM_PARSER__);
 await page.evaluate(async raw=>await(window as any).__LM_PARSE_BASE64__('scan-test','scan.pdf',raw),fs.readFileSync('test-results/scanned-biology.pdf').toString('base64'));
 const result=await page.evaluate(()=>(window as any).__nativeMessages.find((m:any)=>m.id==='scan-test'&&(m.parsed||m.error)));
 expect(result.error).toBeUndefined();expect(result.parsed.items[0].text).toContain('12.5');expect(result.parsed.items[0].text).toContain('Sunlight');
 expect(result.parsed.visuals[0].dataUrl).toMatch(/^data:image\/png;base64,/);expect(errors).toEqual([]);
});

test('cancelling OCR releases the parser for the next import',async({page})=>{
 await page.addScriptTag({path:'public/private-assets/parser.js',type:'module'});
 const outcome=await page.evaluate(async raw=>{
  const parser=(window as any).__LM_PARSER__,abort=new AbortController();
  const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
  const timer=setTimeout(()=>abort.abort(),100);
  let error='';try{await parser.parse(bytes,'scan.pdf',abort.signal);}catch(e){error=String(e);}finally{clearTimeout(timer);}
  const next=await parser.parse(new TextEncoder().encode('A readable source after cancellation.'),'next.txt');
  return {error,text:next.items[0].text};
 },fs.readFileSync('test-results/scanned-biology.pdf').toString('base64'));
 expect(outcome.error).toMatch(/cancel|abort|destroy/i);expect(outcome.text).toContain('after cancellation');
});


test('readable illustrated PDF keeps visuals and reports progress without OCR',async({page})=>{
 await page.addScriptTag({path:'public/private-assets/parser.js',type:'module'});
 const result=await page.evaluate(async raw=>{
  const messages:string[]=[];
  const parsed=await(window as any).__LM_PARSER__.parse(Uint8Array.from(atob(raw),c=>c.charCodeAt(0)),'illustrated.pdf',undefined,(s:string)=>messages.push(s));
  return {parsed,messages};
 },fs.readFileSync('test-results/illustrated-text.pdf').toString('base64'));
 expect(result.parsed.items[0].ocr).toBe(false);
 expect(result.parsed.items[0].text).toContain('photosynthesis');
 expect(result.parsed.visuals.some((v:any)=>v.kind==='figure')).toBe(true);
 expect(result.parsed.visuals.some((v:any)=>v.kind==='page')).toBe(true);
 expect(result.messages).toContain('Preparing page 1 of 1');
 expect(result.messages.some((s:string)=>s.includes('Recognising'))).toBe(false);
});


test('44-page book streams more than 48 MiB of preserved PNGs to IndexedDB',async({page})=>{
 test.setTimeout(240000);
 await page.goto('/api/health/');
 await page.addScriptTag({path:'public/private-assets/parser.js',type:'module'});
 const result=await page.evaluate(async raw=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('large-import-test',1);r.onupgradeneeded=()=>r.result.createObjectStore('images');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  let bytes=0,count=0,active=0,maxActive=0;
  const parsed=await(window as any).__LM_PARSER__.parse(Uint8Array.from(atob(raw),c=>c.charCodeAt(0)),'large.pdf',undefined,()=>{},async(v:any)=>{
   active++;maxActive=Math.max(maxActive,active);bytes+=v.dataUrl.length;count++;
   await new Promise<void>((resolve,reject)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').put(v,v.id);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});active--;
  });
  const saved=await new Promise<number>((resolve,reject)=>{const q=db.transaction('images').objectStore('images').count();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
  db.close();return {bytes,count,saved,maxActive,pages:parsed.items.length,retained:parsed.visuals.length};
 },fs.readFileSync('test-results/large-illustrated.pdf').toString('base64'));
 expect(result.bytes).toBeGreaterThan(48*1024*1024);expect(result.pages).toBe(44);
 expect(result.saved).toBe(result.count);expect(result.maxActive).toBe(1);expect(result.retained).toBe(0);
});

test('native image bridge waits for storage acknowledgement before completing',async({page})=>{
 await page.addScriptTag({path:'public/private-assets/parser.js',type:'module'});
 const result=await page.evaluate(async raw=>{
  let images=0;let pending=0;let maxPending=0;let complete:any;
  (window as any).ReactNativeWebView={postMessage:(raw:string)=>{
   const m=JSON.parse(raw);
   if(m.visual){images++;pending++;maxPending=Math.max(maxPending,pending);setTimeout(()=>{pending--; (window as any).__LM_VISUAL_ACK__(m.id,null);},20);}
   if(m.parsed||m.error)complete=m;
  }};
  await(window as any).__LM_PARSE_BASE64__('stream','illustrated.pdf',raw,true);
  return {images,pending,maxPending,complete};
 },fs.readFileSync('test-results/illustrated-text.pdf').toString('base64'));
 expect(result.complete.error).toBeUndefined();expect(result.images).toBeGreaterThan(1);
 expect(result.pending).toBe(0);expect(result.maxPending).toBe(1);expect(result.complete.parsed.visuals).toEqual([]);
});
