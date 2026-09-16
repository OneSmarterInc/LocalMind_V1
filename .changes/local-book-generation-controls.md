# Book generation controls use device authoring

The institutional book screen's lesson/quiz preparation and regeneration actions
now open device-local authoring rather than posting to server generation endpoints.
Bulk actions open **Prepare this book on your device**:

1. Save the book's authorized source modules while connected.
2. Disconnect and generate missing lessons or quizzes with the installed model.
3. Navigate elsewhere while the batch runs. Each module is saved independently.
4. After refresh, start the same batch again: completed local drafts are skipped,
   and the existing per-module checkpoints resume interrupted work.
5. Review individual drafts, approve synchronization, then use the existing quiz
   publication controls. A batch does not approve or publish its own output.

Batch jobs and individual generation share the existing account-scoped queue and
model. A module-level lock prevents overlapping generation or source replacement.
Completed drafts are retained on errors. If one module fails or has unresolved
work, the batch stops with its error; completed modules remain saved. Saved local
imports mapped to server modules are deduplicated in the batch list.

The batch only covers modules saved on this device. Save all book sources again
while connected to discover newly added modules. Stale sources follow the existing
explicit conflict/history flow; they are not silently overwritten.

This is not the complete migration: the separate Create Quiz screen, other legacy
AI actions, and server triggers for older server-imported books remain to be
migrated. The local file-size limit and illustration synchronization are unchanged.

Verification for this increment:
- 2 browser scenarios passed against disposable Django: single-module offline
  generation/synchronization and book batches with navigation/offline reload.
  Browser inference is stubbed; this is not a real-model performance measurement.
- 3 portable batch failure/cancellation/restart tests passed; added to CI.
- 57 existing private-study contracts passed.
- TypeScript and production web export passed; lint has zero errors and seven
  existing warnings. No native-device acceptance or production deployment claimed.
