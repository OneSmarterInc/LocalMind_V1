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
export async function model(page:Page){
 await page.goto('/student/offline-ai');await expect(page.getByText('Model on this device',{exact:true})).toBeVisible();
 await pick(page,'Import a .gguf file',{name:'browser-fixture.gguf',mimeType:'application/octet-stream',buffer:Buffer.from('GGUFunit-test-model-not-real-inference')});
 await expect(page.getByText('Downloaded',{exact:true})).toBeVisible();
 // A model file alone is not the offline application. Complete the same setup
 // the user is prompted to complete before disconnecting.
 await page.getByRole('button',{name:'Check and save offline app files',exact:true}).click();
 await expect(page.getByText(/Application files saved/)).toBeVisible();
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
  await expect(page.getByText('Ask about this module. If the server disconnects, the installed local model can answer from your downloaded source.',{exact:true})).toBeVisible({timeout:35000});
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
