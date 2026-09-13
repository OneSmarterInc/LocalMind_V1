export type ParsedDocument={items:{title:string;text:string;page?:number}[];warnings:string[]};
let sender:((id:string,name:string,body:string)=>void)|undefined;
let pending:{id:string;resolve:(v:ParsedDocument)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}|undefined;
export function attachParser(send:typeof sender) { sender=send; if(!send && pending){clearTimeout(pending.timer);pending.reject(new Error('The local parser closed. Try importing the book again.'));pending=undefined;} }
export function parserResult(result:{id?:string;parsed?:ParsedDocument;error?:string}) {
 if(!pending||result.id!==pending.id)return;const p=pending;pending=undefined;clearTimeout(p.timer);
 result.parsed?p.resolve(result.parsed):p.reject(new Error(result.error||'Book parsing failed'));
}
export async function parseNative(name:string,body:string):Promise<ParsedDocument> {
 if(!sender)throw new Error('The local book parser is still starting. Try again in a moment.');
 if(pending)throw new Error('A book is already being imported. Wait for it to finish.');
 const id=`parse-${Date.now()}`;
 return await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending=undefined;reject(new Error('Book parsing timed out. Import a chapter at a time.'));},120000);
  pending={id,resolve,reject,timer}; sender!(id,name,body);
 });
}
