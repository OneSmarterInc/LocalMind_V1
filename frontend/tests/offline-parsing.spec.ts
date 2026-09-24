import {test,expect,type Page} from '@playwright/test';
import fs from 'node:fs';
// Same sign-in as private-browser.spec.ts (not imported: importing a spec file re-registers its tests).
const fixture=()=>JSON.parse(fs.readFileSync('test-results/fixture.json','utf8'));
async function signIn(page:Page,role:string,path:string){
 const r=await page.request.post(`/api/auth/login/${role}/`,{data:{email:`browser-${role}@example.edu`,password:fixture().password}});
 expect(r.ok(),await r.text()).toBeTruthy();const tokens=await r.json();
 await page.addInitScript(t=>{if(!sessionStorage.getItem('browser-test-session')){localStorage.setItem('localmind.access',t.access);localStorage.setItem('localmind.refresh',t.refresh);if(t.session_id)localStorage.setItem('localmind.session',t.session_id);sessionStorage.setItem('browser-test-session','set');}},tokens);
 await page.goto(path);return tokens;
}

const COPY='@parser-copy-v1';
/** Read or change the saved book-reader copy in the private-library database. */
const copy=(page:Page,action:'has'|'delete'|'tamper')=>page.evaluate(async({action,key})=>{
 const db=await new Promise<IDBDatabase>((res,rej)=>{const r=indexedDB.open('localmind-private-library',1);r.onupgradeneeded=()=>r.result.createObjectStore('records');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
 const tx=(mode:IDBTransactionMode,run:(s:IDBObjectStore)=>IDBRequest)=>new Promise<unknown>((res,rej)=>{const t=db.transaction('records',mode);const q=run(t.objectStore('records'));t.oncomplete=()=>res(q.result);t.onerror=()=>rej(t.error);});
 const value=await tx('readonly',s=>s.get(key)) as {asset:string;code:string}|undefined;
 if(action==='has')return !!value?.code;
 if(action==='delete'){await tx('readwrite',s=>s.delete(key));return true;}
 await tx('readwrite',s=>s.put({...value!,code:value!.code+'\n;window.__LM_TAMPERED__=1;'},key));return true;
},{action,key:COPY});
async function pick(page:Page,button:string,file:{name:string;mimeType:string;buffer:Buffer}){
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:button,exact:true}).click();await(await chooser).setFiles(file);
}
const pdf=()=>({name:'offline-biology.pdf',mimeType:'application/pdf',buffer:fs.readFileSync('test-results/private-fixture.pdf')});

test.beforeEach(async({page})=>{await page.goto('/api/health/');expect(await page.evaluate(()=>window.isSecureContext)).toBe(false);});

test('student imports a book with no connection on a plain-http address',async({page,context})=>{
 await signIn(page,'student','/student/private-library');
 await expect.poll(()=>copy(page,'has'),{timeout:60000}).toBe(true);
 await context.setOffline(true);
 const parserRequests:string[]=[];page.on('requestfailed',r=>{if(r.url().includes('/private-assets/parser-'))parserRequests.push(r.url());});
 await pick(page,'Upload my book',pdf());
 await expect(page.getByText('offline-biology',{exact:true})).toBeVisible({timeout:90000});
 expect(parserRequests.length,'the network copy was tried first and was unavailable').toBeGreaterThan(0);
 await page.getByText('offline-biology',{exact:true}).click();
 // The book lists its reading units; the extracted text is inside the first one.
 await page.getByText('Page 1',{exact:true}).click();
 await expect(page.getByText(/Photosynthesis happens in the chloroplasts/).first()).toBeVisible();
});

test('without a saved reader the offline import explains what to do instead of failing silently',async({page,context})=>{
 await signIn(page,'student','/student/private-library');
 await expect.poll(()=>copy(page,'has'),{timeout:60000}).toBe(true);
 await copy(page,'delete');await context.setOffline(true);
 await pick(page,'Upload my book',pdf());
 await expect(page.getByText(/The book reader is not saved on this device yet/)).toBeVisible();
});

test('a changed saved reader is refused rather than run',async({page,context})=>{
 await signIn(page,'student','/student/private-library');
 await expect.poll(()=>copy(page,'has'),{timeout:60000}).toBe(true);
 await copy(page,'tamper');await context.setOffline(true);
 await pick(page,'Upload my book',pdf());
 await expect(page.getByText(/The book reader is not saved on this device yet/)).toBeVisible();
 expect(await page.evaluate(()=>(window as unknown as {__LM_TAMPERED__?:number}).__LM_TAMPERED__)).toBeUndefined();
});

test('faculty prepares a book on the device with no connection, subject list from the offline sync',async({page,context})=>{
 await signIn(page,'faculty','/manage/document/upload');
 await expect.poll(()=>copy(page,'has'),{timeout:60000}).toBe(true);
 // Wait for the background offline sync to hold the faculty subject list; the
 // "Books on this device" screen has never been opened, so it has no copy of its own.
 await expect.poll(()=>page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>((res,rej)=>{const r=indexedDB.open('localmind-offline');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
  if(!db.objectStoreNames.length)return false;const name=db.objectStoreNames[0];
  const keys=await new Promise<IDBValidKey[]>((res,rej)=>{const q=db.transaction(name).objectStore(name).getAllKeys();q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);});
  return keys.some(k=>String(k).endsWith(':/faculty/subjects/'));
 }),{timeout:90000}).toBe(true);
 await context.setOffline(true);
 // Nothing on this page polls, so the application only learns the server is gone
 // when a request fails. Returning to the tab is what a user does here, and it is
 // what makes the screen reload its data.
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));});
 await expect(page.getByText('The server is unavailable.',{exact:true})).toBeVisible({timeout:60000});
 await page.getByRole('button',{name:'Prepare on this device',exact:true}).click();
 await expect(page).toHaveURL(/\/manage\/local-books/);
 await page.getByRole('button',{name:'Subject',exact:true}).click();
 await page.getByRole('menuitem',{name:/WEBTEST/}).click();
 // The upload page stays mounted behind this one (tab navigator), so pick this screen's field by its own placeholder.
 await page.getByPlaceholder('For example, Chapter 4 - Threat landscape').fill('Offline LAN textbook');
 await pick(page,'Choose book',pdf());
 await expect(page.getByRole('heading',{name:'Offline LAN textbook',exact:true})).toBeVisible({timeout:90000});
 expect(fixture().password).toBeTruthy();
});
