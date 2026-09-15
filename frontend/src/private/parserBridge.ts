import type {SourceItem,SourceVisual} from './core';
export type ParsedDocument={items:SourceItem[];warnings:string[];visuals?:SourceVisual[]};
let sender:((id:string,name:string,body:string)=>void)|undefined;
let acknowledge:((id:string,error?:string)=>void)|undefined;
let cancelSender:(()=>void)|undefined;
let pending:{saving?:Promise<void>;saveVisual?:(visual:SourceVisual)=>Promise<void>;progress?:(message:string)=>void;id:string;resolve:(v:ParsedDocument)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>;cleanup:()=>void}|undefined;
function fail(message:string){const p=pending;if(!p)return;pending=undefined;clearTimeout(p.timer);p.cleanup();cancelSender?.();void (p.saving||Promise.resolve()).then(()=>p.reject(new Error(message)),()=>p.reject(new Error(message)));}
const timeout=()=>setTimeout(()=>fail('Book parsing timed out. Import a chapter at a time.'),180000);
export function attachParser(send:typeof sender,cancel?:()=>void,ack?:typeof acknowledge){if(!send)fail('The local parser closed. Try importing the book again.');sender=send;cancelSender=cancel;acknowledge=ack;}
export function parserResult(result:{id?:string;parsed?:ParsedDocument;error?:string;progress?:string;visual?:SourceVisual}){
 if(!pending||result.id!==pending.id)return;
 if(result.visual){
  const p=pending;clearTimeout(p.timer);p.timer=timeout();
  p.saving=(async()=>{
   if(!p.saveVisual)throw Error('The image storage handler is unavailable.');await p.saveVisual(result.visual!);
  })();
  void p.saving.then(()=>{if(pending===p)acknowledge?.(p.id);},e=>{if(pending===p){acknowledge?.(p.id,e instanceof Error?e.message:String(e));fail(e instanceof Error?e.message:String(e));}});return;
 }
 if(result.progress){clearTimeout(pending.timer);pending.timer=timeout();pending.progress?.(result.progress);return;}
 const p=pending;pending=undefined;clearTimeout(p.timer);p.cleanup();
 result.parsed?p.resolve(result.parsed):p.reject(new Error(result.error||'Book parsing failed'));
}
export async function parseNative(name:string,body:string,signal?:AbortSignal,progress?:(message:string)=>void,saveVisual?:(visual:SourceVisual)=>Promise<void>):Promise<ParsedDocument>{
 if(signal?.aborted)throw new Error('Book import cancelled.');
 if(!sender)throw new Error('The local book parser is still starting. Try again in a moment.');
 if(pending)throw new Error('A book is already being imported. Wait for it to finish.');
 const id=`parse-${Date.now()}`;
 return await new Promise((resolve,reject)=>{
  const abort=()=>fail('Book import cancelled. Nothing was saved.');
  pending={id,progress,saveVisual,resolve,reject,timer:timeout(),cleanup:()=>signal?.removeEventListener('abort',abort)};
  signal?.addEventListener('abort',abort);sender!(id,name,body);
 });
}
