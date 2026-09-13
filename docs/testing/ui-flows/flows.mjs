import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const ids = JSON.parse(fs.readFileSync("/tmp/flow_ids.json", "utf8"));
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

await flow("student asks a doubt", "student", async (p) => {
  await go(p, `/student/module/${ids.mid}`);
  await click(p, "Ask a doubt", { role: "tab" });
  await type(p, "Your question", "What does the scheduler decide?");
  await click(p, "Ask");
  await waitText(p, "From the module", 45000).catch(async () => { await waitText(p, "OUTSIDE THIS MODULE", 5000); });
});
await flow("student lesson and text size", "student", async (p) => {
  await go(p, `/student/module/${ids.mid}`);
  await click(p, "Use larger text");
  await click(p, "Lesson", { role: "tab" });
  await waitText(p, "By the end, you should be able to", 20000).catch(() => waitText(p, "being prepared", 3000)).catch(() => waitText(p, "The guided lesson is not available right now.", 3000));
});
await flow("student takes a quiz", "student", async (p) => {
  await go(p, `/student/quiz/${ids.qid}`);
  await click(p, "Start quiz");
  await waitText(p, "QUESTION 1 OF");
  const radios = await p.$$('[role="radio"]'); if (radios[0]) await radios[0].click(); await sleep(300);
  await click(p, "Next question");
  const radios2 = await p.$$('[role="radio"]'); if (radios2[1]) await radios2[1].click(); await sleep(300);
  await click(p, "Review & submit");
  await waitText(p, "Review your answers");
  await click(p, "Submit answers");
  await waitText(p, "Submit your answers?");
  await click(p, "Submit answers", { last: true });
  await waitText(p, "Your quiz result", 20000).catch(() => waitText(p, "Your answers are submitted.", 5000));
});
await flow("student submits an assignment", "student", async (p) => {
  await go(p, `/student/assignment/${ids.aid}`);
  if (await p.evaluate(() => document.body.innerText.includes("Your submission is received."))) return;
  await type(p, "Your response", "Round robin gives each process a time slice; priority scheduling picks the most important first.");
  await click(p, "Review submission");
  await waitText(p, "Submit your response?");
  await click(p, "Submit", { last: true });
  await waitText(p, "Your submission is received.");
});
await flow("student uses page finder and help", "student", async (p) => {
  await go(p, "/student");
  await click(p, "Find a page");
  await type(p, "Search pages", "progress");
  await click(p, "My progressScores and learning time").catch(async () => { await p.keyboard.press("Enter"); });
  await waitText(p, "See how far you’ve come.");
  await click(p, "Show me how");
  await waitText(p, "Your first three steps");
});
await flow("faculty locks and opens a module", "faculty", async (p) => {
  await go(p, `/manage/subject/${ids.sid}`);
  await click(p, "Modules & progress", { role: "tab" });
  await click(p, "Lock module");
  await waitText(p, "Lock this module?");
  await click(p, "Lock module", { last: true });
  await waitText(p, "Open module");
  await click(p, "Open module");
  await sleep(1500);
});
await flow("faculty creates a quiz by hand", "faculty", async (p) => {
  await go(p, "/manage/quiz/new");
  await type(p, "Quiz title", "Flow test quiz");
  await click(p, "Subject");
  await click(p, "OS101 · Operating Systems", { role: "menuitem" });
  await sleep(1500);
  await click(p, "Processes and Scheduling", { role: "checkbox" });
  await click(p, "Write my own questions", { role: "radio" });
  await click(p, "Continue to questions");
  await waitText(p, "Flow test quiz", 20000);
  await click(p, "Settings & release", { role: "tab" });
  await waitText(p, "Quiz settings");
});
await flow("faculty opens book tabs", "faculty", async (p) => {
  await go(p, "/manage/books");
  await type(p, "Search books", "Operating Systems Primer");
  await sleep(800);
  await click(p, "Open book");
  await waitText(p, "is published.");
  await click(p, "Check lesson readiness");
  await waitText(p, "Automatic quiz");
  await click(p, "Published book", { role: "tab" });
  await waitText(p, "Delete book permanently");
});
await flow("admin creates a subject and assigns faculty", "admin", async (p) => {
  await go(p, "/admin/subject/new");
  await type(p, "Subject name", "Flow Testing");
  await type(p, "Subject code", "FLW" + String(Date.now()).slice(-4));
  await click(p, "Create subject", { last: true });
  await waitText(p, "Assigned faculty");
  await click(p, "Assign faculty", { last: true });
  const boxes = await p.$$('[role="checkbox"]'); if (!boxes.length) throw new Error("no faculty options"); await boxes[0].click(); await sleep(300);
  await click(p, "Assign 1 faculty");
  await waitText(p, "Remove assignment");
  await click(p, "Enrolled students", { role: "tab" });
  await waitText(p, "Enroll students");
});
await flow("admin adds a person", "admin", async (p) => {
  await go(p, "/admin/user/new");
  await type(p, "Full name", "Flow Student");
  await type(p, "Email address", `flow${Date.now()}@localmind.test`);
  await click(p, "Create account");
  await waitText(p, "created", 20000);
});
await flow("admin resets a password and filters audit", "admin", async (p) => {
  await go(p, "/admin/users");
  await click(p, "Manage");
  await waitText(p, "Account access");
  await click(p, "Reset onboarding password");
  await waitText(p, "Reset the onboarding password?");
  await click(p, "Reset password", { last: true });
  await sleep(1500);
  await go(p, "/admin/audit");
  await click(p, "Details");
  await waitText(p, "Target ID");
  await click(p, "More filters");
  await waitText(p, "From date");
});
await flow("admin monitoring tabs and system", "admin", async (p) => {
  await go(p, "/admin/monitoring");
  await click(p, "Trends & coverage", { role: "tab" });
  await waitText(p, "Evaluation outcomes");
  await click(p, "Subjects & user impact", { role: "tab" });
  await waitText(p, "User impact");
  await go(p, "/admin/system");
  await click(p, "Refresh status");
  await waitText(p, "Local AI details");
});
await browser.close();
for (const r of results) console.log(r.ok ? "PASS" : "FAIL", r.name, r.error ?? "", r.errors.length ? `pageerrors: ${r.errors.join(" | ").slice(0, 300)}` : "");
