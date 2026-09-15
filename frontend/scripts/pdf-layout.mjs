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
 * Find vector/table/chart regions from the already-rendered page without ever
 * returning the page itself. We mask selectable text, sample the remaining ink
 * at low resolution, then cluster connected drawing pixels. This catches line
 * art (flow diagrams, axes, bars, table grids) that PDF image operators miss.
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
 // Scans have no selectable glyphs: use the boxes from the OCR already done
 // for source text, not another recognition pass. This prevents prose blocks
 // from being mistaken for diagrams on scanned pages.
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
   samples++;if(data[i]+data[i+1]+data[i+2]<720&&data[i+3]>20)dark++;
  }
  if(dark>=Math.max(1,Math.ceil(samples*0.2)))on[gy*gw+gx]=1;
 }
 const seen=new Uint8Array(on.length),boxes=[];
 for(let sy=0;sy<gh;sy++)for(let sx=0;sx<gw;sx++){
  const start=sy*gw+sx;if(!on[start]||seen[start])continue;
  const q=[start];seen[start]=1;let minX=sx,maxX=sx,minY=sy,maxY=sy,count=0;
  while(q.length){const n=q.pop(),x=n%gw,y=Math.floor(n/gw);count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=gw||ny>=gh)continue;const ni=ny*gw+nx;if(on[ni]&&!seen[ni]){seen[ni]=1;q.push(ni);}}
  }
  const x=Math.max(0,minX*step-10),y=Math.max(0,minY*step-10),w=Math.min(width-x,(maxX-minX+1)*step+20),h=Math.min(height-y,(maxY-minY+1)*step+20),area=w*h;
  if(count>=3&&w>=55&&h>=45&&area>=2500&&area/pageArea<=0.65)boxes.push([x,y,x+w,y+h]);
 }
 // Merge close components (for example separate bars and axes in one chart).
 const merged=[];
 for(const box of boxes){
  let hit=merged.find(b=>!(box[0]>b[2]+24||box[2]<b[0]-24||box[1]>b[3]+24||box[3]<b[1]-24));
  if(hit){hit[0]=Math.min(hit[0],box[0]);hit[1]=Math.min(hit[1],box[1]);hit[2]=Math.max(hit[2],box[2]);hit[3]=Math.max(hit[3],box[3]);}
  else merged.push([...box]);
 }
 return merged.filter(b=>(b[2]-b[0])*(b[3]-b[1])/pageArea<=0.65);
}
