# Selective image extraction and the staff Pictures UI, merged in

Branch: `feature/integrated-private-library`, rebased onto its current head
(merge commit `63bbb63`, after the lesson-generation speed and UI changes).
This brings the two things it was
missing from `Image_Extraction` — a parser that keeps only real figures, and the
staff Pictures interface — while leaving this branch's own, better pieces in
place.

## What was wrong here

The private PDF parser saved the entire rendered page as a visual on every page,
then cropped regions on top of it, so a reader scrolled through full-page scans
mixed in with the real figures. It also kept every embedded raster and every
group of three or more vector strokes, with no test for QR codes, watermark
stencils, page banners, page numbers or blocks of equations. And there was no
way for faculty or an administrator to see what had been extracted from a book
without opening a generated lesson.

## What changed

The private parser now reads figures from the PDF's drawing operators rather
than clustering dark pixels. `pdf-layout.mjs` and `picture-context.mjs` come
from `Image_Extraction`: `drawingRectangles` walks the graphics transform stack
and returns each painted path with its fill or stroke style, `visualRegions`
groups that ink and anchors it to `FIGURE`, `TABLE` and `CHART` captions, and
`shouldKeepPdfVisual` rejects a crop that is mostly running text even when a
caption sits inside it. `looksLikeQrCanvas` drops QR and navigation codes. The
rendered page is a cutting board now, never a saved visual.

Two rules from this branch are kept because they are good: OCR of scanned pages
still runs, and `reading-outline.mjs` still groups the resulting sections into
chapters. The parser feeds `visualRegions` and stores each crop with the
`context_text`, `caption` and `heading_path` fields that this branch's
`figurePlacement.ts` and the server's `choose_target` rank on, so placement is
unchanged.

On the staff side there is a new read-only **Pictures tab** on every book, for
faculty and administrators alike, since both route through the same
`/manage/document/[id]` screen and the same `/api/faculty/` endpoints. It opens
on four counts — extracted, placed, needing review, warnings — then lists every
chapter and module with a picture count and page range; a module's pictures load
when it is opened. The queue of pictures that matched no module is shown with the
images and the reason each was held back. The module editor shows a module's
pictures inline while its source text is reviewed.

Two new endpoints back this: `GET /api/faculty/documents/<id>/pictures/` returns
the index and the review queue, and `GET /api/faculty/modules/<id>/visuals/`
returns one module's placed pictures. Both compute placement live from the
extraction manifest through `choose_target`, matching this branch's design
rather than storing a copy on each module.

## Measured result

On the sample NCERT chapter (`leph101.pdf`, 44 pages): the parser now keeps 31
pictures — 29 figures and 2 tables — and saves zero whole pages. Before this
change it saved 44 whole-page images plus every raster and vector group on top.

## Tests

- Backend: 644 tests. The one failure,
  `test_legacy_ai_outline_preserves_complete_source_without_model`, is
  pre-existing and fails identically on the untouched branch; this merge adds no
  new failures.
- Four new backend tests: the picture index counts by module without image
  bytes, the review queue carries the orphan with its image and reason, the
  module endpoint returns the placed picture, and a student is refused.
- `tests/pdf-layout.test.mjs` (6) is brought over. This branch's own
  `private-contracts.mjs` (62) had one test pinned to the old `vectorRectangles`
  function; it is updated to the new `drawingRectangles` detector and passes.
  `private-generation.mjs` (5) is unchanged and passes. `npx tsc --noEmit` is
  clean.

## Installing

1. `cd frontend && npm install && npm run export:web` — the private parser is
   bundled at build time, so selective extraction only reaches the offline app
   after a rebuild.
2. No migrations.
3. Books already imported into a private library keep the visuals they were
   imported with, whole pages included. Re-import a book to get the selective
   extraction. Server-side books re-extract on next processing.

## What this deliberately does not touch

This branch's reading outline, its `figurePlacement.ts`, its local authoring,
book transfers and device-generation policy are all left exactly as they were.
Neither branch can yet show an "extraction still running" state, so the Pictures
tab reads zero until extraction finishes; that lifecycle is a separate change
both branches need.
