import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const ids = JSON.parse(fs.readFileSync("/tmp/flow_ids.json", "utf8"));
const st = JSON.parse(fs.readFileSync("/tmp/state_ids.json", "utf8"));
const r3 = JSON.parse(fs.readFileSync("/tmp/r3_ids.json", "utf8"));
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

// #1 held results are not revealed in the student quiz list or quiz page
await fresh(async (p) => {
  const t = await asUser(p, "student", "student3@localmind.test");
  const row = (await apiGet("/student/quizzes/", t.access)).find((q) => q.id === st.held_quiz);
  assert(row && row.best_percentage === null && row.passed === null && row.results_pending >= 1, `list leaked: ${JSON.stringify(row)}`);
  await go(p, "/student/quizzes");
  await waitText(p, "Results not released");
  await go(p, `/student/quiz/${st.held_quiz}`);
  await waitText(p, "Not released yet");
  const txt = await p.evaluate(() => document.body.innerText);
  assert(!txt.includes("Your best so far"), "quiz page shows a best score");
}, "#1 held results hidden in quiz list and quiz page");

// #2 a download still in flight at sign-out never lands in the next student's offline copy
await fresh(async (p) => {
  const a = await asUser(p, "student", "student1@localmind.test");
  const meA = await apiGet("/auth/me/", a.access);
  await p.setRequestInterception(true);
  let delayed = false;
  p.on("request", (req) => {
    if (!delayed && req.url().includes("/api/student/offline/")) { delayed = true; setTimeout(() => req.continue().catch(() => {}), 4000); }
    else req.continue().catch(() => {});
  });
  await p.goto(`${BASE}/student`, { waitUntil: "domcontentloaded" });
  await sleep(1500);
  assert(delayed, "offline download did not start");
  await click(p, "Open account menu");
  await click(p, "Sign out");
  await waitText(p, "Let’s get you to the right place.", 15000);
  await click(p, "I’m a student");
  await type(p, "Email address", "student2@localmind.test");
  await type(p, "Password", "Demo@12345");
  await click(p, "Sign in to the student portal");
  await waitText(p, "Ready for your next small step?", 20000);
  await sleep(7000);
  const keys = await p.evaluate(() => new Promise((resolve) => { const r = indexedDB.open("localmind-offline"); r.onsuccess = () => { const tx = r.result.transaction("entries", "readonly"); const g = tx.objectStore("entries").getAllKeys(); g.onsuccess = () => resolve(g.result.map(String)); }; r.onerror = () => resolve([]); }));
  const leaked = keys.filter((k) => k.startsWith(`u:${meA.id}:`));
  const b = keys.filter((k) => k.startsWith("u:") && !k.startsWith(`u:${meA.id}:`));
  assert(leaked.length === 0, `student 1 entries present after student 2 signed in: ${leaked.length}`);
  assert(b.length > 0, "student 2 offline copy was not saved");
}, "#2 offline download cannot cross accounts");

// #4 unsaved edits survive the window regaining focus; leaving the Outline tab asks to save
await fresh(async (p) => {
  await asUser(p, "faculty", "faculty1@localmind.test");
  await go(p, `/manage/assignment/${ids.aid}`);
  await type(p, "Assignment title", "Kept after focus");
  await p.evaluate(() => window.dispatchEvent(new Event("focus")));
  await sleep(2500);
  const kept = await p.evaluate(() => [...document.querySelectorAll("input")].some((i) => i.value === "Kept after focus"));
  assert(kept, "assignment edit was wiped by the focus reload");
  await go(p, `/manage/document/${r3.review_doc}`);
  await waitText(p, "Book outline");
  await type(p, "Module title", "Edited title not saved");
  await click(p, "Lessons & quizzes", { role: "tab" });
  await waitText(p, "Save your outline changes first?");
  await click(p, "Stay on this tab", { last: true });
  const still = await p.evaluate(() => [...document.querySelectorAll("input")].some((i) => i.value === "Edited title not saved"));
  assert(still, "outline draft lost after cancelling the tab switch");
}, "#4 edits survive focus reload and tab switch");

// #6 saving settings on a quiz with attempts keeps the same quiz and version
await fresh(async (p) => {
  const t = await asUser(p, "faculty", "faculty1@localmind.test");
  const before = await apiGet(`/faculty/quizzes/${ids.qid}/`, t.access);
  await go(p, `/manage/quiz/${ids.qid}?tab=settings`);
  await type(p, "Pass percentage", String(before.pass_percentage === 65 ? 66 : 65));
  await click(p, "Save settings");
  await sleep(2500);
  assert(p.url().includes(ids.qid), `navigated to another quiz: ${p.url()}`);
  const after = await apiGet(`/faculty/quizzes/${ids.qid}/`, t.access);
  assert(after.status !== "superseded" && after.version === before.version, `version changed ${before.version} -> ${after.version} (${after.status})`);
  assert(after.results_release === before.results_release, "release setting changed");
}, "#6 settings save keeps quiz version");

// #9 clearing the attempt limit saves as no limit
await fresh(async (p) => {
  const t = await asUser(p, "faculty", "faculty1@localmind.test");
  await go(p, `/manage/quiz/${ids.qid}?tab=settings`);
  await type(p, "Maximum attempts", "3"); await click(p, "Save settings"); await sleep(2000);
  await type(p, "Maximum attempts", ""); await click(p, "Save settings"); await sleep(2000);
  const q = await apiGet(`/faculty/quizzes/${ids.qid}/`, t.access);
  assert(q.max_attempts === null, `max_attempts is ${q.max_attempts}`);
  const txt = await p.evaluate(() => document.body.innerText);
  assert(!txt.includes("Validation failed"), "validation error shown");
}, "#9 blank attempt limit saves as no limit");

// #15 quiz answers are restored after a page reload
await fresh(async (p) => {
  await asUser(p, "student", "student1@localmind.test");
  await go(p, `/student/quiz/${r3.draft_quiz}`);
  await click(p, "Start quiz");
  await waitText(p, "QUESTION 1 OF");
  await click(p, "The ready process", { role: "radio" });
  await sleep(900);
  await p.reload({ waitUntil: "networkidle0" }); await sleep(1200);
  await click(p, "Start quiz");
  await waitText(p, "Your answers saved on this device were restored", 15000);
  const checked = await p.evaluate(() => [...document.querySelectorAll('[role="radio"]')].some((e) => e.getAttribute("aria-checked") === "true"));
  assert(checked, "restored answer not selected");
}, "#15 quiz answers restored after reload");

// #5 every person is listed, not only the first 25
await fresh(async (p) => {
  const t = await asUser(p, "admin", "admin@localmind.test");
  const total = (await apiGet("/admin/students/", t.access)).count;
  await go(p, "/admin/users"); await sleep(1500);
  const n = await p.evaluate(() => [...document.querySelectorAll('[role="button"]')].filter((e) => (e.getAttribute("aria-label") || e.innerText).trim() === "Manage").length);
  assert(total > 25 && n === total, `server has ${total}, page shows ${n}`);
  await waitText(p, `Showing all ${total} students`);
}, "#5 lists show all records");

// #7 + #8 held automatic quiz: evidence shown, then corrected and published
await fresh(async (p) => {
  const t = await asUser(p, "faculty", "faculty1@localmind.test");
  await go(p, `/manage/quiz/${r3.held_auto_quiz}`);
  await waitText(p, "This automatic quiz is hidden from students.");
  await waitText(p, "A process is a program in execution");
  const txt = await p.evaluate(() => document.body.innerText);
  assert(txt.includes("does not name a single question") || txt.includes("FLAGGED FOR REVIEW"), "no flagged-question statement");
  await click(p, "Fix & review the quiz");
  await waitText(p, "Correcting a held quiz");
  await click(p, "Publish corrected quiz");
  await waitText(p, "Publish the corrected quiz?");
  await click(p, "Publish corrected quiz", { last: true });
  await sleep(2500);
  const q = await apiGet(`/faculty/quizzes/${r3.held_auto_quiz}/`, t.access);
  assert(q.status === "published" && !q.held_for_review, `status ${q.status} held ${q.held_for_review}`);
}, "#7 #8 held quiz review and publish corrected quiz");

// #10 multi-module quiz carries its subject for the student filter
await fresh(async (p) => {
  const t = await asUser(p, "student", "student1@localmind.test");
  const rows = await apiGet("/student/quizzes/", t.access);
  assert(rows.length && rows.every((r) => r.subject_id), "a quiz has no subject_id");
}, "#10 student quizzes carry subject_id");

// #11 released submission is labelled Released
await fresh(async (p) => {
  await asUser(p, "faculty", "faculty1@localmind.test");
  await go(p, `/manage/assignment/${r3.release_assignment}?tab=submissions`);
  await waitText(p, "Released");
  const txt = await p.evaluate(() => document.body.innerText);
  assert(!txt.includes("Not released"), "still labelled Not released");
}, "#11 release label after release");

// #12 a slow earlier search does not overwrite a newer one
await fresh(async (p) => {
  await asUser(p, "admin", "admin@localmind.test");
  await go(p, "/admin/users");
  await p.setRequestInterception(true);
  p.on("request", (req) => { const u = req.url(); if (u.includes("/api/admin/students/") && /[?&]q=F(&|$)/.test(u)) setTimeout(() => req.continue().catch(() => {}), 3000); else req.continue().catch(() => {}); });
  await type(p, "Search people", "F");
  await sleep(700);
  await type(p, "Search people", "Student 1");
  await sleep(4500);
  const txt = await p.evaluate(() => document.body.innerText);
  assert(txt.includes("Student 1") && !txt.includes("Flow Student"), "older search result replaced the newer one");
}, "#12 latest search wins");

// #13 used-up assignment explains the limit and offers no new version
await fresh(async (p) => {
  await asUser(p, "student", "student2@localmind.test");
  await go(p, `/student/assignment/${r3.limit_assignment}`);
  await waitText(p, "You have used all 2 submissions.");
  const txt = await p.evaluate(() => document.body.innerText);
  assert(!txt.includes("Write a new version"), "still offers a new version");
}, "#13 resubmission limit shown");

// #20 archived book is read-only
await fresh(async (p) => {
  await asUser(p, "faculty", "faculty1@localmind.test");
  await go(p, `/manage/document/${r3.archived_doc}`);
  await waitText(p, "is archived.");
  const txt = await p.evaluate(() => document.body.innerText);
  assert(!txt.includes("Book outline") && !txt.includes("Publish book") && !txt.includes("Save changes"), "editing or publishing controls shown");
}, "#20 archived book read-only");

// #21 checklist shows the real automatic-quiz state
await fresh(async (p) => {
  const t = await asUser(p, "faculty", "faculty1@localmind.test");
  const doc = await apiGet(`/faculty/documents/${r3.review_doc}/`, t.access);
  await go(p, `/manage/document/${r3.review_doc}?tab=publish`);
  await waitText(p, "Automatic quizzes");
  const a = doc.auto_quizzes || {};
  const expected = !a.enabled ? "Turned off" : a.held ? "Review needed" : a.failed ? "Some failed" : (a.pending + a.generating + (a.checking || 0)) ? "In progress" : !a.ready ? "None yet" : "Ready";
  await waitText(p, expected);
}, "#21 checklist automatic quiz state");

// #16 outline save controls are reachable at a laptop size
await fresh(async (p) => {
  await p.setViewport({ width: 1280, height: 720 });
  await asUser(p, "faculty", "faculty1@localmind.test");
  await go(p, `/manage/document/${r3.review_doc}`);
  await waitText(p, "Book outline");
  const ok = await p.evaluate(() => {
    const outline = [...document.querySelectorAll("div")].find((d) => d.innerText === "Book outline");
    outline.scrollIntoView({ block: "start" });
    const save = [...document.querySelectorAll('[role="button"]')].find((e) => (e.getAttribute("aria-label") || e.innerText).trim() === "Save changes");
    const r = save.getBoundingClientRect();
    return r.bottom <= window.innerHeight && r.top >= 0;
  });
  assert(ok, "Save changes is outside the visible area");
}, "#16 outline save reachable at 1280x720");

// #17 dropdown opens above when there is no room below
await fresh(async (p) => {
  await p.setViewport({ width: 1440, height: 400 });
  await asUser(p, "admin", "admin@localmind.test");
  await go(p, "/admin/users");
  const trigger = await p.evaluate(() => { const e = [...document.querySelectorAll('[role="button"]')].find((x) => (x.getAttribute("aria-label") || "") === "Filter by status"); const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
  await click(p, "Filter by status");
  await sleep(500);
  const menu = await p.evaluate(() => { const items = [...document.querySelectorAll('[role="menuitem"]')].filter((e) => ["All statuses", "Active", "Discontinued"].includes(e.innerText.trim())); const rs = items.map((e) => e.getBoundingClientRect()); return { top: Math.min(...rs.map((r) => r.top)), bottom: Math.max(...rs.map((r) => r.bottom)) }; });
  assert(menu.bottom <= 400 && menu.top >= 0, `menu outside screen ${JSON.stringify(menu)}`);
  assert(menu.bottom <= trigger.top + 2 || trigger.bottom + 130 < 400, `menu did not open above ${JSON.stringify({ menu, trigger })}`);
}, "#17 dropdown stays on screen");

// #18 lesson link opens the Lesson tab; detail page keeps its sidebar section
await fresh(async (p) => {
  await asUser(p, "student", "student1@localmind.test");
  await go(p, `/student/quiz/${r3.draft_quiz}`);
  await click(p, "Open the lesson");
  await sleep(2000);
  const sel = await p.evaluate(() => [...document.querySelectorAll('[role="tab"]')].find((e) => e.getAttribute("aria-selected") === "true")?.innerText.trim());
  assert(sel === "Lesson", `selected tab is ${sel}`);
  await asUser(p, "faculty", "faculty1@localmind.test");
  await go(p, `/manage/quiz/${ids.qid}`);
  const hl = await p.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((e) => e.getAttribute("aria-selected") === "true")?.getAttribute("aria-label"));
  assert(hl === "Quizzes", `sidebar highlights ${hl}`);
}, "#18 lesson link and sidebar section");

// #22 date pickers with time zone, table semantics, no visible Actions heading
await fresh(async (p) => {
  await asUser(p, "faculty", "faculty1@localmind.test");
  await go(p, `/manage/quiz/${ids.qid}?tab=settings`);
  const n = await p.evaluate(() => document.querySelectorAll('input[type="datetime-local"]').length);
  assert(n >= 2, `datetime pickers: ${n}`);
  await waitText(p, "Times are in your time zone");
  await go(p, "/manage/quizzes");
  const sem = await p.evaluate(() => ({ tables: document.querySelectorAll('[role="table"]').length, headers: document.querySelectorAll('[role="columnheader"]').length, visibleActions: document.body.innerText.includes("Actions") }));
  assert(sem.tables >= 1 && sem.headers >= 5 && !sem.visibleActions, JSON.stringify(sem));
}, "#22 date pickers and table semantics");

await browser.close();
for (const r of results) console.log(r.ok ? "PASS" : "FAIL", r.name, r.error ?? "", r.errors.length ? `pageerrors: ${r.errors.join(" | ").slice(0, 200)}` : "");
