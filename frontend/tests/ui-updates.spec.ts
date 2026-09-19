import {test,expect,Page} from '@playwright/test';
import fs from 'node:fs';
const fixture=()=>JSON.parse(fs.readFileSync('test-results/fixture.json','utf8'));
async function login(page:Page,role:string,path:string){
 const response=await page.request.post(`/api/auth/login/${role}/`,{data:{email:`browser-${role}@example.edu`,password:fixture().password}});expect(response.ok()).toBeTruthy();const tokens=await response.json();
 await page.addInitScript(t=>{if(!sessionStorage.getItem('ui-login')){localStorage.setItem('localmind.access',t.access);localStorage.setItem('localmind.refresh',t.refresh);if(t.session_id)localStorage.setItem('localmind.session',t.session_id);sessionStorage.setItem('ui-login','yes');}},tokens);
 await page.goto(path);return tokens;
}
test('admin header, sidebar, audit modal and retired status route',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await login(page,'admin','/admin');await expect(page.getByText('A clear view of your platform.')).toBeVisible();
 await expect(page.getByRole('button',{name:'Find a page',exact:true})).toHaveCount(0);
 await expect(page.getByText('System status',{exact:true})).toHaveCount(0);
 await page.keyboard.press('Control+k');await expect(page.getByText('Find a page',{exact:true})).toHaveCount(0);
 await page.goto('/admin/audit');await page.getByRole('button',{name:'Details',exact:true}).first().click();
 await expect(page.getByText('Audit details',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Close',exact:true}).click();
 await expect(page.getByText('Audit details',{exact:true})).toHaveCount(0);
 await page.goto('/admin/system');await expect(page).toHaveURL(/\/admin$/);
 await expect(page.getByText('A clear view of your platform.')).toBeVisible();await page.screenshot({path:'test-results/ui-admin.png',fullPage:true});expect(errors).toEqual([]);
});
test('student module search is in book list; back and forward preserve navigation',async({page})=>{
 const f=fixture();await login(page,'student',`/student/document/${f.document}`);
 const search=page.getByLabel('Search book modules');await expect(search).toBeVisible();await search.fill('zz-no-module');await expect(page.getByText('Leaf science',{exact:true})).toHaveCount(0);await search.fill('');
 await page.getByRole('button',{name:'Continue Module 1',exact:true}).click();await expect(page).toHaveURL(/\/student\/module\//);
 await expect(page.getByText('Find a module',{exact:true})).toHaveCount(0);
 await page.goBack();await expect(page).toHaveURL(new RegExp(`/student/document/${f.document}`));await page.goForward();await expect(page).toHaveURL(/\/student\/module\//);
 await expect(page.getByText('About this module',{exact:true})).toBeVisible();await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/ui-mobile-module.png',fullPage:true});
});
test('quiz dates use explicit month-day-year and quiz list exposes delete',async({page})=>{
 const f=fixture();await login(page,'faculty',`/manage/quiz/${f.quizImmediate}?tab=settings`);
 const field=page.getByLabel('Available from',{exact:true});await expect(field).toBeVisible();await field.fill('09-21-2026 14:30');await expect(field).toHaveValue('09-21-2026 14:30');
 await field.fill('02-31-2026 14:30');await expect(field).toHaveAttribute('aria-invalid','true');await field.fill('');
 await page.goto('/manage/quizzes');await expect(page.getByRole('button',{name:'Delete',exact:true}).first()).toBeVisible();
 await page.screenshot({path:'test-results/ui-quizzes.png',fullPage:true});
});
test('module actions link to exact outline and enrolment action is outside table card',async({page})=>{
 const f=fixture();await login(page,'faculty',`/manage/subject/${f.subject}?tab=modules`);
 await page.getByRole('button',{name:'Edit',exact:true}).first().click();await expect(page).toHaveURL(/tab=outline.*module=/);
 await page.goto(`/manage/local-authoring/${f.module}`);await page.getByRole('button',{name:'Back to lessons & quizzes',exact:true}).click();await expect(page).toHaveURL(/tab=lessons.*module=/);
 await expect(page.getByRole('button',{name:'Open module',exact:true}).first()).toBeVisible();await page.screenshot({path:'test-results/ui-generation.png',fullPage:true});
});
test('completed quiz direct URL offers result instead of another start',async({page})=>{
 const f=fixture();const tokens=await login(page,'student','/student/quizzes');
 const headers={Authorization:`Bearer ${tokens.access}`};
 const started=await page.request.post(`/api/student/quizzes/${f.quizImmediate}/attempts/`,{headers});expect(started.ok()).toBeTruthy();
 const attempt=await started.json();
 const submitted=await page.request.post(`/api/student/quiz-attempts/${attempt.attempt_id}/submit/`,{headers,data:{submitted_answers:Object.fromEntries(attempt.questions.map((q:any)=>[q.id,'A']))}});expect(submitted.ok()).toBeTruthy();
 await page.goto(`/student/quiz/${f.quizImmediate}`);
 await expect(page.getByText('Submitted',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Start quiz',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'View result',exact:true}).click();
 await expect(page).toHaveURL(new RegExp(`/student/attempt/${attempt.attempt_id}`));
});
