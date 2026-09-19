/** One bounded health request at a time; no accumulating interval requests. */
export class RecoveryProbe {
 private timer:ReturnType<typeof setTimeout>|undefined;
 private controller:AbortController|undefined;
 private generation=0;
 private attempts=0;
 constructor(private url:()=>string,private recovered:()=>void,private request:typeof fetch=(input,init)=>globalThis.fetch(input,init),private random=()=>Math.random()){}
 start(){if(this.timer||this.controller||!this.url())return;this.schedule(this.generation);}
 stop(){this.generation++;this.attempts=0;clearTimeout(this.timer);this.timer=undefined;this.controller?.abort();this.controller=undefined;}
 private schedule(generation:number){
  const delay=Math.min(60000,5000*2**Math.min(this.attempts,4)*(0.8+0.4*this.random()));
  this.timer=setTimeout(()=>{this.timer=undefined;void this.probe(generation);},delay);
 }
 private async probe(generation:number){
  if(generation!==this.generation)return;
  const controller=new AbortController();this.controller=controller;
  const timeout=setTimeout(()=>controller.abort(),5000);
  try{
   const response=await this.request(this.url(),{cache:'no-store',signal:controller.signal});
   if(generation===this.generation&&response.ok){this.stop();this.recovered();return;}
  }catch{/* The next bounded attempt backs off. */}
  finally{clearTimeout(timeout);if(this.controller===controller)this.controller=undefined;}
  if(generation===this.generation){this.attempts++;this.schedule(generation);}
 }
}
