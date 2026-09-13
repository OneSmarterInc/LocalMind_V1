import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { unzipSync } from 'fflate';
// PDF.js can use its in-process worker: neither browsers nor WebViews need a CDN.
globalThis.pdfjsWorker={WorkerMessageHandler};
const LIMIT=2_000_000;
const assert=(v,m)=>{if(!v)throw new Error(m);};
const decode=b=>new TextDecoder('utf-8',{fatal:true}).decode(b).replace(/^\uFEFF/,'');
async function parse(bytes,name){
 assert(bytes.length>0 && bytes.length<=35*1024*1024,'Choose a book up to 35 MB.');
 const ext=name.split('.').pop().toLowerCase(), warnings=[];let items=[];
 if(ext==='pdf') {
  assert(String.fromCharCode(...bytes.slice(0,5))==='%PDF-','This file is not a PDF.');
  const task=pdfjs.getDocument({data:bytes,isEvalSupported:false,useSystemFonts:true,disableFontFace:true});
  task.onPassword=()=>task.destroy();
  let doc;
  try {
   doc=await task.promise;assert(doc.numPages<=1500,'Import a chapter at a time (maximum 1,500 PDF pages).');
   let total=0;
   for(let p=1;p<=doc.numPages;p++){
    const page=await doc.getPage(p);const c=await page.getTextContent();
    let text='',y=null;
    for(const i of c.items){if(!('str'in i))continue;const next=i.transform?.[5];if(y!==null && next!==y)text+='\n';text+=i.str+(i.hasEOL?'\n':' ');y=next;}
    total+=text.length;assert(total<=LIMIT,'Import a chapter at a time; this book has too much text.');
    if(text.trim())items.push({title:`Page ${p}`,text,page:p});else warnings.push(`Page ${p} has no selectable text. Its image content was not converted.`);
    page.cleanup();
   }
  } finally {if(doc)await doc.destroy();else await task.destroy();}
  warnings.unshift('PDF text is organised by page. Tables and illustrations may need the original book; scanned pages are not recognised.');
 } else if(ext==='docx') {
  // Check directory metadata before inflating to reject zip bombs without large allocations.
  let size=0,count=0;
  const entries=unzipSync(bytes,{filter:f=>{size+=f.originalSize;count++;assert(size<=100*1024*1024 && count<=3000,'DOCX expanded content is too large.');return /^(word\/(document|styles|numbering)\.xml|\[Content_Types\]\.xml)$/.test(f.name);}});
  assert(entries['word/document.xml'] && entries['[Content_Types].xml'],'Not a valid DOCX document.');
  const xml=decode(entries['word/document.xml']);assert(!/<!DOCTYPE|<!ENTITY/i.test(xml),'Unsupported XML declarations.');
  const dom=new DOMParser().parseFromString(xml,'application/xml');assert(!dom.querySelector('parsererror'),'The Word document XML is invalid.');
  const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const children=(node,tag)=>Array.from(node.getElementsByTagNameNS(ns,tag));
  const val=node=>node?.getAttributeNS(ns,'val')||'';
  const content=node=>children(node,'t').map(n=>n.textContent||'').join('');
  let current={title:'Introduction',text:''};let total=0;
  const push=()=>{if(current.text.trim())items.push(current);};
  const body=children(dom,'body')[0];assert(body,'Missing Word document body.');
  for(const node of body.children){
   if(node.localName==='p'){
    const s=content(node);const style=val(children(node,'pStyle')[0]);
    const level=val(children(node,'outlineLvl')[0]);
    const heading=/^(heading|title)[ _-]?\d*/i.test(style)||(level!==''&&Number(level)<9);
    if(heading && s.trim()){push();current={title:s.slice(0,300),text:''};}
    else {const list=children(node,'numPr').length;current.text+=(list?'• ':'')+s+'\n\n';}
   }else if(node.localName==='tbl'){
    const rows=children(node,'tr').map(r=>children(r,'tc').map(c=>content(c).replace(/\|/g,'\\|')));
    if(rows.length){const columns=Math.max(...rows.map(r=>r.length));const pad=r=>[...r,...Array(columns-r.length).fill('')];current.text+='\n'+rows.map((r,i)=>`| ${pad(r).join(' | ')} |${i===0?'\n| '+Array(columns).fill('---').join(' | ')+' |':''}`).join('\n')+'\n\n';}
   }
   total+=content(node).length;assert(total<=LIMIT,'Import a chapter at a time; too much extracted text.');
  }
  push();
  if(children(dom,'drawing').length)warnings.push('This Word file contains illustrations. Text is preserved; illustrations are not interpreted by the local text model.');
  if(children(dom,'numPr').length)warnings.push('Word list items are preserved as bullets in private import; consult the original for exact numbering.');
 } else {
  assert(ext==='txt'||ext==='md','Supported files: text-based PDF, DOCX, TXT and Markdown.');
  const source=decode(bytes);assert(source.length<=LIMIT && !source.includes('\0'),'Unsupported or oversized text.');
  let current={title:'Introduction',text:''};
  for(const line of source.split(/\r?\n/)){const h=/^#{1,6}\s+(.+)$/.exec(line);if(h){if(current.text.trim())items.push(current);current={title:h[1],text:''};}else current.text+=line+'\n';}
  if(current.text.trim())items.push(current);
 }
 assert(items.some(i=>i.text.trim()),'No readable text found. Use a selectable-text book; scanned PDFs need text recognition first.');
 return {items,warnings:[...new Set(warnings)].slice(0,30)};
}
window.__LM_PARSER__={parse};
// The native host exchanges only local file data with this bundled WebView.
window.__LM_PARSE_BASE64__=async(id,name,data)=>{
 try{const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));const parsed=await parse(bytes,name);window.ReactNativeWebView.postMessage(JSON.stringify({id,parsed}));}
 catch(e){window.ReactNativeWebView.postMessage(JSON.stringify({id,error:e.message||String(e)}));}
};
window.ReactNativeWebView?.postMessage(JSON.stringify({ready:true}));
