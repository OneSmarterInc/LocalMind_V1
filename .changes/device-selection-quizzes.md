# Device-generated selection quizzes

Create Quiz now prepares a durable, account-scoped local draft and starts the
installed model on that device. The main workflow no longer posts to the server
quiz-generation endpoint. Missing models lead to setup with the draft retained.
Manual question creation remains available.

Select modules while connected so authorized source snapshots are prepared. The
saved draft then generates offline, persists completed source parts/questions, and
can resume after interruption from Create Quiz > Saved quiz drafts. The chooser
itself still requires a reachable server for fresh subject/module listings.

MCQ generation supports 1–30 questions, at least one per selected module and at
most six per module. Requested counts are distributed among modules and source
parts; this is source-based question sampling, not a guarantee every paragraph is
covered by a question. A repeated/incomplete generation is not published as a
complete quiz. Written-question generation is not offered in this workflow.

Approval saves a pending operation locally. Automatic reconnect synchronization or
Retry uses the same UUID. The server checks permissions, all module revisions,
source quotations, answer keys, duplicate questions and reviewed status; it creates
one unpublished institutional quiz without invoking inference. Conflicts retain the
local draft and require a replacement reviewed against current sources. Existing
quiz settings, publication and result-release controls remain authoritative.

Validation: 10 Django authoring tests passed (including replay, stale revisions,
unauthorized faculty, invalid quotations and multi-module relationships). Two
browser scenarios passed using controlled inference with real storage and Django:
single-module authoring regression and a two-module quiz across offline refresh and
reconnect. TypeScript and production web export passed; lint has zero errors and
seven existing warnings. Real GGUF performance/native acceptance not measured.

Remaining: old server jobs/automatic generation triggers and other AI actions,
offline staff catalogue selection, consolidation of authoring status/navigation,
illustration synchronization, larger originals and complete device acceptance.
