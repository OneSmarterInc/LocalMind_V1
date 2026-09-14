import {test,expect} from '@playwright/test';
import fs from 'node:fs';

test('real GGUF: offline restart, new doubt, lesson and generated quiz',async({page,context})=>{
 test.setTimeout(1100000);
 const f=JSON.parse(fs.readFileSync('test-results/fixture.json','utf8'));
 const login=await page.request.post('/api/auth/login/student/',{data:{email:'browser-student@example.edu',password:f.password}});
 expect(login.ok()).toBeTruthy();const tokens=await login.json();
 await page.addInitScript(v=>{if(!localStorage.getItem('localmind.access')){localStorage.setItem('localmind.access',v.access);localStorage.setItem('localmind.refresh',v.refresh);}},tokens);
 await page.goto('/student/offline-ai');
 if(process.env.LM_E2E_MODEL_FILE){
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Import a .gguf file',exact:true}).click();await(await chooser).setFiles(process.env.LM_E2E_MODEL_FILE);
 }else{
  await page.getByRole('button',{name:/^Download model/}).click();await page.getByRole('button',{name:'Download',exact:true}).click();
 }
 await expect(page.getByText('Downloaded',{exact:true})).toBeVisible({timeout:600000});
 await page.getByRole('button',{name:'Check and save offline app files',exact:true}).click();
 await expect(page.getByText(/Application files saved/)).toBeVisible();
 await page.goto('/student/private-library');
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload my book',exact:true}).click();
 await(await chooser).setFiles({name:'Real model biology.txt',mimeType:'text/plain',buffer:Buffer.from('Photosynthesis happens in the chloroplasts of green leaves. Chlorophyll absorbs sunlight. Plants use light energy to convert carbon dioxide and water into glucose and oxygen. Roots absorb water from the soil. The glucose provides stored chemical energy. Oxygen is released through tiny pores in the leaves called stomata.')});
 await page.getByText('Real model biology',{exact:true}).click();
 await expect(page.getByText('All modules open',{exact:true})).toBeVisible();
 await context.setOffline(true);await page.reload();
 const started=Date.now();
 await page.getByRole('tab',{name:'Ask a doubt',exact:true}).click();
 await page.getByLabel('Your question',{exact:true}).fill('Where does photosynthesis happen?');
 await page.getByRole('button',{name:'Ask local AI',exact:true}).click();
 await expect(page.getByText(/From the book:/)).toBeVisible({timeout:240000});
 const doubtMs=Date.now()-started;console.log('Offline doubt completed:',doubtMs,'ms');
 await page.screenshot({path:'test-results/real-browser-offline-model.png',fullPage:true});
 await page.getByRole('tab',{name:'Lesson',exact:true}).click();
 const lessonStart=Date.now();await page.getByRole('button',{name:'Generate lesson',exact:true}).click();
 await expect(page.getByRole('button',{name:'Saved lesson',exact:true})).toContainText('Version 1',{timeout:240000});
 await expect(page.getByText('Key takeaways',{exact:true})).toBeVisible();
 const lessonMs=Date.now()-lessonStart;console.log('Offline lesson completed:',lessonMs,'ms');
 await page.screenshot({path:'test-results/real-browser-offline-lesson.png',fullPage:true});
 await page.getByRole('tab',{name:'Practice quiz',exact:true}).click();
 await page.getByRole('button',{name:'Questions',exact:true}).click();await page.getByRole('menuitem',{name:'1',exact:true}).click();
 const quizStart=Date.now();await page.getByRole('button',{name:'Generate quiz',exact:true}).click();
 await expect(page.getByRole('radio')).toHaveCount(4,{timeout:240000});
 const quizMs=Date.now()-quizStart;console.log('Offline quiz completed:',quizMs,'ms');
 await page.getByRole('radio').first().click();await page.getByRole('button',{name:'Check my answers',exact:true}).click();
 await expect(page.getByText(/^[01] of 1 correct$/)).toBeVisible();
 await expect(page.getByText(/From the book:/)).toBeVisible();
 await page.screenshot({path:'test-results/real-browser-offline-quiz.png',fullPage:true});
 fs.writeFileSync('test-results/real-model-timings.json',JSON.stringify({model:'Qwen3-0.6B-Q8_0',modelSetup:process.env.LM_E2E_MODEL_FILE?'Imported verified local file':'Downloaded in browser',runner:'Linux Chromium; not a target phone',doubtMs,lessonMs,oneQuestionMs:quizMs},null,2));
});
