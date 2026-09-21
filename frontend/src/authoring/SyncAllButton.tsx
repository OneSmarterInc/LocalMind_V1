import React,{useState} from 'react';
import {View} from 'react-native';
import {useOnline} from '@/offline/connectivity';
import {useLibrary} from '@/private/useLibrary';
import {useGenerationJobs} from '@/private/useGenerationJobs';
import {useTask} from '@/private/useTask';
import {Button,Notice,ErrorBanner,P,confirmAsync} from '@/ui';
import {planSyncAll,runSyncAll,describePlan,describeResult,type SyncScope} from './syncAll';

/** "Synchronize all": approve and send every generated draft in scope at once.
 * Disabled offline and while generation runs, so it never races a job. */
export function SyncAllButton({owner,scope,title='Synchronize all',onDone}:{owner:string;scope:SyncScope;title?:string;onDone?:()=>void}){
 const online=useOnline(),library=useLibrary(),task=useTask();
 const jobs=useGenerationJobs(library?.prefix||'');
 const generating=jobs.some(j=>['queued','running'].includes(j.state));
 const [progress,setProgress]=useState(''),[result,setResult]=useState<{tone:'success'|'warning';text:string}|null>(null);
 const press=()=>task.run(async signal=>{
  setResult(null);
  const items=await planSyncAll(owner,scope);
  if(!items.length){setResult({tone:'success',text:'Nothing to synchronize. Every generated draft is already synchronized, still generating, or needs individual review.'});return;}
  const ok=await confirmAsync('Synchronize all?',`Approve and synchronize ${describePlan(items)}? They become institution drafts. Quizzes still need publishing separately.`,'Approve and synchronize','Cancel');
  if(!ok)return;
  const r=await runSyncAll(owner,items,(done,total)=>setProgress(done<total?`Synchronizing ${done+1} of ${total}…`:''),signal);
  setProgress('');setResult({tone:r.failed.length?'warning':'success',text:describeResult(r)});onDone?.();
 });
 return <View style={{gap:8}}>
  <Button title={title} icon="cloud-upload-outline" busy={task.busy} disabled={!online||generating||task.busy} onPress={()=>{void press();}}/>
  {!online?<P small muted>Reconnect to the institution to synchronize.</P>:generating?<P small muted>Available when generation finishes.</P>:null}
  {progress?<P small muted>{progress}</P>:null}
  <ErrorBanner message={task.error}/>
  {result?<Notice tone={result.tone} message={result.text}/>:null}
 </View>;
}
