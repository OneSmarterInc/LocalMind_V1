import React,{useEffect,useMemo,useState} from 'react';
import {BookUploads,type QueuedUpload} from './uploads';
import {Button,Card,CardHead,Notice,ErrorBanner} from '@/ui';
import {useAction} from '@/hooks/useAsync';
import { everyVisible } from "@/hooks/visibleInterval";
export function UploadStatus({owner}:{owner:string}){
 const service=useMemo(()=>new BookUploads(owner),[owner]);
 const [rows,setRows]=useState<QueuedUpload[]>([]),[error,setError]=useState('');
 useEffect(()=>{let live=true;const read=()=>service.list().then(v=>{if(live)setRows(v);}).catch(e=>{if(live)setError(String(e));});void read();const stop=everyVisible(read,1500);return()=>{live=false;stop();};},[service]);
 const retry=useAction(async(id:string)=>{await service.flush(id);setRows(await service.list());});
 return <><ErrorBanner message={error||retry.error}/>{rows.filter(row=>row.state!=='synced').map(row=><Card key={row.id}><CardHead title={row.title}/><Notice inline title={row.state==='conflict'?'Upload needs review':'Book saved — awaiting upload'} message={row.state==='conflict'?(row.error||'Review this upload.'):'Your original file is saved on this device. Upload and content-based outlining resume automatically when the server is reachable.'}/>{row.state==='conflict'?<Button title="Retry upload" busy={retry.busy} onPress={()=>retry.run(row.id)}/>:null}</Card>)}</>;
}
