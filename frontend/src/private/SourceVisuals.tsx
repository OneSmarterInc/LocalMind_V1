import React,{useState} from 'react';
import {Image,Modal,ScrollView,View,useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Button,Card,H2,P,ErrorBanner,colors} from '@/ui';
import {useAsync} from '@/hooks/useAsync';
import {useLibrary} from './useLibrary';
import type {SourceVisual} from './core';
import type {Library} from './library';
/** Only stored source images: the model cannot supply image URLs. */
export function SourceVisuals({bookId,sectionId,sourceLibrary,pagesOnly=false}:{bookId:string;sectionId:string;sourceLibrary?:Library;pagesOnly?:boolean}){
 const privateLibrary=useLibrary(),library=sourceLibrary||privateLibrary;
 const visuals=useAsync(()=>library?library.visuals(bookId,sectionId):Promise.resolve([]),[library,bookId,sectionId]);
 const [expanded,setExpanded]=useState<SourceVisual|null>(null);
 const [actual,setActual]=useState(false);
 const {width:screenWidth}=useWindowDimensions();
 const insets=useSafeAreaInsets();
 return <View style={{gap:12,minWidth:0}}>
  <ErrorBanner message={visuals.error}/>
  {!!visuals.data?.length&&<><H2>Original source images</H2><P muted>Preserved from this module’s source. Tables and diagrams are shown as imported, alongside the explanation.</P></>}
  {(visuals.data||[]).filter(v=>!pagesOnly&&v.kind!=='page'&&!(v.kind===undefined&&v.caption.startsWith('Original page'))).map(v=><Card key={v.id}><P>{v.caption}</P><Image source={{uri:v.dataUrl}} accessibilityLabel={v.caption} resizeMode="contain" style={{width:'100%',aspectRatio:v.width/v.height,backgroundColor:'white'}}/><Button title="Enlarge illustration" variant="secondary" onPress={()=>{setActual(false);setExpanded(v);}}/></Card>)}
  {(visuals.data||[]).filter(v=>v.kind==='page'||(v.kind===undefined&&v.caption.startsWith('Original page'))).map(v=><Button key={v.id} title={`View original page ${v.page||''}`} variant="secondary" onPress={()=>setExpanded(v)}/>)}
  <Modal visible={!!expanded} animationType="fade" onRequestClose={()=>setExpanded(null)}>
   <View style={{flex:1,padding:20,paddingTop:insets.top+12,paddingBottom:insets.bottom+12,gap:12,backgroundColor:colors.bg}}>
    <View style={{flexDirection:'row',gap:8}}><Button title="Close image" onPress={()=>setExpanded(null)}/><Button title={actual?'Fit to screen':'Actual size'} variant="secondary" onPress={()=>setActual(a=>!a)}/></View>
    {expanded&&<><P>{expanded.caption}</P><ScrollView style={{flex:1}}><ScrollView horizontal><Image source={{uri:expanded.dataUrl}} accessibilityLabel={`${expanded.caption} enlarged`} style={actual?{width:expanded.width,height:expanded.height}:{width:screenWidth-40,height:Math.round((screenWidth-40)*Math.max(1,expanded.height)/Math.max(1,expanded.width))}}/></ScrollView></ScrollView></>}
   </View>
  </Modal>
 </View>;
}
