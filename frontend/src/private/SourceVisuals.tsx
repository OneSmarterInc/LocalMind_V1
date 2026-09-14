import React,{useState} from 'react';
import {Image,Modal,ScrollView,View} from 'react-native';
import {Button,Card,H2,P,ErrorBanner,colors} from '@/ui';
import {useAsync} from '@/hooks/useAsync';
import {useLibrary} from './useLibrary';
import type {SourceVisual} from './core';
/** Only stored source images: the model cannot supply image URLs. */
export function SourceVisuals({bookId,sectionId}:{bookId:string;sectionId:string}){
 const library=useLibrary();
 const visuals=useAsync(()=>library?library.visuals(bookId,sectionId):Promise.resolve([]),[library,bookId,sectionId]);
 const [expanded,setExpanded]=useState<SourceVisual|null>(null);
 return <View style={{gap:12,minWidth:0}}>
  <ErrorBanner message={visuals.error}/>
  {!!visuals.data?.length&&<><H2>Original source images</H2><P muted>Preserved from this module’s source. Tables and diagrams are shown as imported, alongside the explanation.</P></>}
  {(visuals.data||[]).filter(v=>v.kind!=='page'&&!(v.kind===undefined&&v.caption.startsWith('Original page'))).map(v=><Card key={v.id}><P>{v.caption}</P><Image source={{uri:v.dataUrl}} accessibilityLabel={v.caption} resizeMode="contain" style={{width:'100%',aspectRatio:v.width/v.height,backgroundColor:'white'}}/><Button title="Enlarge illustration" variant="secondary" onPress={()=>setExpanded(v)}/></Card>)}
  {(visuals.data||[]).filter(v=>v.kind==='page'||(v.kind===undefined&&v.caption.startsWith('Original page'))).map(v=><Button key={v.id} title={`View original page ${v.page||''}`} variant="secondary" onPress={()=>setExpanded(v)}/>)}
  <Modal visible={!!expanded} animationType="fade" onRequestClose={()=>setExpanded(null)}>
   <View style={{flex:1,padding:20,paddingTop:48,gap:12,backgroundColor:colors.bg}}>
    <Button title="Close image" onPress={()=>setExpanded(null)}/>
    {expanded&&<><P>{expanded.caption}</P><ScrollView style={{flex:1}}><ScrollView horizontal><Image source={{uri:expanded.dataUrl}} accessibilityLabel={`${expanded.caption} enlarged`} style={{width:expanded.width,height:expanded.height}}/></ScrollView></ScrollView></>}
   </View>
  </Modal>
 </View>;
}
