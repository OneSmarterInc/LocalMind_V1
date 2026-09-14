import type {SourceItem,SourceVisual} from './core';
export type ParsedDocument={items:SourceItem[];warnings:string[];visuals?:SourceVisual[]};
let sender:((id:string,name:string,body:string)=>void)|undefined;
let cancelSender:(()=>void)|undefined;
let pending:{id:string;resolve:(v:ParsedDocument)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>;cleanup:()=>void}|undefined;
function fail(message:string){const p=pending;if(!p)return;pending=undefined;clearTimeout(p.timer);p.cleanup();cancelSender?.();p.reject(new Error(message));}
const timeout=()=>setTimeout(()=>fail('Book parsing timed out. Import a chapter at a time.'),180000);
export function attachParser(send:typeof sender,cancel?:()=>void){if(!send)fail('The local parser closed. Try importing the book again.');sender=send;cancelSender=cancel;}
export function parserResult(result:{id?:string;parsed?:ParsedDocument;error?:string;progress?:string}){
 if(!pending||result.id!==pending.id)return;
 if(result.progress){clearTimeout(pending.timer);pending.timer=timeout();return;}
 const p=pending;pending=undefined;clearTimeout(p.timer);p.cleanup();
 result.parsed?p.resolve(result.parsed):p.reject(new Error(result.error||'Book parsing failed'));
}
export async function parseNative(name:string,body:string,signal?:AbortSignal):Promise<ParsedDocument>{
 if(signal?.aborted)throw new Error('Book import cancelled.');
 if(!sender)throw new Error('The local book parser is still starting. Try again in a moment.');
 if(pending)throw new Error('A book is already being imported. Wait for it to finish.');
 const id=`parse-${Date.now()}`;
 return await new Promise((resolve,reject)=>{
  const abort=()=>fail('Book import cancelled. Nothing was saved.');
  pending={id,resolve,reject,timer:timeout(),cleanup:()=>signal?.removeEventListener('abort',abort)};
  signal?.addEventListener('abort',abort);sender!(id,name,body);
 });
}
