import type {Figure} from '@/ui/SourceFigures';
type TextSection={heading:string;content?:string;quote?:string;explanation?:string;source_reference?:string};
const normalize=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const words=(s:string)=>new Set(normalize(s).match(/[\p{L}\p{N}]{4,}/gu)||[]);
/** Weak/tied matches stay in the module gallery, never in an invented section. */
export function figurePlacement(sections:TextSection[],visuals:Figure[]){
 const groups:Figure[][]=sections.map(()=>[]),remaining:Figure[]=[];
 for(const visual of visuals.filter(v=>v.kind!=='page'&&!v.caption?.startsWith('Original page'))){
  const context=visual.context_text||'',terms=words(context),heading=normalize(visual.heading_path?.at(-1)||'');
  const ranked=sections.map((s,index)=>{const source=[s.quote,s.source_reference,s.content,s.explanation].filter(Boolean).join('\n'),target=normalize(source),targetWords=words(source);const overlap=[...terms].filter(w=>targetWords.has(w)).length;const exact=context.split(/[\n.!?]+/).some(p=>normalize(p).length>=24&&target.includes(normalize(p)));const sameHeading=!!heading&&heading===normalize(s.heading);return {index,score:exact||sameHeading||overlap>=6?(exact?10:0)+(sameHeading?40:0)+Math.min(overlap,9):0};}).sort((a,b)=>b.score-a.score);
  if(ranked[0]?.score>0&&(!ranked[1]||ranked[0].score-ranked[1].score>=3))groups[ranked[0].index].push(visual);else remaining.push(visual);
 }
 return {groups,remaining};
}
