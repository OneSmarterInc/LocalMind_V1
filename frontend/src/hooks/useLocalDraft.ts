import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { DraftPersistence, removeDraft } from './draftPersistence';
const KEY=(parts:string[])=>`localmind.draft.${parts.join('.')}`;
export async function clearLocalDraft(parts:(string|null|undefined)[]){if(parts.some(p=>!p))return;await removeDraft(AsyncStorage,KEY(parts as string[]));}

/** Writes errors visibly and never tells a navigation guard an unsuccessful save succeeded. */
export function useLocalDraft<T>(parts:(string|null|undefined)[],value:T,onRestore:(saved:T)=>void){
  const key=parts.every(Boolean)?KEY(parts as string[]):null;
  const valueRef=useRef(value);valueRef.current=value;
  const initial=useRef(value);
  const [generation,setGeneration]=useState(0);
  const restoreRef=useRef(onRestore);restoreRef.current=onRestore;
  const [state,setState]=useState<{key:string|null;restored:boolean|null;error:string|null}>({key:null,restored:null,error:null});
  const [saving,setSaving]=useState(false);
  const mounted=useRef(true);
  const controller=useMemo(()=>key?new DraftPersistence(AsyncStorage,key,initial.current):null,[key,generation]);
  const restored=state.key===key?state.restored:null;
  const report=useCallback((e:unknown)=>{if(mounted.current)setState(s=>({...s,error:e instanceof Error?e.message:String(e)}));},[]);
  useEffect(()=>{
    mounted.current=true;return()=>{mounted.current=false;};
  },[]);
  useEffect(()=>{
    let alive=true;
    setState({key,restored:null,error:null});
    if(controller)void controller.load().then(saved=>{
      if(!alive)return;
      if(saved!==null)restoreRef.current(saved);
      setState({key,restored:saved!==null,error:null});
    }).catch(e=>{if(alive)report(e);});
    return()=>{alive=false;if(controller&&controller.dirty)void controller.flush().catch(report);};
  },[controller,key,report]);
  useEffect(()=>{
    if(!controller||restored===null)return;
    controller.update(value);if(!controller.dirty)return;
    setSaving(true);
    const timer=setTimeout(()=>{void controller.flush().then(()=>{if(mounted.current)setSaving(false);}).catch(e=>{report(e);if(mounted.current)setSaving(false);});},300);
    return()=>clearTimeout(timer);
  },[controller,value,restored,report]);
  const flush=useCallback(async()=>{
    if(!controller)return false;
    if(restored===null){await controller.load();return false;} // wait for React to adopt restored content before departure
    controller.update(valueRef.current);setSaving(true);
    try{const ok=await controller.flush();setState(s=>({...s,error:null}));return ok;}
    catch(e){report(e);throw e;}finally{if(mounted.current)setSaving(false);}
  },[controller,restored,report]);
  const discard=useCallback(async()=>{if(controller){await controller.discard();setGeneration(g=>g+1);}},[controller]);
  useEffect(()=>{const sub=AppState.addEventListener('change',s=>{if(s!=='active'&&controller?.dirty)void controller.flush().catch(report);});return()=>sub.remove();},[controller,report]);
  return {restored,saving,flush,discard,error:state.key===key?state.error:null};
}
