# LocalMind: Product Requirements Document (PRD)

**Version:** 2.5, 1 Oct 2026
**Repository:** github.com/OneSmarterInc/LocalMind_V1, branch `main` (code last verified with the open-items patch of 1 Oct 2026; this version written on top of `d96d055`)
**Master copy:** `docs/PRD.md` in the repository. Change it only there, through a branch and pull request. Any copy kept elsewhere (a project's files, a chat) is a read-only snapshot; if it differs from the repository, the repository wins.
**Owner:** Anshuman (product and code decisions)

---

## 0. Read this first (for people and AI reviewers)

This document is the source of truth for **what LocalMind is meant to do**. Several behaviours look like bugs from the code alone but are deliberate. Before you report anything:

1. **Check section 13 (Do Not Flag).** Anything listed there is intentional. Don't report it as a defect. If you think one of them is still a problem, list it under "Questions for the owner" with your reason, not under "Findings".
2. **Check section 12 (Invariants).** A real bug is one that breaks an invariant, a requirement in sections 2–11, or a user's data or security.
3. **Check section 15 (Resolved).** Don't re-report something fixed there. If it has come back, call it a **regression** and name the commit.
4. **Check section 14 (Known open issues).** Don't re-report these as new. Mention them only if their status changed.
5. **Verify against the code** before reporting. Quote the file and line. Say plainly what you didn't run (for example PostgreSQL, a real phone, a real AI model).
6. **Classify every finding** as one of: **Bug** (breaks sections 2–12), **Regression**, **Documentation error**, **Housekeeping** (tests, comments, tooling), **Performance note**, or **Question for the owner**.
7. **Use the product's words** (section 17), not internal code names, when writing for the owner.

---

## 1. Product summary

LocalMind turns a textbook (PDF, DOCX or DOC) into a course: chapters, modules, guided lessons, quizzes and an "Ask a doubt" tutor, for a department or school.

- **AI runs on the user's own device.** Lessons, quizzes and Private-library doubts are written by a small language model on the faculty member's or student's laptop or phone. Book text and questions are not sent to any AI company.
- **Works offline.** Students can read, take quizzes and study their own books without a connection. Work done offline is sent when they reconnect.
- **Three portals:** Administrator, Faculty, Student, on the website (laptop), the Android app and the iOS app.

---

## 2. Users and roles

| Role | What they do | Workspace |
|---|---|---|
| **Administrator** | People (create, Excel import, reset password), subjects, faculty assignment, AI monitoring, System readiness, Audit log | `/admin` |
| **Faculty** | Teaching subjects, Books & modules (upload, outline, publish), lessons and quizzes (written on their device), Synchronize all, Manage quizzes, results | `/manage` |
| **Student** | My subjects, reading, guided lessons, My quizzes, Ask a doubt, My progress, Course sync, Private library, Offline AI | `/student` |

**Accounts:** new accounts, Excel imports and password resets all use **one shared initial password**. The person **must change it on first sign-in** (`must_change_password` is set on every new account).

---

## 3. Platforms and deployment

| Item | Current setting |
|---|---|
| Website | Expo web export served by the backend; production **https://localmind.onesmarter.com** (AWS EC2, Docker Compose, PostgreSQL 16) |
| Android app | Expo SDK 54 / React Native 0.81, package `com.onesmarter.localmind`, **version 1.0.1 (build 2)**, arm64-v8a, Android 7.0+ (API 24), points at the production URL |
| iOS app | Same code; built on a Mac or with EAS; iOS 15.1+ deployment target |
| Local and testing | Windows laptop with `start.bat` / `run_localmind.py` (SQLite); testers through Tailscale |
| Backend | Django 5.2, Django REST Framework, SimpleJWT; a single monolith by design |
| On-device AI | Laptop: `@wllama/wllama` 3.6.1 (WebGPU when available, else CPU). Phone: `llama.rn` 0.10.0 with a patched grammar/stops runtime |
| Server AI (optional) | Embedded `llama-cpp-python` (Qwen3-1.7B). Used for grading typed answers, the course tutor and AI monitoring when configured. **Not** used to write lessons, quizzes or outlines while `DEVICE_AUTHORING_ONLY` is on |

Deployment and build steps are in `docs/AWS_EC2_RUNBOOK.md`, `docs/DEPLOYMENT.md` and `frontend/MOBILE_BUILD.md`.

---

## 4. Architecture in one page

- **Backend apps** (see `docs/ARCHITECTURE.md`): `accounts`, `academics`, `documents`, `learning`, `assessments`, `tutor`, `jobs`, `activity`, `analytics`, `ai`, `ai_monitor`, `audit`, `private_library`, `study`. `assignments` is retired (historical records only).
- **API portals by prefix:** `/api/auth/`, `/api/admin/`, `/api/faculty/`, `/api/student/`.
- **Frontend:** `frontend/app/` (routes per portal), `frontend/src/private/` (on-device AI, Private library, doubts, model setup, notifications), `frontend/src/authoring/` (faculty generation on device), `frontend/src/offline/` (offline copy and sync), `frontend/src/ui/` (design system, in-app dialogs).
- **Native module:** `frontend/modules/localmind-background/` (Android foreground service, iOS continued processing), configured by `frontend/plugins/*.js`.
- **Grounding rules exist twice and must match:** `frontend/src/private/core.ts` (device) and `backend/tutor/services.py` (server tutor).

---

## 5. Faculty flow: from book to students

1. **Upload a book** (PDF, DOCX or DOC; TXT is refused) in Books & modules.
2. **The outline** (chapters and modules) is built by rules on the server. Faculty review and edit it, then **publish**.
3. **The faculty member's own device writes the lessons and quizzes** (`DEVICE_AUTHORING_ONLY` is on by default). The device needs the AI model (Offline AI) and **LocalMind must stay open** while it writes, which takes about 1.5–2.5 minutes per module on a laptop CPU. The phone continues in the background (section 7).
4. **Synchronize all** (on the book's page) sends everything that is **ready at that moment**, even while generation is still running. The part still being written waits for a later press.
5. **Generation claim:** only one device per login generates a given book. A second device is told "generation already started on that device" and can **Take over** (audited). A device that was offline generates anyway and claims when it reconnects; **the first to reconnect wins**, and the other keeps its drafts without sending them.
6. **Content already synchronized by another faculty member shows as synchronized, with their name**, so it isn't generated twice.
7. **Quizzes:** from one module (with its lesson) or a **multi-module AI quiz from selected modules only**, or written by hand.
8. **Results:** grading and **releasing** are separate steps. Students see a score only after release.

---

## 6. Student flow

- **Read** a module, open its **guided lesson** (already written; never generated when the student opens it), take the **quiz**, **Ask a doubt**.
- **My progress** shows completion (section 9).
- **Offline:** the app keeps a copy of their courses. Quiz answers and reading done offline are queued and sent on reconnect (`course_sync`), then fresh data is fetched.
- **Private library:** a student can import their **own** book. It is processed **on the device** (scanned pages with English text recognition), never uploaded, and is visible only to that account on that device.

---

## 7. On-device AI

### 7.1 Models

| Model | Where | Size | Pinned |
|---|---|---|---|
| Qwen3-1.7B Q4_K_M | Laptop (and phone option) | 1.11 GB | Commit `d7f544ee…`, sha256 + md5 checked |
| Qwen3-0.6B Q4_K_M (fast phone model) | Phone | 397 MB | Commit `f2d6f9ca…`, sha256 `ac2d9771…0d524a` |

- Downloads are **resumable** and **verified**; a file with different bytes is rejected.
- A laptop can store the model in browser storage or in a folder the person chooses.
- **GPU is not forced.** The phone measures GPU against CPU once and keeps the faster one; the laptop uses WebGPU when the browser offers it and falls back to CPU.

### 7.2 Model setup after sign-in (`ModelGate`)

- Shown to **every** signed-in user (all roles) who has no model on the device.
- **Anyone can continue without it**, on laptop, Android and iOS, after a confirmation pop-up. The choice is remembered **per account, per device**, cleared when a model is installed, and a short reminder appears **once per app start**.
- Reading, quizzes and sync work without the model. Writing lessons and quizzes and Ask a doubt say "Download or import a model in Offline AI first."

### 7.3 Status and notifications

- **In-app status:** phone "Reading the material… 14s" → "Writing… 3s" → "Fixing the format… 2s". The laptop shows one step, **"Reading and writing… 12s"**, because the browser runtime returns the whole answer at once. No CPU, GPU or token counts in student-facing status.
- **Progress lines:** "Module 2 of 5 · Lesson · Part 1 of 3 · …", always "N of M".
- **Android:** a foreground service (type **specialUse**) keeps generation going when the person switches apps. The notification title names the job ("Writing lessons — Chapter 4", "Answering your question"). Its bar counts **finished items** and never goes backwards; while an answer is written it shows a busy bar. When lessons or quizzes finish **while LocalMind is not on screen**, Android shows **"Lessons ready"** (channels "Work in progress" and "Lessons and quizzes ready").
- **iOS:** iOS 26 continued-processing task (CPU off screen unless background GPU is enabled); older iOS pauses and resumes. **No "ready" notification on iOS** (it would need another permission prompt).
- **Laptop:** a Web Lock keeps the tab from being frozen. There is **no "Leave site?" box** for AI work (see section 11).

---

## 8. Ask a doubt (grounding rules)

Applies to the Private library and course doubts, on the device and on the server tutor.

1. A question is **judged against the module first**. If the passages found never mention its subject, it is **refused before the AI runs**: "I could not find the answer in this module…". One-word subjects ("What is maths") are judged too.
2. **Matching allows** plurals and related forms (encrypt/encryption, attack/attacker) and small typos that keep the first letter (columb/coulomb). It does **not** treat look-alikes as the same subject (maths≠paths, physics≠physical).
3. A question with no subject of its own ("explain more", "why?") is left to the conversation (a follow-up).
4. The AI may only quote **sentences about the question**. Headings ("Notable Groups:") and LocalMind's own reading labels ("[Chapter 4 · Reading 2]") are never quotes.
5. An answer is refused if its quote doesn't mention the question's subject, or if it names people, places or numbers absent from the module.
6. **Refusals look different:** an amber "Not in this module" note, without a source line.
7. **Chat behaviour:** the question stays visible until its answer is saved. The list never blanks while it refreshes. "Latest" appears only when the reader has scrolled up, and never covers text.

---

## 9. Progress and completion

- A module **completes** when every step that exists is done: **read**, **lesson viewed** (if a lesson exists), **quiz attempted** (if a quiz is published). **Pass or fail both count as attempted.**
- **"Needs review"** is not a status. It is **calculated**: a **released** quiz score below the module quiz's pass mark (`below_pass_mark()`). Faculty screens and the student report both use it. **Held results are never counted** in a student's own view.
- **Reopening:** a completed module reopens, with a label, when a **new quiz** is published or its **content changes** ("New quiz published", "Content updated"). **Completions set by faculty are never reopened.**
- Reading or opening a lesson offline still completes modules after sync.

---

## 10. Quizzes

- **Manual quizzes:** 2 to 6 options (A–F). **AI quizzes:** exactly 4 options, real options (no placeholders), questions readable without internal words like "source text".
- **A quiz cannot be published** while its book is unpublished or its module is locked; LocalMind shows a pop-up instead of opening the module.
- **Time limits are advisory:** a late submission is accepted and annotated, not rejected.
- **Typed or subjective answers** are graded by a background job on the server (`jobs` app). Submitting never waits for the AI. A missing model never produces a false zero; the job retries.

---

## 11. Pop-ups and wording

- **Every pop-up LocalMind needs is LocalMind's own dialog** (`frontend/src/ui/Confirm.tsx`, `DialogHost`), the same on laptop, Android and iOS. The app never uses the browser's `alert`/`confirm`.
- **System prompts that no app can replace** (Android "Allow notifications?", the browser's folder chooser and access box, Firefox's storage prompt, device file pickers, the phone share sheet) are **always preceded by LocalMind's own explanation** where one is needed, and "Not now" skips the system prompt.
- **Destructive actions ask first:** delete, archive, sign out (warns that the offline copy is removed), Discard/Cancel of unsaved edits, continuing without the model, stopping a download.
- **The browser's "Leave site?" box** is used **only for unsaved edits** (it cannot be restyled). AI writing and model downloads resume by themselves, so they don't use it.
- **Wording rules:** every in-progress message ends in "…"; one name per concept (glossary, section 17). The administrator **System** page keeps technical names on purpose.

---

## 12. Invariants (must always hold)

1. **Book text, questions and learner data are never sent to an external AI provider.** Inference runs on the device, or on the institution's own server when configured.
2. **Lessons are never generated when a student opens a module.** Students only read stored lessons.
3. **Anything shown as from the book is an exact sentence from the book**, and every AI answer, lesson section and question is checked against the module text.
4. **Held quiz results are never visible to the student**, in any count or average.
5. **Only one device per login generates a given book** (generation claim). A losing device never overwrites the owner's content.
6. **Offline work is never lost silently.** It is queued and sent on reconnect, or kept on the device with a clear message.
7. **Completions set by faculty are never reopened automatically.**
8. **Modules with no text never appear to students.** They are removed, or kept hidden when a quiz or student work refers to them.
9. **Nobody is locked out by the model:** every user can continue without it.
10. **Role scope:** each API route belongs to exactly one portal. Faculty see only their subjects; students only their enrolments.
11. **Downloaded models are verified** (sha256/md5) and pinned to a commit.
12. **No secrets in the repository:** no keystore, signing password, `.env` file or API key.
13. **Tests run on Windows, Linux and macOS.** Use `pathToFileURL()` for `import()` of absolute paths, and relative paths in generated code.
14. **Locked database queries that also join must lock only their own rows** (`select_for_update(of=("self",))`), because PostgreSQL refuses FOR UPDATE on the nullable side of a join. A guard test enforces this.

---

## 13. Do Not Flag (intentional behaviour)

| # | Behaviour | Why it is intended | Where |
|---|---|---|---|
| 1 | Faculty devices write lessons and quizzes; the server doesn't (`DEVICE_AUTHORING_ONLY=True` by default) | Privacy and cost; no AI server needed for authoring | `backend/core/generation_policy.py` |
| 2 | Server AI outline step returns nothing while device authoring is on; outline comes from rules | Same reason; the rule-based outline is editable | `documents/services/outline.py:58` |
| 3 | The 120 s AI timeout only limits **waiting** for the embedded model, not generation | Harmless while the server doesn't write lessons | `ai/llamacpp.py`, `config/settings.py` |
| 4 | A failed quiz still completes the module; "Needs review" is a calculated flag | Product decision on completion | `learning/services.py` (`refresh_completion`, `below_pass_mark`) |
| 5 | No `needs_review` status is written any more | Replaced by the calculation above | same |
| 6 | `progress_map()` refreshes completion (and may write) on every read | Accepted (audit F4); a stored text hash may speed it up later | `learning/services.py` |
| 7 | A second device on the same login is blocked from generating a claimed book | Generation claim, with audited Take over | `documents/generation_claims.py` |
| 8 | Multi-module selection quizzes (`LocalQuizView`) skip the generation claim | A deliberate faculty action must not claim a whole book | `documents/local_authoring.py` |
| 9 | Everyone, including admins and faculty, can skip model setup | Nobody must be locked out | `frontend/src/private/ModelGate.tsx`, `modelSkip.ts` |
| 10 | No "Leave site?" box for AI writing or downloads | They resume by themselves; the box is a browser pop-up | `backgroundWork.web.ts` |
| 11 | "Leave site?" remains for unsaved edits | Those would really be lost | `frontend/src/hooks/useDraft.ts` |
| 12 | Laptop shows one AI step ("Reading and writing…") | Browser runtime returns the answer whole | `frontend/src/private/device.web.ts`, `aiStatus.ts` |
| 13 | Android "ready" notification only; none on iOS | Avoids another iOS permission prompt | `modules/localmind-background` |
| 14 | Android foreground service type **specialUse** | Needed for background generation (Play Console declaration required before release) | `GenerationService.kt`, `withBackgroundGeneration.js` |
| 15 | Fast 0.6B phone model alongside the 1.7B model | Speed on ordinary phones | `frontend/src/private/modelSpec.ts` |
| 16 | Manual quizzes 2–6 options; AI quizzes exactly 4 | Product decision | `assessments`, `ai_monitor/validators.py` |
| 17 | Quiz time limits are advisory | Late work is annotated, not refused | `assessments` |
| 18 | One shared initial password for new accounts, imports and resets | Temporary decision; forced change on first sign-in | `accounts` |
| 19 | The service worker precaches the whole app shell on install | Needed for offline start | web export / offline manifest |
| 20 | App and EAS point at `https://localmind.onesmarter.com` | Production host | `frontend/app.json`, `eas.json` |
| 21 | Android and iOS work is in scope, done by the owner | Scope changed in Sept 2026 | — |
| 22 | Admin System page shows Docling, Django API, parser | Diagnostics page for administrators | `frontend/app/admin/system.tsx` |
| 23 | Release builds fall back to the debug key (with a Gradle warning) when no upload key is configured | Lets local test builds keep working; real key is set per machine | `frontend/plugins/withReleaseSigning.js` |
| 24 | `android/` is committed **and** `npm run prebuild` is `expo prebuild --clean` | Native settings live in `app.json` and `plugins/` so a clean prebuild reproduces them | `frontend/app.json`, `plugins/` |
| 25 | Off-topic doubts refused before the AI runs; refusals shown as an amber note | Grounding rules, section 8 | `frontend/src/private/core.ts`, `library.ts` |
| 26 | No CI set up on the `ui/portal-improvements` branch | Owner's decision; don't raise again | — |
| 27 | `draft_persistence.test.cjs` isn't in an npm script | It runs through `scripts/check_offline_study.py` | `scripts/` |
| 28 | The offline copy refreshes every 15 minutes (on sign-in, reconnect, and returning to the app after 2+ minutes too), not every minute; no timed refresh while hidden or under Data Saver | Online screens always read live from the server; the copy only matters offline, and the old 1-minute poll was the costliest traffic in the app | `frontend/src/offline/sync.ts` |
| 29 | The faculty portal stays at `/manage` (routes `frontend/app/manage/…`) | Owner's decision (1 Oct 2026): keep the route as it is; don't propose renaming or moving it | `frontend/app/manage/` |
| 30 | No app-wide wording sweep is planned (the p9 review was dropped) | Owner's decision (1 Oct 2026). Report a wrong or misleading text only when it gives users incorrect information | — |
| 31 | Tester APKs are signed with the Android debug key and always built on the same laptop; no upload key exists yet | Owner's decision (1 Oct 2026). An upload key and the Play Console specialUse declaration are needed only for a Google Play release; the steps and the declaration text are in `frontend/MOBILE_BUILD.md` | `frontend/plugins/withReleaseSigning.js`, `frontend/MOBILE_BUILD.md` |

---

## 14. Known open issues (real, not yet fixed)

None. Everything reported so far is either fixed (section 15) or a decision recorded in section 13.

---

## 15. Resolved (don't re-report; call it a regression if it returns)

| Area | Fix | On `main` |
|---|---|---|
| Doubts | Off-topic one-word questions answered from the model's own knowledge; unrelated or heading quotes; refusal styling | PR #5 (`f4aae3a`) |
| Doubt chat | Question vanished, page jumped, "Latest" stuck or covering text | PR #5 |
| Pop-ups | Skip/sign-out/cancel confirmations; discard confirmations; explanations before system prompts | PR #5 |
| Wording | One AI status on laptop and phone; progress messages; notification titles; forward-only progress bar; Android ready notification | PR #5 |
| F1 | Naive `started_at` crashed the claim endpoint (Django 5 removed `timezone.utc`) | `c3afac7` |
| F2 | Student report "needs review" always 0 | `c3afac7` |
| F3 | Claim docstring overstated coverage | `c3afac7` |
| PostgreSQL | **AI grading failed on PostgreSQL** (FOR UPDATE on a nullable join) | `90968ca` |
| Doubts | Reading title label offered as a quote | `90968ca` |
| Tests | 11 unwired test files now run (`local-ai-json` + 10 older) | `c3afac7`, `90968ca` |
| APK | Debug-key signing path, overlay/storage permissions, version 1.0.1 (2), pinned phone model, build docs | `90968ca` |
| Windows | `local-ai-json` and `editor-state` tests failed on Windows paths | `90968ca`, `cc9fff2` |
| Getting Started guide | No model-download step for faculty, "a few minutes" timing, TXT listed, five faculty steps against three on the Overview, Synchronize all location, phone model size, Quick help cause, orphaned table row | `84d65ee` |
| Tooling | `npm run typecheck` and `npm run lint` failed on a clean install with scripts disabled (generated parser files missing); both now run `prepare:private` first (`pretypecheck`, `prelint`). If `lint` still shows the two errors on an old checkout, delete `frontend/.expo/cache/eslint/` once | `5581194` |
| Offline sync | The offline copy refreshed every minute: staff fetched the whole teaching corpus one request at a time (~260 a minute for a two-book teacher) and rewrote storage each time; students downloaded the whole course. Now a full refresh every 15 min while on screen, queued course work retried every minute, nothing while hidden, no timed refresh under Data Saver, staff storage rewritten only when the copy changes, and students get `{"unchanged": true}` from `/api/student/offline/?since=<version>` | open-items patch, 1 Oct 2026 |
| iOS version | iOS build number was 1 and version 1.0.0; now 1.0.1 (build 2) like Android, and `tests/android-release.mjs` checks all version fields agree | open-items patch, 1 Oct 2026 |
| Model download | No mobile-data note before the download; the prompts now say the size uses that much data and Wi-Fi is better | open-items patch, 1 Oct 2026 |
| Build docs | Stale "sign with your own keystore / debug build installs as-is" line in `frontend/MOBILE_BUILD.md` (recheck R8) replaced; iOS versioning and the Play Console specialUse text added | open-items patch, 1 Oct 2026 |

---

## 16. How work is delivered and checked

- **Patches:** one patch per change set, with a **new distinct filename**, created with `git format-patch`, applied with `git am --3way --ignore-whitespace`. No `node_modules`, build output or keystore in a patch. Don't push unless the owner says so.
- **Gate before delivery:**

| Check | Required |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | Clean (max warnings 0) |
| `npm run test:private` | 0 failures (35 files at time of writing) |
| `npm run test:native` | 0 failures |
| Django suite | 0 failures on **SQLite and PostgreSQL 16** |
| `makemigrations --check` | No changes on both databases |
| `npm run export:web` | Succeeds |
| React Compiler | No new components skipped |

- **Always state what wasn't tested** (real phone, real model, Playwright suites, live server).
- **Version rule:** raise `expo.version` + `expo.android.versionCode` in `app.json` **and** `versionName` + `versionCode` in `android/app/build.gradle` together; `tests/android-release.mjs` checks they match.
- **Native settings** go in `app.json` or `frontend/plugins/`, never only in `android/`.
- **Deploy:** EC2 follows `main`. Backend changes need `docker compose up -d --build`; migrations run automatically at container start. Phone changes need a new APK/iOS build.

---

## 17. Glossary (product words)

| Say | Means | Avoid in user-facing text |
|---|---|---|
| Offline AI | The on-device AI feature and its screen | Local AI, on-device AI |
| AI model | The downloaded model file | local model, offline model, GGUF (except on the import button) |
| Book | An uploaded textbook | document (in UI) |
| Module | One study unit of a book | section |
| Guided lesson | The lesson written for a module | — |
| Ask a doubt | The question-and-answer tutor | — |
| Private library | A student's own books, on their device | Private Library |
| Synchronize all / sync | Sending device-written content to the institution | — |
| Generation claim / Take over | One device per login writes a book | — |
| Needs review | Released score below the pass mark (calculated) | a status |
| Release (results) | Making graded results visible to students | — |
| Administrator | Admin role | admin |

---

## 18. Change history

| Date | Change |
|---|---|
| 30 Sep 2026 | v2.0: rewritten after PR #5, audit follow-ups, PostgreSQL grading fix, APK review and Windows test fixes. Adds grounding rules, completion rule, pop-up policy, notifications, invariants 9–14, Do Not Flag 1–27. Earlier notes that "lessons are generated in the background on the server when a book is uploaded" are **superseded** by device authoring (section 5) |
| 1 Oct 2026 | v2.1: the PRD is in the repository as `docs/PRD.md`, which is the master copy (header). The Getting Started guide corrections are resolved (`84d65ee`): moved from section 14 to section 15, and the remaining open issues renumbered |
| 1 Oct 2026 | v2.2: "typecheck and lint on a clean install" added to section 15 (Resolved, `5581194`) |
| 1 Oct 2026 | v2.3: staffBundle/offline sync, iOS build number, mobile-data note and build docs resolved; Play Console text written (the upload key itself stays open). Section 14 now lists 3 items |
| 1 Oct 2026 | v2.4: the wording review (p9) is dropped and removed from section 14 and section 11; the `/manage` route stays as it is (Do Not Flag #29, #30). Section 14 now lists 1 item |
| 1 Oct 2026 | v2.5: restores v2.4 after commit `d96d055` replaced it with the older v2.2 by mistake; the upload key is no longer an open issue (Do Not Flag #31: tester APKs stay debug-signed and built on one laptop until a Google Play release). Section 14 is empty |
