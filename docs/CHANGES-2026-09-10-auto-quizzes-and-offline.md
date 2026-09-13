# Automatic lessons and quizzes per module, and studying offline (10 September 2026)

## What now happens

**When faculty or an admin upload a book.** As soon as processing finishes, every module with text is queued twice: once for its lesson and once for its quiz. One background worker writes them, alternating a lesson and a quiz, and it steps aside whenever a student is waiting on the model. Both are stored in the database.

**When a module is open to students.** The module's automatic quiz is published the moment its module is open in a published book. That happens straight after it is written if the module is already open, when the book is published, or when faculty open the module or its chapter. Enrolled students then see the module's text, its lesson and its quiz together. An automatic quiz never opens a module faculty have kept locked.

**Automatic quizzes are ordinary quizzes.** They use the same generator as faculty-built quizzes: only that module's text, readable questions, four real options, and never placeholders. By default each has 5 multiple-choice questions, a 65% pass mark and 3 attempts.

- **Editing:** faculty can edit, close or delete them in Quizzes. Editing one that students have attempted creates a new version, as for any quiz.
- **Module text changes:** the quiz is rewritten only if no student has attempted it yet. Once students have scores on it, it is kept.
- **Deleted quizzes:** a quiz faculty deleted is not written again unless they ask for it.
- **Failures:** failed generations are retried like lessons. No placeholder quiz is ever published.

**Faculty book screen.**

- **Book band:** a line such as "Automatic quizzes: 12 of 34 ready · 1 being written · 21 queued. Each goes live when its module is open.", with Try Failed Again when some failed.
- **Each module:** a quiz status badge, Open Quiz, and a button to have that module's quiz written again.

**When a student is online.** The app downloads, in one request (`GET /api/student/offline/`), everything the student can study:

- **Their courses:** their subjects and the published books in them.
- **Every open module:** its text, its stored lesson, its quizzes, and the latest tutor conversation.
- **Their records:** the quiz list, scores, assignments and progress.

The download happens when they sign in or open the app, again the moment the server can be reached after being offline, when the app comes back to the foreground, and every ten minutes. It is stored on the device: IndexedDB in the browser, app storage on phones.

**When the student goes offline.** Every reading screen keeps working from the saved copy: subjects, books, open modules, lessons, quiz lists, scores and progress. A banner says they are offline and when the copy was last updated. Asking the tutor, taking a quiz and submitting an assignment need the server, and the banner says so. When the connection returns, the copy refreshes by itself.

**What is not downloaded.**

- **Locked content:** locked modules, and anything else the student cannot see.
- **Quiz answers:** the student views never send them.
- **Other users:** the copy belongs to the signed-in student and is wiped on sign-out or when someone else signs in on the same device.

**Downloading is not reading.** The download does not mark modules as read, so progress and analytics stay accurate.

## Verification

| Check | Result |
|---|---|
| Backend unit suite | 385 of 385 |
| Black-box system test (fake model) | 213 of 213, including an automatic quiz for every module, the open module's quiz live for its students, and a download that holds the open module with its lesson and quizzes but leaves out locked modules |
| Frontend `tsc`, `eslint`, web export | Clean (the 2 existing lint warnings only) |
| Download for a 34-module book with lessons and quizzes | 144 entries, 246 KB, about 0.6 s on the server; no quiz answers in it; no progress rows created |

**What the new tests cover.**

- **Generation:** quizzes are queued on upload.
- **Publishing:** a ready quiz on an open module is published at once, and one on a locked module waits and goes live when the module opens.
- **Text changes:** an edit rewrites an unattempted quiz but keeps an attempted one.
- **Deletion:** a deleted quiz is not regenerated.
- **Failures:** a model outage leaves no placeholder quiz, and the worker's calls are marked as background work.
- **Editing:** faculty can edit an attempted automatic quiz into a new version.
- **Download contents:** it holds open modules, lessons and quizzes in the app's own response shapes, and does not mark modules as read.
- **Download version:** its version changes only when content does.
- **Download privacy:** other students and faculty get none of it.

**Not tested in a browser or on a phone.** The offline behaviour of the screens was type-checked and built, not clicked through.

## Things to know

1. **Web browsers on a plain-http LAN address.** A browser tab that is already open keeps working offline. If the student closes or reloads the tab while offline, the page itself cannot load again: browsers only allow offline app files on https or localhost. The phone app has no such limit. Served over https, the included service worker also keeps the web app's files.
2. **Generation time on the laptop from the field log.** One lesson takes about 1.5 minutes and one 5-question quiz about 2.5 minutes. A 34-module book therefore needs roughly 2 to 2.5 hours after upload before every lesson and quiz is ready, less when fewer modules. Students can start on any module whose lesson is ready.
3. **Books uploaded before this release** do not get automatic quizzes by themselves, because that would publish new quizzes into courses already running. To add them, run `python manage.py generate_auto_quizzes --queue`, or `--queue --document <id>` for one book.
4. **Turning the feature off.** `AUTO_QUIZ_ENABLED=false`. Question count, pass mark and attempts are `AUTO_QUIZ_MCQS`, `AUTO_QUIZ_PASS_PERCENTAGE` and `AUTO_QUIZ_MAX_ATTEMPTS`.

## Upgrading

1. Run `python manage.py migrate`, which adds `assessments.0004` (automatic quiz jobs and the `auto_generated` flag).
2. Rebuild the web client with `npm run export:web`.
3. Restart.

A phone app needs a new build to get offline study.
