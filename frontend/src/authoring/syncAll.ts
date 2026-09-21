import {LocalAuthoring,draftStatus,type Draft} from './local';
import {LocalQuizzes,type QuizDraft} from './quizzes';

/** One reviewed-and-ready item that "Synchronize all" can send.
 * lesson/quiz = a single module draft; selection = a multi-module quiz draft. */
export type SyncItem={kind:'lesson'|'quiz'|'selection';id:string;title:string};
export type SyncScope={documentId?:string;lessons?:boolean;quizzes?:boolean;selections?:boolean};
export type SyncResult={synced:number;waiting:SyncItem[];failed:(SyncItem&{error:string})[]};

/** Generated on this device, not yet sent, and not blocked by work in progress.
 * Everything else (still generating, already synchronized, waiting on the
 * other kind, in conflict) is left for the reviewer to handle one by one. */
export function eligible(draft:Draft,kind:'lesson'|'quiz'){
 if(draftStatus(draft,kind)!=='Ready for review')return false;
 if(draft.run?.kind===kind||draft.pausedRuns?.[kind])return false;
 if(draft.operation&&draft.state!=='synced'&&draft.operation.kind!==kind)return false;
 return true;
}
export function selectionReady(row:QuizDraft){
 return row.state==='draft'&&row.done===row.parts.length&&row.questions.length===row.count&&row.count>0;
}

export async function planSyncAll(owner:string,scope:SyncScope={}):Promise<SyncItem[]>{
 const items:SyncItem[]=[];
 const wantLessons=scope.lessons!==false,wantQuizzes=scope.quizzes!==false;
 if(wantLessons||wantQuizzes){
  const authoring=new LocalAuthoring(owner),removed=new Map<string,boolean>();
  for(const draft of await authoring.drafts()){
   const book=draft.snapshot.document_id;
   if(scope.documentId&&book!==scope.documentId)continue;
   if(!removed.has(book))removed.set(book,await authoring.isRemoved(book));
   if(removed.get(book))continue;
   for(const kind of ['lesson','quiz'] as const){
    if((kind==='lesson'&&!wantLessons)||(kind==='quiz'&&!wantQuizzes))continue;
    if(eligible(draft,kind))items.push({kind,id:draft.snapshot.module_id,title:draft.snapshot.title});
   }
  }
 }
 if(scope.selections){
  for(const row of await new LocalQuizzes(owner).list()){
   if(scope.documentId&&!row.sources.some(s=>s.document_id===scope.documentId))continue;
   if(selectionReady(row))items.push({kind:'selection',id:row.id,title:row.title});
  }
 }
 return items;
}

/** Approve and send each item in turn. One failure never stops the rest;
 * operation IDs make a repeated run safe on the server. Nothing is published. */
export async function runSyncAll(owner:string,items:SyncItem[],progress:(done:number,total:number)=>void=()=>{},signal?:AbortSignal):Promise<SyncResult>{
 const authoring=new LocalAuthoring(owner),quizzes=new LocalQuizzes(owner);
 const result:SyncResult={synced:0,waiting:[],failed:[]};
 for(let i=0;i<items.length;i++){
  if(signal?.aborted)break;
  const item=items[i];progress(i,items.length);
  try{
   const state=item.kind==='selection'?(await quizzes.approve(item.id)).state:(await authoring.share(item.id,item.kind))?.state;
   if(state==='synced')result.synced++;
   else if(state==='conflict')result.failed.push({...item,error:'Needs review before it can synchronize.'});
   else result.waiting.push(item);
  }catch(e){result.failed.push({...item,error:e instanceof Error?e.message:String(e)});}
 }
 progress(items.length,items.length);
 return result;
}

export function describePlan(items:SyncItem[]){
 const n=(kind:SyncItem['kind'])=>items.filter(i=>i.kind===kind).length;
 const part=(count:number,noun:string)=>count?`${count} ${noun}${count===1?'':'s'}`:'';
 return [part(n('lesson'),'lesson'),part(n('quiz'),'module quiz'),part(n('selection'),'multi-module quiz')].filter(Boolean).join(', ');
}
export function describeResult(r:SyncResult){
 const parts=[`${r.synced} synchronized`];
 if(r.waiting.length)parts.push(`${r.waiting.length} waiting for the connection (they retry automatically)`);
 if(r.failed.length)parts.push(`${r.failed.length} failed: ${r.failed.slice(0,5).map(f=>`${f.title} (${f.error})`).join('; ')}${r.failed.length>5?'…':''}`);
 return parts.join(' · ');
}
