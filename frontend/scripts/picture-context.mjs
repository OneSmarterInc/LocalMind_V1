/** Nearby words are metadata only, never extra pixels around the picture. */
const captionPattern=/^(?:fig(?:ure)?\.?|diagram|chart|table)\s+[\w.-]+(?:\s*[:.\-–—]|\s+)/i;
export function sourceCaption(lines){return lines.map(s=>String(s).trim()).find(s=>captionPattern.test(s))?.slice(0,300)||'';}
export function usefulPicture(width,height){return width>=40&&height>=40&&Math.max(width,height)/Math.min(width,height)<=12&&width*height<=36_000_000;}
export function pdfPictureContext(items,view,rect){
 const candidates=[];
 for(const item of items){
  if(!item.str?.trim()||!item.transform)continue;
  const [x,y]=view.convertToViewportPoint(item.transform[4],item.transform[5]);
  const w=Math.abs(item.width||0)*view.scale,h=Math.abs(item.height||item.transform[3]||10)*view.scale;
  const gap=Math.max(rect[1]-y,y-h-rect[3],0);
  if(x+w>rect[0]&&x<rect[2]&&gap<=90*view.scale)candidates.push({gap,y,text:item.str});
 }
 candidates.sort((a,b)=>a.gap-b.gap||a.y-b.y);
 const lines=candidates.slice(0,16).map(x=>x.text),caption=sourceCaption(lines);
 return {contextText:lines.join('\n').slice(0,1800),...(caption?{caption,captionOrigin:'source'}:{captionOrigin:'label'})};
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
