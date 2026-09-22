import React from 'react';
import {Button} from '@/ui';
import {generationJobs,type Job} from './jobs';

/** Stop only this book/module, including a module inside a whole-book job. */
export function StopGeneration({jobs,moduleIds}:{jobs:readonly Job[];moduleIds?:string[]}){
 const active=jobs.filter(j=>['queued','running'].includes(j.state)||j.cancelling).filter(j=>!moduleIds||moduleIds.some(id=>j.moduleIds?j.moduleIds.includes(id)&&!j.stoppedModuleIds?.includes(id):j.sectionId===id||j.bookId===id));
 if(!active.length)return null;
 const stopping=active.every(j=>j.cancelling);
 return <Button title={stopping?'Stopping…':moduleIds?'Stop module':'Stop book generation'} small variant="secondary" disabled={stopping} onPress={()=>{
  for(const j of active){if(moduleIds&&j.moduleIds){for(const id of moduleIds)generationJobs.cancelModule(j.id,id);}else generationJobs.cancel(j.id);}
 }}/>;
}
