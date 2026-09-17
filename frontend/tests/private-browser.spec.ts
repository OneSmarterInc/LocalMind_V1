import {test,expect,type Page} from '@playwright/test';
import fs from 'node:fs';
export const fixture=()=>JSON.parse(fs.readFileSync('test-results/fixture.json','utf8'));
export async function signIn(page:Page,role='student',path='/student/private-library',other=false){
 const email=`browser-${other?'other':role}@example.edu`;
 const r=await page.request.post(`/api/auth/login/${role}/`,{data:{email,password:fixture().password}});
 expect(r.ok(),await r.text()).toBeTruthy();const tokens=await r.json();
 await page.addInitScript(t=>{
  if(!sessionStorage.getItem('browser-test-session')){
   localStorage.setItem('localmind.access',t.access);localStorage.setItem('localmind.refresh',t.refresh);
   if(t.session_id)localStorage.setItem('localmind.session',t.session_id);
   sessionStorage.setItem('browser-test-session','set');
  }
 },tokens);
 await page.goto(path);return tokens;
}
async function pick(page:Page,button:string,file:{name:string;mimeType:string;buffer:Buffer}){
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:button,exact:true}).click();await(await chooser).setFiles(file);
}
export async function model(page:Page,path='/student/offline-ai'){
 await page.goto(path);await expect(page.getByText('Model on this device',{exact:true})).toBeVisible();
 await pick(page,'Import a .gguf file',{name:'browser-fixture.gguf',mimeType:'application/octet-stream',buffer:Buffer.from('GGUFunit-test-model-not-real-inference')});
 await expect(page.getByText('Downloaded',{exact:true})).toBeVisible();
 // A model file alone is not the offline application. Complete the same setup
 // the user is prompted to complete before disconnecting.
 await page.getByRole('button',{name:'Check and save offline app files',exact:true}).click();
 await expect(page.getByText(/Application files saved/).first()).toBeVisible();
}
async function importBook(page:Page,name='Personal biology'){
 await page.goto('/student/private-library');
 await pick(page,'Upload my book',{name:name+'.md',mimeType:'text/markdown',buffer:Buffer.from('# Leaf science\n'+fixture().source+'\n# Open practice\n'+fixture().source)});
 await expect(page.getByText(name,{exact:true})).toBeVisible();await page.getByText(name,{exact:true}).click();
 await expect(page).toHaveURL(/\/student\/private-book\/[a-f0-9]{64}/);return page.url();
}
const jobPanel=(page:Page)=>page.getByRole('heading',{name:'Generation jobs',exact:true}).locator('..').locator('..');
async function countOne(page:Page){await page.getByRole('button',{name:'Questions',exact:true}).click();await page.getByRole('menuitem',{name:'1',exact:true}).click();}

test('admin shares a plain book; legacy publishing route no longer shows the block editor',async({page})=>{
 await signIn(page,'admin','/manage/study/00000000-0000-0000-0000-000000000001');
 await expect(page).toHaveURL(/\/manage\/private-library/);
 await expect(page.getByText('Books for private study',{exact:true}).first()).toBeVisible();
 await expect(page.getByText('Choose a block',{exact:true})).toHaveCount(0);
 await expect(page.getByText('Author the available teaching aids',{exact:true})).toHaveCount(0);
 await page.getByLabel('Book title',{exact:true}).fill('Shared test notes');
 await pick(page,'Choose book file',{name:'shared-notes.txt',mimeType:'text/plain',buffer:Buffer.from(fixture().source)});
 await page.getByRole('button',{name:'Upload and share book',exact:true}).click();
 await page.getByRole('button',{name:'Upload and share',exact:true}).click();
 await expect(page.getByText('Shared test notes',{exact:true})).toBeVisible();
 await page.screenshot({path:'test-results/simple-staff-books.png',fullPage:true});
});

test('private lesson regeneration, quiz checking and new doubts survive a completely offline restart',async({page,context})=>{
 await signIn(page);await model(page);const url=await importBook(page);
 const uploads:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/'))uploads.push(r.url());});
 await page.getByRole('button',{name:'Generate a lesson',exact:true}).click();
 await expect(page.getByText('A local lesson about photosynthesis.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Regenerate lesson',exact:true}).click();
 await expect(page.getByRole('button',{name:'Saved lesson'})).toContainText('Version 2');
 await page.evaluate(()=>{(window as any).__LM_TEST_FAIL_ONCE__=true;});
 await page.getByRole('button',{name:'Regenerate lesson',exact:true}).click();
 await expect(page.getByText(/Expected 1–3 lesson sections/).filter({visible:true}).first()).toBeVisible();
 await expect(page.getByText('A local lesson about photosynthesis.',{exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'Practice quiz',exact:true}).click();await countOne(page);
 await page.getByRole('button',{name:'Generate quiz',exact:true}).click();
 await expect(page.getByRole('radio',{name:'A. Chloroplasts',exact:true})).toBeVisible();
 await page.getByRole('radio',{name:'A. Chloroplasts',exact:true}).click();
 await expect(page.getByRole('radio',{name:'A. Chloroplasts',exact:true})).toHaveAttribute('aria-checked','true');
 await expect(page.getByText('Answers saved on this device',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Check my answers',exact:true}).click();
 await expect(page.getByText('1 of 1 correct',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Generate another quiz',exact:true}).click();
 await expect(page.getByRole('button',{name:'Generate another quiz',exact:true})).toBeEnabled();
 await expect(page.getByRole('button',{name:'Saved quiz'})).toContainText('Version 1');
 await page.getByRole('button',{name:'Saved quiz'}).click();await page.getByRole('menuitem',{name:/Version 2/}).click();
 await page.getByRole('radio',{name:'A. Chloroplasts',exact:true}).click();
 await expect(page.getByText('Answers saved on this device',{exact:true})).toBeVisible();
 expect(uploads,'Private model tasks must not post books, questions or answers to Django.').toEqual([]);
 await context.setOffline(true);await page.reload();
 await expect(page).toHaveURL(url);await expect(page.getByText('All modules open',{exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'Practice quiz',exact:true}).click();
 await expect(page.getByRole('radio',{name:'A. Chloroplasts',exact:true})).toHaveAttribute('aria-checked','true');
 await page.getByRole('button',{name:'Check my answers',exact:true}).click();await expect(page.getByText('1 of 1 correct',{exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'Ask a doubt',exact:true}).click();
 await page.getByLabel('Your question',{exact:true}).fill('Where does photosynthesis happen?');
 await page.getByRole('button',{name:'Ask local AI',exact:true}).click();
 await expect(page.getByText('The local model explains that photosynthesis happens in chloroplasts.',{exact:true})).toBeVisible();
 await page.screenshot({path:'test-results/private-offline-doubt.png',fullPage:true});
 await context.setOffline(false);
});

test('faculty course originals appear and are imported locally; PDF parser is bundled',async({page})=>{
 await signIn(page);await page.getByRole('tab',{name:'From my institution',exact:true}).click();
 await expect(page.getByText('Faculty Biology',{exact:true})).toBeVisible();
 const row=page.getByText('Faculty Biology',{exact:true}).locator('..').locator('..');
 await row.getByRole('button',{name:'Add to my library',exact:true}).click();
 await expect(page.getByText('Saved books',{exact:true})).toBeVisible();await page.getByText('Faculty Biology',{exact:true}).click();
 await expect(page.getByText('All modules open',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Back to library',exact:true}).click();
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload my book',exact:true}).click();await(await chooser).setFiles('test-results/private-fixture.pdf');
 await expect(page.getByText('private-fixture',{exact:true})).toBeVisible();
});

test('private books do not appear under another account and the mobile viewport fits',async({page})=>{
 await signIn(page);await importBook(page,'Only my private notes');
 const r=await page.request.post('/api/auth/login/student/',{data:{email:'browser-other@example.edu',password:fixture().password}});expect(r.ok()).toBeTruthy();const t=await r.json();
 await page.evaluate(v=>{localStorage.setItem('localmind.access',v.access);localStorage.setItem('localmind.refresh',v.refresh);},t);
 await page.goto('/student/private-library');
 await expect(page.getByText('Add your first book',{exact:true})).toBeVisible();
 await expect(page.getByText('Only my private notes',{exact:true})).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'test-results/private-library-mobile.png',fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);expect(overflow).toBeLessThanOrEqual(2);
});

test('normal course doubts use the same device model offline and reject a known access denial',async({page,context})=>{
 await signIn(page);await model(page);const id=fixture().module;
 await page.goto(`/student/module/${id}?tab=ask`);
 await expect(page.getByLabel('Your question',{exact:true})).toBeEditable();
 await context.setOffline(true);
 await page.getByLabel('Your question',{exact:true}).fill('Where does photosynthesis happen?');await page.getByRole('button',{name:'Ask',exact:true}).click();
 await expect(page.getByText('Local AI · this device',{exact:true})).toBeVisible();
 await context.setOffline(false);
 const login=await page.request.post('/api/auth/login/admin/',{data:{email:'browser-admin@example.edu',password:fixture().password}});const admin=await login.json();
 const endpoint=`/api/faculty/modules/${id}/availability/`;const headers={Authorization:`Bearer ${admin.access}`};
 const lock=await page.request.post(endpoint,{headers,data:{availability:'locked'}});expect(lock.ok()).toBeTruthy();
 try{
  await expect(page.getByText('Connected',{exact:true})).toBeVisible({timeout:35000});
  await page.getByLabel('Your question',{exact:true}).fill('Explain the leaf again.');await page.getByRole('button',{name:'Ask',exact:true}).click();
  await expect(page.getByText('This module has not been opened by faculty.',{exact:true})).toBeVisible();
  await context.setOffline(true);
  await page.getByLabel('Your question',{exact:true}).fill('Where does photosynthesis happen now?');await page.getByRole('button',{name:'Ask',exact:true}).click();
  await expect(page.getByText('This module was denied by the institution. Reconnect and restore authorized access before asking locally.',{exact:true})).toBeVisible();
 }finally{await context.setOffline(false);await page.request.post(endpoint,{headers,data:{availability:'open'}});}
});


test('real English OCR and original table/diagram survive offline import, lesson and restart',async({page,context})=>{
 test.setTimeout(180000);
 page.on('pageerror',e=>console.log('OCR page error:',e.message));
 await signIn(page);await model(page);
 await page.goto('/student/private-library');await context.setOffline(true);
 const posts:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/'))posts.push(r.url());});
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload my book',exact:true}).click();await(await chooser).setFiles('test-results/scanned-biology.pdf');
 await page.getByText('scanned-biology',{exact:true}).click({timeout:60000});
 await expect(page.getByText('Text recognised on this device',{exact:true})).toBeVisible();
 await expect(page.getByText(/12\.5/).first()).toBeVisible();
 const showOriginal=()=>page.getByRole('button',{name:'View original page 1',exact:true}).click();
 await showOriginal();
 const original=page.getByRole('img',{name:'Original page 1 — tables and diagrams enlarged',exact:true});
 await expect(original).toBeVisible();
 const imageBefore=await original.getAttribute('src');expect(imageBefore).toMatch(/^data:image\/png;base64,/);
 await page.screenshot({path:'test-results/scanned-source-with-visuals.png',fullPage:true});
 await page.getByRole('button',{name:'Close image',exact:true}).click();
 await page.getByRole('button',{name:'Generate a lesson',exact:true}).click();
 await expect(page.getByRole('button',{name:'Saved lesson'})).toContainText('Version 1');
 await showOriginal();await expect(original).toBeVisible();expect(await original.getAttribute('src')).toBe(imageBefore);
 await page.getByRole('button',{name:'Close image',exact:true}).click();
 await page.screenshot({path:'test-results/scanned-lesson-with-visuals.png',fullPage:true});
 await page.reload();await page.getByRole('tab',{name:'Lesson',exact:true}).click();
 await expect(page.getByRole('button',{name:'Saved lesson'})).toContainText('Version 1');
 await showOriginal();await expect(original).toBeVisible();expect(await original.getAttribute('src')).toBe(imageBefore);
 await page.getByRole('button',{name:'Close image',exact:true}).click();
 expect(posts).toEqual([]);
});


test('multiple background jobs continue across modules and navigation without a save prompt',async({page})=>{
 await signIn(page);await model(page);await importBook(page,'Background biology');
 await page.evaluate(()=>{(window as any).__LM_TEST_DELAY__=4000;});
 await page.getByRole('button',{name:'Generate a lesson',exact:true}).click();
 await page.getByRole('tab',{name:'Practice quiz',exact:true}).click();await countOne(page);
 await page.getByRole('button',{name:'Generate quiz',exact:true}).click();
 await page.getByRole('button',{name:'Open practice',exact:true}).click();
 await page.getByRole('button',{name:'Generate a lesson',exact:true}).click();
 await page.getByRole('button',{name:'Back to library',exact:true}).click();
 await expect(page).toHaveURL(/\/student\/private-library$/);
 await expect(page.getByRole('button',{name:'Save and leave',exact:true})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Generation jobs',exact:true})).toHaveCount(0);
 await page.getByText('Generation jobs',{exact:true}).click();
 await expect(jobPanel(page).getByText('Completed',{exact:true})).toHaveCount(3,{timeout:30000});
 await page.getByText('Private library',{exact:true}).first().click();
 await page.getByRole('heading',{name:'Saved books',exact:true}).locator('..').locator('..').getByText('Background biology',{exact:true}).click();
 await page.getByRole('button',{name:'Leaf science',exact:true}).click();
 await page.getByRole('tab',{name:'Lesson',exact:true}).click();
 await expect(page.getByRole('button',{name:'Saved lesson'})).toContainText('Version 1');
 await page.getByRole('tab',{name:'Practice quiz',exact:true}).click();
 await expect(page.getByRole('radio')).toHaveCount(4);
 await page.getByRole('radio').first().click();await page.getByRole('button',{name:'Check my answers',exact:true}).click();
 await expect(page.getByText('1 of 1 correct',{exact:true})).toBeVisible();
});

test('long module lesson processes successive passages before saving',async({page})=>{
 await signIn(page);await model(page);await page.goto('/student/private-library');
 await pick(page,'Upload my book',{name:'Full coverage.txt',mimeType:'text/plain',buffer:Buffer.from((fixture().source+' ').repeat(8).slice(0,3000))});
 await page.getByText('Full coverage',{exact:true}).click();
 await page.evaluate(()=>{(window as any).__LM_TEST_CALLS__=0;});
 await page.getByRole('button',{name:'Generate a lesson',exact:true}).click();
 await expect(page.getByRole('button',{name:'Saved lesson'})).toContainText('Version 1');
 expect(await page.evaluate(()=>(window as any).__LM_TEST_CALLS__)).toBeGreaterThan(1);
});


test('cancelling a background lesson does not cancel the queued quiz',async({page})=>{
 await signIn(page);await model(page);await importBook(page,'Cancellation biology');
 await page.evaluate(()=>{(window as any).__LM_TEST_DELAY__=2500;});
 await page.getByRole('button',{name:'Generate a lesson',exact:true}).click();
 await page.getByRole('tab',{name:'Practice quiz',exact:true}).click();await countOne(page);
 await page.getByRole('button',{name:'Generate quiz',exact:true}).click();
 await page.getByRole('tab',{name:'Lesson',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('tab',{name:'Practice quiz',exact:true}).click();
 await expect(page.getByRole('radio')).toHaveCount(4,{timeout:30000});
 await page.getByText('Generation jobs',{exact:true}).click();
 await expect(jobPanel(page).getByText('Cancelled',{exact:true})).toBeVisible();
 await expect(jobPanel(page).getByText('Completed',{exact:true})).toBeVisible();
});

test('doubts, drafts and selected module survive reload without embedded jobs',async({page})=>{
 await signIn(page);await model(page);await importBook(page,'Persistent doubts');
 await page.getByRole('button',{name:'Open practice',exact:true}).click();
 await page.getByRole('tab',{name:'Ask a doubt',exact:true}).click();
 await page.getByLabel('Your question',{exact:true}).fill('Where does photosynthesis occur?');
 await page.getByRole('button',{name:'Ask local AI',exact:true}).click();
 await expect(page.getByText('You: Where does photosynthesis occur?',{exact:true})).toBeVisible();
 await page.getByLabel('Your question',{exact:true}).fill('Explain chlorophyll next');
 await page.reload();
 await expect(page.getByText('You: Where does photosynthesis occur?',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Your question',{exact:true})).toHaveValue('Explain chlorophyll next');
 await expect(page.getByRole('heading',{name:'Generation jobs',exact:true})).toHaveCount(0);
 await page.getByRole('tab',{name:'Read',exact:true}).click();
 await page.getByRole('button',{name:'Correct extracted text',exact:true}).click();
 await page.getByLabel('Correct extracted source',{exact:true}).fill('Chlorophyll absorbs sunlight in chloroplasts.');
 await page.getByRole('button',{name:'Save source correction',exact:true}).click();
 await expect(page.getByRole('button',{name:'Correct extracted text',exact:true})).toBeVisible();
 await page.reload();
 await expect(page.getByText('Chlorophyll absorbs sunlight in chloroplasts.',{exact:true})).toBeVisible();
});

for(const release of ['Immediate','Held'])test(`institutional ${release} quiz and progress survive offline restart and synchronize`,async({page,context})=>{
 const tokens=await signIn(page);await model(page);const data=fixture();
 await page.goto('/student/offline');await page.getByRole('button',{name:'Refresh course copy',exact:true}).click();
 await expect(page.getByText('Your course copy is saved.',{exact:true})).toBeVisible();
 await context.setOffline(true);
 await page.goto(`/student/module/${data.module}?tab=lesson`);
 await expect(page.getByText('This lesson was prepared by the institution before download.',{exact:true})).toBeVisible();
 await page.goto(`/student/quiz/${data['quiz'+release]}`);
 await page.getByRole('button',{name:'Start quiz',exact:true}).click();
 await page.getByText('The next process',{exact:true}).click();
 await page.getByRole('button',{name:'Review & submit',exact:true}).click();
 await page.getByRole('button',{name:'Submit answers',exact:true}).click();
 await page.getByRole('button',{name:'Submit answers',exact:true}).last().click();
 await expect(page).toHaveURL(/student\/attempt\//);
 const url=page.url();await page.reload();
 await expect(page.getByText('Saved on this device',{exact:true})).toBeVisible();
 if(release==='Immediate')await expect(page.getByText('Local result: 100% · Passed',{exact:true})).toBeVisible();
 else {await expect(page.getByText(/Your faculty has withheld results/)).toBeVisible();await expect(page.getByText(/Local result:/)).toHaveCount(0);}
 // Submitted quizzes disappear from the dashboard's ready list even before sync.
 await page.goto('/student');
 const pendingQuizTitle=release==='Immediate'?'Offline immediate quiz':'Offline held quiz';
 await expect(page.getByText(release==='Immediate'?'Offline held quiz':'Offline immediate quiz',{exact:true}).or(page.getByText('Nothing waiting. Nice work.',{exact:true}))).toBeVisible();
 await expect(page.getByText(pendingQuizTitle,{exact:true})).toHaveCount(0);
 await page.goto(url);
 // Reopening through the quiz route must show the immutable submission, including after reload.
 await page.goto(`/student/quiz/${data['quiz'+release]}`);
 await expect(page).toHaveURL(url);
 await expect(page.getByRole('button',{name:'Start quiz',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Submit answers',exact:true})).toHaveCount(0);
 await page.reload();await expect(page.getByText('Saved on this device',{exact:true})).toBeVisible();
 if(release==='Immediate'){
  await page.goto(`/student/module/${data.module}`);
  await expect(page.getByText('This progress is saved on your device and awaits institution synchronization.',{exact:true})).toBeVisible();
  let dropped=false;await page.route('**/api/student/offline/events/',async route=>{const event=route.request().postDataJSON();if(event.kind==='quiz'&&!dropped){dropped=true;await route.fetch();await route.abort();}else await route.continue();});
 }
 await context.setOffline(false);await page.goto('/student/offline');
 await page.getByRole('button',{name:'Refresh course copy',exact:true}).click();
 await expect(page.getByText(/0 saved events waiting/)).toBeVisible({timeout:45000});
 const response=await page.request.get('/api/student/scores/',{headers:{Authorization:`Bearer ${tokens.access}`}});expect(response.ok()).toBeTruthy();const scores=await response.json();const rows=Array.isArray(scores)?scores:scores.results;
 expect(rows.filter((r:any)=>r.assessment_id===data['quiz'+release])).toHaveLength(1);
 await page.goto(`/student/quiz/${data['quiz'+release]}`);
 await expect(page).toHaveURL(url);
 await expect(page.getByRole('button',{name:'Start quiz',exact:true})).toHaveCount(0);
 await page.goto(url);
 await expect(page.getByText('Saved on this device',{exact:true})).toHaveCount(0);
 if(release==='Held')await expect(page.getByText('Your faculty will release the results.',{exact:true})).toBeVisible();
 else await expect(page.getByText('Your quiz result',{exact:true})).toBeVisible();
 // Use in-app navigation: a retained quiz screen must not redirect in the background.
 await page.getByText('My subjects',{exact:true}).click();
 await expect(page).toHaveURL(/student\/subjects$/);
 await page.waitForTimeout(2200);
 await expect(page).toHaveURL(/student\/subjects$/);
 await page.getByText('Quizzes',{exact:true}).first().click();
 await expect(page).toHaveURL(/student\/quizzes$/);
 await page.waitForTimeout(2200);
 await expect(page).toHaveURL(/student\/quizzes$/);
});


for(const kind of ['lesson','quiz'])test(`${kind} checkpoints survive offline reload and resume only missing parts`,async({page,context})=>{
 await signIn(page);await model(page);
 await page.goto('/student/private-library');
 const source=('Photosynthesis happens in chloroplasts. Chlorophyll absorbs sunlight. Water enters through roots. ').repeat(18);
 await pick(page,'Upload my book',{name:'Checkpoint lesson.txt',mimeType:'text/plain',buffer:Buffer.from(source)});
 await page.getByText('Checkpoint lesson',{exact:true}).click();
 await expect(page.getByText('All modules open',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.crossOriginIsolated)).toBe(true);
 await page.evaluate(()=>{(window as any).__LM_TEST_FAIL_AT__=2;});
 await page.getByRole('tab',{name:kind==='lesson'?'Lesson':'Practice quiz',exact:true}).click();
 if(kind==='quiz'){await page.getByRole('button',{name:'Questions',exact:true}).click();await page.getByRole('menuitem',{name:'3',exact:true}).click();}
 await page.getByRole('button',{name:kind==='lesson'?'Generate lesson':'Generate quiz',exact:true}).click();
 await expect(page.getByText('Local AI timed out: simulated interruption',{exact:true})).toBeVisible();
 const before=await page.evaluate(async kind=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('localmind-private-library');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const tx=db.transaction('records');const store=tx.objectStore('records');
  const keys=await new Promise<IDBValidKey[]>(resolve=>{const r=store.getAllKeys();r.onsuccess=()=>resolve(r.result);});
  const key=keys.find(k=>String(k).includes(`checkpoint:${kind}:`))!;
  return new Promise<any>(resolve=>{const r=db.transaction('records').objectStore('records').get(key);r.onsuccess=()=>{db.close();resolve(r.result);};});
 },kind);
 expect(before.parts).toHaveLength(1);
 await context.setOffline(true);await page.reload();
 expect(await page.evaluate(()=>window.crossOriginIsolated)).toBe(true);
 await page.getByRole('tab',{name:kind==='lesson'?'Lesson':'Practice quiz',exact:true}).click();
 if(kind==='quiz'){await page.getByRole('button',{name:'Questions',exact:true}).click();await page.getByRole('menuitem',{name:'3',exact:true}).click();}
 await page.getByRole('button',{name:kind==='lesson'?'Generate lesson':'Generate quiz',exact:true}).click();
 await expect(page.getByRole('button',{name:kind==='lesson'?'Saved lesson':'Saved quiz',exact:true})).toContainText('Version 1');
 const count=await page.evaluate(()=>(window as any).__LM_TEST_CALLS__);
 expect(count).toBe(2); // Three passages total; the first was restored from IndexedDB.
 await page.reload();await expect(page.getByRole('button',{name:kind==='lesson'?'Saved lesson':'Saved quiz',exact:true})).toContainText('Version 1');
});

test('streamed import rolls back images on storage failure and saves successful images across reload',async({page})=>{
 await signIn(page);
 const manifest=await(await page.request.get('/offline-files.json')).json();
 await page.addScriptTag({url:manifest.files.find((f:string)=>/\/parser-[a-f0-9]+\.js$/.test(f)),type:'module'});
 await page.evaluate(()=>{
  (window as any).__LM_PARSER__.parse=async(_bytes:any,_name:any,_signal:any,progress:any,save:any)=>{
   progress('Preparing page 1 of 2');
   await save({id:'v1',dataUrl:'data:image/png;base64,aGVsbG8=',kind:'page',width:10,height:10,caption:'Source page',page:1});
   throw new DOMException('Device full','QuotaExceededError');
  };
 });
 const book={name:'Storage test.md',mimeType:'text/markdown',buffer:Buffer.from('# Source\n'+fixture().source)};
 await pick(page,'Upload my book',book);
 await expect(page.getByText(/insufficient storage/)).toBeVisible();
 await expect(page.getByText('Preparing page 1 of 2',{exact:true})).toHaveCount(0);
 const keys=()=>page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('localmind-private-library');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  return await new Promise<string[]>((resolve,reject)=>{const r=db.transaction('records').objectStore('records').getAllKeys();r.onsuccess=()=>{db.close();resolve(r.result.map(String));};r.onerror=()=>reject(r.error);});
 });
 expect((await keys()).filter(k=>k.includes('visual:'))).toHaveLength(0);
 await page.evaluate(()=>{
  (window as any).__LM_PARSER__.parse=async(_b:any,_n:any,_s:any,_p:any,save:any)=>{
   await save({id:'v1',dataUrl:'data:image/png;base64,aGVsbG8=',kind:'page',width:10,height:10,caption:'Source page',page:1});
   return {items:[{title:'Source',text:'Photosynthesis occurs in chloroplasts.',visualIds:['v1']}],warnings:[],visuals:[]};
  };
 });
 await pick(page,'Upload my book',book);await expect(page.getByText('Storage test',{exact:true})).toBeVisible();
 expect((await keys()).filter(k=>k.includes('visual:'))).toHaveLength(1);
 await pick(page,'Upload my book',book);await expect(page.getByText(/This book is already in your library/)).toBeVisible();
 expect((await keys()).filter(k=>k.includes('visual:'))).toHaveLength(1);
 await page.reload();await expect(page.getByText('Storage test',{exact:true})).toBeVisible();
 expect((await keys()).filter(k=>k.includes('visual:'))).toHaveLength(1);
});


test('new app bypasses an old offline-cached parser without deleting private data',async({page})=>{
 await signIn(page);await model(page);
 await page.evaluate(async()=>{
  const names=(await caches.keys()).filter(n=>n.startsWith('localmind-shell-v2-'));
  for(const name of names){const cache=await caches.open(name);for(const request of await cache.keys())if(/\/parser-[a-f0-9]+\.js$/.test(request.url))await cache.delete(request);await cache.put('/private-assets/parser.js',new Response("window.__LM_PARSER__={parse:async()=>{throw Error('The preserved page images exceed 48 MB. Import a chapter at a time. Nothing was saved.')}};",{headers:{'Content-Type':'application/javascript'}}));}
  localStorage.setItem('preserve-private-data-test','retained');
 });
 const requests:string[]=[];page.on('request',r=>{if(r.url().includes('/private-assets/parser'))requests.push(r.url());});
 await importBook(page,'Fresh parser book');
 expect(requests.some(url=>/\/parser-[a-f0-9]+\.js$/.test(url))).toBe(true);
 expect(requests.some(url=>url.endsWith('/parser.js'))).toBe(false);
 expect(await page.evaluate(()=>localStorage.getItem('preserve-private-data-test'))).toBe('retained');
});


for(const role of ['admin','faculty'])test(`${role} can configure local AI within their own portal`,async({page})=>{
 await signIn(page,role,role==='admin'?'/admin/offline-ai':'/manage/offline-ai');
 await expect(page.getByText('Model on this device',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/^Download model/})).toBeVisible();
 await page.getByRole('button',{name:'Books & modules',exact:true}).click();await expect(page).toHaveURL(/\/manage\/books/);
});

test('connected course doubt uses device AI and synchronizes exactly once',async({page})=>{
 const tokens=await signIn(page);await model(page);let serverCalls=0;
 page.on('request',r=>{if(r.method()==='POST'&&/\/modules\/[^/]+\/ask\//.test(r.url()))serverCalls++;});
 await page.goto(`/student/module/${fixture().module}?tab=ask`);
 await page.getByLabel('Your question',{exact:true}).fill('Where does photosynthesis happen?');
 await page.getByRole('button',{name:'Ask',exact:true}).click();
 await expect(page.getByText('The local model explains that photosynthesis happens in chloroplasts.',{exact:true})).toBeVisible();
 await expect.poll(async()=>{const r=await page.request.get(`/api/student/conversations/?module=${fixture().module}`,{headers:{Authorization:`Bearer ${tokens.access}`}});return r.ok()?(await r.json()).length:0;}).toBe(1);
 await page.reload();await expect(page.getByText('The local model explains that photosynthesis happens in chloroplasts.',{exact:true})).toHaveCount(1);expect(serverCalls).toBe(0);
});


test('faculty generates offline and synchronizes a reviewed lesson without server inference',async({page,context})=>{
 const tokens=await signIn(page,'faculty','/manage/offline-ai');await model(page,'/manage/offline-ai');
 const headers={Authorization:`Bearer ${tokens.access}`};
 let aiRequests=0;page.on('request',r=>{if(r.method()==='POST'&&/\/(?:lesson|auto-quiz|lessons|auto-quizzes)\/$/.test(r.url()))aiRequests++;});
 await page.goto(`/manage/local-authoring/${fixture().module}`);
 await expect(page.getByText('Source ready · Changes saved automatically',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Show source',exact:true})).toBeVisible();
 await context.setOffline(true);
 await page.getByRole('button',{name:/^(Generate|Regenerate) lesson$/,exact:true}).click();
 await expect(page.getByRole('heading',{name:'Review lesson',exact:true})).toBeVisible();
 await page.reload();await expect(page.getByRole('heading',{name:'Review lesson',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Approve and synchronize lesson',exact:true}).click();
 await expect(page.getByText('Waiting to synchronize',{exact:true})).toBeVisible();
 await context.setOffline(false);
 await expect(page.getByText('Received by institution',{exact:true})).toBeVisible({timeout:45000});
 const result=await page.request.get(`/api/faculty/modules/${fixture().module}/lesson/`,{headers});
 expect(result.ok()).toBeTruthy();const lesson=await result.json();expect(lesson.model).toBe('device-local');expect(lesson.status).toBe('ready');expect(aiRequests).toBe(0);
 await page.reload();
 await expect(page.getByRole('heading',{name:'Institution lesson',exact:true})).toBeVisible();
 await context.setOffline(true);
 await page.getByRole('button',{name:'Generate quiz',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Review quiz',exact:true})).toBeVisible();
 await expect(page.getByText('Question 1 of 6',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Next question',exact:true}).click();
 await expect(page.getByText('Question 2 of 6',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Approve and synchronize quiz draft',exact:true}).click();
 await expect(page.getByText('Waiting to synchronize',{exact:true})).toBeVisible();
 await page.reload();await expect(page.getByRole('heading',{name:'Review quiz',exact:true})).toBeVisible();
 await context.setOffline(false);
 await expect(page.getByText('Received by institution',{exact:true})).toBeVisible({timeout:45000});expect(aiRequests).toBe(0);

});

test('staff conflict recovery preserves the previous draft across refresh',async({page,context})=>{
 const tokens=await signIn(page,'faculty','/manage/offline-ai');await model(page,'/manage/offline-ai');
 const headers={Authorization:`Bearer ${tokens.access}`},id=fixture().module;
 await page.goto(`/manage/local-authoring/${id}`);
 await expect(page.getByText('Source ready · Changes saved automatically',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Show source',exact:true})).toBeVisible();
 await page.getByRole('button',{name:/^(Generate|Regenerate) lesson$/,exact:true}).click();
 await expect(page.getByRole('heading',{name:'Review lesson',exact:true})).toBeVisible();
 const changed=fixture().source+' The faculty added a new source sentence.';
 const update=await page.request.patch(`/api/faculty/modules/${id}/`,{headers,data:{source_text:changed}});expect(update.ok(),await update.text()).toBeTruthy();
 await page.getByRole('button',{name:'Approve and synchronize lesson',exact:true}).click();
 await expect(page.getByText('Review needed',{exact:true})).toBeVisible();
 await context.setOffline(true);
 await page.getByRole('button',{name:'Refresh source and keep draft in history',exact:true}).click();
 await page.getByRole('button',{name:'Keep draft and refresh',exact:true}).click();
 await expect(page.getByText(/You are offline and this page has not been saved/)).toBeVisible();
 await expect(page.getByRole('heading',{name:'Review lesson',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Previous local drafts',exact:true})).toHaveCount(0);
 await context.setOffline(false);
 await page.getByRole('button',{name:'Refresh source and keep draft in history',exact:true}).click();
 await page.getByRole('button',{name:'Keep draft and refresh',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Review lesson',exact:true})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Previous local drafts',exact:true})).toBeVisible();
 await context.setOffline(true);await page.reload();
 await page.getByRole('button',{name:'Show source',exact:true}).click();
 await expect(page.getByText(changed,{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'View previous draft',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Previous lesson',exact:true})).toBeVisible();
 await expect(page.getByText('A local lesson about photosynthesis.',{exact:true})).toBeVisible();
});

test('staff imports a new book offline and synchronizes its source and reviewed lesson after refresh',async({page,context})=>{
 const tokens=await signIn(page,'faculty','/manage/offline-ai');await model(page,'/manage/offline-ai');
 await page.goto('/manage/local-books');
 await page.getByRole('button',{name:'Subject',exact:true}).click();
 await page.getByRole('menuitem',{name:/WEBTEST/}).click();
 await page.getByLabel('Book title',{exact:true}).fill('Device imported textbook');
 await context.setOffline(true);
 await pick(page,'Choose book',{name:'local-book.pdf',mimeType:'application/pdf',buffer:fs.readFileSync('test-results/private-fixture.pdf')});
 await expect(page.getByRole('heading',{name:'Device imported textbook',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Open module',exact:true}).first().click();
 await page.getByRole('button',{name:'Show source',exact:true}).click();
 await expect(page.getByText('Photosynthesis happens in the chloroplasts of green leaves.',{exact:true}).first()).toBeVisible();
 await page.getByRole('button',{name:/^(Generate|Regenerate) lesson$/,exact:true}).click();
 await expect(page.getByRole('heading',{name:'Review lesson',exact:true})).toBeVisible({timeout:30000});
 await page.getByRole('button',{name:'Approve and synchronize lesson',exact:true}).click();
 await expect(page.getByText('Waiting to synchronize',{exact:true})).toBeVisible();
 await page.reload();
 await expect(page.getByRole('heading',{name:'Review lesson',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Open local book synchronization',exact:true}).click();
 await page.getByRole('button',{name:'Review and synchronize book draft',exact:true}).click();
 await page.getByRole('button',{name:'Synchronize draft',exact:true}).click();
 await expect(page.getByRole('button',{name:'Retry book synchronization',exact:true})).toBeVisible();
 const sentOffsets:number[]=[];let lostAcknowledgement=false;
 await page.route('**/api/faculty/local-books/transfers/',async route=>{
  const response=await route.fetch(),body=await response.json();
  await route.fulfill({response,json:{...body,chunk_bytes:256}});
 });
 await page.route(/\/api\/faculty\/local-books\/transfers\/[a-f0-9-]+\/$/,async route=>{
  if(route.request().method()!=='POST'){await route.continue();return;}
  const raw=route.request().postDataBuffer()!.toString();
  const offset=Number(raw.match(/name="offset"\r\n\r\n(\d+)/)?.[1]);sentOffsets.push(offset);
  const response=await route.fetch();
  if(!lostAcknowledgement){lostAcknowledgement=true;await route.abort('failed');}else await route.fulfill({response});
 });
 await context.setOffline(false);
 await page.getByRole('button',{name:'Retry book synchronization',exact:true}).click();
 await expect.poll(()=>lostAcknowledgement).toBeTruthy();
 await page.reload();
 await expect(page.getByRole('button',{name:'Open institutional review',exact:true})).toBeVisible({timeout:50000});
 expect(sentOffsets[0]).toBe(0);expect(sentOffsets[1]).toBe(256);expect(sentOffsets.filter(n=>n===0)).toHaveLength(1);
 const headers={Authorization:`Bearer ${tokens.access}`};
 const documents=await page.request.get('/api/faculty/documents/',{headers});const payload=await documents.json();
 const rows=Array.isArray(payload)?payload:payload.results;
 const matching=rows.filter((d:any)=>d.title==='Device imported textbook');expect(matching).toHaveLength(1);expect(matching[0].status).toBe('under_review');
 await page.getByRole('button',{name:'Open module',exact:true}).first().click();
 await expect(page.getByText('Received by institution',{exact:true})).toBeVisible({timeout:25000});
 await context.setOffline(true);await page.reload();
 await expect(page.getByRole('heading',{name:'Review lesson',exact:true})).toBeVisible();
});

test('staff batch generates offline, survives navigation and skips completed drafts on restart',async({page,context})=>{
 await signIn(page,'faculty','/manage/offline-ai');await model(page,'/manage/offline-ai');
 const serverGeneration:string[]=[];
 page.on('request',request=>{if(request.method()==='POST'&&/\/api\/faculty\/.*(lessons|auto-quizzes|generate)/.test(request.url()))serverGeneration.push(request.url());});
 await page.goto(`/manage/local-batch?document=${fixture().document}`);
 await expect(page.getByRole('button',{name:'Review draft',exact:true})).toHaveCount(2);
 await context.setOffline(true);
 await page.getByRole('button',{name:'Generate missing lessons',exact:true}).click();
 await page.getByRole('button',{name:'Review draft',exact:true}).first().click();
 await expect(page).toHaveURL(/manage\/local-authoring/);
 await page.getByRole('button',{name:'Prepare book',exact:true}).click();
 await expect(page).toHaveURL(/manage\/local-batch/);
 await expect(page.getByText(/Lesson saved · Quiz missing/)).toHaveCount(2,{timeout:30000});
 await page.reload();
 await expect(page.getByText(/Lesson saved · Quiz missing/)).toHaveCount(2);
 await page.evaluate(()=>{(window as any).__LM_TEST_FAIL_ONCE__=true;});
 // No inference should be made for a batch whose drafts are already complete.
 await page.getByRole('button',{name:'Generate missing lessons',exact:true}).click();
 await expect(page.getByText('Saved on this device',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__LM_TEST_FAIL_ONCE__)).toBe(true);
 await page.evaluate(()=>{(window as any).__LM_TEST_FAIL_ONCE__=false;});
 await page.getByRole('button',{name:'Generate missing quizzes',exact:true}).click();
 await expect(page.getByText(/Lesson saved · Quiz saved/)).toHaveCount(2,{timeout:30000});
 expect(serverGeneration).toEqual([]);
});


test('staff source saves automatically and missing model blocks generation before a job starts',async({page})=>{
 await signIn(page,'faculty',`/manage/local-authoring/${fixture().module}`);
 await expect(page.getByText('Source ready · Changes saved automatically',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Save module on this device',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:/^(Generate|Regenerate) lesson$/,exact:true})).toBeDisabled();
 await expect(page.getByText('Set up AI before generating',{exact:true})).toBeVisible();
 await page.reload();
 await expect(page.getByText('Source ready · Changes saved automatically',{exact:true})).toBeVisible();
 await expect(page.getByText('Failed',{exact:true})).toHaveCount(0);
});


test('opening the institutional book automatically prepares its modules',async({page})=>{
 const source=page.waitForResponse(r=>r.url().includes(`/modules/${fixture().module}/local-authoring/`)&&r.ok());
 await signIn(page,'faculty',`/manage/document/${fixture().document}`);
 await source;
 await page.goto(`/manage/local-authoring/${fixture().module}`);
 await expect(page.getByText('Source ready · Changes saved automatically',{exact:true})).toBeVisible();
});

test('Create Quiz uses device inference and syncs a reviewed multi-module draft after an offline refresh',async({page,context})=>{
 const tokens=await signIn(page,'faculty','/manage/offline-ai');await model(page,'/manage/offline-ai');
 const serverCalls:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/quizzes/generate/'))serverCalls.push(r.url());});
 await page.goto('/manage/quiz/new');
 await page.getByLabel('Quiz title',{exact:true}).fill('Device selection quiz');
 await page.getByRole('checkbox',{name:'Leaf science',exact:true}).click();
 await page.getByRole('checkbox',{name:'Open practice',exact:true}).click();
 await page.getByLabel('Multiple-choice questions',{exact:true}).fill('2');
 await page.evaluate(()=>{(window as any).__LM_TEST_DELAY__=700;});
 await page.getByRole('button',{name:'Continue to questions',exact:true}).click();
 await expect(page).toHaveURL(/manage\/local-quizzes\?id=/);
 await context.setOffline(true);
 await expect(page.getByText('2 of 2 questions saved · 2 source modules',{exact:true})).toBeVisible();
 await page.reload();
 await expect(page.getByText('2 of 2 questions saved · 2 source modules',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Approve and synchronize quiz',exact:true}).click();
 await expect(page.getByRole('button',{name:'Retry synchronization',exact:true})).toBeVisible();
 await page.reload();
 await context.setOffline(false);
 await expect(page.getByRole('button',{name:'Open quiz settings and publish',exact:true})).toBeVisible({timeout:45000});
 const response=await page.request.get('/api/faculty/quizzes/',{headers:{Authorization:`Bearer ${tokens.access}`}});expect(response.ok()).toBeTruthy();
 const body=await response.json(),rows=Array.isArray(body)?body:body.results;
 expect(rows.filter((q:any)=>q.title==='Device selection quiz')).toHaveLength(1);
 expect(serverCalls).toEqual([]);
});

test('faculty can release held results from quiz settings',async({page})=>{
 await signIn(page,'faculty',`/manage/quiz/${fixture().quizHeld}?tab=settings`);
 await expect(page.getByRole('button',{name:'Release results now',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Release results now',exact:true}).click();
 await page.getByRole('button',{name:'Release results',exact:true}).click();
 await expect(page.getByText('Results have been released. Students receive them when connected and synchronized.',{exact:true})).toBeVisible();
 await page.reload();
 await expect(page.getByRole('button',{name:'Release results now',exact:true})).toHaveCount(0);
});

 test('app files and course content prepare automatically without setup buttons',async({page,context})=>{
 await signIn(page,'student','/student/offline-ai');
 await expect(page.getByText('Application files saved automatically. Ready to reopen offline.',{exact:true})).toBeVisible({timeout:120000});
 await page.goto('/student/offline');
 await expect(page.getByText('Your course copy is saved.',{exact:true})).toBeVisible();
 await context.setOffline(true);
 await page.goto(`/student/module/${fixture().autoModule}?tab=lesson`);
 await expect(page.getByText('This lesson was prepared by the institution before download.',{exact:true})).toBeVisible();
 await page.reload();
 await expect(page.getByText('This lesson was prepared by the institution before download.',{exact:true})).toBeVisible();
 });

for (const role of ['student','faculty']) {
 test(role+' assignment links retire to quizzes without trapping navigation',async({page})=>{
  const area=role==='student'?'student':'manage';
  const requests:string[]=[];
  page.on('request',r=>{if(r.url().includes('/api/')&&r.url().includes('assignments'))requests.push(r.url());});
  await signIn(page,role,'/'+area);
  await expect(page.getByText('Assignments',{exact:true})).toHaveCount(0);
  expect(requests).toEqual([]);
  for(const path of ['assignments','assignment/00000000-0000-0000-0000-000000000001',...(area==='manage'?['assignment/new','submission/00000000-0000-0000-0000-000000000001']:[])]){
   await page.goto('/'+area+'/'+path);
   await expect(page).toHaveURL(new RegExp('/'+area+'/quizzes$'));
  }
  await page.getByText('Overview',{exact:true}).first().click();
  await expect(page).toHaveURL(new RegExp('/'+area+'/?$'));
  await expect(page.getByText('Assignments',{exact:true})).toHaveCount(0);
 });
}


test('faculty upload uses content headings and opens the existing outline editor',async({page})=>{
 await signIn(page,'faculty',`/manage/document/upload?subject=${fixture().subject}`);
 await expect(page.getByRole('heading',{name:'Let’s add a book.',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Review and synchronize book draft',exact:true})).toHaveCount(0);
 await page.getByLabel('Book title',{exact:true}).fill('Content outline regression');
 await pick(page,'Choose file',{name:'outline-upload.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:fs.readFileSync('test-results/outline-upload.docx')});
 const uploaded=page.waitForResponse(r=>r.url().endsWith('/api/faculty/documents/')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Upload and process',exact:true}).click();
 const response=await uploaded;expect(response.status(),await response.text()).toBe(201);
 const document=await response.json();expect(document.outline_strategy).toBe('source');
 await expect(page).toHaveURL(new RegExp(`/manage/document/${document.id}$`));
 await expect(page.getByText('Book outline',{exact:true})).toBeVisible({timeout:60000});
 await expect(page.getByLabel('Module title',{exact:true})).toHaveValue('Energy and living systems');
 await expect(page.getByLabel('Source text',{exact:true})).toHaveValue(/restored upload regression/);
 await expect(page.getByText(/Page 1 · Part/)).toHaveCount(0);
 await page.reload();
 await expect(page.getByLabel('Module title',{exact:true})).toHaveValue('Energy and living systems');
 await page.goto('/manage/books');
 await page.getByLabel('Search books',{exact:true}).fill('outline-upload');
 await page.getByRole('button',{name:'Remove book',exact:true}).click();
 await expect(page.getByText('Remove this book?',{exact:true})).toBeVisible();
 const deleted=page.waitForResponse(r=>r.url().includes(`/api/faculty/documents/${document.id}/`)&&r.request().method()==='DELETE');
 await page.getByRole('button',{name:'Remove book',exact:true,disabled:false}).click();
 expect((await deleted).ok()).toBeTruthy();
 await expect(page.getByRole('button',{name:'Remove book',exact:true})).toHaveCount(0);
 await expect(page).toHaveURL(/\/manage\/books$/);
});

test('book readiness distinguishes missing generation from missing text and prepares device drafts automatically',async({page})=>{
 await signIn(page,'faculty',`/manage/document/${fixture().document}?tab=lessons`);
 await expect(page.getByText('1 of 2 institution lessons are ready.',{exact:true})).toBeVisible();
 await expect(page.getByText('No text',{exact:true})).toHaveCount(0);
 await expect(page.getByText('Model setup required',{exact:true})).toHaveCount(3);
 await model(page,'/manage/offline-ai');
 const central:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&/\/api\/faculty\/.*(lessons|auto-quizzes|generate)/.test(r.url()))central.push(r.url());});
 await page.goto(`/manage/document/${fixture().document}?tab=lessons`);
 await expect(page.getByText('Ready for review',{exact:true})).toHaveCount(3,{timeout:60000});
 expect(central).toEqual([]);
 await page.reload();
 await expect(page.getByText('Ready for review',{exact:true})).toHaveCount(3);
});


test('automatic book preparation continues after a module timeout',async({page})=>{
 await signIn(page,'faculty','/manage/offline-ai');await model(page,'/manage/offline-ai');
 await page.addInitScript(()=>{(window as any).__LM_TEST_FAIL_AT__=1;});
 await page.goto(`/manage/document/${fixture().document}?tab=lessons`);
 await expect(page.getByText('Ready for review',{exact:true})).toHaveCount(2,{timeout:60000});
 await expect(page.getByText('Failed',{exact:true})).toHaveCount(1);
 await expect(page.getByText(/simulated interruption/).first()).toBeVisible();
 await page.getByRole('menuitem',{name:'Subjects',exact:true}).click();
 await expect(page).toHaveURL(/\/manage\/subjects/);
});


test('module authoring returns to the selected book outline',async({page})=>{
 await signIn(page,'faculty',`/manage/local-authoring/${fixture().module}`);
 await page.getByRole('button',{name:'Back to outline',exact:true}).click();
 await expect(page).toHaveURL(new RegExp(`/manage/document/${fixture().document}\\?tab=outline&module=${fixture().module}`));
 await expect(page.getByLabel('Module title',{exact:true})).toHaveValue('Leaf science');
});

test('books list confirms removal and stays on the list when cancelled',async({page})=>{
 await signIn(page,'faculty','/manage/books');
 const row=page.getByText('Faculty Biology',{exact:true});
 await expect(row).toBeVisible();
 await page.getByRole('button',{name:'Remove book',exact:true}).first().click();
 await expect(page.getByText('Remove this book?',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(page).toHaveURL(/\/manage\/books$/);
 await expect(row).toBeVisible();
});
