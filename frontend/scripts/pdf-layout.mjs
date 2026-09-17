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

/** Group vector strokes into source figure/table regions. Never change text items. */
export function vectorRectangles(ops,OPS,transform){
 let matrix=[1,0,0,1,0,0];const stack=[],regions=[];
 for(let i=0;i<ops.fnArray.length;i++){
  const fn=ops.fnArray[i],args=ops.argsArray[i];
  if(fn===OPS.save)stack.push([...matrix]);
  else if(fn===OPS.restore)matrix=stack.pop()||[1,0,0,1,0,0];
  else if(fn===OPS.transform)matrix=transform(matrix,args);
  else if(fn===OPS.constructPath&&args?.[2]?.length===4&&args[2].every(Number.isFinite)){
   const [x0,y0,x1,y1]=args[2],points=[[x0,y0],[x0,y1],[x1,y0],[x1,y1]].map(([x,y])=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]]);
   regions.push([Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]);
  }
 }
 const groups=[];
 for(const rect of regions){let merged=rect,count=1;for(let i=0;i<groups.length;){const g=groups[i];if(merged[0]<=g.rect[2]+14&&merged[2]>=g.rect[0]-14&&merged[1]<=g.rect[3]+14&&merged[3]>=g.rect[1]-14){merged=[Math.min(merged[0],g.rect[0]),Math.min(merged[1],g.rect[1]),Math.max(merged[2],g.rect[2]),Math.max(merged[3],g.rect[3])];count+=g.count;groups.splice(i,1);i=0;}else i++;}groups.push({rect:merged,count});}
 return groups.filter(g=>g.count>=3&&g.rect[2]-g.rect[0]>=45&&g.rect[3]-g.rect[1]>=35).map(g=>g.rect);
}

export function sourceFigureContext(items,rect){
 const [x0,y0,x1,y1]=rect;
 const nearby=items.filter(i=>i.str?.trim()&&i.transform).filter(i=>{const x=i.transform[4],y=i.transform[5];return x+(i.width||0)>=x0-25&&x<=x1+25&&y>=y0-80&&y<=y1+80;});
 const text=readablePdfText(nearby);
 const caption=text.split(/\n+/).find(l=>/^(?:fig(?:ure)?\.?|diagram|table|chart)\s+[\w.-]+/i.test(l.trim()));
 return {context_text:text.slice(0,1800),...(caption?{caption:caption.slice(0,300)}:{})};
}
