# Automatic device preparation after content outlining

The document screen now starts one device job per book to prepare missing lessons
and quizzes. Each module operation runs sequentially; one module failure does not
stop the others. Saved drafts are retained and missing work resumes when the book
is reopened after refresh. Existing shared lessons/quizzes and saved drafts are
not regenerated. Approval and synchronization remain explicit review actions.

Readiness distinguishes unavailable source, missing model setup, queued work,
generation, saved drafts awaiting review, and shared content. A lesson absent on
the server is no longer described as missing source. Backend lesson totals now
include readable modules without generated lessons in a not_generated bucket.
Short source passages receive fewer quiz questions; sources below 80 characters
are retained for review rather than generating unsupported educational material.
The source outline and extraction rules are unchanged.

Verification: 30 backend tests passed. Three browser scenarios passed: content
upload and outline, automatic preparation and refresh with existing content
preserved, and continuation after a simulated timeout. TypeScript and web export
passed; lint has zero errors (existing unrelated warnings). Browser inference is
stubbed in this test suite; real-model speed and quality require device testing.
