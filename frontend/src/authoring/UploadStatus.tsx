import React,{useEffect,useMemo,useState} from 'react';
import {useRouter} from 'expo-router';
import {BookUploads,type QueuedUpload} from './uploads';
import {Button,Card,CardHead,Notice,ErrorBanner} from '@/ui';
import {useAction} from '@/hooks/useAsync';
export function UploadStatus({owner,showCompleted=true}:{owner:string;showCompleted?:boolean}){
 const service=useMemo(()=>new BookUploads(owner),[owner]),router=useRouter();
 const [rows,setRows]=useState<QueuedUpload[]>([]),[error,setError]=useState('');
 useEffect(()=>{let live=true;const read=()=>service.list().then(v=>{if(live)setRows(v);}).catch(e=>{if(live)setError(String(e));});void read();const timer=setInterval(read,1500);return()=>{live=false;clearInterval(timer);};},[service]);
 const retry=useAction(async(id:string)=>{await service.flush(id);setRows(await service.list());});
 const open=useAction(async(row:QueuedUpload)=>{await service.dismiss(row.id);router.push(`/manage/document/${row.documentId}`);});
 return <><ErrorBanner message={error||retry.error||open.error}/>{rows.filter(row=>showCompleted||row.state!=='synced').map(row=><Card key={row.id}><CardHead title={row.title}/><Notice title={row.state==='synced'?'Upload complete':row.state==='conflict'?'Upload needs review':'Book saved — awaiting upload'} message={row.state==='synced'?'Open the book to review its content-based outline.':row.state==='conflict'?(row.error||'Review this upload.'):'Your original file is saved on this device. Upload and content-based outlining resume automatically when the server is reachable.'}/>{row.state==='conflict'?<Button title="Retry upload" busy={retry.busy} onPress={()=>retry.run(row.id)}/>:row.state==='synced'?<Button title="Review uploaded book" busy={open.busy} onPress={()=>open.run(row)}/>:null}</Card>)}</>;
}
