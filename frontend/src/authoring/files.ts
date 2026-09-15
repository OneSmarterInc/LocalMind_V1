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
