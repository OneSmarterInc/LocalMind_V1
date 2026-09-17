import {test,expect,type Page} from '@playwright/test';
import fs from 'node:fs';
import {MODEL} from '../src/private/modelSpec';

const fixture=()=>JSON.parse(fs.readFileSync('test-results/fixture.json','utf8'));

async function signIn(page:Page){
 const r=await page.request.post('/api/auth/login/student/',{data:{email:'browser-student@example.edu',password:fixture().password}});
 expect(r.ok(),await r.text()).toBeTruthy();const tokens=await r.json();
 await page.addInitScript(t=>{
  if(!sessionStorage.getItem('quiz-stability-session')){
   localStorage.setItem('localmind.access',t.access);localStorage.setItem('localmind.refresh',t.refresh);
   if(t.session_id)localStorage.setItem('localmind.session',t.session_id);
   sessionStorage.setItem('quiz-stability-session','set');
  }
 },tokens);
}

async function pick(page:Page,button:string,file:{name:string;mimeType:string;buffer:Buffer}){
 const chooser=page.waitForEvent('filechooser');
 await page.getByRole('button',{name:button,exact:true}).click();
 await(await chooser).setFiles(file);
}

async function setupModel(page:Page){
 await page.goto('/student/offline-ai');
 await pick(page,'Import a .gguf file',{name:'browser-fixture.gguf',mimeType:'application/octet-stream',buffer:Buffer.from('GGUFunit-test-model-not-real-inference')});
 await expect(page.getByText('Downloaded',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Check and save offline app files',exact:true}).click();
 await expect(page.getByText(/Application files saved/)).toBeVisible();
}

test('rich six-question quiz automatically recovers from repeated local-model candidates',async({page})=>{
 expect(MODEL.name).toBe('Qwen3-1.7B-Q4_K_M.gguf');
 expect(MODEL.bytes).toBe(1107409280);
 expect(MODEL.sha256).toBe('8f6da508f16926c49196d1bf8faecb47aef679227bc69a1d0bc9081c37b15e99');

 await signIn(page);await setupModel(page);await page.goto('/student/private-library');
 const source=`# Photosynthesis and plant transport\n
Photosynthesis occurs in chloroplasts in green plant cells. Chlorophyll absorbs light energy from sunlight. Plants use that energy to convert carbon dioxide and water into glucose and oxygen. Carbon dioxide enters leaves through stomata. Oxygen can leave through the same pores. Roots absorb water from the soil. Xylem carries water upward through the plant. Phloem transports sugars to tissues that need or store energy. Glucose stores chemical energy made during photosynthesis. Guard cells regulate the opening of stomata. Light intensity can affect the rate of photosynthesis. Carbon dioxide availability can also limit the rate. Temperature influences the enzyme-controlled reactions involved in photosynthesis. Leaves are broad so they can expose a large surface area to light. A network of veins helps move water and sugars through each leaf.`;
 await pick(page,'Upload my book',{name:'Rich quiz source.md',mimeType:'text/markdown',buffer:Buffer.from(source)});
 await page.getByText('Rich quiz source',{exact:true}).click();
 await expect(page.getByText('All modules open',{exact:true})).toBeVisible();

 await page.evaluate(()=>{(window as any).__LM_TEST_REPEAT_DUPLICATES__=true;(window as any).__LM_TEST_CALLS__=0;});
 await page.getByRole('tab',{name:'Practice quiz',exact:true}).click();
 await page.getByRole('button',{name:'Questions',exact:true}).click();
 await page.getByRole('menuitem',{name:'6',exact:true}).click();
 await page.getByRole('button',{name:'Generate quiz',exact:true}).click();

 await expect(page.getByRole('radio')).toHaveCount(24,{timeout:90000});
 await expect(page.getByText(/repeated a question/i)).toHaveCount(0);
 await expect(page.getByText('Practice 6: where does photosynthesis happen?')).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__LM_TEST_CALLS__)).toBeGreaterThan(6);
 await expect(page.getByRole('button',{name:'Saved quiz'})).toContainText('6 questions');
});
