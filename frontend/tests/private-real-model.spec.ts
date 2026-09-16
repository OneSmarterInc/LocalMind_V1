import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

// A supplied file makes repeated runs use the same model bytes.
const modelFile=process.env.LM_E2E_MODEL_FILE;
let report: Record<string,unknown>;
let stageStarted=0;
function stage(name:string) {
 if(report.stage) report[`${report.stage}ElapsedMs`]=Date.now()-stageStarted;
 report.stage=name;stageStarted=Date.now();
}
test.afterEach(async({},info)=>{
 if(!report)return;
 report[`${report.stage}ElapsedMs`]=Date.now()-stageStarted;
 report.status=info.status;
 report.errors=info.errors.map(error=>error.message);
 const output=info.outputPath('real-model-timings.json');
 fs.mkdirSync(path.dirname(output),{recursive:true});
 fs.writeFileSync(output,JSON.stringify(report,null,2));
 await info.attach('real-model-timings',{path:output,contentType:'application/json'});
});

test('real GGUF: offline restart, new doubt, lesson and generated quiz',async({page,context})=>{
 test.setTimeout(1600000);
 report={startedAt:new Date().toISOString(),modelFile:modelFile?path.basename(modelFile):'Application catalog default (browser download)',
  os:{platform:os.platform(),release:os.release(),architecture:os.arch(),totalMemoryBytes:os.totalmem(),cpu:os.cpus()[0]?.model},
  commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  uncommittedChanges:Boolean(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()),
  scope:'Desktop Playwright Chromium; does not verify a physical phone'};
 stage('modelPreflight');
 if(modelFile){
 const fd=fs.openSync(modelFile,'r');
 const magic=Buffer.alloc(4);
 try { fs.readSync(fd,magic,0,4,0); } finally { fs.closeSync(fd); }
 expect(magic.toString('ascii'),'Model must be a GGUF file').toBe('GGUF');
 const hash=createHash('sha256');
 for await(const chunk of fs.createReadStream(modelFile))hash.update(chunk);
 report.modelSha256=hash.digest('hex');report.modelBytes=fs.statSync(modelFile).size;
 }
 stage('setup');
 const f=JSON.parse(fs.readFileSync('test-results/fixture.json','utf8'));
 const login=await page.request.post('/api/auth/login/student/',{data:{email:'browser-student@example.edu',password:f.password}});
 expect(login.ok()).toBeTruthy();const tokens=await login.json();
 await page.addInitScript(v=>{if(!localStorage.getItem('localmind.access')){localStorage.setItem('localmind.access',v.access);localStorage.setItem('localmind.refresh',v.refresh);if(v.session_id)localStorage.setItem('localmind.session',v.session_id);}},tokens);
 await page.goto('/student/offline-ai');
 report.browser=await page.evaluate(()=>({userAgent:navigator.userAgent,
  hardwareConcurrency:navigator.hardwareConcurrency,crossOriginIsolated,
  sharedArrayBuffer:typeof SharedArrayBuffer!=='undefined'}));
 if(modelFile){
 const modelChooser=page.waitForEvent('filechooser');
 await page.getByRole('button',{name:'Import a .gguf file',exact:true}).click();
 await(await modelChooser).setFiles(modelFile);
 }else{
  await page.getByRole('button',{name:/^Download model/}).click();
  await page.getByRole('button',{name:'Download',exact:true}).click();
 }
 await expect(page.getByText('Downloaded',{exact:true})).toBeVisible({timeout:600000});
 // Automatic app preparation is part of the actual user flow.
 await expect(page.getByText(/Application files saved/).first()).toBeVisible({timeout:120000});
 await page.goto('/student/private-library');
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload my book',exact:true}).click();
 await(await chooser).setFiles({name:'Real model biology.txt',mimeType:'text/plain',buffer:Buffer.from('Photosynthesis happens in the chloroplasts of green leaves. Chlorophyll absorbs sunlight. Plants use light energy to convert carbon dioxide and water into glucose and oxygen. Roots absorb water from the soil. The glucose provides stored chemical energy. Oxygen is released through tiny pores in the leaves called stomata.')});
 await page.getByText('Real model biology',{exact:true}).click();
 await expect(page.getByText('All modules open',{exact:true})).toBeVisible();
 await context.setOffline(true);await page.reload();
 stage('doubt');
 const started=Date.now();
 await page.getByRole('tab',{name:'Ask a doubt',exact:true}).click();
 await page.getByLabel('Your question',{exact:true}).fill('Where does photosynthesis happen?');
 await page.getByRole('button',{name:'Ask local AI',exact:true}).click();
 await expect(page.getByText(/From the book:/)).toBeVisible({timeout:240000});
 const doubtMs=Date.now()-started;report.doubtMs=doubtMs;console.log('Offline doubt completed:',doubtMs,'ms');
 await page.screenshot({path:'test-results/real-browser-offline-model.png',fullPage:true});
 await page.getByRole('tab',{name:'Lesson',exact:true}).click();
 stage('lesson');
 const lessonStart=Date.now();await page.getByRole('button',{name:'Generate lesson',exact:true}).click();
 await expect(page.getByRole('button',{name:'Saved lesson',exact:true})).toContainText('Version 1',{timeout:240000});
 await expect(page.getByText('Key takeaways',{exact:true})).toBeVisible();
 const lessonMs=Date.now()-lessonStart;report.lessonMs=lessonMs;console.log('Offline lesson completed:',lessonMs,'ms');
 await page.screenshot({path:'test-results/real-browser-offline-lesson.png',fullPage:true});
 await page.getByRole('tab',{name:'Practice quiz',exact:true}).click();
 await page.getByRole('button',{name:'Questions',exact:true}).click();await page.getByRole('menuitem',{name:'1',exact:true}).click();
 stage('quiz');
 const quizStart=Date.now();await page.getByRole('button',{name:'Generate quiz',exact:true}).click();
 await expect(page.getByRole('radio')).toHaveCount(4,{timeout:240000});
 const quizMs=Date.now()-quizStart;console.log('Offline quiz completed:',quizMs,'ms');
 report.oneQuestionMs=quizMs;
 stage('offlineQuizScoring');
 await page.getByRole('radio').first().click();await page.getByRole('button',{name:'Check my answers',exact:true}).click();
 await expect(page.getByText(/^[01] of 1 correct$/)).toBeVisible();
 await expect(page.getByText(/From the book:/)).toBeVisible();
 await page.screenshot({path:'test-results/real-browser-offline-quiz.png',fullPage:true});
 stage('completed');
});
