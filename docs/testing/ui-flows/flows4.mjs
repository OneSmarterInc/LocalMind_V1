import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const ids = JSON.parse(fs.readFileSync("/tmp/flow_ids.json", "utf8"));
const st = JSON.parse(fs.readFileSync("/tmp/state_ids.json", "utf8"));
const r3 = JSON.parse(fs.readFileSync("/tmp/r3_ids.json", "utf8"));
const r4 = JSON.parse(fs.readFileSync("/tmp/r4_ids.json", "utf8"));
import { execSync } from "node:child_process";
const BASE = "http://127.0.0.1:8020";
const K = { access: "localmind.access", refresh: "localmind.refresh", session: "localmind.session" };
const creds = { student: "student2@localmind.test", faculty: "faculty1@localmind.test", admin: "admin@localmind.test" };
const browser = await puppeteer.launch({ protocolTimeout: 60000, args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function session(role) {
  const t = await fetch(`${BASE}/api/auth/login/${role}/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: creds[role], password: "Demo@12345" }) }).then((r) => r.json());
  const page = await browser.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((k, t) => { localStorage.clear(); localStorage.setItem(k.access, t.access); localStorage.setItem(k.refresh, t.refresh); if (t.session_id) localStorage.setItem(k.session, t.session_id); }, K, t);
  return page;
}
async function go(page, path) { await page.goto(`${BASE}${path}`, { waitUntil: "networkidle0", timeout: 30000 }); await sleep(600); }
async function click(page, text, { role = null, last = false } = {}) {
  const ok = await page.evaluate((text, role, last) => {
    const els = [...document.querySelectorAll('[role="button"],[role="tab"],[role="link"],[role="radio"],[role="checkbox"],[role="menuitem"],button,a')].filter((e) => {
      const clean = (s) => (s || "").replace(/[\uE000-\uF8FF]/g, "").replace(/\s+/g, " ").trim();
      const label = clean(e.getAttribute("aria-label") || e.innerText);
      return (label === text || clean(e.innerText) === text || clean(e.innerText).startsWith(text + " ")) && (!role || e.getAttribute("role") === role) && e.offsetParent !== null && e.getAttribute("aria-disabled") !== "true";
    });
    const clean = (s) => (s || "").replace(/[\uE000-\uF8FF]/g, "").replace(/\s+/g, " ").trim();
    const exact = els.filter((e) => clean(e.getAttribute("aria-label") || e.innerText) === text);
    const pool = exact.length ? exact : els;
    const el = last ? pool[pool.length - 1] : pool[0];
    if (!el) return false;
    el.click(); return true;
  }, text, role, last);
  if (!ok) throw new Error(`No clickable "${text}"`);
  await sleep(700);
}
async function type(page, placeholderOrLabel, value) {
  const handle = await page.evaluateHandle((p) => [...document.querySelectorAll("input,textarea")].find((e) => e.placeholder === p || e.getAttribute("aria-label") === p), placeholderOrLabel);
  const el = handle.asElement();
  if (!el) throw new Error(`No field "${placeholderOrLabel}"`);
  await el.click(); await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control"); await page.keyboard.press("Backspace");
  if (value) await el.type(value);
  await sleep(250);
}
async function waitText(page, text, timeout = 20000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
}
async function flow(name, role, fn) {
  const page = await session(role);
  try { await fn(page); results.push({ name, ok: true, errors: page.errors }); }
  catch (e) {
    results.push({ name, ok: false, error: e.message.slice(0, 300), errors: page.errors });
    await page.screenshot({ path: `/tmp/shot/flow-fail-${name.replace(/\W+/g, "_")}.png` });
  }
  await page.close();
}


const tok = async (role, email) => fetch(`${BASE}/api/auth/login/${role}/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Demo@12345" }) }).then((r) => r.json());
const apiGet = async (path, access) => fetch(`${BASE}/api${path}`, { headers: { Authorization: `Bearer ${access}` } }).then((r) => r.json());
async function asUser(page, role, email) { const t = await tok(role, email); await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await page.evaluate((k, t) => { localStorage.clear(); localStorage.setItem(k.access, t.access); localStorage.setItem(k.refresh, t.refresh); }, K, t); return t; }
async function fresh(fn, name) {
  const page = await browser.newPage(); page.errors = [];
  page.on("dialog", (d) => { page.dialogs = (page.dialogs ?? 0) + 1; d.accept().catch(() => {}); });
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.setViewport({ width: 1440, height: 900 });
  try { await fn(page); results.push({ name, ok: true, errors: page.errors }); }
  catch (e) { results.push({ name, ok: false, error: e.message.slice(0, 300), errors: page.errors }); await Promise.race([page.screenshot({ path: `/tmp/shot/r3-fail-${name.replace(/\W+/g, "_").slice(0, 40)}.png` }), sleep(5000)]).catch(() => {}); }
  const last = results[results.length - 1]; console.log(last.ok ? "PASS" : "FAIL", name, last.error ?? "");
  await Promise.race([page.close(), sleep(5000)]).catch(() => {});
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };


const shell = (py) => execSync(`cd /home/claude/dev/backend && DJANGO_DEBUG=true DATABASE_URL=sqlite:////tmp/uidb.sqlite3 MEDIA_ROOT=/tmp/ui-media /home/claude/venv/bin/python manage.py shell -c ${JSON.stringify(py)}`, { encoding: "utf8" });
const dialogButton = (p, label) => p.evaluate((label) => { const b = [...document.querySelectorAll('[role="button"]')].filter((e) => e.innerText.trim() === label).pop(); if (b) b.click(); return !!b; }, label);

// R4-1 a delayed token refresh from student A never replaces student B's sign-in or cache
await fresh(async (p) => {
  const a = await tok("student", "student1@localmind.test");
  const meA = await apiGet("/auth/me/", a.access);
  await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await p.evaluate((k, a) => { localStorage.clear(); localStorage.setItem(k.access, "expired.access.token"); localStorage.setItem(k.refresh, a.refresh); }, K, a);
  await p.setRequestInterception(true);
  let held = 0;
  p.on("request", (req) => { if (req.url().includes("/api/auth/refresh/") && held === 0) { held = 1; setTimeout(() => req.continue().catch(() => {}), 6000); } else req.continue().catch(() => {}); });
  await p.goto(`${BASE}/student`, { waitUntil: "domcontentloaded" });
  await sleep(1500);
  assert(held === 1, "refresh did not start");
  // A is still "signed in" locally while the refresh is pending; sign out and sign in as B.
  await p.evaluate((k) => { localStorage.clear(); }, K);
  await p.goto(`${BASE}/login/student`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await sleep(1000);
  await type(p, "Email address", "student2@localmind.test");
  await type(p, "Password", "Demo@12345");
  await click(p, "Sign in to the student portal");
  await waitText(p, "Ready for your next small step?", 20000);
  await sleep(8000);
  const stored = await p.evaluate((k) => localStorage.getItem(k.access), K);
  const me = await apiGet("/auth/me/", stored);
  assert(me.email === "student2@localmind.test", `stored sign-in belongs to ${me.email}`);
  const keys = await p.evaluate(() => new Promise((resolve) => { const r = indexedDB.open("localmind-offline"); r.onsuccess = () => { const g = r.result.transaction("entries", "readonly").objectStore("entries").getAllKeys(); g.onsuccess = () => resolve(g.result.map(String)); }; r.onerror = () => resolve([]); }));
  assert(!keys.some((k) => k.startsWith(`u:${meA.id}:`)), "student 1 data in the offline copy");
}, "R4-1 delayed refresh cannot mix accounts (full page)");

await fresh(async (p) => {
  // Same, without a page load in between: the refresh is still in flight inside the running app.
  const a = await tok("student", "student1@localmind.test");
  const meA = await apiGet("/auth/me/", a.access);
  await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await p.evaluate((k, a) => { localStorage.clear(); localStorage.setItem(k.access, a.access); localStorage.setItem(k.refresh, a.refresh); }, K, a);
  await p.goto(`${BASE}/student`, { waitUntil: "networkidle0" }); await sleep(1500);
  await p.setRequestInterception(true);
  let held = 0;
  p.on("request", (req) => {
    const u = req.url();
    if (held === 0 && u.includes("/api/student/") && !u.includes("offline")) { held = 1; req.respond({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "TOKEN_EXPIRED", message: "expired" } }) }); return; }
    if (held === 1 && u.includes("/api/auth/refresh/")) { held = 2; setTimeout(() => req.continue().catch(() => {}), 6000); return; }
    req.continue().catch(() => {});
  });
  await click(p, "My progress");
  await sleep(1500);
  assert(held === 2, `refresh not intercepted (${held})`);
  await click(p, "Open account menu");
  await click(p, "Sign out");
  await waitText(p, "Let’s get you to the right place.", 15000);
  await click(p, "I’m a student");
  await type(p, "Email address", "student2@localmind.test");
  await type(p, "Password", "Demo@12345");
  await click(p, "Sign in to the student portal");
  await waitText(p, "Ready for your next small step?", 20000);
  await sleep(9000);
  const stored = await p.evaluate((k) => localStorage.getItem(k.access), K);
  const me = await apiGet("/auth/me/", stored);
  assert(me.email === "student2@localmind.test", `stored sign-in belongs to ${me.email}`);
  const keys = await p.evaluate(() => new Promise((resolve) => { const r = indexedDB.open("localmind-offline"); r.onsuccess = () => { const g = r.result.transaction("entries", "readonly").objectStore("entries").getAllKeys(); g.onsuccess = () => resolve(g.result.map(String)); }; r.onerror = () => resolve([]); }));
  assert(!keys.some((k) => k.startsWith(`u:${meA.id}:`)), "student 1 data in the offline copy");
}, "R4-1 delayed refresh cannot mix accounts (in-app)");

// R4-2 an expired resumed attempt submits the saved answers, not an empty set
await fresh(async (p) => {
  const s = await asUser(p, "student", "student3@localmind.test");
  await go(p, `/student/quiz/${r4.timed_quiz}`);
  await click(p, "Start quiz");
  await waitText(p, "QUESTION 1 OF");
  await click(p, "The ready process", { role: "radio" });
  await sleep(1000);
  const aid = await apiGet(`/student/quizzes/`, s.access).then(() => null);
  shell(`from assessments.models import AssessmentAttempt as A; from django.utils import timezone; from datetime import timedelta; a=A.objects.filter(assessment_id='${r4.timed_quiz}', student__email='student3@localmind.test', status='in_progress').latest('started_at'); a.started_at=timezone.now()-timedelta(minutes=3); a.save(update_fields=['started_at'])`);
  await p.reload({ waitUntil: "networkidle0" }); await sleep(1000);
  await click(p, "Start quiz");
  await sleep(6000);
  const out = shell(`from assessments.models import AssessmentAttempt as A; a=A.objects.filter(assessment_id='${r4.timed_quiz}', student__email='student3@localmind.test').latest('started_at'); print('STATUS', a.status, 'ANSWERS', a.submitted_answers)`);
  assert(/ANSWERS \{'[^']+': 'A'\}/.test(out), `submitted: ${out.trim().split("\n").pop()}`);
}, "R4-2 expired attempt submits restored answers");

// R4-3 unsaved quiz A edits never reach quiz B; sidebar asks first
await fresh(async (p) => {
  const t = await asUser(p, "faculty", "faculty1@localmind.test");
  // Titles are read live: earlier flows may have renamed these quizzes.
  const [titleA, titleB] = await Promise.all([apiGet(`/faculty/quizzes/${r4.quiz_a}/`, t.access).then((q) => q.title), apiGet(`/faculty/quizzes/${r4.quiz_b}/`, t.access).then((q) => q.title)]);
  await go(p, `/manage/quiz/${r4.quiz_a}?tab=settings`);
  await type(p, "Quiz title", "EDITED FROM A");
  await click(p, "Quizzes", { role: "menuitem" });
  await waitText(p, "Save your changes before leaving?");
  await dialogButton(p, "Stay");
  await sleep(500);
  assert(p.url().includes(r4.quiz_a), "left quiz A after choosing Stay");
  await click(p, "Quizzes", { role: "menuitem" });
  await waitText(p, "Save your changes before leaving?");
  await dialogButton(p, "Discard changes");
  await waitText(p, "ASSESSMENT WORKSPACE");
  await type(p, "Search quizzes", titleB); await sleep(1500);
  await p.evaluate((title) => {
    const row = [...document.querySelectorAll('[role="row"]')].find((r) => r.innerText.includes(title));
    if (!row) throw new Error(`no row for ${title}`);
    [...row.querySelectorAll('[role="button"]')].pop().click();
  }, titleB);
  await sleep(2500);
  await click(p, "Settings & release", { role: "tab" });
  const field = await p.evaluate(() => [...document.querySelectorAll("input")].find((e) => e.getAttribute("aria-label") === "Quiz title")?.value);
  assert(field === titleB, `quiz B title field shows ${field}`);
  const [qa, qb] = await Promise.all([apiGet(`/faculty/quizzes/${r4.quiz_a}/`, t.access), apiGet(`/faculty/quizzes/${r4.quiz_b}/`, t.access)]);
  assert(qa.title === titleA && qb.title === titleB, `titles changed: ${qa.title} / ${qb.title}`);
}, "R4-3 drafts stay with their quiz; sidebar asks Save/Discard/Stay");

// R4-4 text typed while a save is running is kept as unsaved
await fresh(async (p) => {
  const t = await asUser(p, "faculty", "faculty1@localmind.test");
  await go(p, `/manage/quiz/${r4.quiz_a}?tab=settings`);
  await p.setRequestInterception(true);
  p.on("request", (req) => { if (req.method() === "PATCH" && req.url().includes(`/api/faculty/quizzes/${r4.quiz_a}/`)) setTimeout(() => req.continue().catch(() => {}), 3000); else req.continue().catch(() => {}); });
  await type(p, "Quiz title", "Saved part");
  await click(p, "Save settings");
  await sleep(600);
  const el = await p.evaluateHandle(() => [...document.querySelectorAll("input")].find((e) => e.getAttribute("aria-label") === "Quiz title"));
  await el.asElement().click(); await p.keyboard.press("End"); await el.asElement().type(" plus more");
  await sleep(5000);
  const field = await p.evaluate(() => [...document.querySelectorAll("input")].find((e) => e.getAttribute("aria-label") === "Quiz title")?.value);
  const q = await apiGet(`/faculty/quizzes/${r4.quiz_a}/`, t.access);
  assert(field === "Saved part plus more", `field is ${field}`);
  assert(q.title === "Saved part", `server title ${q.title}`);
  const saveEnabled = await p.evaluate(() => [...document.querySelectorAll('[role="button"]')].find((e) => (e.getAttribute("aria-label") || e.innerText).trim() === "Save settings")?.getAttribute("aria-disabled") !== "true");
  assert(saveEnabled, "the newer text is not marked as unsaved");
}, "R4-4 edits during a save are kept");

// R4-9 a failed save during a tab change keeps the draft and says why
await fresh(async (p) => {
  await asUser(p, "faculty", "faculty1@localmind.test");
  await go(p, `/manage/document/${r4.review_doc}`);
  await waitText(p, "Book outline");
  await p.setRequestInterception(true);
  p.on("request", (req) => { if (req.method() === "PUT" && req.url().includes("/outline/")) req.respond({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "A module title is too long." } }) }); else req.continue().catch(() => {}); });
  await type(p, "Module title", "Unsaved outline edit");
  await click(p, "Lessons & quizzes", { role: "tab" });
  await waitText(p, "Save your outline changes first?");
  await dialogButton(p, "Save and continue");
  await waitText(p, "The outline was not saved");
  await waitText(p, "A module title is too long.");
  const still = await p.evaluate(() => [...document.querySelectorAll("input")].some((i) => i.value === "Unsaved outline edit"));
  const tab = await p.evaluate(() => [...document.querySelectorAll('[role="tab"]')].find((e) => e.getAttribute("aria-selected") === "true")?.innerText.trim());
  assert(still && tab === "Outline & source", `draft ${still} tab ${tab}`);
}, "R4-9 failed save and continue shows the error");

// R4-6 whole-chapter quiz lists its source modules
await fresh(async (p) => {
  await asUser(p, "faculty", "faculty1@localmind.test");
  await go(p, `/manage/quiz/${r4.chapter_quiz}?tab=sources`);
  await sleep(2500);
  const txt = await p.evaluate(() => document.body.innerText);
  assert(txt.includes("Open module") && !txt.includes("This quiz follows a whole chapter."), "no source module cards");
}, "R4-6 whole-chapter quiz sources");

// R4-7 offline later pages: saved first page is shown with a note
await fresh(async (p) => {
  await asUser(p, "student", "student2@localmind.test");
  await p.setRequestInterception(true);
  p.on("request", (req) => {
    const u = req.url();
    if (u.includes("/api/student/scores/") && /[?&]page=2/.test(u)) { req.abort("internetdisconnected").catch(() => {}); return; }
    if (u.includes("/api/student/scores/") && !/[?&]page=/.test(u)) {
      fetch(u, { headers: req.headers() }).then((r) => r.json()).then((d) => req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ ...d, count: 40, next: `${u}?page=2` }) })).catch(() => req.continue());
      return;
    }
    req.continue().catch(() => {});
  });
  await go(p, "/student/progress");
  await waitText(p, "of 40 quiz results", 15000);
  await waitText(p, "Only the records saved on this device are shown");
}, "R4-7 partial list offline shows saved rows and a note");

// R4-10 date field fits a phone-width card; outline save bar wraps
await fresh(async (p) => {
  await p.setViewport({ width: 390, height: 844 });
  await asUser(p, "faculty", "faculty1@localmind.test");
  await go(p, `/manage/quiz/${r4.quiz_b}?tab=settings`);
  await sleep(1500);
  const r = await p.evaluate(() => [...document.querySelectorAll('input[type="datetime-local"]')].map((e) => e.getBoundingClientRect().right));
  const vw = await p.evaluate(() => window.innerWidth);
  assert(r.length && r.every((x) => x <= vw), `date field overflows: ${r} > ${vw}`);
}, "R4-10 date fields fit a 390 px screen");

await browser.close();
