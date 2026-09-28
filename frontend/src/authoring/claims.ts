/**
 * One device per login generates a book.
 *
 * QA found that a faculty account signed in on a laptop and a phone at once
 * generated two different sets of lessons and quizzes for the same book, one
 * per device, and both reached the server. The server now keeps an owner per
 * login and book (backend documents/generation_claims.py). This module is the
 * device side of that rule.
 *
 * Online: before a device generates, it asks the server for the book. If
 * another device of the same login holds it, generation stops with
 * "Generation for this book already started on another device".
 *
 * Offline: the device cannot ask, so it records that it started (with the
 * time) and generates anyway. On reconnect, reconcile() asks the server before
 * any draft is sent. The first device to reconnect wins. The other is told,
 * its running jobs for that book are cancelled, and its drafts stay on the
 * device unsent. The server re-checks every write, so ordering mistakes here
 * cannot let a second set through.
 */
import {api,ApiError} from '@/api/client';
import {device} from '@/private/device';
import {Library} from '@/private/library';

export type Claim={device_label:string;started_at:string;claimed_at:string;last_seen:string;mine:boolean;stale:boolean};
/** "This device started generating this book" — waiting to be confirmed by the server. */
type Pending={key:string;documentId?:string;localBook?:string;startedAt:string};
/** "Another device owns this book." Kept until the person takes over or the owner releases it. */
export type Lost={key:string;documentId?:string;localBook?:string;claim:Claim;at:string};

export const CLAIMED_ELSEWHERE='GENERATION_CLAIMED_ELSEWHERE';
export class ClaimedElsewhereError extends Error{
 readonly code=CLAIMED_ELSEWHERE;
 constructor(readonly claim:Claim,readonly documentId?:string){super(claimMessage(claim));}
}
export function claimMessage(claim:Pick<Claim,'device_label'|'started_at'>){
 const when=claim.started_at?new Date(claim.started_at):null;
 const at=when&&!isNaN(when.getTime())?` at ${when.toLocaleString()}`:'';
 return `Already started generation on another device (${claim.device_label||'another device'}${at}). Continue there, or take over from this device.`;
}
export const isClaimedElsewhere=(e:unknown):e is ClaimedElsewhereError|ApiError=>e instanceof ClaimedElsewhereError||(e instanceof ApiError&&e.code===CLAIMED_ELSEWHERE);

const listeners=new Set<()=>void>();
export function subscribeClaims(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
const emit=()=>listeners.forEach(l=>l());
const HEARTBEAT_MS=60_000;
const lastBeat=new Map<string,number>();

export class GenerationClaims{
 readonly library:Library;
 constructor(owner:string){this.library=new Library(owner,'authoring');}
 private k(kind:'pending'|'lost',id:string){return `${this.library.prefix}claim:${kind}:${id}`;}
 private id(documentId?:string,localBook?:string){return documentId||(localBook?'local-'+localBook:'');}
 private async get<T>(key:string){const v=await(await device()).get<T|null>(key);this.library.guard();return v||undefined;}
 private async put(key:string,value:unknown){this.library.guard();await(await device()).put(key,value);}
 private async all<T>(kind:'pending'|'lost'){const rows=await(await device()).list<T|null>(`${this.library.prefix}claim:${kind}:`);this.library.guard();return rows.filter(Boolean) as T[];}

 /** Another device's claim on this book, if this device has been refused. */
 async lost(documentId?:string,localBook?:string){
  const direct=documentId?await this.get<Lost>(this.k('lost',documentId)):undefined;
  return direct||(localBook?await this.get<Lost>(this.k('lost','local-'+localBook)):undefined);
 }
 private async markLost(documentId:string|undefined,localBook:string|undefined,claim:Claim){
  const key=this.id(documentId,localBook);if(!key)return;
  await this.put(this.k('lost',key),{key,documentId,localBook,claim,at:new Date().toISOString()} satisfies Lost);
  await this.put(this.k('pending',key),null);emit();
 }
 private async clearLost(documentId?:string,localBook?:string){
  if(documentId)await this.put(this.k('lost',documentId),null);
  if(localBook)await this.put(this.k('lost','local-'+localBook),null);
  emit();
 }
 private async remember(documentId:string|undefined,localBook:string|undefined){
  const key=this.id(documentId,localBook);if(!key)return;
  const old=await this.get<Pending>(this.k('pending',key));
  await this.put(this.k('pending',key),{key,documentId,localBook,startedAt:old?.startedAt||new Date().toISOString()} satisfies Pending);
 }
 /** When this device first started on a book, for the offline book upload. */
 async startedAt(documentId?:string,localBook?:string){return (await this.get<Pending>(this.k('pending',this.id(documentId,localBook))))?.startedAt;}

 private async ask(documentId:string,body:Record<string,unknown>){
  const r=await api<{claim:Claim}>(`/faculty/documents/${documentId}/generation-claim/`,{method:'POST',body,timeoutMs:15000});
  lastBeat.set(this.library.prefix+documentId,Date.now());return r.claim;
 }
 private static claimOf(e:unknown):Claim|undefined{
  if(!(e instanceof ApiError)||e.code!==CLAIMED_ELSEWHERE)return undefined;
  return (e.details as {claim?:Claim}|undefined)?.claim||{device_label:'another device',started_at:'',claimed_at:'',last_seen:'',mine:false,stale:false};
 }

 /** Call before generating anything for a book. Throws ClaimedElsewhereError
  * if another device of this login owns it. Offline, it records the start and
  * lets generation proceed; reconcile() settles it on reconnect. */
 async ensure(documentId?:string,localBook?:string){
  const refused=await this.lost(documentId,localBook);
  if(refused)throw new ClaimedElsewhereError(refused.claim,documentId);
  await this.remember(documentId,localBook);
  if(!documentId)return; // A book not yet on the server: settled when it uploads.
  try{
   await this.ask(documentId,{started_at:await this.startedAt(documentId)});
   await this.put(this.k('pending',documentId),null);
  }catch(e){
   const claim=GenerationClaims.claimOf(e);
   if(claim){await this.markLost(documentId,localBook,claim);throw new ClaimedElsewhereError(claim,documentId);}
   if(e instanceof ApiError&&e.status===0)return; // offline: keep the pending record
   throw e;
  }
 }

 /** Run on every reconnect and on the sync timer, BEFORE drafts are sent.
  * Confirms offline starts, renews books this device is generating, and
  * returns the books this device just lost so their jobs can be stopped. */
 async reconcile(active:Iterable<string>=[],resolveLocal:(localBook:string)=>Promise<string|undefined>=async()=>undefined){
  const lostNow:string[]=[];
  const settle=async(documentId:string,localBook:string|undefined,body:Record<string,unknown>,pendingKey?:string)=>{
   try{await this.ask(documentId,body);if(pendingKey)await this.put(this.k('pending',pendingKey),null);}
   catch(e){const claim=GenerationClaims.claimOf(e);if(claim){await this.markLost(documentId,localBook,claim);if(pendingKey&&pendingKey!==documentId)await this.put(this.k('pending',pendingKey),null);lostNow.push(documentId);}else if(!(e instanceof ApiError&&e.status===0))throw e;}
  };
  for(const p of await this.all<Pending>('pending')){
   const documentId=p.documentId||(p.localBook?await resolveLocal(p.localBook):undefined);
   if(!documentId)continue; // local book still waiting for its own upload
   await settle(documentId,p.localBook,{started_at:p.startedAt},p.key);
  }
  for(const documentId of new Set(active)){
   const at=lastBeat.get(this.library.prefix+documentId)||0;
   if(Date.now()-at<HEARTBEAT_MS||await this.lost(documentId))continue;
   await settle(documentId,undefined,{});
  }
  if(lostNow.length)emit();
  return lostNow;
 }

 /** The book upload was refused as a duplicate and another device owns it. */
 async localBookRefused(localBook:string,documentId:string|undefined,claim:Claim){await this.markLost(documentId,localBook,claim);}

 /** Who owns the book, fresh from the server. */
 async status(documentId:string){return (await api<{claim:Claim|null}>(`/faculty/documents/${documentId}/generation-claim/`,{cacheOffline:false})).claim;}

 /** The person chose to generate here instead. The other device is refused
  * on its next contact and its unsent drafts stay on it. */
 async takeOver(documentId:string,localBook?:string){
  const claim=await this.ask(documentId,{take_over:true});
  await this.clearLost(documentId,localBook);return claim;
 }
 /** Let another device of this login generate the book. */
 async release(documentId:string){
  await api(`/faculty/documents/${documentId}/generation-claim/`,{method:'DELETE',timeoutMs:15000});
  await this.put(this.k('pending',documentId),null);emit();
 }
 /** The owner released or lost the book: this device may try again. */
 async forget(documentId:string){await this.clearLost(documentId);}
}
