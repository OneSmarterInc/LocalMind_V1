import React,{useState} from 'react';
import {Image,Modal,ScrollView,View} from 'react-native';
import {Button,Card,H2,P,ErrorBanner,colors} from '@/ui';
import {useAsync} from '@/hooks/useAsync';
import {useLibrary} from './useLibrary';
import type {SourceVisual} from './core';
/** Only cropped source visuals. Legacy full-page records are deliberately hidden. */
export function SourceVisuals({bookId,sectionId}:{bookId:string;sectionId:string}){
 const library=useLibrary();
 const visuals=useAsync(()=>library?library.visuals(bookId,sectionId):Promise.resolve([]),[library,bookId,sectionId]);
 const [expanded,setExpanded]=useState<SourceVisual|null>(null);
 const cropped=(visuals.data||[]).filter(v=>v.kind!=='page'&&!(v.kind===undefined&&v.caption.startsWith('Original page')));
 return <View style={{gap:12,minWidth:0}}>
  <ErrorBanner message={visuals.error}/>
  {!!cropped.length&&<><H2>Visuals from the source</H2><P muted>Only the figure, diagram, chart or table region is preserved. The surrounding PDF page and page text are not shown as an image.</P></>}
  {cropped.map(v=><Card key={v.id}><P>{v.caption}</P><Image source={{uri:v.dataUrl}} accessibilityLabel={v.caption} resizeMode="contain" style={{width:'100%',aspectRatio:v.width/v.height,backgroundColor:'white'}}/><Button title="Enlarge visual" variant="secondary" onPress={()=>setExpanded(v)}/></Card>)}
  <Modal visible={!!expanded} animationType="fade" onRequestClose={()=>setExpanded(null)}>
   <View style={{flex:1,padding:20,paddingTop:48,gap:12,backgroundColor:colors.bg}}>
    <Button title="Close image" onPress={()=>setExpanded(null)}/>
    {expanded&&<><P>{expanded.caption}</P><ScrollView style={{flex:1}}><ScrollView horizontal><Image source={{uri:expanded.dataUrl}} accessibilityLabel={`${expanded.caption} enlarged`} style={{width:expanded.width,height:expanded.height}}/></ScrollView></ScrollView></>}
   </View>
  </Modal>
 </View>;
}
