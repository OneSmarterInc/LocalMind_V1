# Device-local AI migration — first increment

This is an incremental feature-branch delivery, not the completed migration.
No desktop executable is included or planned for this increment.

## Available in this increment

- Admin and faculty have Offline AI routes using the existing device model.
- In Books & modules, the module lesson/readiness panels link to **Generate on
  this device**. Save an existing authorized module while connected, generate
  its lesson or MCQs offline, review the output, and approve synchronization.
- Staff drafts use a separate `authoring:` namespace scoped to account and
  institution. Completed generation parts survive refresh. Pending reviewed
  work retries while the application is open, independent of the current page.
- Saved staff modules remain discoverable from Books & modules offline.
- The server checks staff access, content/lesson revision, structure, answer
  keys and source quotations. Receipt and result commit atomically. Replaying
  the same operation does not create a second lesson version or quiz.
- A received lesson becomes the stored course lesson; a received quiz remains
  a draft for the existing publication and result-release controls.
- Course doubts use the installed model both online and offline. A connected
  device first refreshes authorized source access. Answers enter the durable
  institutional course queue; the server checks access, source revision and
  quotations without invoking AI. The screen restores synchronized threads
  and local records without duplicating them.
- Private Study data and older private course history are not uploaded.

Generation uses the existing bounded, checkpointed device engine. Browser
workers still produce one model response at a time on each device. This does
not promise a particular generation speed or educational accuracy.

## Apply to a development installation

Update this feature branch, install project dependencies, run
`python backend/manage.py migrate`, rebuild the web export with
`npm --prefix frontend run export:web`, and restart the launcher/backend.
Use Offline AI to save the updated offline application files. Do not clear
browser storage: doing so removes local books, drafts and models.

## Remaining migration work

- Entirely offline staff import of a new institutional book and resumable
  synchronization of its original file, extracted outline and image assets.
- Local replacement of the remaining server AI actions (bulk authoring,
  assignment generation, AI review/evaluation and other legacy triggers).
  Those existing actions have not been silently disabled or redirected here.
- A complete conflict-resolution UI. Conflicting staff drafts currently stay
  local with an explicit error; they do not overwrite newer course content.
- Wider course authoring formats/question settings and complete two-device
  publication-to-offline-student acceptance.
- Native builds, physical-device quality/performance and production acceptance.

Onboarding, role permissions, enrollment and private-study privacy are retained.

## Verification

21 focused Django tests passed for course sync and staff authoring ingestion.
57 portable private-study checks passed. TypeScript and web export passed.
Five focused browser scenarios passed, including offline staff lesson/quiz
generation, refresh and synchronization, both staff setup portals, connected
course doubt synchronization and revoked-access rejection. Lint has no errors
and seven pre-existing warnings. Model responses in the integration suite are deterministic fixtures, not quality or
speed measurements of real GGUF inference.
