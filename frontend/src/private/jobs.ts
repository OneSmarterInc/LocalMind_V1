/** App-lifetime jobs. Results are persisted by the library; no page owns cancellation. */
export type JobState='queued'|'running'|'completed'|'failed'|'cancelled';
export type Job={id:number;scope:string;bookId:string;sectionId:string;kind:string;label:string;state:JobState;note:string;error:string};
type Entry=Job&{controller:AbortController;run?:(signal:AbortSignal,progress:(s:string)=>void)=>Promise<unknown>;settled:Promise<void>;finish:()=>void};
export class JobQueue{
 private entries:Entry[]=[];private serial=0;private active=0;private snapshotJobs:readonly Job[]=[];private listeners=new Set<()=>void>();
 constructor(private concurrency=2,private doubtLane=false){}
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 snapshot=()=>this.snapshotJobs;
 private emit(){this.snapshotJobs=this.entries.map(j=>({...j}));for(const fn of this.listeners)fn();}
 list(scope:string):Job[]{return this.entries.filter(j=>j.scope===scope).map(j=>({...j}));}
 enqueue(meta:Omit<Job,'id'|'state'|'note'|'error'>,run:NonNullable<Entry['run']>){
  const old=this.entries.find(j=>j.scope===meta.scope&&j.bookId===meta.bookId&&j.sectionId===meta.sectionId&&j.kind===meta.kind&&['queued','running'].includes(j.state));if(old)return old.id;
  if(this.entries.filter(j=>['queued','running'].includes(j.state)).length>=20)throw Error('Twenty jobs are already waiting. Let some finish before adding more.');
  this.entries=this.entries.filter(j=>['queued','running'].includes(j.state)||j.id>this.serial-40);
  let finish=()=>{};const settled=new Promise<void>(resolve=>{finish=resolve;});
  const job:Entry={...meta,id:++this.serial,state:'queued',note:'Waiting to start',error:'',controller:new AbortController(),run,settled,finish};this.entries.push(job);this.emit();this.pump();return job.id;
 }
 cancel(id:number){const j=this.entries.find(j=>j.id===id);if(!j||!['queued','running'].includes(j.state))return;j.controller.abort();if(j.state==='queued'){j.state='cancelled';j.run=undefined;j.finish();}else j.note='Cancelling…';this.emit();}
 cancelOtherScopes(scope:string){for(const j of this.entries)if(j.scope!==scope)this.cancel(j.id);}
 async cancelBook(scope:string,bookId:string){const jobs=this.entries.filter(j=>j.scope===scope&&j.bookId===bookId);for(const j of jobs)this.cancel(j.id);await Promise.all(jobs.map(j=>j.settled));}
 private pump(){
  while(true){const running=this.entries.filter(j=>j.state==='running');
   const j=this.entries.find(j=>j.state==='queued'&&(this.doubtLane?(j.kind==='doubt'?!running.some(r=>r.kind==='doubt'):running.filter(r=>r.kind!=='doubt').length<this.concurrency):this.active<this.concurrency));if(!j)break;this.active++;j.state='running';j.note='Preparing on this device';this.emit();
   void(async()=>{try{await j.run!(j.controller.signal,s=>{if(!j.controller.signal.aborted){j.note=s;this.emit();}});j.state=j.controller.signal.aborted?'cancelled':'completed';j.note=j.state==='completed'?'Saved on this device':'Cancelled';}
    catch(e){j.state=j.controller.signal.aborted?'cancelled':'failed';j.error=j.state==='failed'?(e instanceof Error?e.message:String(e)):'';}
    finally{j.run=undefined;j.finish();this.active--;this.emit();this.pump();}})();
  }
 }
}
export const generationJobs=new JobQueue(2,true);
