/** Context-driven placement, independent of the local inference engine. */
import type {SourceVisual} from './core';
const normalize=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const stop=new Set('about after before their there these those which would source figure diagram chart table chapter module section'.split(' '));
const words=(s:string)=>new Set((normalize(s).match(/[\p{L}\p{N}]+/gu)||[]).filter(w=>w.length>=4&&!stop.has(w)));
function score(context:string,source:string){
 const target=normalize(source), phrases=[...new Set(context.split(/[\n.!?]+/).map(normalize))];
 const exact=phrases.filter(p=>p.length>=24&&target.includes(p)).length,terms=words(source);
 return Math.min(4,exact)*10+Math.min(9,[...words(context)].filter(w=>terms.has(w)).length);
}
export function lessonVisualIds(sections:{heading:string;content:string;quote:string}[],visuals:SourceVisual[]):string[][]{
 const out=sections.map(()=>[] as string[]);
 for(const v of visuals){
  if(v.kind==='page'||v.caption.startsWith('Original page'))continue;
  const ranked=sections.map((s,index)=>{
   const source=s.quote+'\n'+s.content,context=v.contextText||'',caption=v.captionOrigin==='source'?v.caption:'';
   const contextScore=score(context,source),captionScore=score(caption,source),terms=words(source);
   const exactHeading=!!v.headingPath?.length&&normalize(s.heading)===normalize(v.headingPath[v.headingPath.length-1]);
   const common=[...words(context+'\n'+caption)].filter(w=>terms.has(w)).length;
   const strong=exactHeading||Math.max(contextScore,captionScore)>=10||common>=6;
   return {index,score:strong?contextScore+captionScore+(exactHeading?40:0):0};
  }).sort((a,b)=>b.score-a.score);
  if(ranked[0]?.score>=4&&(!ranked[1]||ranked[0].score-ranked[1].score>=3))out[ranked[0].index].push(v.id);
 }
 return out;
}
