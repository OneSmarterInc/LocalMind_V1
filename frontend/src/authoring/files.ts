import {randomUUID} from 'expo-crypto';
import {toByteArray} from 'base64-js';
import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';
import * as FS from 'expo-file-system/legacy';
import {device} from '@/private/device';
import {fingerprint} from '@/private/library';
import {requireThat} from '@/private/core';
import type {LocalFile} from '@/private/device.types';
export async function retainFile(key:string,file:LocalFile){
 requireThat(file.uri.startsWith('file://'),'Choose a file stored on this device.');
 const root=FS.documentDirectory+'localmind-authoring/';await FS.makeDirectoryAsync(root,{intermediates:true});
 const uri=root+fingerprint(key);await FS.copyAsync({from:file.uri,to:uri});await(await device()).put(key,uri);
}
export async function attachFile(key:string,form:FormData,name:string){
 const uri=await(await device()).get<string>(key);requireThat(uri&&(await FS.getInfoAsync(uri)).exists,'The saved original file is missing.');
 form.append('file',{uri,name,type:name.toLowerCase().endsWith('.pdf')?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'} as unknown as Blob);
}
export async function originalSize(key:string){
 const uri=await(await device()).get<string>(key);requireThat(uri,'The saved original file is missing.');const info=await FS.getInfoAsync(uri);requireThat(info.exists&&!info.isDirectory,'The saved original file is missing.');return info.size;
}
export async function originalChunk(key:string,offset:number,length:number){
 const uri=await(await device()).get<string>(key);requireThat(uri,'The saved original file is missing.');
 const base64=await FS.readAsStringAsync(uri,{encoding:FS.EncodingType.Base64,position:offset,length});
 const path=FS.cacheDirectory+'authoring-chunk-'+randomUUID();
 await FS.writeAsStringAsync(path,base64,{encoding:FS.EncodingType.Base64});
 const form=new FormData();form.append('chunk',{uri:path,name:'source.part',type:'application/octet-stream'} as unknown as Blob);form.append('offset',String(offset));form.append('sha256',bytesToHex(sha256(toByteArray(base64))));
 return {form,release:()=>FS.deleteAsync(path,{idempotent:true})};
}
