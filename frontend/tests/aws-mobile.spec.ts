import {test, expect, type Page} from '@playwright/test';
import fs from 'node:fs';

const fixture = () => JSON.parse(fs.readFileSync('test-results/fixture.json', 'utf8'));

async function signIn(page: Page, role: 'admin' | 'student', path: string) {
  const response = await page.request.post(`/api/auth/login/${role}/`, {
    data: {email: `browser-${role}@example.edu`, password: fixture().password},
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.addInitScript(tokens => {
    if (sessionStorage.getItem('integration-session')) return;
    localStorage.setItem('localmind.access', tokens.access);
    localStorage.setItem('localmind.refresh', tokens.refresh);
    if (tokens.session_id) localStorage.setItem('localmind.session', tokens.session_id);
    sessionStorage.setItem('integration-session', 'set');
  }, await response.json());
  await page.goto(path);
}

async function pick(page: Page, button: string, name: string, text: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', {name: button, exact: true}).click();
  await (await chooser).setFiles({name, mimeType: 'application/octet-stream', buffer: Buffer.from(text)});
}

test('AWS shared-book upload persists and is visible after reload', async ({page}) => {
  await signIn(page, 'admin', '/manage/private-library');
  await page.getByLabel('Book title', {exact: true}).fill('Integration shared notes');
  await pick(page, 'Choose book file', 'integration.txt', fixture().source);
  await page.getByRole('button', {name: 'Upload and share book', exact: true}).click();
  await page.getByRole('button', {name: 'Upload and share', exact: true}).click();
  await expect(page.getByText('Integration shared notes', {exact: true})).toBeVisible();
  await page.reload();
  await expect(page.getByText('Integration shared notes', {exact: true})).toBeVisible();
});

test('web module workflow generates lessons and quizzes and answers doubts offline', async ({page, context}) => {
  await signIn(page, 'student', '/student/offline-ai');
  await pick(page, 'Import a .gguf file', 'integration.gguf', 'GGUFunit-test-model-not-real-inference');
  await expect(page.getByText('Downloaded', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Check and save offline app files', exact: true}).click();
  await expect(page.getByText(/Application files saved/).first()).toBeVisible();
  await page.goto('/student/private-library');
  await pick(page, 'Upload my book', 'Integration biology.md', '# Leaf science\n' + fixture().source);
  await page.getByText('Integration biology', {exact: true}).click();
  await page.getByRole('button', {name: /^Open module 1:/}).click();
  const apiPosts: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().includes('/api/')) apiPosts.push(request.url());
  });
  await page.getByRole('tab', {name: 'Lesson', exact: true}).click();
  await page.getByRole('button', {name: 'Generate lesson', exact: true}).click();
  await expect(page.getByText('A local lesson about photosynthesis.', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Regenerate lesson', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Saved lesson'})).toContainText('Version 2');
  await page.getByRole('tab', {name: 'Practice quiz', exact: true}).click();
  await page.getByRole('button', {name: 'Questions', exact: true}).click();
  await page.getByRole('menuitem', {name: '1', exact: true}).click();
  await page.getByRole('button', {name: 'Generate quiz', exact: true}).click();
  await page.getByRole('radio', {name: 'A. Chloroplasts', exact: true}).click();
  await expect(page.getByText('Answers saved on this device', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Check my answers', exact: true}).click();
  await expect(page.getByText('1 of 1 correct', {exact: true})).toBeVisible();
  expect(apiPosts, 'Private generation must stay on the device').toEqual([]);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', {name: /^Open module 1:/}).click();
  await page.getByRole('tab', {name: 'Practice quiz', exact: true}).click();
  await expect(page.getByRole('radio', {name: 'A. Chloroplasts', exact: true})).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('tab', {name: 'Lesson', exact: true}).click();
  await expect(page.getByText('A local lesson about photosynthesis.', {exact: true})).toBeVisible();
  await page.getByRole('tab', {name: 'Ask a doubt', exact: true}).click();
  await page.getByLabel('Your question', {exact: true}).fill('Where does photosynthesis happen?');
  await page.getByRole('button', {name: 'Ask local AI', exact: true}).click();
  await expect(page.getByText('The local model explains that photosynthesis happens in chloroplasts.', {exact: true})).toBeVisible();
  expect(apiPosts).toEqual([]);
});
