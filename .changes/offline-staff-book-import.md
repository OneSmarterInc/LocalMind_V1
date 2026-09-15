# Offline institutional book import

This increment adds **Books & modules → Import and prepare books on this device**
for faculty and administrators. It does not replace onboarding or publication.

## Flow

1. While connected, open the new screen to save assigned active subjects. Complete
   Offline AI model setup and save the offline application files.
2. Select a subject and title, then import a PDF or DOCX locally. The current local
   parser supports original files up to 35 MB; the separate existing server upload
   limit is unchanged. Extraction/OCR uses the existing bundled local parser.
3. Open a module, compare the extracted source and original images, and generate
   lessons/quizzes with the installed model. Original files, extracted visuals,
   source and generated drafts persist in the staff account's authoring namespace.
4. Review and synchronize the book draft when ready. A disconnected request is
   retained and retried while the signed-in application is open. The original
   file and text outline are submitted; no server parser or AI generation is run.
   Publishing or editing a device-imported book also skips automatic server
   lesson/quiz queues. A missing or stale lesson waits for local authoring.
5. Approve generated lessons and quiz drafts separately. Their stable local module
   IDs are mapped to the created institutional modules. Content approved before
   the book has synchronized waits for that mapping.
6. Continue through the existing institutional review, opening and publication
   controls. The new endpoint never publishes or opens a module automatically.

## Durability and validation

- Web originals use binary IndexedDB storage; native originals are copied into
  application document storage, with an account-scoped SQLite reference.
- A stable operation UUID and receipt prevent duplicate books after a lost response.
  Server permissions and active subject status are checked again on every retry.
- The source file is validated and SHA-256 matched against the manifest. Text,
  module IDs, page numbers and sizes are validated before database mutation.
- Failed late writes roll back the outline and remove that operation's original file.
- Mapping replay does not roll an already synchronized lesson revision backwards.
- Local source/generation records stay independent of Private Study. No personal
  books or private conversations enter this synchronization flow.
- Transfers wait for active generation against that book. Active transfers briefly
  block new writes to those modules to prevent mapping races. Merely being queued
  while offline does not block generation of other unapproved local content.

## Validation

- 13 Django tests: book ingest, exact replay, conflicting replay, duplicate source,
  checksums, malformed source, permission revocation, rollback and existing local
  lesson/quiz ingestion.
- Browser scenario with real local PDF extraction, IndexedDB and Django: offline
  import, local lesson generation, approval, refresh, reconnection, one unpublished
  server book, mapped lesson synchronization, and another offline refresh.
  Inference is stubbed in this integration suite; it is not a model-quality test.
- 57 existing backend lesson/automatic-quiz regression tests also passed.
- Two browser scenarios passed, including the existing source-conflict recovery.
- TypeScript, web export and 57 portable private-library contracts passed.
  Lint reported zero errors and seven pre-existing warnings.

## Still required for the full distributed-AI migration

- Replace remaining legacy server generation actions, including bulk paths.
- Byte-range/chunk-resumable uploads: this implementation retries the entire
  original file with an idempotent operation; it does not resume at a byte offset.
- Synchronize extracted figure/table assets for institutional lesson rendering.
  This increment preserves them locally and transfers the original book, but does
  not yet distribute separate extracted illustrations through course sync.
- A richer institutional outline editor for local imports. The current draft is
  one chapter containing the parser's ordered modules; review remains necessary.
- Native/phone acceptance and a full faculty-device to student-device release test.
- Larger local original-file support beyond the current 35 MB parser limit.

No standalone executable work is included.
