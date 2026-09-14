import {useCallback,useEffect,useRef,useState} from 'react';
/** Single task, cancellation on unmount and no stale component state after account changes. */
export function useTask(){
 const active=useRef(true), ref=useRef<AbortController|null>(null);
 const settled=useRef<Promise<boolean>>(Promise.resolve(true));
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState('');
 useEffect(()=>{active.current=true;return()=>{active.current=false;ref.current?.abort();};},[]);
 const run=useCallback(async<T,>(fn:(s:AbortSignal)=>Promise<T>)=>{
  if(ref.current)return;const c=new AbortController();ref.current=c;setBusy(true);setError('');setNote('');
  let finish:(ok:boolean)=>void=()=>{};settled.current=new Promise(resolve=>{finish=resolve;});let success=false;
  try{const result=await fn(c.signal);success=!c.signal.aborted;return result;}catch(e){if(active.current)setError(e instanceof Error?e.message:String(e));}
  finally{ref.current=null;finish(success);if(active.current)setBusy(false);}
 },[]);
 const wait=useCallback(()=>settled.current,[]);
 const isRunning=useCallback(()=>ref.current!==null,[]);
 return {busy,error,note,wait,isRunning,run,setError,setNote,cancel:()=>ref.current?.abort()};
}
