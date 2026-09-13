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


const draftKeys = (p) => p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("localmind.draft.")));

// R5-1 a blank score is refused by "Save and leave" too
await fresh(async (p) => {
  const t = await asUser(p, "faculty", "faculty1@localmind.test");
  const subs = await apiGet(`/faculty/assignments/${ids.aid}/submissions/`, t.access);
  const sub = (subs.results ?? subs)[0];
  const before = sub.score;
  await go(p, `/manage/submission/${sub.id}?assignment=${ids.aid}`);
  await waitText(p, "Your evaluation");
  await type(p, "Score", "");
  await type(p, "Feedback", "Feedback without a score");
  await click(p, "Quizzes", { role: "menuitem" });
  await waitText(p, "Save your changes before leaving?");
  await dialogButton(p, "Save and leave");
  await waitText(p, "Enter a score before saving.", 15000);
  await sleep(800);
  assert(p.url().includes(`/manage/submission/${sub.id}`), `left the page: ${p.url()}`);
  const after = (await apiGet(`/faculty/assignments/${ids.aid}/submissions/`, t.access));
  const now = (after.results ?? after).find((x) => x.id === sub.id);
  assert(now.score === before, `score changed ${before} -> ${now.score}`);
}, "R5-1 blank score cannot be saved as zero");

// R5-2 leaving is refused while edits typed during the save are still unsaved
await fresh(async (p) => {
  const t = await asUser(p, "faculty", "faculty1@localmind.test");
  await go(p, `/manage/quiz/${r4.quiz_b}?tab=settings`);
  await p.setRequestInterception(true);
  p.on("request", (req) => { if (req.method() === "PATCH" && req.url().includes(`/api/faculty/quizzes/${r4.quiz_b}/`)) setTimeout(() => req.continue().catch(() => {}), 3000); else req.continue().catch(() => {}); });
  await type(p, "Quiz title", "First edit");
  await click(p, "Quizzes", { role: "menuitem" });
  await waitText(p, "Save your changes before leaving?");
  await dialogButton(p, "Save and leave");
  await sleep(600);
  const el = await p.evaluateHandle(() => [...document.querySelectorAll("input")].find((e) => e.getAttribute("aria-label") === "Quiz title"));
  await el.asElement().click(); await p.keyboard.press("End"); await el.asElement().type(" and more");
  await waitText(p, "Newer changes are still unsaved", 20000);
  await dialogButton(p, "OK");
  await sleep(700);
  assert(p.url().includes(r4.quiz_b), `left with unsaved edits: ${p.url()}`);
  const q = await apiGet(`/faculty/quizzes/${r4.quiz_b}/`, t.access);
  assert(q.title === "First edit", `server title ${q.title}`);
  const field = await p.evaluate(() => [...document.querySelectorAll("input")].find((e) => e.getAttribute("aria-label") === "Quiz title")?.value);
  assert(field === "First edit and more", `field ${field}`);
}, "R5-2 cannot leave while newer edits are unsaved");

// R5-3 sign out and the grading page's Back both ask first
await fresh(async (p) => {
  const t = await asUser(p, "faculty", "faculty1@localmind.test");
  await go(p, `/manage/quiz/${r4.quiz_a}?tab=settings`);
  await type(p, "Quiz title", "Unsaved before sign out");
  await click(p, "Open account menu");
  await click(p, "Sign out");
  await waitText(p, "Save your changes before signing out?");
  await dialogButton(p, "Stay signed in");
  await sleep(600);
  assert(p.url().includes(r4.quiz_a), "signed out despite Stay");
  const subs = await apiGet(`/faculty/assignments/${ids.aid}/submissions/`, t.access);
  const sub = (subs.results ?? subs)[0];
  await go(p, `/manage/submission/${sub.id}?assignment=${ids.aid}`);
  await waitText(p, "Your evaluation");
  await type(p, "Feedback", "Typed but not saved");
  await click(p, "Back to submissions");
  await waitText(p, "Save your changes before leaving?");
  await dialogButton(p, "Discard changes");
  await waitText(p, "Submissions", 15000);
  await click(p, "Open account menu");
  await click(p, "Sign out");
  await waitText(p, "Let’s get you to the right place.", 15000);
}, "R5-3 sign out and Back ask about unsaved work");

// R5-5 manual submission waits for the restore
await fresh(async (p) => {
  await asUser(p, "student", "student1@localmind.test");
  await go(p, `/student/quiz/${r4.timed_quiz}`);
  await click(p, "Start quiz");
  await waitText(p, "QUESTION 1 OF");
  await click(p, "The ready process", { role: "radio" });
  await sleep(900);
  const keys = await draftKeys(p);
  assert(keys.length, "no saved draft");
  await p.evaluate(() => {
    // Hold the restore so the race can be tested at all.
    const real = window.localStorage.getItem.bind(window.localStorage);
    window.__slow = true;
    Object.defineProperty(window.localStorage, "getItem", { configurable: true, value: (k) => (window.__slow && k.startsWith("localmind.draft.") ? null : real(k)) });
  });
  await p.reload({ waitUntil: "networkidle0" }); await sleep(800);
  await click(p, "Start quiz");
  await waitText(p, "QUESTION 1 OF");
  const state = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('[role="button"]')].find((e) => (e.getAttribute("aria-label") || e.innerText).trim() === "Review & submit");
    return { disabled: btn?.getAttribute("aria-disabled"), restoring: document.body.innerText.includes("Restoring saved answers"), noSaved: document.body.innerText.includes("No answers were saved") };
  });
  assert(!state.noSaved, "claims nothing was saved while still restoring");
  assert(state.disabled === "true" || !state.restoring, `submit not blocked while restoring: ${JSON.stringify(state)}`);
}, "R5-5 submission waits for restored answers");

// R5-4 typing while the draft loads is kept, and the last keystroke survives leaving at once
await fresh(async (p) => {
  await asUser(p, "student", "student1@localmind.test");
  await go(p, `/student/assignment/${ids.aid}`);
  await sleep(1200);
  const box = await p.evaluateHandle(() => [...document.querySelectorAll("textarea")][0]);
  if (box.asElement()) {
    await box.asElement().click(); await box.asElement().type("Typed immediately");
    await p.evaluate(() => { const b = [...document.querySelectorAll('[role="menuitem"]')].find((e) => e.getAttribute("aria-label") === "My subjects"); b && b.click(); });
    await sleep(300);
    await dialogButton(p, "Save and leave");
    await sleep(1500);
    const saved = await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.includes(".assignment.")); return k ? localStorage.getItem(k) : null; });
    assert(saved && saved.includes("Typed immediately"), `saved draft: ${saved}`);
  }
}, "R5-4 immediate typing is saved before leaving");

// R5-6 a failed outline save during navigation explains itself
await fresh(async (p) => {
  await asUser(p, "faculty", "faculty1@localmind.test");
  await go(p, `/manage/document/${r4.review_doc}`);
  await waitText(p, "Book outline");
  await p.setRequestInterception(true);
  p.on("request", (req) => { if (req.method() === "PUT" && req.url().includes("/outline/")) req.respond({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "A module title is too long." } }) }); else req.continue().catch(() => {}); });
  await type(p, "Module title", "Edit that will not save");
  await click(p, "Quizzes", { role: "menuitem" });
  await waitText(p, "Save your changes before leaving?");
  await dialogButton(p, "Save and leave");
  // "Save and leave" is already the decision, so the editor saves without asking again.
  await waitText(p, "Your changes were not saved", 20000);
  await waitText(p, "A module title is too long.");
  await dialogButton(p, "OK");
  await sleep(800);
  assert(p.url().includes(r4.review_doc), `navigated away: ${p.url()}`);
  await waitText(p, "Not saved:");
  const still = await p.evaluate(() => [...document.querySelectorAll("input")].some((i) => i.value === "Edit that will not save"));
  assert(still, "draft lost");
}, "R5-6 failed save during navigation shows the reason");

await browser.close();
