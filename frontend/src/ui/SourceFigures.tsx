import React, {useState} from 'react';
import {Image, Modal, ScrollView, View} from 'react-native';
import {Button, P, colors} from '@/ui';
export type Figure = {id:string;kind?:string;caption?:string;width?:number|null;height?:number|null;page?:number|null;data_url?:string;dataUrl?:string;context_text?:string;heading_path?:string[]};
/** Stored source images only. Never accept remote/model-authored image URLs. */
export function SourceFigures({visuals}:{visuals:Figure[]}){
 const [expanded,setExpanded]=useState<Figure|null>(null);
 const valid=visuals.filter(v=>v.kind!=='page'&&!v.caption?.startsWith('Original page')&&/^data:image\/(png|jpeg|webp);base64,/.test(v.data_url||v.dataUrl||''));
 const image=(v:Figure,full=false)=><Image source={{uri:v.data_url||v.dataUrl}} accessibilityLabel={v.caption||'Original book figure'} resizeMode="contain" style={full?{width:v.width||1000,height:v.height||700}:{width:'100%',aspectRatio:Math.max(1,v.width||1000)/Math.max(1,v.height||700),backgroundColor:'white'}}/>;
 return <View style={{gap:12,minWidth:0}}>{valid.map(v=><View key={v.id} style={{borderWidth:1,borderColor:colors.border,borderRadius:8,padding:12,gap:8}}>{image(v)}<P small muted>{v.caption||'Original book figure'}{v.page?` · Source page ${v.page}`:''}</P><Button title="Enlarge image" small variant="secondary" onPress={()=>setExpanded(v)}/></View>)}<Modal visible={!!expanded} animationType="fade" onRequestClose={()=>setExpanded(null)}><View style={{flex:1,padding:20,paddingTop:48,gap:12,backgroundColor:colors.bg}}><Button title="Close image" onPress={()=>setExpanded(null)}/>{expanded?<><P>{expanded.caption||'Original book figure'}{expanded.page?` · Page ${expanded.page}`:''}</P><ScrollView><ScrollView horizontal>{image(expanded,true)}</ScrollView></ScrollView></>:null}</View></Modal></View>;
}
