# Lessons generated in the background; modules without text removed (10 September 2026)

Two changes to how a book becomes something students learn from. Lessons are no longer written while a student waits: every module's lesson is generated in the background as soon as the module has text, stored, and read from the database. And a module with no source text is never kept, so faculty no longer have to find and delete empty modules before a book can be published.

## Verification

| Check | Result |
|---|---|
| Backend unit suite, SQLite | 343 of 343 (20 new tests for lessons, 3 rewritten for textless modules) |
| Backend unit suite, PostgreSQL 16 | 343 of 343 (1 skipped, as before) |
| Black-box system test (fake model, CI settings) | 206 of 206 (15 new checks) |
| Migrations applied to a database created by the previous release, with real lesson rows and empty modules, on SQLite and on PostgreSQL | Correct result on both (details below) |
| Student question while 8 lessons were queued, each taking 3 s | Answered in 5.9 s: the lesson already underway, then the question |
| Lesson tab while its lesson was queued | Answered in 22 ms with `preparing` |
| Frontend `tsc`, `eslint`, `expo export --platform web` | Clean; eslint shows the 2 existing warnings only |

The new screens were type-checked, linted and bundled, and every endpoint behind them was exercised by the system test. They were not clicked through in a browser, because none was available here.

## How lessons work now

**When lessons are queued.** Three moments add a lesson to the queue: a book finishing processing (every module), an outline save that adds a module or changes a module's text (only those modules), and a faculty edit of one module's text. Publishing fills any gaps. Each module has one `ModuleLesson` row, and that row is also the job: `pending`, `generating`, `ready` or `failed`.

**How they are generated.** A single worker thread in the web process generates lessons one at a time and stores them. Students read the stored lesson, so opening the Lesson tab never calls the model.

**Correctness rules.**

1. **Stale lessons.** Each lesson records a hash of the text it was written for. A ready lesson whose text has since changed is never shown.
2. **Edits during generation.** If faculty edit a module while its lesson is being written, the old result is thrown away and the new request stands. Every state change bumps a version number, and the worker's final write only succeeds if the version is unchanged.
3. **Several processes.** Two gunicorn workers cannot take the same job, because claiming one is a conditional update.
4. **Restarts.** A job left "generating" by a process that stopped is picked up again after 15 minutes, and queued work resumes when the web process starts.
5. **Students first.** Between lessons the worker waits while any interactive AI request is running or a book is being parsed, so a student waits for at most one lesson in progress. The live check above measured this.
6. **Order.** Published books are generated before drafts.

**Failures.**

1. **Model off or busy.** The lesson is retried every 10 minutes without counting as an attempt.
2. **Unusable output.** A reply the model cannot shape into a lesson is retried with growing gaps, up to 3 times, then waits for faculty to ask again.
3. **What students see meanwhile.** A plain lesson built from the source text, with a note saying the tutor's lesson is not ready.

**What students see.** `GET /api/student/modules/{id}/teach/` returns one of three states:

- **`ready`:** the tutor's lesson.
- **`preparing`:** no lesson yet. The Lesson tab says so, shows how many lessons are ahead, offers the Read tab, and checks back every 8 seconds by itself.
- **`unavailable`:** the plain lesson, with a notice. `POST` still works for older clients.

**What faculty see.**

- **Book screen band.** Lesson progress such as "12 of 40 ready · 1 being written · 27 queued", with a progress bar that refreshes every 10 seconds while work is queued. Only the book's details refresh, never an outline being edited. A Try Failed Again or Generate Lessons button appears when needed.
- **Outline tree.** A small mark on any module whose lesson is queued, being written or failed.
- **Module pane.** A Lesson view beside Source text. It shows the stored lesson as students will see it, its state and queue position, the error and next retry when it failed, and a Generate Again button. If the text has been edited but not saved, it says the lesson shown is for the saved text.
- **Endpoints.** `GET/POST /api/faculty/modules/{id}/lesson/` and `POST /api/faculty/documents/{id}/lessons/` (`{"force": true}` regenerates the whole book).

**Command line.** `python manage.py generate_lessons` reports the queue (`--status`), queues modules without a current lesson (`--queue`, optionally `--document` and `--force`), or generates in the current process (`--run --limit N`).

**Settings.**

| Setting | Default | Controls |
|---|---|---|
| `LESSON_AUTO_GENERATE` | `true` | Whether lessons are queued automatically. When false, lessons are generated only on request. |
| `LESSON_MAX_ATTEMPTS` | `3` | Retries for unusable model output |
| `LESSON_RETRY_MINUTES` | `10` | Gap before a failed lesson is retried |
| `LESSON_STALE_MINUTES` | `15` | When an abandoned "generating" job is picked up again |
| `LESSON_WORKER_IDLE_SECONDS` | `30` | How long the idle worker waits before exiting |

`LESSON_PREWARM` from the previous pass is gone; the worker replaces it.

## Modules without source text

**The rule.** A module never exists without text.

- **Processing.** An outline module whose section is empty is not created. A planned chapter that ends up with no modules becomes one module made from its own text, as the heading-based outline already did.
- **Outline saves.** A module whose text resolves to nothing is removed, along with any chapter left empty. The save response now includes `outline_report`, and the book screen shows it ("Removed 2 modules with no source text: …"). The save confirmation warns before it happens.
- **Refusals.** An outline that would leave no module with text is refused whole with `NO_SOURCE_TEXT`. Setting a module's text to empty through `PATCH` is refused with `EMPTY_SOURCE_TEXT`.
- **Exception.** A textless module that a quiz, an assignment, student progress or a tutor conversation refers to cannot be deleted without breaking that record. It is kept, flagged, hidden from every student view (reading, lessons, the tutor, analytics counts), and listed on the book screen with a way to bring it back by pasting text. It no longer blocks publishing.

**Bug found and fixed.** The rule for when a module may be deleted only looked at progress and single-module quizzes. Removing a module used by an assignment, or by a quiz built from several modules, crashed with a server error. Removing a chapter with a chapter-level quiz did the same. Both are now refused with `MODULE_IN_USE` or `CHAPTER_IN_USE`, and tutor conversations count as a reference too.

## Upgrading

Run `python manage.py migrate`. The new migrations are `tutor.0002` to `0005` and `learning.0002`.

**Existing lessons.** The lesson migrations keep each module's lesson if it still matches the book's current version and drop the rest. They then queue every module with text that lacks a lesson, so an upgraded server starts filling lessons in the background as soon as it runs.

**Existing empty modules.** The learning migration deletes textless modules that nothing refers to, flags and hides the ones that something does, and removes chapters left with no modules.

**Tested result.** Both were run on a database created by the previous release, on SQLite and PostgreSQL:

- The current lesson was kept.
- The stale and duplicate lessons were dropped.
- The two modules missing lessons were queued.
- The unreferenced empty modules were deleted.
- The two referenced ones were kept hidden.
- The chapter left empty was removed.

Rebuild the web client with `npm run export:web` for the new Lesson tab and book screen.

**Why four lesson migrations.** They are split so that no migration mixes row changes with table changes. The first version of this migration did both, and PostgreSQL refused it with "pending trigger events".

## Known limits

- **CPU host.** A book of 40 modules takes roughly 40 lesson generations. On a laptop CPU that is 20 to 60 minutes after upload, which is why generation starts at processing rather than at publish.
- **Interactive wait.** A student's question can still wait behind the one lesson being written, up to one lesson's generation time.
- **More than one worker process.** Each process can run a worker. Claims prevent duplicate work, but two processes would generate two lessons at once and contend for the model.
- **Renames.** Changing only a module's title does not regenerate its lesson, whose title was written by the model.
