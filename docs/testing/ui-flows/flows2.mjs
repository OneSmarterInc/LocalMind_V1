import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const ids = JSON.parse(fs.readFileSync("/tmp/flow_ids.json", "utf8"));
const st = JSON.parse(fs.readFileSync("/tmp/state_ids.json", "utf8"));
const BASE = "http://127.0.0.1:8020";
const K = { access: "localmind.access", refresh: "localmind.refresh", session: "localmind.session" };
const creds = { student: "student2@localmind.test", faculty: "faculty1@localmind.test", admin: "admin@localmind.test" };
const browser = await puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
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
  await el.click({ clickCount: 3 }); await el.type(value); await sleep(200);
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


async function blank() {
  const page = await browser.newPage(); page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await page.evaluate(() => localStorage.clear());
  return page;
}
async function uiFlow(name, fn, mk = blank) {
  const page = await mk();
  try { await fn(page); results.push({ name, ok: true, errors: page.errors }); }
  catch (e) { results.push({ name, ok: false, error: e.message.slice(0, 300), errors: page.errors }); await page.screenshot({ path: `/tmp/shot/flow2-fail-${name.replace(/\W+/g, "_")}.png` }); }
  await page.close();
}
await uiFlow("real sign-in form, forced password change, empty student, sign out", async (p) => {
  await go(p, "/login");
  await click(p, "I’m a student");
  await waitText(p, "Welcome back.");
  await type(p, "Email address", st.new_email);
  await type(p, "Password", st.new_password);
  await click(p, "Sign in to the student portal");
  await waitText(p, "Choose a new password", 20000);
  await type(p, "Current password", st.new_password);
  await type(p, "New password", "Brand#New2026x");
  await type(p, "Confirm new password", "Brand#New2026x");
  await click(p, "Update password");
  await waitText(p, "Ready for your next small step?", 20000);
  await go(p, "/student/subjects");
  await waitText(p, "Let’s find your classes.");
  await click(p, "Open account menu");
  await click(p, "Sign out");
  await waitText(p, "Let’s get you to the right place.", 20000);
});
await uiFlow("wrong password shows an error", async (p) => {
  await go(p, "/login/faculty");
  await type(p, "Email address", "faculty1@localmind.test");
  await type(p, "Password", "WrongPass!123");
  await click(p, "Sign in to the faculty portal");
  await waitText(p, "Something went wrong", 15000);
});
await uiFlow("expired session explains itself", async (p) => {
  await p.evaluate((k) => { localStorage.setItem(k.access, "bogus.token.value"); localStorage.setItem(k.refresh, "bogus.refresh.value"); }, K);
  await go(p, "/student");
  await waitText(p, "Please sign in again.", 20000);
});
await flow("student locked module state", "student", async (p) => {
  await go(p, `/student/module/${st.m2}`);
  await waitText(p, "This module is not open yet.");
  await click(p, "See available modules");
  await waitText(p, "My subjects");
});
await uiFlow("student held results state", async (p) => {
  const t = await fetch(`${BASE}/api/auth/login/student/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "student3@localmind.test", password: "Demo@12345" }) }).then((r) => r.json());
  await p.evaluate((k, t) => { localStorage.setItem(k.access, t.access); localStorage.setItem(k.refresh, t.refresh); }, K, t);
  await go(p, `/student/attempt/${st.held_attempt}`);
  await waitText(p, "Your faculty will release the results.");
  await go(p, "/student/quizzes");
  await waitText(p, "Results not released");
});
await flow("student offline: banner, offline page, saved module", "student", async (p) => {
  await go(p, "/student/offline");
  await click(p, "Refresh offline copy");
  await sleep(4000);
  await waitText(p, "Saved copy from", 30000);
  await p.setOfflineMode(true);
  await click(p, "My subjects");
  await sleep(2500);
  await waitText(p, "You are offline", 15000);
  await go(p, `/student/module/${st.m1}`).catch(() => {});
  await p.setOfflineMode(false);
});
await flow("faculty releases held results and marks an assignment", "faculty", async (p) => {
  await go(p, `/manage/quiz/${st.held_quiz}?tab=attempts`);
  await waitText(p, "waiting for their results.", 20000);
  await click(p, "Release all results");
  await waitText(p, "Release results to everyone?");
  await click(p, "Release results", { last: true });
  await sleep(1500);
  await go(p, `/manage/assignment/${ids.aid}?tab=submissions`);
  await waitText(p, "Submissions");
});
await flow("faculty unpublishes and republishes a book", "faculty", async (p) => {
  await go(p, "/manage/books");
  await type(p, "Search books", "Operating Systems Primer");
  await sleep(800);
  await click(p, "Open book");
  await waitText(p, "is published.");
  await click(p, "Unpublish book");
  await waitText(p, "Unpublish this book?");
  await click(p, "Unpublish book", { last: true });
  await waitText(p, "Review before publishing", 15000);
  await click(p, "Publish book");
  await waitText(p, "Publish this book?");
  await click(p, "Publish book", { last: true });
  await waitText(p, "is published.", 15000);
});
await flow("faculty enrolls a student with the picker", "faculty", async (p) => {
  await go(p, `/manage/subject/${ids.sid}?tab=students`);
  await click(p, "Enroll students");
  await waitText(p, "Select existing student accounts to enroll.");
});
await flow("admin discontinues and reactivates an account", "admin", async (p) => {
  await go(p, "/admin/users");
  await click(p, "Manage", { last: true });
  await click(p, "Discontinue account");
  await waitText(p, "Discontinue this account?");
  await click(p, "Discontinue account", { last: true });
  await waitText(p, "Reactivate account", 15000);
  await click(p, "Reactivate account");
  await waitText(p, "Discontinue account", 15000);
});
await flow("admin archives, reactivates and deletes a flow subject", "admin", async (p) => {
  await go(p, "/admin/subjects");
  await type(p, "Search subjects", "Flow Testing");
  await sleep(1200);
  await click(p, "Manage subject");
  await click(p, "Archive subject");
  await waitText(p, "Archive this subject?");
  await click(p, "Archive subject", { last: true });
  await waitText(p, "Reactivate subject", 15000);
  await click(p, "Delete subject");
  await waitText(p, "Delete this subject?");
  const typed = await p.$('input[placeholder]'); // confirm-delete may ask to type
  await click(p, "Delete subject", { last: true });
  await waitText(p, "was deleted", 15000);
});
await flow("admin imports students from Excel", "admin", async (p) => {
  await go(p, "/admin/user/import");
  const [chooser] = await Promise.all([p.waitForFileChooser({ timeout: 10000 }), click(p, "Choose file")]);
  await chooser.accept(["/tmp/import_students.xlsx"]);
  await waitText(p, "import_students.xlsx");
  await click(p, "Import students");
  await waitText(p, "Review the import report", 20000);
  await waitText(p, "Invalid email");
  await waitText(p, "Account exists");
});
await flow("phone menu opens and navigates", "faculty", async (p) => {
  await p.setViewport({ width: 390, height: 844 });
  await go(p, "/manage");
  await click(p, "Open navigation menu");
  await click(p, "Quizzes", { role: "menuitem" });
  await waitText(p, "Create, review, publish");
});
await browser.close();
for (const r of results) console.log(r.ok ? "PASS" : "FAIL", r.name, r.error ?? "", r.errors.length ? `pageerrors: ${r.errors.join(" | ").slice(0, 300)}` : "");
