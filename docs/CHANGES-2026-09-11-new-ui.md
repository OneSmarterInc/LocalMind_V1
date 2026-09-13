# New interface: LocalMind UI direction 01 (11 September 2026)

The web and mobile client (Expo, `frontend/`) follows the design in `LocalMind_UI_Preview.html`: a calm green palette, a white sidebar, a top bar with a two-level breadcrumb and a page finder, and the page layouts of all 84 preview screens. The work was done in two rounds.

- **Round 1:** reskinned the app.
- **Round 2:** fixed every mismatch found in a screen-by-screen audit (`UI-mismatch-report.md`, sections A to E), plus the approved backend items F1, F2, F3, F6, F7 and F8.

F4 (a daily learning-time chart) and F5 (assigning an incident to another administrator) were **not implemented**, as agreed.

**Base:** `development` at `0aaaa57`. Nothing was pushed.

## Upgrading

1. **Unzip:** unzip over the project, keeping `backend\.env`, `backend\db.sqlite3`, `backend\media` and `backend\models`.
2. **Build the web client:** in `frontend`, run `npm install` (no new packages) and then `npm run export:web`.
3. **Restart:** `run_localmind.py` applies the one new migration (`assignments/0004_assignment_max_attempts`) on start. If you run the server another way, run `python manage.py migrate` first.

## Backend changes (all additive)

| Item | Change |
|---|---|
| F1 | `GET /api/student/subjects/` returns `faculty_names` for each subject |
| F2 | `GET /api/faculty/analytics/students/{id}/subjects/{subject_id}/` also returns `quiz_attempts`: recent attempts with quiz, attempt number, status, percentage and whether results are released. Faculty and admin view only; the student's own analytics do not carry it |
| F3 | New `GET /api/faculty/analytics/activity/`: recent quiz attempts and assignment submissions (grouped per item and day), books reaching review or publication, and lessons generated. Limited to the caller's subjects |
| F6 | `Assignment.max_attempts` (nullable). With resubmission allowed it caps the total submissions; going over returns 409 `ATTEMPT_LIMIT`. Create and update accept it |
| F7 | Book details include `published_by_name` |
| F8 | `GET /api/student/modules/{id}/` returns `module_number`, `module_count` and `faculty_names` |
| Extra (read-only) | Class roster rows include `best_quiz_percentage`, and the admin subject snapshot includes `modules_published`. They feed the design's "Best quiz" and "Published modules" columns |
| Extra (read-only) | Quiz attempts and assignment submissions include `student_name`, so attempt, review and marking pages show the student's name as in the design |

- **Tests:** `backend/analytics/tests_ui_additions.py` (8 tests).
- **Docs:** `openapi.yaml` was regenerated; `docs/API.md` and `docs/DATABASE.md` are updated.

## Design system and shell

**Tokens and building blocks.** Tokens (`src/ui/theme.ts`) are the design's. The kit (`src/ui/index.tsx`) provides:

- **Layout:** page heading with eyebrow, cards, split and grid layouts, stat row, hero card.
- **Tables:** sentence-case headings, the row action column right after the data, and a "Showing N records" footer.
- **Pickers and controls:** dropdown select, option cards, underlined text-only tabs.
- **Notes and boxes:** notes with titles, empty states, form footer (note left, buttons right), numbered step list, full-width danger box.
- **States:** a request-failed card ("Let's try that again.").

**Shell** (`src/ui/Shell.tsx`):

- **Sidebar and top bar:**
  - white sidebar with the role's menu; bottom links ("Content workspace" for administrators) sit above My profile;
  - top bar with a two-level breadcrumb, Find a page (Ctrl K), connection status, and the account menu showing the full name;
  - "New to LocalMind?" guide;
  - phone drawer.
- **Offline notice (students):** shown under the page title, not above the whole app.

## Screens

**Sign-in.**

- **Welcome and sign-in:** the welcome page and the three sign-in pages use a 50/50 layout.
- **Change password:** field hints and a form footer.
- **Expired session:** a dedicated "Please sign in again." page.

**Student.**

- **Overview:** stats; "Pick up where you left off" with "Up next" and the learning card beside it; subject cards with faculty and progress.
- **Subjects and books:**
  - **My subjects:** 3 columns, empty state "You're in. Let's find your classes.";
  - **Subject details:** book rows with progress;
  - **Book & chapters:** numbered chapters, progress card and a separate lock note.
- **Module:**
  - **Read:** text size inside the reading card, "Explore the lesson" bottom right;
  - **Lesson:** label and badge, intro, two-column terms, "Check my understanding" inside the card;
  - **Other states:** Ask a doubt; locked (the page keeps the module title); lesson being prepared; tutor unavailable (shows the module text with a retry).
- **Quizzes:**
  - **My quizzes:** table with a titled note and subject dropdown;
  - **Quiz instructions:** badge in the card, tips, "Start quiz" bottom right;
  - **Taking a quiz:** progress bar, letter tiles, Next and "Review & submit" together;
  - **Result:** feedback boxes, "Make the next attempt easier";
  - **Results held:** one card.
- **Assignments:** table; assignment task with "Include these points"; single-column submitted view.
- **Other pages:**
  - **My progress:** subject rows with icon, small bar and chevron;
  - **Offline reading library:** side-by-side cards;
  - **My profile:** design layout.

**Faculty.**

- **Overview:** hero plus next actions and recent teaching activity (F3); subject cards.
- **Subjects:** teaching subjects; subject overview, students and modules tabs; student progress page with a module table and quiz attempts (F2).
- **Books:**
  - **Books & modules:** table and dropdown filters; upload page with stepper and subject dropdown;
  - **Book page:** stepper; processing card; "Book outline" with "Add module"; editor order with source mapping and "Open to students when published"; save bar with "Review & publish";
  - **Lessons & quizzes:** readiness tab; lesson preview view;
  - **Publish:** checklist with badges; published-book page with Archive and the delete box.
- **Quizzes (rebuilt, `src/screens/QuizWorkspace.tsx`):**
  - **List and create:** list; create page with a module checklist.
  - **Quiz page:**
    - **Questions:** radio answers, side cards, floating save bar;
    - **Source modules:** the module text;
    - **Settings & release:** three result-release options, lifecycle box;
    - **Student attempts:** table with "Release all results".
  - **Review pages:** held automatic quiz review (review note, false alarm, confirm the issue); separate attempt review page (`/manage/attempt/[id]`).
- **Assignments (rebuilt, `src/screens/AssignmentWorkspace.tsx`):**
  - **List and create:** list and create page.
  - **Assignment page:**
    - **Task & rubric**;
    - **Source material**;
    - **Settings:** "Maximum attempts" (F6), late submissions, result release;
    - **Submissions:** table with "Release evaluated results".
  - **Marking page:** separate "Review submission" page (`/manage/submission/[id]`).

**Administrator.**

- **Overview:** hero with system status ring, "Administration at a glance", 2 × 2 common tasks, subject snapshot, system readiness.
- **People:**
  - **Tables:** avatars and status dropdown;
  - **Add a person:** "Account type" dropdown;
  - **Excel import:** "Download template" inside the columns panel; report with Name/Email columns and "Return to import";
  - **Manage account:** green identity card, email on its own row, delete box at the bottom.
- **Subjects:** table, create page and subject pages in the design layout.
- **Content workspace:** its own page (`/admin/content`).
- **AI monitoring:**
  - **Monitoring page:** tabs under the title, dropdown filters, reporting window and weekly chart. "Evaluate pending" appears in a note when interactions are waiting.
  - **Incident review:** decision dropdown with a required note, checks table. "Assign to me" is kept, since F5 was not built.
  - **Monitoring policies:** one card with a single Save.
- **Audit trail:** "More filters" link, one-line times, outlined "Details".
- **System readiness:** full-width component table, cards below, and a dedicated "The AI model needs attention." state.

## Behaviour notes

- **Page structure:** quizzes and assignments have separate list, item, attempt-review and submission-marking pages. Old `?quiz=` and `?assignment=` links redirect.
- **Faculty subject tables:** they no longer offer "Remove". Enrollment is discontinued from the student's progress page.
- **Book publishing:** a published book opens on its published-book page. "Mark as ready" is a link on the publish checklist; publishing directly still works.
- **Tutor unavailable:** when the tutor cannot write a lesson, students see the original module text with a retry. The fallback is not presented as a generated lesson.
- **Failed lists:** a list that fails to load shows "Let's try that again." instead of an empty table.

## Verification

| Check | Result |
|---|---|
| Backend unit tests | 432 of 432 |
| Migrations | none missing (`makemigrations --check`) |
| Black-box system test | 213 of 213 |
| `tsc --noEmit`, `eslint app src` | clean |
| Production web build: every page for every role, desktop and phone width | 50 pages, 0 errors |
| Development build (React warnings visible) | no warnings from app code |
| Design comparison: all 83 app states recaptured at 1440 px next to the preview | done |
| Button flows in a real browser | 25 of 25 pass |

The 25 flows cover:

- **Student:** ask a doubt; lesson and text size; take a quiz; submit an assignment; page finder and guide.
- **Faculty:**
  - lock and reopen a module;
  - create a quiz;
  - book pages;
  - release held results;
  - unpublish and republish a book;
  - enrollment picker.
- **Administrator:**
  - create a subject and assign faculty;
  - add a person;
  - reset a password and audit filters;
  - monitoring tabs and system status;
  - discontinue and reactivate an account;
  - archive and delete a subject;
  - Excel import report;
  - phone menu.
- **Sign-in and states:**
  - real sign-in with the forced password change and empty state;
  - wrong password;
  - expired session;
  - locked module;
  - held results;
  - offline mode.

## Recheck against the report (second pass)

**Method.** Every item in `UI-mismatch-report.md` was checked again against all 83 app states recaptured from the final build: 154 checks across sections A to F, from on-screen text and element positions plus the code for states the demo data cannot show. **All pass.**

**Fixed during the recheck.**

- **Row action buttons:** they now start where the design's table places them. Measured against the design they are within about 30 px (previously 50–150 px further right).
- **Avatars:** people identified only by email (quiz attempts, submissions) get two-letter avatars.
- **Monitoring table:** its footer reads "Showing N of M incidents".
- **Expired session:** the "Please sign in again." page no longer disappears if the sign-in page opens before the server's rejection arrives. The notice now stays until it is dismissed or the person signs in. One run in four had lost it.

**Student names (approved after the recheck).** Attempts and submissions now include `student_name`. The attempts table, the attempt review title ("Aditi Sharma · Attempt 1"), the submissions table and the marking page ("Review Aditi's submission") show names, with the email as a fallback. Nothing in the report remains different.

**Evaluation rerun on the final build (after student names).** Backend unit tests 432 of 432; no missing migrations; `tsc` and `eslint` clean; report items 154 of 154; button flows 25 of 25. The system test passed 213 of 213 twice. One earlier run failed one existing concurrency check ("parallel process calls: exactly one wins"), which starts the same book processing from several requests against SQLite; nothing in this work touches that code.

## Round 3: fixes from the 22-issue review

All 22 reported issues were checked against the code and live behaviour before changing anything. 20 were confirmed and 1 was partly confirmed; issue 3 (an outline update loop) could not be reproduced but its unstable dependency was cleaned up anyway. Everything was then fixed in the agreed order.

### Data leaks

- **1. Held quiz results:** the student quiz list no longer returns a best score or pass/fail for attempts whose results are held. It adds `results_pending` and counts attempts correctly (the count used to reset when a better attempt was found). The quiz page shows "Not released yet" instead of "Your best so far".
- **2. Offline copy per student:**
  - saved content is stored under the signed-in student;
  - sign-out empties the storage scope before clearing, so a download or request that finishes afterwards has nowhere to write;
  - a download belongs to the student who started it, and the next student never reuses it.

### Lost work

- **4. Unsaved edits:**
  - a background reload (such as when the window regains focus) no longer replaces unsaved edits on the quiz, assignment, outline or marking pages; a note appears if the server copy changed meanwhile;
  - leaving the Outline tab with unsaved edits asks to save first;
  - Publish and Close are disabled while there are unsaved changes;
  - closing or reloading the browser warns.
- **6. Saving quiz settings:**
  - the screen sends questions only when they changed;
  - the backend updates settings in place and makes a new version only for real question changes;
  - new versions keep selected modules and result-release settings;
  - quizzes spanning several chapters no longer fail.
- **15. Student drafts:** quiz answers and assignment responses are kept on the device per student and per attempt or assignment, restored after a refresh or resume, and removed after submitting. Grading stays on the server.

### Wrong data and states

- **5. Long lists:** list requests fetch every page, so screens show all records, "Showing all N" is true, and older attempts and submissions are found.
- **7. Correcting a held quiz:** "Publish corrected quiz" records the finding as confirmed and publishes the corrections. Saving corrections no longer leaves no way to publish.
- **8. Held quiz review:** it uses the monitor's own evidence and names the flagged question when the finding identifies one. Otherwise it says so and lists every question.
- **9. "No limit" and empty dates:** a blank attempt limit saves as no limit, and `null` clears limits and dates.
- **10. Subject filter:** student quizzes include `subject_id`, so quizzes spanning several modules keep their subject in the filter.
- **11. Result labels:** "Held" and "Released" follow the server's rule (immediate, released for the quiz/assignment or for one item, or past a scheduled time). Submissions include `results_released_at`, and the attempts table refreshes after a release.
- **12. Stale results:** only the most recent request can update a screen.
- **13. Resubmission limit:** the assignment shows "Submission X of N", and once the limit is used it says so instead of offering a new version.
- **14. Offline readiness:**
  - a new download removes content that was locked or removed;
  - storage failures are reported as errors;
  - the offline notice says nothing is saved until a download has succeeded;
  - the saved-conversation count reads the stored format correctly.
- **20. Archived books:** a read-only page with delete as the only action.
- **21. Publish checklist:** automatic quizzes show their real state: Turned off, None yet, In progress, Some failed, Review needed or Ready.

### Usability

- **16. Outline editor:** it sizes to the space it actually has, not a 980 px minimum and the window width. It stacks below 820 px of its own width and keeps "Save changes" and "Review & publish" in view.
- **17. Dropdowns:** they open above the field when there is no room below and stay within the screen, including above a phone keyboard.
- **18. Links and sidebar:** "Open the lesson" opens the Lesson tab, and "Open module" opens the outline with that module selected. Detail pages keep their sidebar section highlighted, and the highlighted item is announced as the current page.
- **19. Answer review:** "Review & submit" opens a real review of every answer with "Change" buttons. The timed-quiz wording is one policy: answers are submitted automatically when the time runs out, otherwise only on confirmation.
- **22. Dates, text and screen readers:**
  - date/time pickers in the person's time zone (with the zone shown) replace raw timestamps on quiz, assignment, result-release and audit fields;
  - helper text is at least 11 px;
  - tables expose table, row, column-header and cell roles;
  - tabs, sidebar items and option cards expose their selected or checked state.

### Cleanup

- **3. Outline editor:** its save function no longer depends on a value that changes every render.

### Tests

**Backend.** `backend/assessments/tests_round3.py` has 6 tests:

- held scores are withheld from the list, and attempts are counted;
- settings saves update the quiz in place;
- a new version keeps modules and release settings and works for a quiz spanning several chapters;
- `null` clears limits and dates;
- assignment dates clear, and submissions include their release time.

**New browser flows.** There are 18, one per fixed behaviour:

- held results;
- offline data cannot cross accounts during a deliberately delayed download;
- edits survive window focus and tab switching;
- settings save keeps the version;
- a blank limit saves;
- answers restore after reload;
- all records listed;
- held quiz review and "Publish corrected quiz";
- subject IDs;
- release labels;
- latest search wins;
- resubmission limit;
- archived book;
- checklist state;
- outline save reachable at 1280×720;
- dropdown on a short screen;
- lesson link and sidebar highlight;
- date pickers and table semantics.

### Verification on the final build

| Check | Result |
|---|---|
| Backend unit tests | 438 of 438 |
| Migrations | none missing |
| System test | 213 of 213 in three reruns (see note) |
| `tsc`, `eslint` | clean |
| Browser flows | 25 existing plus 18 new, all pass |
| Pages opened in a browser, desktop and phone | 57 of 57 without errors |
| Design recheck (83 screens, 154 items) | all pass |

**Note.** One system-test run failed the existing check "parallel process calls: exactly one wins": two simultaneous "process book" requests both succeeded. It passes on rerun, predates this work and is not among the 22 issues, but it points to a real race where a book could start processing twice. It is worth a separate fix.

## Round 4: fixes from the follow-up review

All 10 reported issues were verified first (issue 3 reproduced in a real browser) and fixed in the agreed order.

### Account safety

**1. Delayed token refresh.** Every sign-in and sign-out starts a new client session. A token refresh that started under an earlier session is dropped: its tokens are never stored and it cannot sign the current person out. Any request or response that started under an earlier session is discarded before it is shown or cached (`SessionChangedError`, ignored by screens). Tested with a refresh held for 6 seconds while student A signs out and student B signs in, both after a page load and inside the running app. Afterwards the stored sign-in is B's and the offline copy holds none of A's data.

### Lost or misdirected work

- **2. Expired quiz attempts:** the deadline no longer submits before the answers saved on the device are loaded. An attempt reopened after its time ran out submits the saved answers.
- **3. Drafts on the wrong record:**
  - drafts belong to their quiz or assignment;
  - if the screen is reused for another record while edits are unsaved, the edits stay with their own record (restored when it is reopened, with a note offering "Open that quiz" or "Discard them") and can never be shown on or saved to the other record;
  - saves use the draft's own id.
- **4. Leaving or saving mid-edit:**
  - the sidebar, breadcrumb, page finder, guide links and account menu, plus the phone's back button, ask **Save and leave / Discard changes / Stay** while a quiz, assignment, outline or evaluation has unsaved changes;
  - a save marks as saved only what it sent, so text typed while it runs stays unsaved;
  - the outline editor pauses editing during its save, because the server assigns ids to new chapters and modules.
- **9. "Save and continue" on the Outline tab:** it now offers Save and continue / Discard changes / Stay on this tab. A failed save keeps you on the tab with your edits and shows the reason.

### Wrong data

- **5. Flagged questions:** a held quiz flags only the questions its failing checks name by id, not every question in the generated text. With no named question, the review says so. Backend tests cover a three-question quiz with a finding on question 2 only, and a finding that names no question.
- **6. Whole-chapter quizzes:** the quiz page matches source modules by chapter id.
- **7. Long lists offline:** later pages are loaded only while the server is reachable. If one cannot be loaded, the saved rows are shown with a note ("Showing 25 of 40 quiz results. Only the records saved on this device are shown while you are offline."). The 200-page stop is gone; a very large list is marked incomplete instead of being cut silently.

### Input and layout

- **8. Dates on phones:** they use the system date and time pickers (`@react-native-community/datetimepicker` 8.4.4, the version Expo SDK 54 bundles; it works in Expo Go, and custom development builds need rebuilding). Date parsing is strict everywhere: 31 February, 24:00 and malformed input are rejected instead of rolling over (`src/ui/dateParts.ts`).
- **10. Small screens:** date fields shrink to their card (their width is a maximum), the outline save bar wraps, and the outline editor's height is computed from its measured position under the notices above it.

### Upgrading

Run `npm install` in `frontend` (new package), then `npm run export:web`. No backend migration.

### Tests and verification

| Check | Result |
|---|---|
| Backend unit tests | 440 of 440 (2 new for issue 5) |
| Migrations | none missing |
| System test | 213 of 213 |
| `tsc`, `eslint` | clean |
| Strict date parsing check | 12 of 12 cases |
| Browser flows | 12 + 13 + 18 existing plus 10 new (`flows4.mjs`), all 53 pass |
| Pages opened in a browser, desktop and phone | 43 of 43 without errors |
| Design recheck (83 screens, 154 items) | all pass |

**Also fixed: the double-processing race.** Claiming a book for processing is now a single conditional update that names the row's state, so the database picks one winner among simultaneous requests; a stale run is reclaimed by naming the start time that was judged stale. The earlier lock alone was not enough, because SQLite ignores `select_for_update`. Three new tests in `documents/tests.py` race six threads for a fresh book, four for a stale run, and confirm that processing a book again after the first run finished is still allowed (a quick book can finish before the next request arrives, which explains part of the earlier intermittent failure). Four parallel requests against a live server now return one 200 and three 409s with a single start time, and the system test passed three runs in a row.

## Round 5: follow-up on unsaved work and drafts

All six reported issues were confirmed in the code first, then fixed in the agreed order.

- **1. A blank score could be saved as zero.** The score rule now lives inside the save, not only in the button's disabled state, so "Save and leave" cannot turn an empty field into a real 0. A blank, non-numeric or out-of-range score shows a field error and sends nothing; a typed `0` is still a valid mark.
- **2. Leaving with newer edits unsaved.** The navigation guard asks the editor whether anything typed during the save is still unsaved, and refuses to leave if so ("Newer changes are still unsaved"). When a save creates a new quiz version, edits typed meanwhile are carried to that new version instead of being left behind on the retired one.
- **3. Exits that skipped the guard.** Sign out (both in the account menu and on the profile page) asks **Save and sign out / Discard and sign out / Stay signed in**. The grading page's "Back to submissions" and "Cancel" ask the same way as any other exit.
- **5. Manual submission before answers were restored.** Every submit path waits for the saved answers to load: "Review & submit" and "Submit answers" are disabled while loading, the page says "Restoring saved answers…" instead of claiming nothing was saved, and a submit attempted meanwhile is refused with an explanation.
- **4. Student drafts.** A saved draft that arrives after the student has started typing is discarded, so their own text always wins. Deliberate navigation writes the latest draft first (`flush()`), so the last keystroke is not lost inside the autosave delay. The screens show "Restoring saved answers…" and "Saving your response on this device…".
- **6. Silent outline save failures.** The Save button, tab changes and the navigation guard share one save-and-report path. A failure keeps the draft, states the reason in a dialog ("Your changes were not saved …") and leaves "Not saved: …" in the editor's own status bar.

### Tests

Six new browser flows (`docs/testing/ui-flows/flows5.mjs`), one per fix, including a blank score with the server value checked before and after, a save deliberately delayed while more is typed, sign out with unsaved work, a held draft restore, and a forced outline save error.

| Check | Result |
|---|---|
| Backend unit tests | 443 of 443 |
| System test | 213 of 213 |
| `tsc`, `eslint` | clean |
| Browser flows | 12 + 13 + 18 + 10 + 6 = 59, all pass |
| Pages opened in a browser, desktop and phone | 23 of 23 without errors |
| Design recheck (83 screens, 154 items) | all pass |

