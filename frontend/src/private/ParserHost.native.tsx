import React,{useEffect,useRef} from 'react';
import {View} from 'react-native';
import {WebView} from 'react-native-webview';
import {attachParser,parserResult} from './parserBridge';
import {PARSER_HTML} from './generated/parser';
export default function ParserHost() {
 const ref=useRef<WebView>(null);
 useEffect(()=>()=>attachParser(undefined),[]);
 return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{position:'absolute',width:1,height:1,opacity:0,overflow:'hidden'}}>
  <WebView ref={ref} source={{html:PARSER_HTML}} originWhitelist={['about:blank']} javaScriptEnabled
   allowFileAccess={false} allowUniversalAccessFromFileURLs={false} mixedContentMode="never"
   onShouldStartLoadWithRequest={r=>r.url==='about:blank'}
   onError={()=>attachParser(undefined)}
   onMessage={event=>{try{const r=JSON.parse(event.nativeEvent.data);if(r.ready)attachParser((id,name,body)=>ref.current?.injectJavaScript(`window.__LM_PARSE_BASE64__(${JSON.stringify(id)},${JSON.stringify(name)},${JSON.stringify(body)},true);true;`),()=>ref.current?.injectJavaScript("window.__LM_CANCEL_PARSE__();true;"),(id,error)=>ref.current?.injectJavaScript(`window.__LM_VISUAL_ACK__(${JSON.stringify(id)},${JSON.stringify(error||null)});true;`));else parserResult(r);}catch{attachParser(undefined);}}} />
 </View>;
}
