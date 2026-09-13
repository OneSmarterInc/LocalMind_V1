import {api,BASE_URL,tokenStore,currentSession,SessionChangedError} from '@/api/client';
import {device} from './device';
import type {LocalFile} from './device.types';
export type SharedBook={id:string;kind:'shared'|'course';title:string;original_name:string;file_size:number;sha256:string;active:boolean;subject:string;subject_id:string|null;version:number};
export function sharedBooks(staff=false){return api<SharedBook[]>(staff?'/faculty/private-library/':'/student/private-library/',{cacheOffline:false});}
export async function downloadShared(book:SharedBook,signal:AbortSignal):Promise<LocalFile>{
 const mine=currentSession(); const headers:Record<string,string>={};const t=tokenStore.get();if(t)headers.Authorization=`Bearer ${t.access}`;
 const d=await device();const file=await d.downloadBook(`${BASE_URL}/api/student/private-library/${book.kind}/${encodeURIComponent(book.id)}/download/`,headers,book.original_name,signal);
 if(mine!==currentSession()){await d.releaseFile(file);throw new SessionChangedError();}return file;
}
