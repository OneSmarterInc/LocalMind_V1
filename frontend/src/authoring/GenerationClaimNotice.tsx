/**
 * "Already started generation on another device" for one book.
 *
 * Shown on the book page when another device of this login owns the book's
 * generation, either because the server said so just now (both online) or
 * because this device was refused when it reconnected (it generated offline
 * and the other device reached the server first). Offers a deliberate take
 * over; nothing changes owner without the person asking.
 */
import React,{useCallback,useEffect,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {errorMessage} from '@/api/client';
import {useOnline} from '@/offline/connectivity';
import {everyVisible} from '@/hooks/visibleInterval';
import {Button,Notice,confirmAsync,showToast} from '@/ui';
import {GenerationClaims,claimMessage,subscribeClaims,type Claim} from './claims';

function ago(iso:string){
 const t=new Date(iso).getTime();if(isNaN(t))return '';
 const m=Math.max(0,Math.round((Date.now()-t)/60000));
 return m<1?'just now':m<60?`${m} min ago`:m<1440?`${Math.round(m/60)} h ago`:`${Math.round(m/1440)} d ago`;
}

export function GenerationClaimNotice({documentId,onTakenOver}:{documentId:string;onTakenOver?:()=>void}){
 const {user}=useAuth(),owner=user?.id,online=useOnline();
 const [claim,setClaim]=useState<Claim|null>(null);
 const [busy,setBusy]=useState(false);
 const read=useCallback(async()=>{
  if(!owner||!documentId)return;
  const claims=new GenerationClaims(owner);
  const local=(await claims.lost(documentId))?.claim||null;
  if(!online){setClaim(local);return;}
  try{
   const server=await claims.status(documentId);
   // The other device released the book, or this device owns it again:
   // clear the refusal so generation can resume here.
   if(local&&(!server||server.mine))await claims.forget(documentId);
   setClaim(server&&!server.mine?server:null);
  }catch{setClaim(local);}
 },[owner,documentId,online]);
 useEffect(()=>{void read();const stop=everyVisible(()=>void read(),20000);const off=subscribeClaims(()=>void read());return()=>{stop();off();};},[read]);
 if(!claim||!owner)return null;
 const takeOver=async()=>{
  const ok=await confirmAsync('Generate on this device instead?',
   `${claim.device_label} started this book${claim.last_seen?` and was last seen ${ago(claim.last_seen)}`:''}. `+
   'If you take over, that device stops generating this book the next time it connects, and anything it has not synchronized stays on it unsent.',
   'Take over','Cancel',{tone:'warning'});
  if(!ok)return;
  setBusy(true);
  try{await new GenerationClaims(owner).takeOver(documentId);setClaim(null);showToast({tone:'success',title:'Generating on this device',message:'This device now prepares this book.'});onTakenOver?.();}
  catch(e){showToast({tone:'danger',title:'Could not take over',message:errorMessage(e)});}
  finally{setBusy(false);}
 };
 const seen=claim.last_seen?` Last seen ${ago(claim.last_seen)}.`:'';
 return <Notice inline tone="warning" title="Generation already started on another device"
  message={claimMessage(claim)+seen+(online?'':' Connect to take over.')}
  action={online?<Button small variant="secondary" title="Take over" busy={busy} onPress={()=>void takeOver()}/>:undefined}/>;
}
