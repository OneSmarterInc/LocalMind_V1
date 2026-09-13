/* Only public application assets are cached here. Never cache APIs or books. */
const PREFIX='localmind-shell-v2-';
let current;
async function manifest(){const r=await fetch('/offline-files.json',{cache:'no-store'});if(!r.ok)throw Error('Build the web export before saving offline files.');const m=await r.json();if(!m.version||!Array.isArray(m.files)||!m.files.includes('/index.html'))throw Error('Invalid offline manifest.');return m;}
async function prepare(){
 const m=await manifest(),name=PREFIX+m.version,cache=await caches.open(name);
 try{
  // Bounded concurrency avoids excessive browser memory use while caching WASM.
  for(let i=0;i<m.files.length;i+=4)await Promise.all(m.files.slice(i,i+4).map(async url=>{
   if(!url.startsWith('/')||url.startsWith('//')||url.startsWith('/api/')||url.startsWith('/media/'))throw Error('Invalid application asset path');
   const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error(`Could not save ${url}`);await cache.put(url,r);
  }));
  await cache.put('/__complete__',new Response(JSON.stringify(m)));current=name;
  return name;
 }catch(e){if(!await cache.match('/__complete__'))await caches.delete(name);throw e;}
}
async function active(){
 if(current)return caches.open(current);
 for(const name of (await caches.keys()).filter(n=>n.startsWith(PREFIX)).reverse()){
  const c=await caches.open(name);if(await c.match('/__complete__')){current=name;return c;}
 }
 return null;
}
self.addEventListener('install',event=>{event.waitUntil(prepare());});
// Only an explicit Offline AI setup action activates a waiting update. Never
// replace a running quiz automatically just because a new deployment appeared.
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{if(event.data?.type==='PREPARE_OFFLINE')event.waitUntil(prepare().then(async()=>{event.ports[0]?.postMessage({ok:true});await self.skipWaiting();}).catch(e=>event.ports[0]?.postMessage({ok:false,error:e.message})));});
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/media/'))return;
 event.respondWith((async()=>{
  const cache=await active();
  // Offline uses the complete same-version shell and its matching assets.
  if(req.mode==='navigate'){
   try{return await fetch(req);}catch{const saved=await cache?.match('/index.html');return saved||new Response('Connect once to install LocalMind offline.',{status:503});}
  }
  const saved=await cache?.match(url.pathname);if(saved)return saved;
  return fetch(req);
 })());
});
