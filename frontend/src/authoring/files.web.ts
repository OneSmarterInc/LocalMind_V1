import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';
import {device} from '@/private/device';
import {requireThat} from '@/private/core';
import type {LocalFile} from '@/private/device.types';
export async function retainFile(key:string,file:LocalFile){
 requireThat(file.file,'Select a source file.');await(await device()).put(key,file.file);
}
export async function attachFile(key:string,form:FormData,name:string){
 const file=await(await device()).get<Blob>(key);requireThat(file instanceof Blob,'The saved original file is missing.');form.append('file',file,name);
}
export async function originalSize(key:string){
 const file=await(await device()).get<Blob>(key);requireThat(file instanceof Blob,'The saved original file is missing.');return file.size;
}
export async function originalChunk(key:string,offset:number,length:number){
 const file=await(await device()).get<Blob>(key);requireThat(file instanceof Blob,'The saved original file is missing.');
 const part=file.slice(offset,offset+length),bytes=new Uint8Array(await part.arrayBuffer());
 const form=new FormData();form.append('chunk',part,'source.part');form.append('offset',String(offset));form.append('sha256',bytesToHex(sha256(bytes)));
 return {form,release:async()=>{}};
}

export async function discardFile(key:string){await(await device()).removePrefix(key);}
