/** Nearby words are metadata only, never extra pixels around the picture. */
const captionPattern=/^(?:fig(?:ure)?\.?|diagram|chart|graph|table|plate|map)\s+[\w.-]+(?:\s*[:.\-–—]|\s+)/i;
const calloutPattern=/^(?:why\s+this\s+is\s+happening|activity(?:\s*[\d.]+)?|questions?|examples?(?:\s*[\d.]+)?|more\s+to\s+know!?|do\s+you\s+know\??|did\s+you\s+know\??|points?\s+to\s+ponder|summary|exercises?|think\s+it\s+over\??|try\s+this|fact\s+file)\b/i;
export function sourceCaption(lines){return lines.map(s=>String(s).trim()).find(s=>captionPattern.test(s))?.slice(0,300)||'';}
export function usefulPicture(width,height){return width>=40&&height>=40&&Math.max(width,height)/Math.min(width,height)<=12&&width*height<=36_000_000;}

function lineRuns(line){
 const runs=[];if(!line.length)return runs;let colour=line[0],start=0;
 for(let i=1;i<line.length;i++){if(line[i]!==colour){runs.push([colour,start,i-start]);colour=line[i];start=i;}}
 runs.push([colour,start,line.length-start]);return runs;
}
function finderHits(line){
 const runs=lineRuns(line);let hits=0;
 for(let i=0;i+4<runs.length;i++){
  const w=runs.slice(i,i+5);if(w.map(r=>r[0]).join('')!=='10101')continue;
  const widths=w.map(r=>r[2]),unit=(widths[0]+widths[1]+widths[3]+widths[4])/4;
  if(unit<1)continue;
  if([0,1,3,4].some(j=>Math.abs(widths[j]-unit)>unit*.85))continue;
  if(Math.abs(widths[2]-unit*3)>unit*1.55)continue;
  hits++;
 }
 return hits;
}
/** High-confidence QR/navigation filter. It does not decode or transmit the QR. */
export function looksLikeQrCanvas(canvas){
 if(!canvas?.width||!canvas?.height||Math.min(canvas.width,canvas.height)<42)return false;
 if(Math.max(canvas.width,canvas.height)/Math.min(canvas.width,canvas.height)>1.38)return false;
 const side=160,scale=Math.min(1,side/Math.max(canvas.width,canvas.height));
 const tmp=document.createElement('canvas');tmp.width=Math.max(1,Math.round(canvas.width*scale));tmp.height=Math.max(1,Math.round(canvas.height*scale));
 const ctx=tmp.getContext('2d',{willReadFrequently:true});ctx.drawImage(canvas,0,0,tmp.width,tmp.height);
 const data=ctx.getImageData(0,0,tmp.width,tmp.height).data,m=[];let black=0;
 for(let y=0;y<tmp.height;y++){const row=[];for(let x=0;x<tmp.width;x++){const i=(y*tmp.width+x)*4,v=(data[i]*.299+data[i+1]*.587+data[i+2]*.114)<128?1:0;row.push(v);black+=v;}m.push(row);}
 const ratio=black/Math.max(1,tmp.width*tmp.height);if(ratio<.12||ratio>.72){tmp.width=0;tmp.height=0;return false;}
 const fs=[.18,.25,.32,.5,.68,.75,.82],ys=[...new Set(fs.map(f=>Math.max(0,Math.min(tmp.height-1,Math.round(tmp.height*f)))))],xs=[...new Set(fs.map(f=>Math.max(0,Math.min(tmp.width-1,Math.round(tmp.width*f)))))];
 const h=ys.filter(y=>finderHits(m[y])>0).length,v=xs.filter(x=>finderHits(m.map(r=>r[x]))>0).length;tmp.width=0;tmp.height=0;return h>=2&&v>=2;
}

export function pdfPictureContext(items,view,rect){
 const candidates=[],inside=[];
 for(const item of items){
  if(!item.str?.trim()||!item.transform)continue;
  const [x,y]=view.convertToViewportPoint(item.transform[4],item.transform[5]);
  const w=Math.abs(item.width||0)*view.scale,h=Math.abs(item.height||item.transform[3]||10)*view.scale;
  const gap=Math.max(rect[1]-y,y-h-rect[3],0);
  const overlaps=x+w>rect[0]&&x<rect[2];
  if(overlaps&&gap<=90*view.scale)candidates.push({gap,y,text:item.str});
  if(overlaps&&y>=rect[1]-h&&y-h<=rect[3])inside.push(String(item.str));
 }
 candidates.sort((a,b)=>a.gap-b.gap||a.y-b.y);
 const lines=candidates.slice(0,16).map(x=>x.text),caption=sourceCaption(lines),insideText=inside.join(' ').replace(/\s+/g,' ').trim();
 return {contextText:lines.join('\n').slice(0,1800),insideText:insideText.slice(0,1200),calloutText:inside.some(s=>calloutPattern.test(String(s).trim())),...(caption?{caption,captionOrigin:'source'}:{captionOrigin:'label'})};
}

export function shouldKeepPdfVisual(metadata,rect,pageWidth,pageHeight,{tableLike=false}={}){
 const [x0,y0,x1,y1]=rect,w=Math.max(1,x1-x0),h=Math.max(1,y1-y0),ratio=w*h/Math.max(1,pageWidth*pageHeight),top=y0/Math.max(1,pageHeight),bottom=y1/Math.max(1,pageHeight),caption=metadata?.captionOrigin==='source';
 const chars=String(metadata?.insideText||'').replace(/\s/g,'').length;
 // A crop that is mostly running text is a slice of the page, whatever caption
 // happens to sit inside it. Publisher watermark stencils are the usual source:
 // they cover half a page, so the caption test alone would let them through.
 if(!tableLike&&ratio>=.24&&chars>=260)return false;
 if(!tableLike&&ratio>=.14&&chars>=520)return false;
 if(!caption&&!tableLike&&metadata?.calloutText)return false;
 if(!tableLike&&!caption&&ratio>=.10&&chars>=140)return false;
 if(!caption&&top<.17&&w>pageWidth*.38)return false;
 if(!caption&&bottom>.90&&w>pageWidth*.30)return false;
 if(!caption&&!tableLike&&ratio<.10&&(top<.24||bottom>.82))return false;
 return true;
}

export function wordPictureContext(nodes,index,content,isHeading){
 let start=index,end=index;
 while(start>Math.max(0,index-3)&&!isHeading(nodes[start]))start--;
 while(end<Math.min(nodes.length-1,index+3)&&!isHeading(nodes[end+1]))end++;
 const lines=nodes.slice(start,end+1).map(content).filter(Boolean);
 const nearest=nodes.slice(start,end+1).map((node,i)=>({node,i:start+i})).sort((a,b)=>Math.abs(a.i-index)-Math.abs(b.i-index)||(a.i<index?1:-1));
 const caption=nearest.map(({node})=>{const text=content(node).trim();const style=node.getElementsByTagNameNS?.('http://schemas.openxmlformats.org/wordprocessingml/2006/main','pStyle')[0]?.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','val')||'';return /caption/i.test(style)?text.slice(0,300):sourceCaption([text]);}).find(Boolean)||'';
 return {contextText:lines.join('\n').slice(0,1800),...(caption?{caption,captionOrigin:'source'}:{captionOrigin:'label'})};
}
