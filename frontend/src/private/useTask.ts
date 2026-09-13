import {useCallback,useEffect,useRef,useState} from 'react';
/** Single task, cancellation on unmount and no stale component state after account changes. */
export function useTask(){
 const active=useRef(true), ref=useRef<AbortController|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState('');
 useEffect(()=>{active.current=true;return()=>{active.current=false;ref.current?.abort();};},[]);
 const run=useCallback(async<T,>(fn:(s:AbortSignal)=>Promise<T>)=>{
  if(ref.current)return;const c=new AbortController();ref.current=c;setBusy(true);setError('');setNote('');
  try{return await fn(c.signal);}catch(e){if(active.current)setError(e instanceof Error?e.message:String(e));}
  finally{ref.current=null;if(active.current)setBusy(false);}
 },[]);
 return {busy,error,note,run,setError,setNote,cancel:()=>ref.current?.abort()};
}
