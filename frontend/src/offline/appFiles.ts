import {useEffect,useState} from 'react';
import {Platform} from 'react-native';
import {device} from '@/private/device';
import {isOnline} from './connectivity';
let inflight:Promise<void>|null=null;
let lastSuccess=0;
let status='Application files will save automatically when connected.';
const listeners=new Set<(value:string)=>void>();
function publish(value:string){status=value;listeners.forEach(fn=>fn(value));}
/** Public app files only: never downloads models or uploads private study. */
export function prepareAppFiles():Promise<void>{
 if(Platform.OS!=='web'||!isOnline())return Promise.resolve();
 if(inflight)return inflight;
 if(Date.now()-lastSuccess<5*60*1000)return Promise.resolve();
 publish('Saving offline application files automatically…');
 inflight=(async()=>{try{await(await device()).prepareOffline();lastSuccess=Date.now();publish('Application files saved automatically. Ready to reopen offline.');}catch(e){publish(`Offline preparation will retry when connected. ${e instanceof Error?e.message:String(e)}`);}finally{inflight=null;}})();
 return inflight;
}
export function useAppFilesStatus(){const [value,setValue]=useState(status);useEffect(()=>{listeners.add(setValue);return()=>{listeners.delete(setValue);};},[]);return value;}
