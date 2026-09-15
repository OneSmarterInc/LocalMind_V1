import React from 'react';
import {View} from 'react-native';
import {H2,P,ErrorBanner} from '@/ui';
import {SourceFigures} from '@/ui/SourceFigures';
import {useAsync} from '@/hooks/useAsync';
import {useLibrary} from './useLibrary';
/** Only cropped source visuals. Legacy full-page records are deliberately hidden. */
export function SourceVisuals({bookId,sectionId}:{bookId:string;sectionId:string}){
 const library=useLibrary();
 const visuals=useAsync(()=>library?library.visuals(bookId,sectionId):Promise.resolve([]),[library,bookId,sectionId]);
 const cropped=(visuals.data||[]).filter(v=>v.kind!=='page'&&!v.caption.startsWith('Original page'));
 return <View style={{gap:12,minWidth:0}}>
  <ErrorBanner message={visuals.error}/>
  {!!cropped.length&&<><H2>Visuals from the source</H2><P muted>Only the figure, diagram, chart or table region is preserved. The surrounding PDF page and page text are not shown as an image.</P></>}
  <SourceFigures visuals={cropped}/>
 </View>;
}
