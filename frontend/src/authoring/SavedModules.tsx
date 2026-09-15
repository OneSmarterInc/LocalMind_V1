import React,{useEffect,useState} from 'react';
import {useRouter} from 'expo-router';
import {useAuth} from '@/auth/AuthContext';
import {Card,H2,P,Button,Row,ErrorBanner} from '@/ui';
import {LocalAuthoring,type Draft} from './local';
export default function SavedModules(){
 const {user}=useAuth(),owner=user?.id,router=useRouter();
 const [rows,setRows]=useState<Draft[]>([]),[error,setError]=useState('');
 useEffect(()=>{let active=true;setRows([]);if(!owner)return;
  const service=new LocalAuthoring(owner);
  const read=()=>service.drafts().then(v=>{if(active){setRows(v);setError('');}}).catch(e=>{if(active)setError(String(e));});
  void read();const timer=setInterval(read,5000);return()=>{active=false;clearInterval(timer);};
 },[owner]);
 if(!rows.length&&!error)return null;
 return <Card><H2>Saved for local authoring</H2><ErrorBanner message={error}/>{rows.map(d=><Row key={d.snapshot.module_id}><P>{d.snapshot.title}</P><P small muted>{d.state||'On this device'}</P><Button title="Open local module" small variant="secondary" onPress={()=>router.push(`/manage/local-authoring/${d.snapshot.module_id}`)}/></Row>)}</Card>;
}
