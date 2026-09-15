import {device} from '@/private/device';
import {requireThat} from '@/private/core';
import type {LocalFile} from '@/private/device.types';
export async function retainFile(key:string,file:LocalFile){
 requireThat(file.file,'Select a source file.');await(await device()).put(key,file.file);
}
export async function attachFile(key:string,form:FormData,name:string){
 const file=await(await device()).get<Blob>(key);requireThat(file instanceof Blob,'The saved original file is missing.');form.append('file',file,name);
}
