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
