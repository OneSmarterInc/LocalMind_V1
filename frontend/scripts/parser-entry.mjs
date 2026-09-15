import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { unzipSync } from 'fflate';
import { readablePdfText, imageRectangles } from './pdf-layout.mjs';
import { OCR_WORKER } from './generated-ocr.mjs';
globalThis.pdfjsWorker={WorkerMessageHandler};
const LIMIT=2_000_000;
const assert=(v,m)=>{if(!v)throw new Error(m);};
const decode=b=>new TextDecoder('utf-8',{fatal:true}).decode(b).replace(/^\uFEFF/,'');
const check=signal=>{if(signal?.aborted)throw Error('Book import cancelled. Nothing was saved.');};
const base64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
// Worker, WASM and English recognition data are compiled into the installed parser.
// No language/model CDN is contacted, including from the native WebView.
async function recognizer(signal){
 check(signal);
 const url=URL.createObjectURL(new Blob([OCR_WORKER],{type:'application/javascript'}));
 // Own the pinned Tesseract worker protocol so cancellation/timeouts cover initialization too.
 const worker=new Worker(url);let pending,serial=0,closed=false;
 const close=(error)=>{if(closed)return;closed=true;worker.terminate();URL.revokeObjectURL(url);signal?.removeEventListener('abort',abort);if(pending){clearTimeout(pending.timer);pending.reject(error||Error('OCR closed'));pending=undefined;}};
 const abort=()=>close(Error('Book import cancelled. Nothing was saved.'));signal?.addEventListener('abort',abort);
 worker.onerror=()=>close(Error('The bundled OCR engine could not start. Check the offline app installation.'));
 worker.onmessage=({data})=>{
  if(!pending||data.jobId!==pending.id||data.status==='progress')return;
  const p=pending;pending=undefined;clearTimeout(p.timer);
  data.status==='resolve'?p.resolve(data.data):p.reject(Error('OCR failed: '+String(data.data).slice(0,300)));
 };
 const job=(action,payload)=>new Promise((resolve,reject)=>{
  if(closed||signal?.aborted){reject(Error('Book import cancelled.'));return;}
  const id=`ocr-${++serial}`;
  pending={id,resolve,reject,timer:setTimeout(()=>close(Error('OCR timed out. Import a smaller chapter or a clearer scan.')),120000)};
  worker.postMessage({workerId:'localmind-ocr',jobId:id,action,payload});
 });
 try{
  await job('load',{options:{lstmOnly:true,corePath:'https://localmind.invalid/bundled-ocr',logging:false}});
  await job('loadLanguage',{langs:'eng',options:{langPath:'https://localmind.invalid/bundled-ocr',gzip:true,cacheMethod:'none',lstmOnly:true}});
  await job('initialize',{langs:'eng',oem:1,config:{}});
  return {read:async canvas=>{
   check(signal);
   return await job('recognize',{image:base64(canvas.toDataURL('image/png').split(',')[1]),options:{preserve_interword_spaces:'1',tessedit_pageseg_mode:'3'},output:{text:true}});
  },close:async()=>close()};
 }catch(e){close();throw e;}
}

let running=false;
async function parse(bytes,name,signal,progress=()=>{},saveVisual){
 assert(!running,'A book is already being imported. Wait for it to finish.');running=true;
 let ocr;
 try {
 check(signal);assert(bytes.length>0 && bytes.length<=35*1024*1024,'Choose a book up to 35 MB.');
 const ext=name.split('.').pop().toLowerCase(), warnings=[],visuals=[];let items=[],visualCount=0;
 const capture=async(canvas,caption,page,kind='figure')=>{
  check(signal);
  const id=`v${++visualCount}`;
  const visual={id,dataUrl:canvas.toDataURL('image/png'),kind,width:canvas.width,height:canvas.height,caption,...(page?{page}:{})};
  // Await durable storage before rendering the next image. Never accumulate a book of bitmaps.
  if(saveVisual)await saveVisual(visual);else visuals.push(visual);
  check(signal);return id;
 };
 if(ext==='pdf') {
  assert(String.fromCharCode(...bytes.slice(0,5))==='%PDF-','This file is not a PDF.');
  const task=pdfjs.getDocument({data:bytes,isEvalSupported:false,useSystemFonts:true});
  task.onPassword=()=>task.destroy();
  const abort=()=>{void task.destroy();};signal?.addEventListener('abort',abort);
  let doc;
  try {
   doc=await task.promise;assert(doc.numPages<=1500,'Import a chapter at a time (maximum 1,500 PDF pages).');let total=0;
   for(let p=1;p<=doc.numPages;p++){
    check(signal);progress(`Preparing page ${p} of ${doc.numPages}`);
    const page=await doc.getPage(p), c=await page.getTextContent();
    let text=readablePdfText(c.items);
    const plain=page.getViewport({scale:1});const view=page.getViewport({scale:Math.min(2.5,2400/Math.max(plain.width,plain.height))});
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
    try {
     await page.render({canvasContext:canvas.getContext('2d'),viewport:view,background:'white'}).promise;
     const visualIds=[await capture(canvas,`Original page ${p} — tables and diagrams`,p,'page')];
     // Mixed pages (a selectable header above a scanned body) also need OCR.
     const ops=await page.getOperatorList();const hasImage=ops.fnArray.some(op=>[pdfjs.OPS.paintImageXObject,pdfjs.OPS.paintInlineImageXObject,pdfjs.OPS.paintImageMaskXObject].includes(op));
     // Crop embedded illustrations from the rendered page, retaining surrounding labels.
     for(const rect of imageRectangles(ops,pdfjs.OPS,pdfjs.Util.transform)){
      const r=view.convertToViewportRectangle(rect);const left=Math.min(r[0],r[2]),top=Math.min(r[1],r[3]),width=Math.abs(r[2]-r[0]),height=Math.abs(r[3]-r[1]);
      if(width<40||height<40||width*height>canvas.width*canvas.height*0.65||left>=canvas.width||top>=canvas.height||left+width<=0||top+height<=0)continue;
      const x=Math.max(0,Math.floor(left-16)),y=Math.max(0,Math.floor(top-16));
      const crop=document.createElement('canvas');crop.width=Math.min(canvas.width-x,Math.ceil(width+32));crop.height=Math.min(canvas.height-y,Math.ceil(height+32));
      if(crop.width<=0||crop.height<=0)continue;
      crop.getContext('2d').drawImage(canvas,x,y,crop.width,crop.height,0,0,crop.width,crop.height);
      visualIds.push(await capture(crop,`Illustration from page ${p}`,p));crop.width=0;crop.height=0;
     }
     const readableChars=text.replace(/\s/g,'').length;
     // Preserve illustrations without re-recognising substantial selectable text.
     // Sparse headers over scanned bodies still receive OCR.
     const needsOCR=readableChars<50||(hasImage&&readableChars<300);
     if(hasImage&&!needsOCR)warnings.push('Pages with substantial selectable text use that text without additional image OCR. Original illustrations remain visible; labels present only inside images may not be available to the tutor.');
     if(needsOCR){
      progress(`Recognising text on page ${p} of ${doc.numPages}`);ocr||=await recognizer(signal);
      const read=await ocr.read(canvas);
      // Keep accurate selectable text and append only additional recognised lines.
      const norm=s=>s.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');const known=norm(text);
      const extra=read.text.split('\n').filter(line=>line.trim()&&!known.includes(norm(line))).join('\n');
      text=text.trim()?(extra?`${text.trim()}\n\n[Additional text recognised from the page image]\n${extra}`:text):read.text;
      if(read.confidence<65)warnings.push(`Page ${p}: OCR confidence is low. Compare the recognised text with the preserved page before relying on it.`);
     }
     total+=text.length;assert(total<=LIMIT,'Import a chapter at a time; this book has too much text.');
     if(!text.trim())warnings.push(`Page ${p}: no text recognised. The original image is retained; the text tutor cannot explain image-only content.`);
     items.push({title:`Page ${p}`,text,page:p,visualIds,ocr:needsOCR});
    }finally{canvas.width=0;canvas.height=0;page.cleanup();}
   }
  } finally {signal?.removeEventListener('abort',abort);if(doc)await doc.destroy();else await task.destroy();}
  warnings.unshift('Embedded raster illustrations are cropped where possible; scanned-page and vector diagrams may require the original page. Original PDF pages are preserved as images. OCR runs locally in English; check numbers, formulas and table reading order against the original. Diagrams are displayed, not interpreted by the text model.');
 } else if(ext==='docx') {
  let size=0,count=0;
  const entries=unzipSync(bytes,{filter:f=>{size+=f.originalSize;count++;assert(size<=100*1024*1024&&count<=3000,'DOCX expanded content is too large.');return /^(word\/(document\.xml|_rels\/document.xml.rels|media\/[^/]+)|\[Content_Types\]\.xml)$/.test(f.name);}});
  assert(entries['word/document.xml']&&entries['[Content_Types].xml'],'Not a valid DOCX document.');
  const xml=decode(entries['word/document.xml']);assert(!/<!DOCTYPE|<!ENTITY/i.test(xml),'Unsupported XML declarations.');
  const dom=new DOMParser().parseFromString(xml,'application/xml');assert(!dom.querySelector('parsererror'),'The Word document XML is invalid.');
  const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main', relns='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const children=(node,tag)=>Array.from(node.getElementsByTagNameNS(ns,tag));const val=node=>node?.getAttributeNS(ns,'val')||'';
  const content=node=>children(node,'t').map(n=>n.textContent||'').join('');
  const rels=new Map();
  if(entries['word/_rels/document.xml.rels']){
   const relxml=decode(entries['word/_rels/document.xml.rels']);assert(!/<!DOCTYPE|<!ENTITY/i.test(relxml),'Unsupported relationships XML');
   const relDom=new DOMParser().parseFromString(relxml,'application/xml');
   for(const r of relDom.getElementsByTagName('Relationship'))if(r.getAttribute('TargetMode')!=='External')rels.set(r.getAttribute('Id'),r.getAttribute('Target'));
  }
  let current={title:'Introduction',text:'',visualIds:[]},total=0;
  const push=()=>{if(current.text.trim()||current.visualIds.length)items.push(current);};
  const body=children(dom,'body')[0];assert(body,'Missing Word document body.');
  for(const [index,node] of Array.from(body.children).entries()){
   check(signal);progress(`Reading Word content ${index+1} of ${body.children.length}`);
   if(node.localName==='p'){
    const s=content(node),style=val(children(node,'pStyle')[0]),level=val(children(node,'outlineLvl')[0]);
    if((/^(heading|title)[ _-]?\d*/i.test(style)||(level!==''&&Number(level)<9))&&s.trim()){push();current={title:s.slice(0,300),text:'',visualIds:[]};}
    else current.text+=(children(node,'numPr').length?'• ':'')+s+'\n\n';
   }else if(node.localName==='tbl'){
    const rows=children(node,'tr').map(r=>children(r,'tc').map(c=>content(c).replace(/\|/g,'\\|')));
    if(rows.length){const columns=Math.max(...rows.map(r=>r.length));const pad=r=>[...r,...Array(columns-r.length).fill('')];current.text+='\n'+rows.map((r,i)=>`| ${pad(r).join(' | ')} |${i===0?'\n| '+Array(columns).fill('---').join(' | ')+' |':''}`).join('\n')+'\n\n';}
   }
   // Embedded images stay local. Never follow external relationships or load SVG scripts.
   for(const blip of node.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main','blip')){
    const target=rels.get(blip.getAttributeNS(relns,'embed'));
    if(!target||!/^media\/[^/]+\.(png|jpe?g|gif|webp)$/i.test(target)||!entries[`word/${target}`]){warnings.push('An unsupported Word drawing could not be rendered. Import a PDF export to retain its exact appearance.');continue;}
    const url=URL.createObjectURL(new Blob([entries[`word/${target}`]]));const img=new Image();
    try{
     await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('An embedded Word image could not be decoded. Export this document as PDF.'));img.src=url;});
     check(signal);const canvas=document.createElement('canvas'),scale=Math.min(1,2400/Math.max(img.naturalWidth,img.naturalHeight));canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
     current.visualIds.push(await capture(canvas,`Original illustration — ${current.title}`));
     ocr||=await recognizer(signal);const read=await ocr.read(canvas);if(read.text.trim())current.text+=`\n[Text recognised from illustration]\n${read.text}\n`;canvas.width=0;canvas.height=0;
    }finally{URL.revokeObjectURL(url);}
   }
   total+=content(node).length;assert(total<=LIMIT,'Import a chapter at a time; too much extracted text.');
  }
  push();
  warnings.push('Word text, tables and embedded raster images are retained. For exact page layout, merged-cell geometry, charts or SmartArt, import a PDF export; the original PDF pages are preserved.');
  if(children(dom,'numPr').length)warnings.push('Word list items are shown as bullets; use a PDF export to preserve exact numbering.');
 } else {
  assert(ext==='txt'||ext==='md','Supported files: PDF (including English scans), DOCX, TXT and Markdown.');
  const source=decode(bytes);assert(source.length<=LIMIT&&!source.includes('\0'),'Unsupported or oversized text.');let current={title:'Introduction',text:''};
  for(const line of source.split(/\r?\n/)){const h=/^#{1,6}\s+(.+)$/.exec(line);if(h){if(current.text.trim())items.push(current);current={title:h[1],text:''};}else current.text+=line+'\n';}if(current.text.trim())items.push(current);
 }
 check(signal);assert(items.some(i=>i.text.trim()||i.visualIds?.length),'No readable source content found.');
 return {items,visuals,warnings:[...new Set(warnings)].slice(0,30)};
 }finally{try{await ocr?.close();}finally{running=false;}}
}
window.__LM_PARSER__={parse};
let nativeAbort,nativeVisual;
window.__LM_VISUAL_ACK__=(id,error)=>{if(nativeVisual?.id!==id)return;const p=nativeVisual;nativeVisual=undefined;error?p.reject(Error(error)):p.resolve();};
window.__LM_CANCEL_PARSE__=()=>{nativeAbort?.abort();if(nativeVisual){nativeVisual.reject(Error('Book import cancelled.'));nativeVisual=undefined;}};
window.__LM_PARSE_BASE64__=async(id,name,data,stream=false)=>{
 nativeAbort=new AbortController();
 try{const parsed=await parse(base64(data),name,nativeAbort.signal,progress=>window.ReactNativeWebView.postMessage(JSON.stringify({id,progress})),stream?visual=>new Promise((resolve,reject)=>{nativeVisual={id,resolve,reject};window.ReactNativeWebView.postMessage(JSON.stringify({id,visual}));}):undefined);window.ReactNativeWebView.postMessage(JSON.stringify({id,parsed}));}
 catch(e){window.ReactNativeWebView.postMessage(JSON.stringify({id,error:e.message||String(e)}));}
 finally{nativeAbort=undefined;}
};
window.ReactNativeWebView?.postMessage(JSON.stringify({ready:true}));
