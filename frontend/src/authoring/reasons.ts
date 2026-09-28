/**
 * Why a module has no lesson or quiz, in words a faculty member or student can
 * act on.
 *
 * Automatic preparation skips three kinds of module (front matter, no readable
 * text, very short text) and a generation can fail. The book table used to show
 * only a grey badge and a greyed-out Preview button, which read as "broken"
 * with no explanation. Every screen now takes its wording from here so the
 * book table, the module page, the student lesson tab and the private library
 * all say the same thing.
 */
import {isFrontMatter} from './local';

/** Below this many characters a module is too short to teach from. */
export const BRIEF_SOURCE_CHARS=80;

export type SkipKind='front-matter'|'no-source'|'brief-source';
export type Reason={kind:SkipKind|'failed';title:string;short:string;message:string;canOverride:boolean};

const REASONS:Record<SkipKind,Omit<Reason,'kind'>>={
 'front-matter':{title:'No lesson or quiz for this module',short:'Objectives or contents page: read, not taught.',
  message:'This module looks like front matter (objectives, contents, preface or similar). Students read it on the Read tab, but a lesson or quiz written from it would only repeat it, so it is skipped. If it really is teaching material, generate it anyway from the module page.',
  canOverride:true},
 'no-source':{title:'No lesson or quiz for this module',short:'No readable text was found for this module.',
  message:'No readable text was recognised for this module (it may be an image-only page or an empty section), so there is nothing to build a lesson or quiz from. Check the source on the Outline & source tab, correct or re-import it, and generate again.',
  canOverride:false},
 'brief-source':{title:'Too little content for a lesson or quiz',short:'Too little text to teach from. Review the source.',
  message:`This module has only a line or two of text (under ${BRIEF_SOURCE_CHARS} characters), which is too little for a useful lesson or quiz. It may be a heading that was split from its content. Review the outline and merge it into its neighbour, or generate anyway from the module page.`,
  canOverride:true},
};

/** Why automatic preparation skips this module, or null if it is teachable. */
export function skipReason(title?:string|null,source?:string|null,sourceMissing?:boolean):Reason|null{
 const text=(source||'').trim();
 const kind:SkipKind|null=sourceMissing||!text?'no-source':isFrontMatter(title,source)?'front-matter':text.length<BRIEF_SOURCE_CHARS?'brief-source':null;
 return kind?{kind,...REASONS[kind]}:null;
}

/** The reason behind a status badge the book table shows. */
export function reasonForStatus(status:string,error?:string|null):Reason|null{
 if(status==='Front matter')return{kind:'front-matter',...REASONS['front-matter']};
 if(status==='No source text')return{kind:'no-source',...REASONS['no-source']};
 if(status.startsWith('Brief source'))return{kind:'brief-source',...REASONS['brief-source']};
 if(status==='Failed'||status.startsWith('Failed'))return failureReason(error);
 return null;
}

/** A generation failure explained. The model's own message is kept at the end
 * so nothing is hidden from someone reporting a problem. */
export function failureReason(error?:string|null):Reason{
 const raw=(error||'').trim();
 const e=raw.toLowerCase();
 let short='Generation did not finish.',message='The local model could not produce a usable result for this module.';
 if(/not enough|too little|too short|insufficient|no .*content|too few/.test(e)){
  short='Too little content for the requested lesson or quiz.';
  message='The module does not have enough content for the model to write a grounded lesson or the requested number of questions. Try fewer quiz questions, or merge this module with its neighbour on the Outline & source tab.';
 }else if(/quote|ground|source text|not found in/.test(e)){
  short='The answer could not be traced back to the module text.';
  message='The model wrote something that could not be matched to the module text, so it was rejected rather than shown to students. Generating again usually works; if it keeps failing, the source text may need correcting.';
 }else if(/json|schema|parse|format|options|exactly/.test(e)){
  short='The model returned an incomplete answer.';
  message='The model returned a lesson or quiz in the wrong shape (for example, missing options). Generating again usually works.';
 }else if(/time|abort|cancel|memory|storage|model/.test(e)){
  short='The device stopped the generation.';
  message='Generation stopped on this device (time limit, memory or the model being unavailable). Keep the app open and generate again, or try on another device.';
 }
 return{kind:'failed',title:'Generation did not finish',short,message:raw?`${message} Details: ${raw.length>180?raw.slice(0,177)+'…':raw}`:message,canOverride:true};
}
