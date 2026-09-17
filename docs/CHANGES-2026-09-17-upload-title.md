# The title a person types at upload is kept after processing

Branch: `feature/integrated-private-library`.

## What was wrong

Uploading a course book asks for a title, and the value was stored — but
processing then overwrote it. `persist_outline` ended by setting
`document.title` to the outline's `document_title`, and for a PDF that title is
derived from the file name (`leph101`). So a book uploaded as "Electric Charges
and Fields" showed as "leph101" once processing finished, in every list and
header across the admin and faculty portals.

The private-study library (`SharedBook`) was never affected: it stores the typed
title directly and runs no outline, so its titles were always correct. The bug
was specific to the course-book pipeline that turns a document into modules.

## The fix

A book now records whether its title was typed by a person. `upload_document`
sets `title_is_custom` to true when a non-empty title is supplied, and false
when it falls back to the file name. `persist_outline` replaces the title from
the outline only when the title is not custom, so an auto-derived name can still
be improved by the outline while a title a person chose is left alone.

This is one field, `Document.title_is_custom`, with migration
`0012_document_title_is_custom`, and a two-line guard at the single point where
the title was being overwritten. The frontend already displays `document.title`
in every list and header, so no client change was needed — the correct title now
simply reaches it.

## Across the three portals

Admin and faculty upload through the same course-book endpoint, so both are
fixed together. Students do not upload course books; their private-study uploads
go through `SharedBook`, which was already correct. Every kind of book upload in
all three portals now keeps the title as entered.

## Tests

- Backend: 650 tests. The one failure,
  `test_legacy_ai_outline_preserves_complete_source_without_model`, is
  pre-existing and fails identically on the untouched branch.
- Four new tests: a custom title survives processing; an auto-derived title is
  still replaced by the outline; a typed title is stored and marked custom at
  upload; and no title falls back to the file name and is not marked custom.

## Installing

1. `cd backend && python manage.py migrate` — applies the new field.
2. `cd frontend && npm install && npm run export:web`.
3. Books uploaded before this change keep whatever title they currently show.
   Re-uploading is not necessary for new uploads to behave correctly; to correct
   an old book's title, edit it, or re-upload it.
