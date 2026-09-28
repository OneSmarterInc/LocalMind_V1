import React, {useState} from 'react';
import {Image, Modal, ScrollView, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Button, P, colors} from '@/ui';
export type Figure = {id:string;kind?:string;caption?:string;width?:number|null;height?:number|null;page?:number|null;data_url?:string;dataUrl?:string;context_text?:string;heading_path?:string[]};
/** Stored source images only. Never accept remote/model-authored image URLs. */
export function SourceFigures({visuals}:{visuals:Figure[]}){
 const [expanded,setExpanded]=useState<Figure|null>(null);
 // Enlarged figures open fitted to the screen; "Actual size" keeps the full-pixel view.
 const [actual,setActual]=useState(false);
 const {width:screenWidth}=useWindowDimensions();
 const insets=useSafeAreaInsets();
 const fitted=(v:Figure)=>{const w=Math.max(1,v.width||1000),h=Math.max(1,v.height||700),fw=screenWidth-40;return {width:fw,height:Math.round(fw*h/w)};};
 const valid=visuals.filter(v=>v.kind!=='page'&&!v.caption?.startsWith('Original page')&&/^data:image\/(png|jpeg|webp);base64,/.test(v.data_url||v.dataUrl||''));
 const image=(v:Figure,full=false)=><Image source={{uri:v.data_url||v.dataUrl}} accessibilityLabel={v.caption||'Original book figure'} resizeMode="contain" style={full?(actual?{width:v.width||1000,height:v.height||700}:fitted(v)):{width:'100%',aspectRatio:Math.max(1,v.width||1000)/Math.max(1,v.height||700),backgroundColor:'white'}}/>;
 return <View style={{gap:12,minWidth:0}}>{valid.map(v=><View key={v.id} style={{borderWidth:1,borderColor:colors.border,borderRadius:8,padding:12,gap:8}}>{image(v)}<P small muted>{v.caption||'Original book figure'}{v.page?` · Source page ${v.page}`:''}</P><Button title="Enlarge image" small variant="secondary" onPress={()=>{setActual(false);setExpanded(v);}}/></View>)}<Modal visible={!!expanded} animationType="fade" onRequestClose={()=>setExpanded(null)}><View style={{flex:1,padding:20,paddingTop:insets.top+12,paddingBottom:insets.bottom+12,gap:12,backgroundColor:colors.bg}}><View style={{flexDirection:'row',gap:8}}><Button title="Close image" onPress={()=>setExpanded(null)}/><Button title={actual?'Fit to screen':'Actual size'} variant="secondary" onPress={()=>setActual(a=>!a)}/></View>{expanded?<><P>{expanded.caption||'Original book figure'}{expanded.page?` · Page ${expanded.page}`:''}</P><ScrollView><ScrollView horizontal>{image(expanded,true)}</ScrollView></ScrollView></>:null}</View></Modal></View>;
}
