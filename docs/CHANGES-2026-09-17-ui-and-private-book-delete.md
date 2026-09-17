# Consistent headers, live counts, and private-book removal

Branch: `feature/integrated-private-library`, on top of the image-extraction
merge. Small, targeted fixes to the manage screens and the private library.

## Back button and action placement

The book screen put "Back to books" in its own row above the title, while every
other workspace screen puts its primary action top-right through `PageHeading`.
`PageHeading` now takes an optional `back` slot that renders a left-aligned link
above the title, and the book screen uses it in all four of its states —
processing, archived, published and under review. Every screen now places its
buttons the same way: the back link top-left, the primary action top-right, as
the subject screen already did.

## Counts update while work is happening

The book screen already re-fetches every ten seconds while lessons or quizzes
are being written, so the publish checklist counts move on their own; no change
was needed there. The one gap was the new Pictures tab, which could show four
zeros for the minute or so extraction runs after processing finishes. It now
re-checks every four seconds, up to about a minute, while the total is zero, and
shows "Still extracting pictures from this book…" with a spinner instead of an
empty state until extraction settles.

## Private study books: a professional layout and a remove button

The staff private library was a stack of nested cards. It is now a two-column
layout: the shared books on the left as proper rows with a file icon, the
subject, the original file name and a readable file size, an availability badge,
the download toggle, and a **Remove** button; the upload form and the guidance
note on the right. Raw byte counts are shown as KB and MB throughout, on both
the staff and student screens.

Removing a shared book is new. `DELETE /api/faculty/private-library/<id>/`
removes only a shared private-study book the caller manages: it stops new
downloads and deletes the stored file. Course books, which are published
documents, are never touched, and copies a student has already saved to their
own device are not remotely deleted. The button confirms first and says exactly
that. Students already had a Remove button for their own device copies; that is
unchanged.

## Tests

- Backend: 646 tests. The one failure,
  `test_legacy_ai_outline_preserves_complete_source_without_model`, is
  pre-existing and fails identically on the untouched branch.
- Two new backend tests: a delete removes the book and its file and it then
  vanishes for students, and only the managing staff member can delete while a
  student and an unrelated faculty member cannot.
- `pdf-layout.test.mjs` (6) and `private-contracts.mjs` (62) pass.
  `npx tsc --noEmit` is clean.

## Installing

1. `cd frontend && npm install && npm run export:web`.
2. No migrations.

## Follow-up: "0 of 41 lessons ready" while every row said "Ready for review"

The Lessons & quizzes banner counted only lessons synchronized to the
institution (`doc.lessons.ready`), while the table below counted device drafts
at any stage. A book whose 41 modules were all prepared as drafts, waiting for
the reviewer, therefore read "0 of 41 ready" next to 41 rows marked "Ready for
review" — correct by its own measure, but it looked broken.

The banner now counts what the table shows: lessons prepared on this device at
any stage past generation (ready for review, awaiting synchronization, or
synchronized). It reads, for that book, "41 of 41 lessons prepared · 0
synchronized to the institution." The publish checklist still measures the
synced count, because publishing shares synchronized lessons with students, but
its wording is now explicit — "N of M synchronized to the institution · K still
preparing or awaiting review in Lessons & quizzes" — so the two screens no
longer appear to contradict each other. Back-to-books placement is also
corrected: it sits top-right beside the status badge, matching the subject
screen, rather than stacked above the title.
