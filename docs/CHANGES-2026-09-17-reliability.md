# Reliability audit follow-up

## Changes

- Automatic and manual staff generation carry their document identity. Module and batch screens show the same active work and disable competing actions. Cancelling the displayed job retains completed checkpoints.
- Removing or archiving a book cancels its local jobs, including selected-module quizzes. A durable local marker prevents removed content from generating or synchronizing again on that device. Archived books no longer offer removal, repeated archive requests are idempotent, and the default list filter is labelled Active books.
- Lesson and quiz checkpoints are retained separately. A failed lesson does not block its quiz. Long-module quizzes sample sections across the beginning, middle and end. Previously interrupted quizzes keep their original section order.
- Synchronization status compares each artifact with its acknowledged content. Synchronized content is distinguished from drafts awaiting review, pending uploads and conflicts.
- Books list responses include lesson counts. Admin teaching assignments use faculty IDs rather than names.
- Book file limits agree at 100 MiB across faculty upload, private sharing, browser parsing, native parsing and downloads. Available device storage and memory still matter.
- Faculty uploads retain original files locally before transmission. Pending uploads survive refresh and retry on reconnection. The upload screen and books list show pending uploads and a link when ready. Saved originals are removed after successful transfer and processing acceptance.
- Browser readiness tests use a dedicated fixture so unrelated source-edit tests cannot invalidate their expected lessons.

## Scope of offline intake

Faculty can choose and retain a file offline after their subject list and app files have been downloaded. The existing content-based outline extractor still runs on the server after reconnection. This change does not implement a second offline heading extractor or replace the established outline with per-page modules. Lesson and quiz generation remains on the user's device after source preparation. Central monitoring/judging is unchanged.

## Manual acceptance checks

1. Open a book with unfinished content and a model installed. While automatic generation runs, open a module: manual generation is disabled and Cancel generation is available.
2. Generate and approve a lesson, allow synchronization, then revisit it. The approval action should say Lesson synchronized and be disabled for that content.
3. Archive a versioned book while it is generating. Its job should stop, the active list should hide it, and its archived row should have no Remove book action.
4. Open Upload a book while connected once, disconnect, choose a DOCX/PDF, and submit. Confirm Book saved — awaiting upload; refresh; reconnect. Open Review uploaded book and verify the book's content headings.
5. Check the Lessons column and the admin faculty assignment overview. For names shared by different faculty, only the assigned faculty ID should match.

The automated browser tests use a controlled model stub. Real model speed, output quality, and native-device memory usage require hardware testing; passing these checks is not a guarantee of an error-free platform.

## Validation

- Django: 620 tests passed.
- Browser suite: 43 tests passed; five affected workflows also passed against the final build.
- Private contracts: 58 passed; batch/coverage contracts: five passed.
- TypeScript and web export passed. Lint has no errors and seven pre-existing warnings.
