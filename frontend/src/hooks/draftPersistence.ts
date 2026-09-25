/** Ordered, failure-aware draft writes; deletion invalidates already queued writes. */
export interface DraftStorage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> }
const queues = new Map<string, { tail: Promise<void>; epoch: number }>();
function queue(key: string) { let q = queues.get(key); if (!q) { q = { tail: Promise.resolve(), epoch: 0 }; queues.set(key,q); } return q; }
function serial(key: string, work: () => Promise<void>) { const q=queue(key); const next=q.tail.then(work); q.tail=next.catch(()=>{}); return next; }
export async function removeDraft(storage: DraftStorage, key: string) { const q=queue(key); q.epoch++; await serial(key,()=>storage.removeItem(key)); }
export class DraftPersistence<T> {
  private loaded=false;
  private removed=false;
  private epoch:number;
  private loading:Promise<T|null>|null=null;
  private value:T;
  private revision=0;
  private savedRevision=-1;
  constructor(private storage:DraftStorage,readonly key:string,initial:T){this.value=initial;this.epoch=queue(key).epoch;}
  async load():Promise<T|null>{
    if(!this.loading)this.loading=(async()=>{
      await queue(this.key).tail;
      const raw=await this.storage.getItem(this.key);
      let stored:T|null=null;
      if(raw!==null){try{stored=JSON.parse(raw) as T;}catch{throw new Error('This saved draft cannot be read. It has not been overwritten.');}}
      if(this.removed||this.epoch!==queue(this.key).epoch)return null;
      if(stored!==null){
        if(this.revision===0)this.value=stored;
        else if(typeof stored==='object'&&stored!==null&&!Array.isArray(stored)&&typeof this.value==='object'&&this.value!==null&&!Array.isArray(this.value)){
          // A quiz change made during restoration overrides only that question.
          this.value={...stored,...this.value};
        }else throw new Error('A saved response arrived while you were editing. Stay on this page and resolve the draft before leaving.');
      }
      this.loaded=true;this.savedRevision=this.revision===0?0:-1;
      return stored===null?null:this.value;
    })();
    return this.loading;
  }
  update(value:T){if(this.removed)return;if(JSON.stringify(value)!==JSON.stringify(this.value)){this.value=value;this.revision++;}}
  get dirty(){return !this.removed&&(this.loaded||this.revision>0)&&this.revision!==this.savedRevision;}
  async flush():Promise<boolean>{
    await this.load();
    if(!this.loaded||this.removed||this.epoch!==queue(this.key).epoch)return false;
    const value=this.value,revision=this.revision,epoch=this.epoch;
    await serial(this.key,async()=>{
      if(this.removed||queue(this.key).epoch!==epoch)return;
      await this.storage.setItem(this.key,JSON.stringify(value));
      this.savedRevision=revision;
    });
    return !this.removed&&this.epoch===queue(this.key).epoch&&!this.dirty;
  }
  async discard(){
    this.removed=true;
    try{await removeDraft(this.storage,this.key);}
    catch(error){this.removed=false;this.epoch=queue(this.key).epoch;this.savedRevision=-1;if(!this.loaded)this.loading=null;throw error;}
  }
}
export function carryEditableFields<T>(server:T,sent:T,current:T,fields:(keyof T)[]):T{
  const result={...server};for(const key of fields)if(JSON.stringify(sent[key])!==JSON.stringify(current[key]))result[key]=current[key];return result;
}
