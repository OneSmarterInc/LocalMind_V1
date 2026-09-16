# Source pictures in every portal, and heading-wise private modules

Branch: `Image_Extraction`, on top of `20dd597`. Three problems, one change set.

## 1. Extracted pictures looked missing after an upload

They were never missing. The only way to see them was a collapsed panel inside
the module editor, or a lesson that had already been generated. That is too far
from an upload to count as visible.

**New, read-only Pictures tab** on every book in the faculty and admin
workspace, beside Outline and Lessons. It opens on counts — extracted, placed,
needing review, warnings — then lists every chapter and module with a picture
count and a page range. A module's pictures load when it is opened, so a book
with five hundred figures still loads at once. The first module that has
pictures opens by itself, so the tab is never empty on arrival.

The queue of pictures that matched no module is shown with the images
themselves and the reason each was held back, written out rather than left as a
code. Nothing on this tab can be edited: an unplaced figure is a review task,
and this release does not yet let anyone place one by hand.

**The module pane** now shows its pictures inline and expanded while the source
text is being reviewed, instead of behind a button.

`GET /api/faculty/documents/<id>/pictures/` is the new endpoint behind the tab.
It returns structure and counts but no image bytes; the existing
`/api/faculty/modules/<id>/visuals/` serves the pictures one module at a time.

## 2. A private PDF was split page by page

A Word file already splits at its real heading styles. A PDF had no equivalent,
so it became `Page 1, Page 2, Page 3 …`. One idea was cut across three modules,
its figures landed under whichever page they were printed on, and a lesson
generated from a module stopped at the page break.

`frontend/scripts/pdf-headings.mjs` reads the headings a PDF implies. A numbered
scheme is the strongest evidence a PDF offers, so it is preferred and used on
its own; type size and small capitals are the fallback. The hard part is not
finding headings but refusing the things that look like them: a display equation
is a small number followed by a short line, and a numbered exercise at the back
of a chapter is a number followed by the opening clause of a sentence. Relations
and Greek letters rule out the first; a nine-word limit and a rule that one
number belongs to one list rule out the second.

A section then spans whatever pages it runs across. Each page's pictures go to
the section holding most of that page, which is what puts a figure beside the
text it illustrates. Page numbers are kept and shown, so a reader can still
check a module against the original file.

**When no usable headings are found, the import falls back to one module per
page exactly as before**, and a warning says which way the book was split. Two
headings in a forty-page chapter is a table of contents, not a structure, so the
detector returns nothing rather than a bad guess.

On the sample NCERT chapter this produces 24 modules — 1.1 Introduction through
1.14.3 — where page splitting produced 44.

**Existing imports are untouched.** A book already in a student's private
library keeps its sections and its practice history. The import version moves to
6, so opening an older copy offers a reimport as a separate copy; it changes
nothing unless the student asks for it.

## 3. Three different picture layouts

The faculty screens, the student course module and the private book each
rendered pictures their own way. They now share `SourceFigures`, and the private
book shows a page range in its module list and its module header, matching the
staff screens.

## Tests

- Backend: 645 tests. The two errors in `tests_visual_fallbacks` are
  pre-existing and environmental — `page.insert_image` raises a zlib error in
  the build sandbox and fails identically on an unmodified checkout.
- New backend tests: the picture index reports chapters, modules and counts
  without image bytes; an administrator sees another faculty member's book and a
  second faculty member does not; students are refused.
- New `tests/pdf-headings.test.mjs`, six tests: splitting at headings across a
  page break, picture ownership by page share, equations rejected, numbered
  exercises rejected, fallback when no headings exist, and small capitals and
  possessives read as single words. Registered in the private-library workflow.
- `tests/pdf-layout.test.mjs` (6), `tests/picture-context.test.mjs` (6) and
  `tests/private-contracts.mjs` (57) all pass. `npx tsc --noEmit` is clean.

## Installing

1. `cd frontend && npm install && npm run export:web` — the private parser is
   bundled at build time, so heading splitting only reaches the offline app
   after a rebuild.
2. No migrations. `python manage.py refresh_source_visuals --all` is not needed
   for these changes; extraction itself is unchanged.
3. To see heading splitting, import a PDF into the private library again. The
   existing copy stays as it is.

## What this does not do

Heading detection on a PDF is inference, not metadata, and it will misread some
books. The fallback and the warning matter as much as the detection. On the
sample chapter the closing Summary, Points to Ponder and Exercises sections are
not numbered, so they stay inside the last numbered section rather than becoming
modules of their own.

## Also fixed: deleting a subject that had a shared book returned a 500

`SharedBook.subject` is a protected foreign key, so `delete_subject` raised
`ProtectedError` and the request became an unhandled five hundred. Nothing in
the response told the administrator what was holding the subject.

A shared book is a file staff published for private study, and its subject is a
label on that file rather than ownership of it. Deleting the subject now frees
the label and leaves the book, so study material a student may already have
imported is not destroyed by an administrative tidy-up. The audit entry records
how many books were detached.

Any other protected reference is now caught and returned as a 409 naming what
still points at the subject, instead of a five hundred that names nothing.

## Also fixed: enrolling students looked broken in both portals

The endpoints were sound — an admin and an assigned faculty member could both
enrol — but the screen around them told the person nothing, so two ordinary
situations looked like a broken feature.

The student search returned a bare array. An empty one was indistinguishable
between "everyone matching is already on this subject", "no student account
exists yet" and "every match is locked", and the picker guessed the first of
those and printed it as fact. It now returns the candidates alongside the
number of student accounts, how many matched, how many are already enrolled and
how many are not active, and the picker says which of those is true.

Enrolment can also partly succeed: a locked or discontinued account is skipped
rather than refused, and the per-student outcome was thrown away by the client.
Picking one person and having nothing happen is indistinguishable from a
failure. The picker now reports what happened — how many were enrolled, how
many were already there, and how many were skipped because the account is not
active.

Both portals share one picker, so the admin and faculty screens are fixed
together, and a test pins the two endpoints to the same response shape.
