/** Confirm loss of server reachability independently of an individual API failure.
 * Any HTTP response proves reachability, even when that endpoint reports an error.
 * A successful API request cancels stale checks before they can change app state. */
export class ConnectionCheck {
 private controller:AbortController|undefined;
 private timer:ReturnType<typeof setTimeout>|undefined;
 private epoch=0;
 private failures=0;
 constructor(private url:()=>string,private unreachable:()=>void,private request:typeof fetch=(input,init)=>globalThis.fetch(input,init)){}
 start(){if(this.controller||this.timer||!this.url())return;void this.check(this.epoch);}
 stop(){this.epoch++;this.failures=0;clearTimeout(this.timer);this.timer=undefined;this.controller?.abort();this.controller=undefined;}
 private async check(epoch:number){
  if(epoch!==this.epoch)return;
  const controller=new AbortController();this.controller=controller;
  const timeout=setTimeout(()=>controller.abort(),5000);
  let answered=false;
  try{const response=await this.request(this.url(),{cache:'no-store',signal:controller.signal});answered=response.status>0;}
  catch{/* A failed request is evidence only after an independent confirmation. */}
  finally{clearTimeout(timeout);if(this.controller===controller)this.controller=undefined;}
  if(epoch!==this.epoch)return;
  if(answered){this.stop();return;}
  if(++this.failures>=2){this.stop();this.unreachable();return;}
  this.timer=setTimeout(()=>{this.timer=undefined;void this.check(epoch);},1000);
 }
}
