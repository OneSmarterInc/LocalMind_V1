/** Assemble positioned PDF glyph runs into lines before joining prose paragraphs. */
export function readablePdfText(items){
 const runs=items.filter(i=>typeof i.str==='string'&&i.str.trim()).map(i=>({...i,x:i.transform?.[4]||0,y:i.transform?.[5]||0,h:Math.abs(i.height||i.transform?.[3]||10)}));
 const lines=[];
 for(const run of runs){
  let line=lines.find(l=>Math.abs(l.y-run.y)<=Math.max(l.h,run.h)*0.55);
  if(!line){line={y:run.y,h:run.h,runs:[]};lines.push(line);}
  line.runs.push(run);if(run.h>line.h){line.y=run.y;line.h=run.h;}
 }
 lines.sort((a,b)=>b.y-a.y);
 const supers='⁰¹²³⁴⁵⁶⁷⁸⁹',subs='₀₁₂₃₄₅₆₇₈₉';
 const textLine=l=>{l.runs.sort((a,b)=>a.x-b.x);let out='',right=0;
  for(const r of l.runs){let value=r.str;const script=r.h<l.h*0.85&&Math.abs(r.y-l.y)>l.h*0.12;
   if(script&&/^[0-9+−-]+$/.test(value))value=value.replace(/[0-9+−-]/g,c=>/\d/.test(c)?(r.y>l.y?supers:subs)[Number(c)]:c==='+'?(r.y>l.y?'⁺':'₊'):(r.y>l.y?'⁻':'₋'));
   // Small-cap PDF runs encode display size, not mixed-case spelling.
   if(/^[A-Za-z]+$/.test(value)&&r.h<l.h*0.9&&Math.abs(r.y-l.y)<l.h*0.12&&l.runs.every(x=>/^[A-Za-z\s.0-9]+$/.test(x.str))&&l.runs.filter(x=>x.h>=l.h*0.9).every(x=>x.str===x.str.toUpperCase()))value=value.toUpperCase();
   const gap=r.x-right;out+=(out&&gap>l.h*0.18&&!script?' ':'')+value;right=r.x+(r.width||value.length*r.h*0.5);
  }return out.replace(/[ \t]+/g,' ').trim();};
 let out='';
 for(let i=0;i<lines.length;i++){const l=lines[i],value=textLine(l),prev=lines[i-1];
  const paragraph=prev&&(prev.y-l.y>Math.max(prev.h,l.h)*1.9||Math.abs(prev.h-l.h)>2||textLine(prev).length<45);
  out+=(out?(paragraph?'\n\n':' '):'')+value;
 }
 return out;
}

/** Image paint rectangles in page coordinates, using the PDF graphics transform stack. */
export function imageRectangles(ops,OPS,transform){
 let matrix=[1,0,0,1,0,0];const stack=[],rects=[];
 for(let i=0;i<ops.fnArray.length;i++){const fn=ops.fnArray[i],args=ops.argsArray[i];
  if(fn===OPS.save)stack.push([...matrix]);
  else if(fn===OPS.restore)matrix=stack.pop()||[1,0,0,1,0,0];
  else if(fn===OPS.transform)matrix=transform(matrix,args);
  else if(fn===OPS.paintImageXObject||fn===OPS.paintInlineImageXObject){
   const points=[[0,0],[1,0],[0,1],[1,1]].map(([x,y])=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]]);
   rects.push([Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]);
  }
 }return rects;
}

/**
 * Painted vector paths in page coordinates, with the paint style that produced
 * them. Reading the drawing operators rather than the rendered pixels is what
 * separates real line art from a publisher's watermark stencil, a tinted panel
 * or a coloured page banner: a background is a fill of known size and colour,
 * while pixel clustering can only see an unexplained patch of dark.
 */
export function drawingRectangles(ops,OPS,transform){
 let matrix=[1,0,0,1,0,0],fill=[0,0,0],stroke=[0,0,0];
 const stack=[],colours=[],out=[];let pending=null;
 const norm=v=>{const n=Number(v)||0;return n>1?n/255:n;};
 const point=(x,y)=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]];
 const box=minMax=>{
  if(!minMax||minMax.length<4)return null;
  const values=[...minMax];
  if(!values.every(Number.isFinite))return null;
  const [a,b,c,d]=values;
  const points=[[a,b],[c,b],[a,d],[c,d]].map(([x,y])=>point(x,y));
  return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
 };
 const paintOps=[OPS.fill,OPS.eoFill,OPS.fillStroke,OPS.eoFillStroke,OPS.closeFillStroke,OPS.closeEOFillStroke].filter(v=>v!==undefined);
 const strokeOps=[OPS.stroke,OPS.closeStroke].filter(v=>v!==undefined);
 for(let i=0;i<ops.fnArray.length;i++){
  const fn=ops.fnArray[i],args=ops.argsArray[i];
  if(fn===OPS.save){stack.push([...matrix]);colours.push([fill,stroke]);}
  else if(fn===OPS.restore){matrix=stack.pop()||[1,0,0,1,0,0];const c=colours.pop();if(c){fill=c[0];stroke=c[1];}}
  else if(fn===OPS.transform)matrix=transform(matrix,args);
  else if(fn===OPS.setFillRGBColor)fill=[norm(args[0]),norm(args[1]),norm(args[2])];
  else if(fn===OPS.setStrokeRGBColor)stroke=[norm(args[0]),norm(args[1]),norm(args[2])];
  else if(fn===OPS.constructPath)pending=box(args?.[2]);
  else if(pending&&paintOps.includes(fn)){out.push({rect:pending,filled:true,colour:fill});pending=null;}
  else if(pending&&strokeOps.includes(fn)){out.push({rect:pending,filled:false,colour:stroke});pending=null;}
  else if(fn===OPS.clip||fn===OPS.eoClip||fn===OPS.endPath)pending=null;
 }
 return out;
}

// Relations and operators mark a derivation. A ratio such as "90 / 100" is
// ordinary table content, so a solidus alone is not evidence of algebra.
const MATH_RE=/[=∫√≈≤≥±×÷∑]/;
const CAPTION_RE=/^(?:fig(?:ure)?\.?|table|chart|graph|diagram|exhibit|plate|map)\s*[\w.-]*\d/i;
const area=r=>Math.max(0,r[2]-r[0])*Math.max(0,r[3]-r[1]);
const grow=(a,b)=>[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])];
const axisOverlap=(a0,a1,b0,b1)=>Math.max(0,Math.min(a1,b1)-Math.max(a0,b0))/Math.max(1,Math.min(a1-a0,b1-b0));
const gapBetween=(a,b)=>[Math.max(b[0]-a[2],a[0]-b[2],0),Math.max(b[1]-a[3],a[1]-b[3],0)];
const touches=(a,b)=>{const [gx,gy]=gapBetween(a,b);return gx===0&&gy===0;};

/** Text runs assembled into visual lines in viewport coordinates. */
export function textLines(items,view){
 const runs=[];
 for(const item of items||[]){
  if(!item?.str?.trim()||!item.transform)continue;
  const [x,y]=view.convertToViewportPoint(item.transform[4],item.transform[5]);
  const scale=view.scale||1;
  const h=Math.max(5,Math.abs(item.height||item.transform[3]||10)*scale);
  const w=Math.max(2,Math.abs(item.width||0)*scale);
  runs.push({x0:x,y0:y-h,x1:x+w,y1:y+h*0.22,h,str:String(item.str)});
 }
 runs.sort((a,b)=>a.y0-b.y0||a.x0-b.x0);
 const lines=[];
 for(const run of runs){
  const centre=(run.y0+run.y1)/2;
  const line=lines.find(l=>Math.abs((l.y0+l.y1)/2-centre)<=Math.max(l.h,run.h)*0.55);
  if(!line){lines.push({...run,runs:[run]});continue;}
  line.x0=Math.min(line.x0,run.x0);line.x1=Math.max(line.x1,run.x1);
  line.y0=Math.min(line.y0,run.y0);line.y1=Math.max(line.y1,run.y1);
  line.h=Math.max(line.h,run.h);line.runs.push(run);
 }
 for(const line of lines){
  line.runs.sort((a,b)=>a.x0-b.x0);
  line.text=line.runs.map(r=>r.str).join(' ').replace(/\s+/g,' ').trim();
  line.chars=line.text.replace(/\s/g,'').length;
  // A two-column page puts unrelated text on the same baseline. Splitting at
  // the gutter keeps a caption from absorbing the body paragraph beside it.
  line.segments=[];
  let current=null;
  for(const run of line.runs){
   if(current&&run.x0-current.x1<=Math.max(line.h*2.2,12)){current.x1=Math.max(current.x1,run.x1);current.text+=' '+run.str;}
   else{current={x0:run.x0,y0:line.y0,x1:run.x1,y1:line.y1,h:line.h,text:run.str};line.segments.push(current);}
  }
  for(const segment of line.segments)segment.text=segment.text.replace(/\s+/g,' ').trim();
 }
 return lines.filter(l=>l.text);
}

export function captionLines(lines){
 return lines.flatMap(line=>(line.segments||[line]).filter(s=>s.text.length<=300&&CAPTION_RE.test(s.text)));
}

function charsInside(lines,rect){
 let total=0;
 for(const line of lines){
  const box=[Math.max(line.x0,rect[0]),Math.max(line.y0,rect[1]),Math.min(line.x1,rect[2]),Math.min(line.y1,rect[3])];
  if(box[2]<=box[0]||box[3]<=box[1])continue;
  const share=area(box)/Math.max(1,area([line.x0,line.y0,line.x1,line.y1]));
  if(share>0.15)total+=Math.round(line.chars*Math.min(1,share));
 }
 return total;
}

/** Cluster ink that touches or nearly touches, the way one drawing does.
 * Each group keeps the pieces it was built from, because what a region is made
 * of decides whether it is artwork or a stack of fraction bars. */
function cluster(items,gap){
 const groups=[];const remaining=items.map(item=>Array.isArray(item)?{rect:item,members:[item]}:item);
 while(remaining.length){
  const group=[remaining.shift()];
  for(let changed=true;changed;){
   changed=false;
   for(let i=remaining.length-1;i>=0;i--){
    const candidate=remaining[i];
    if(group.some(member=>{
     const [gx,gy]=gapBetween(member.rect,candidate.rect);
     return (gx<=gap&&gy<=gap);
    })){group.push(candidate);remaining.splice(i,1);changed=true;}
   }
  }
  groups.push({rect:group.map(g=>g.rect).reduce(grow),members:group.flatMap(g=>g.members)});
 }
 return groups;
}

/** Line art has shape. A block of equations only has fraction bars. */
function variedPieces(members,scale){
 let varied=0;
 for(const piece of members){
  const w=piece[2]-piece[0],h=piece[3]-piece[1];
  if(Math.min(w,h)<2.5*scale)continue;
  if(h<=4*scale&&w>=14*scale)continue;
  if(w<=4*scale&&h>=14*scale)continue;
  varied++;
 }
 return varied;
}

function textCoverage(lines,rect){
 let covered=0;
 for(const line of lines){
  const box=[Math.max(line.x0,rect[0]),Math.max(line.y0,rect[1]),Math.min(line.x1,rect[2]),Math.min(line.y1,rect[3])];
  if(box[2]>box[0]&&box[3]>box[1])covered+=area(box);
 }
 return covered/Math.max(1,area(rect));
}

/** Drop page furniture, tinted panels, banners and rails before clustering. */
function instructionalInk(drawings,width,height){
 const pageArea=Math.max(1,width*height);
 const span=Math.max(width,height);
 const kept=[];
 for(const drawing of drawings){
  const rect=drawing.rect;
  // A plain horizontal or vertical line has no thickness. It is still ink, so
  // give it one pixel rather than discarding half of every line drawing.
  const w=Math.max(1,rect[2]-rect[0]),h=Math.max(1,rect[3]-rect[1]);
  if(!(Number.isFinite(w)&&Number.isFinite(h)))continue;
  if(rect[3]<=height*0.17||rect[1]>=height*0.90)continue;
  const ratio=(w*h)/pageArea,aspect=Math.max(w,h)/Math.min(w,h);
  // A large solid fill is a background panel or a chapter banner, never the
  // instructional drawing that may sit on top of it.
  if(drawing.filled&&ratio>0.12)continue;
  // Long hairline rules and coloured margin rails must not bridge separate
  // figures. Short slivers are shading inside artwork and are kept.
  if(aspect>20&&ratio<0.04&&Math.max(w,h)>span*0.10)continue;
  if(drawing.filled&&aspect>8&&h>height*0.22&&w<width*0.08)continue;
  kept.push([rect[0],rect[1],rect[0]+w,rect[1]+h]);
 }
 return kept;
}

function nearestCaption(rect,captions,width,height){
 let best=null;
 for(const line of captions){
  const box=[line.x0,line.y0,line.x1,line.y1];
  const vertical=Math.max(rect[1]-box[3],box[1]-rect[3],0);
  const horizontal=Math.max(rect[0]-box[2],box[0]-rect[2],0);
  const overlap=axisOverlap(rect[0],rect[2],box[0],box[2]);
  if(vertical>height*0.44)continue;
  if(overlap<0.12&&horizontal>Math.max(width*0.30,(rect[2]-rect[0])*1.5))continue;
  const distance=vertical+horizontal*0.45;
  if(!best||distance<best.distance)best={distance,line};
 }
 return best;
}

/** Split one visual line where the gaps are wide enough to be cell boundaries. */
function rowCells(line){
 const cells=[];let current=null;
 for(const run of line.runs){
  if(current&&run.x0-current.x1<=Math.max(10,line.h*0.9)){current.x1=Math.max(current.x1,run.x1);current.text+=' '+run.str;}
  else{current={x0:run.x0,x1:run.x1,text:run.str};cells.push(current);}
 }
 return cells;
}

/** Rows of aligned short cells: a table the publisher drew without borders. */
function textTableRegions(lines,width,height){
 const rows=[];
 for(const line of lines){
  if(line.runs.length<2||line.y1<=height*0.17||line.y0>=height*0.90)continue;
  const cells=rowCells(line);
  if(cells.length>=3)rows.push({...line,cells});
 }
 const groups=[];
 for(const row of rows){
  const group=groups.find(g=>{
   const last=g[g.length-1];
   return row.y0-last.y1<=Math.max(26,last.h*3.0)&&
    row.cells.filter(cell=>last.cells.some(other=>Math.abs(other.x0-cell.x0)<=14)).length>=2;
  });
  if(group)group.push(row);else groups.push([row]);
 }
 const result=[];
 for(const group of groups){
  if(group.length<3)continue;
  // Every row of a table has the same shape. A stack of worked steps does not,
  // because each line of algebra breaks into a different number of pieces.
  const counts={};
  for(const row of group)counts[row.cells.length]=(counts[row.cells.length]||0)+1;
  const commonest=Math.max(...Object.values(counts));
  if(commonest<3||commonest<group.length*0.6)continue;
  const cells=group.flatMap(row=>row.cells);
  const lengths=cells.map(cell=>cell.text.replace(/\s/g,'').length).sort((a,b)=>a-b);
  const median=lengths[Math.floor(lengths.length/2)]||0;
  if(median>26||Math.max(...lengths)>220)continue;
  const columns=new Set(cells.map(cell=>Math.round(cell.x0/14)));
  if(columns.size<3)continue;
  // Worked-example arithmetic also sits in neat columns. A table is prose in
  // cells; a derivation is equations, so relations and operators give it away.
  const maths=cells.filter(cell=>MATH_RE.test(cell.text)).length;
  if(maths>cells.length*0.20)continue;
  const rect=group.map(row=>[row.x0,row.y0,row.x1,row.y1]).reduce(grow);
  // A table is laid out across the measure. A column of stacked display
  // equations is narrow, and that is the cheapest way to tell them apart.
  if(rect[2]-rect[0]<width*0.30)continue;
  const padded=[Math.max(0,rect[0]-12),Math.max(0,rect[1]-12),Math.min(width,rect[2]+12),Math.min(height,rect[3]+12)];
  if(area(padded)/Math.max(1,width*height)>0.55)continue;
  result.push({rect:padded,kind:'table'});
 }
 return result;
}

/** Three or more parallel rules sharing a span, with cells between them: a
 * table the publisher ruled. Rules alone are not enough, because a column of
 * display equations is also a stack of evenly spaced horizontal bars. */
function ruledTableRegions(drawings,lines,width,height){
 const rules=drawings.filter(d=>{
  const w=d.rect[2]-d.rect[0],h=d.rect[3]-d.rect[1];
  return h<=5&&w>=width*0.22&&d.rect[3]>height*0.17&&d.rect[1]<height*0.90;
 }).map(d=>d.rect).sort((a,b)=>a[1]-b[1]);
 const groups=[];
 for(const rule of rules){
  // Table rules are flush with each other. Fraction bars in a column of
  // equations are centred and each is a different width, so requiring both
  // ends to line up keeps a derivation from being read as a ruled table.
  const group=groups.find(g=>rule[1]-g[g.length-1][1]<=height*0.16&&
   Math.abs(rule[0]-g[0][0])<=width*0.05&&Math.abs(rule[2]-g[0][2])<=width*0.05);
  if(group)group.push(rule);else groups.push([rule]);
 }
 const result=[];
 for(const group of groups){
  if(group.length<3)continue;
  const rect=group.reduce(grow);
  const inside=lines.filter(line=>line.y0>=rect[1]-line.h&&line.y1<=rect[3]+line.h&&
   line.x0>=rect[0]-12&&line.x1<=rect[2]+12&&rowCells(line).length>=2);
  if(inside.length<3)continue;
  result.push({rect,kind:'table'});
 }
 return result;
}

/**
 * Figure, chart, diagram and table regions for one PDF page, in viewport
 * coordinates. Nothing here reads the rendered page, so a watermark stencil, a
 * tinted callout or a page banner cannot become a figure, and the caller still
 * never receives the page itself.
 */
export function visualRegions({ops,OPS,transform,items,view,width,height}){
 const lines=textLines(items,view);
 const captions=captionLines(lines);
 const scale=view?.scale||1;
 const pageArea=Math.max(1,width*height);
 const painted=drawingRectangles(ops,OPS,transform).map(d=>{
  const r=view.convertToViewportRectangle(d.rect);
  return {...d,rect:[Math.min(r[0],r[2]),Math.min(r[1],r[3]),Math.max(r[0],r[2]),Math.max(r[1],r[3])]};
 });
 const clusters=cluster(instructionalInk(painted,width,height),38*scale)
  .filter(group=>area(group.rect)/pageArea<=0.62);
 // A figure is drawing, not typesetting. Fraction bars, underlines and the
 // rules around a worked example are ink too, so a candidate has to show at
 // least a little shape before it can be a figure at all.
 const artwork=group=>variedPieces(group.members,scale)>=2&&textCoverage(lines,group.rect)<=0.55;

 const regions=[],used=new Set();
 // A source caption is the strongest evidence a page offers. Assemble the ink
 // that belongs to the caption into one figure rather than emitting every
 // arrow, axis and label box separately.
 for(const caption of captions){
  const near=clusters.filter((group,index)=>!used.has(index)&&nearestCaption(group.rect,[caption],width,height));
  if(!near.length)continue;
  let chosen=null;
  for(const group of cluster(near,85*scale)){
   if(area(group.rect)/pageArea>0.60)continue;
   if(!artwork(group))continue;
   const best=nearestCaption(group.rect,[caption],width,height);
   if(best&&(!chosen||best.distance<chosen.distance))chosen={distance:best.distance,rect:group.rect};
  }
  if(!chosen)continue;
  const tableLike=/^(?:table|chart|graph)\b/i.test(caption.text);
  regions.push({rect:chosen.rect,kind:tableLike?'table':'figure',caption:caption.text.slice(0,300)});
  clusters.forEach((group,index)=>{if(touches(group.rect,chosen.rect))used.add(index);});
 }
 // Compact, low-text ink without a caption is the conservative fallback for
 // genuine uncaptioned diagrams.
 clusters.forEach((group,index)=>{
  if(used.has(index))return;
  const rect=group.rect,w=rect[2]-rect[0],h=rect[3]-rect[1];
  if(w<40*scale||h<34*scale)return;
  if(area(rect)/pageArea>0.20)return;
  if(charsInside(lines,rect)>90||!artwork(group))return;
  regions.push({rect,kind:'figure',caption:''});
 });
 for(const table of [...ruledTableRegions(painted,lines,width,height),...textTableRegions(lines,width,height)]){
  if(regions.some(other=>touches(table.rect,other.rect)&&area(other.rect)>=area(table.rect)*0.7))continue;
  const caption=nearestCaption(table.rect,captions,width,height);
  regions.push({rect:table.rect,kind:'table',caption:caption?caption.line.text.slice(0,300):''});
 }
 return regions
  .filter(region=>{
   const w=region.rect[2]-region.rect[0],h=region.rect[3]-region.rect[1];
   return w>=34*scale&&h>=30*scale&&Math.max(w,h)/Math.max(1,Math.min(w,h))<=12;
  })
  .sort((a,b)=>a.rect[1]-b.rect[1]||a.rect[0]-b.rect[0]);
}

/**
 * Scanned pages carry no drawing operators, so their figures have to be found
 * in the raster. Text is masked using the boxes from the OCR pass already run
 * for the source text, and only firmly dark ink counts: a pale background tint
 * is a background, not a diagram.
 */
export function visualRectangles(canvas,textItems,view,ocrBoxes=[]){
 const width=canvas.width,height=canvas.height,pageArea=width*height;
 if(width<1||height<1)return [];
 const work=document.createElement('canvas');work.width=width;work.height=height;
 const ctx=work.getContext('2d',{willReadFrequently:true});ctx.drawImage(canvas,0,0);
 ctx.fillStyle='white';
 for(const item of textItems||[]){
  if(!item?.str?.trim()||!item.transform)continue;
  const m=view.convertToViewportPoint(item.transform[4],item.transform[5]);
  const scale=view.scale||1, w=Math.max(2,Math.abs(item.width||0)*scale),h=Math.max(8,Math.abs(item.height||item.transform[3]||10)*scale);
  // PDF text origin is on the baseline; erase a padded glyph box only.
  ctx.fillRect(Math.max(0,m[0]-3),Math.max(0,m[1]-h-4),Math.min(width,w+6),Math.min(height,h+9));
 }
 for(const box of ocrBoxes){
  if([box.x0,box.y0,box.x1,box.y1].every(Number.isFinite))ctx.fillRect(box.x0-2,box.y0-2,box.x1-box.x0+4,box.y1-box.y0+4);
 }
 const data=ctx.getImageData(0,0,width,height).data;work.width=0;work.height=0;
 const step=Math.max(5,Math.ceil(Math.max(width,height)/420));
 const gw=Math.ceil(width/step),gh=Math.ceil(height/step),on=new Uint8Array(gw*gh);
 for(let gy=0;gy<gh;gy++)for(let gx=0;gx<gw;gx++){
  let dark=0,samples=0;
  for(let oy=0;oy<step;oy+=Math.max(1,Math.floor(step/2)))for(let ox=0;ox<step;ox+=Math.max(1,Math.floor(step/2))){
   const x=Math.min(width-1,gx*step+ox),y=Math.min(height-1,gy*step+oy),i=(y*width+x)*4;
   samples++;
   // Luminance, not a channel sum: pale blue and grey publisher tints are as
   // bright as paper to the eye and must not register as ink.
   if(data[i]*0.299+data[i+1]*0.587+data[i+2]*0.114<170&&data[i+3]>20)dark++;
  }
  if(dark>=Math.max(1,Math.ceil(samples*0.34)))on[gy*gw+gx]=1;
 }
 const seen=new Uint8Array(on.length),boxes=[];
 for(let sy=0;sy<gh;sy++)for(let sx=0;sx<gw;sx++){
  const start=sy*gw+sx;if(!on[start]||seen[start])continue;
  const q=[start];seen[start]=1;let minX=sx,maxX=sx,minY=sy,maxY=sy,count=0;
  while(q.length){const n=q.pop(),x=n%gw,y=Math.floor(n/gw);count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=gw||ny>=gh)continue;const ni=ny*gw+nx;if(on[ni]&&!seen[ni]){seen[ni]=1;q.push(ni);}}
  }
  const x=Math.max(0,minX*step-10),y=Math.max(0,minY*step-10),w=Math.min(width-x,(maxX-minX+1)*step+20),h=Math.min(height-y,(maxY-minY+1)*step+20),box=w*h;
  if(count>=6&&w>=55&&h>=45&&box>=2500&&box/pageArea<=0.62&&y+h>height*0.17&&y<height*0.90)boxes.push([x,y,x+w,y+h]);
 }
 const merged=[];
 for(const box of boxes){
  const hit=merged.find(b=>!(box[0]>b[2]+24||box[2]<b[0]-24||box[1]>b[3]+24||box[3]<b[1]-24));
  if(hit){hit[0]=Math.min(hit[0],box[0]);hit[1]=Math.min(hit[1],box[1]);hit[2]=Math.max(hit[2],box[2]);hit[3]=Math.max(hit[3],box[3]);}
  else merged.push([...box]);
 }
 return merged.filter(b=>area(b)/pageArea<=0.62);
}
