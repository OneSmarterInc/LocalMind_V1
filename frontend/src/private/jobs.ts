export const DOUBTS_PAUSED_MESSAGE = "Content generation is in progress. Ask a doubt will be available when generation finishes. You can continue reading and taking saved quizzes.";
/** App-lifetime jobs. Results are persisted by the library; no page owns cancellation. */
export type JobState='queued'|'running'|'completed'|'failed'|'cancelled';
export type Job={id:number;scope:string;bookId:string;sectionId:string;kind:string;label:string;documentId?:string;documentIds?:string[];state:JobState;note:string;error:string;
 /** This job specifically is being cancelled. Per job, never shared: one row
  * cancelling must not make every other row claim it is cancelling too. */
 cancelling?:boolean};
type Entry=Job&{controller:AbortController;run?:(signal:AbortSignal,progress:(s:string)=>void)=>Promise<unknown>;settled:Promise<void>;finish:()=>void};
/** Generation is serialized for shared drafts, not for unrelated documents. */
function conflicts(a:Job,b:Job):boolean {
 if(a.scope!==b.scope||!a.kind.startsWith('staff-')||!b.kind.startsWith('staff-'))return false;
 if(a.bookId===b.bookId)return true;
 const documents=(j:Job)=>new Set([...(j.documentIds||[]),...(j.documentId?[j.documentId]:[])]);
 if(a.kind==='staff-auto'||b.kind==='staff-auto'||a.kind==='staff-batch'||b.kind==='staff-batch'){
  const left=documents(a);return [...documents(b)].some(id=>left.has(id));
 }
 return false;
}
export class JobQueue{
 private entries:Entry[]=[];private serial=0;private active=0;private snapshotJobs:readonly Job[]=[];private listeners=new Set<()=>void>();
 constructor(private concurrency=2,private doubtLane=false){}
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 snapshot=()=>this.snapshotJobs;
 hasContentGeneration=()=>this.entries.some(j=>j.kind!=='doubt'&&['queued','running'].includes(j.state));
 requireDoubtsAvailable(){if(this.hasContentGeneration())throw Error(DOUBTS_PAUSED_MESSAGE);}
 private emit(){this.snapshotJobs=this.entries.map(j=>({...j}));for(const fn of this.listeners)fn();}
 list(scope:string):Job[]{return this.entries.filter(j=>j.scope===scope).map(j=>({...j}));}
 enqueue(meta:Omit<Job,'id'|'state'|'note'|'error'>,run:NonNullable<Entry['run']>){
  if(meta.kind==='doubt')this.requireDoubtsAvailable();
  const old=this.entries.find(j=>j.scope===meta.scope&&j.bookId===meta.bookId&&j.sectionId===meta.sectionId&&j.kind===meta.kind&&['queued','running'].includes(j.state));if(old)return old.id;
  // The book-wide lock exists to stop two WHOLE-BOOK preparations running over
  // each other. It used to reject every per-module job as well, so a second
  // reviewer opening any module of the same book was told "already being
  // prepared" — the app looked broken when it was merely busy elsewhere.
  // Whole-book jobs still exclude each other; single modules queue normally
  // and are serialised by the concurrency limit below.
  const wholeBook=meta.kind==='staff-auto';
  if(wholeBook&&meta.documentId&&this.entries.some(j=>j.scope===meta.scope&&j.kind==='staff-auto'&&j.documentId===meta.documentId&&['queued','running'].includes(j.state)))throw Error('This book is already being prepared. Wait for it to finish or cancel its current job.');
  if(this.entries.filter(j=>['queued','running'].includes(j.state)).length>=20)throw Error('Twenty jobs are already waiting. Let some finish before adding more.');
  this.entries=this.entries.filter(j=>['queued','running'].includes(j.state)||j.id>this.serial-40);
  let finish=()=>{};const settled=new Promise<void>(resolve=>{finish=resolve;});
  const job:Entry={...meta,id:++this.serial,state:'queued',note:'Waiting to start',error:'',cancelling:false,controller:new AbortController(),run,settled,finish};this.entries.push(job);this.emit();this.pump();return job.id;
 }
 /** Cancel one job. A queued job stops at once; a running one is aborted and
  * settles when its current model call returns.
  *
  * `cancelling` is per job. The screens used to infer "is something being
  * cancelled?" from shared state, so cancelling one generation made EVERY
  * visible row read "Cancelling…", and the Cancel button stayed on the row
  * that had already been cancelled because the job was still `running`.
  * With this flag a row can hide its own button and show its own progress
  * without speaking for any other row. */
 cancel(id:number){const j=this.entries.find(j=>j.id===id);if(!j||!['queued','running'].includes(j.state)||j.cancelling)return;j.cancelling=true;j.controller.abort();if(j.state==='queued'){j.state='cancelled';j.note='Cancelled';j.run=undefined;j.finish();}else j.note='Cancelling…';this.emit();}
 cancelOtherScopes(scope:string){for(const j of this.entries)if(j.scope!==scope)this.cancel(j.id);}
 async cancelDocument(scope:string,documentId:string,moduleIds:string[]=[]){const jobs=this.entries.filter(j=>j.scope===scope&&(j.documentId===documentId||j.documentIds?.includes(documentId)||j.bookId===documentId||moduleIds.includes(j.bookId)));for(const j of jobs)this.cancel(j.id);await Promise.all(jobs.map(j=>j.settled));}
 async cancelBook(scope:string,bookId:string){const jobs=this.entries.filter(j=>j.scope===scope&&j.bookId===bookId);for(const j of jobs)this.cancel(j.id);await Promise.all(jobs.map(j=>j.settled));}
 private pump(){
  while(true){const running=this.entries.filter(j=>j.state==='running');
   const j=this.entries.find(j=>j.state==='queued'&&!running.some(r=>conflicts(j,r))&&(this.doubtLane?(j.kind==='doubt'?!running.some(r=>r.kind==='doubt'):running.filter(r=>r.kind!=='doubt').length<this.concurrency):this.active<this.concurrency));if(!j)break;this.active++;j.state='running';j.note='Preparing on this device';this.emit();
   void(async()=>{try{await j.run!(j.controller.signal,s=>{if(!j.controller.signal.aborted){j.note=s;this.emit();}});j.state=j.controller.signal.aborted?'cancelled':'completed';j.note=j.state==='completed'?'Saved on this device':'Cancelled';}
    catch(e){j.state=j.controller.signal.aborted?'cancelled':'failed';j.error=j.state==='failed'?(e instanceof Error?e.message:String(e)):'';}
    finally{j.run=undefined;j.cancelling=false;j.finish();this.active--;this.emit();this.pump();}})();
  }
 }
}
export const generationJobs=new JobQueue(2,true);
