# Source image extraction: textbook figures, charts and tables

Branch: `Image_Extraction`. This change makes source picture extraction work on
typeset textbooks of the NCERT kind, and makes the extracted pictures visible to
students, faculty and administrators alike.

## What was wrong

There are two independent extraction stacks in this repository, and the reported
problem was in the second one.

| Stack | Code | Used by |
| --- | --- | --- |
| Python | `backend/documents/services/` | faculty and admin uploads, then modules and lessons on the student side |
| JavaScript | `frontend/scripts/` | the private and offline library (`PrivateBook`) |

The screenshots came from the JavaScript stack, and it had two root causes.

The first was in `imageRectangles`. It accepted any embedded raster smaller than
65% of the page, which includes the publisher's watermark stencil. In the sample
chapter that stencil is a 1894×1894 one-bit image covering about 45% of every
page, so what arrived in the reader was a washed-out crop of the page body, and
proximity matching even captioned it "FIGURE 1.1".

The second was in `visualRectangles`. It found figures by looking for dark
pixels in the rendered page, with a threshold of `r + g + b < 720`. The pale
blue used for chapter banners and page-number tiles sums to 684, so the banner
and the page number registered as ink and were cropped as figures.

The Python stack was in better shape but had three defects: two columns of
running prose were being returned as `borderless_text_table` crops because a
figure caption nearby was treated as permission to keep them; a page-sized
one-bit watermark raised a "page-sized scan was not saved" notice on 16 of 44
pages; and faculty could only see extracted pictures inside a generated lesson.

## What changed

### Detection, private and offline stack

`frontend/scripts/pdf-layout.mjs` no longer looks for figures in pixels. The new
`drawingRectangles()` walks the pdf.js operator list with the graphics transform
stack and returns each painted path with the style that painted it. Reading the
drawing operators is what separates line art from a background: a banner is a
large fill of a known colour, and a watermark is a raster, so neither can be
mistaken for a diagram. `visualRegions()` then clusters that ink, anchors the
clusters to `FIGURE`, `TABLE`, `CHART` and `DIAGRAM` captions, and returns
figure and table rectangles.

Three further rules do most of the remaining work. A candidate must show some
shape before it can be a figure at all, because fraction bars and the rules
around a worked example are ink too, and a stack of them used to arrive as a
"diagram". Text lines are split at the column gutter, so a caption in the margin
no longer absorbs the body paragraph beside it. A ruled table needs cells
between its rules, since a column of display equations is also a stack of evenly
spaced horizontal bars.

`visualRectangles()` survives as the fallback for genuine scans, which carry no
drawing operators. It now measures luminance rather than a channel sum, so a
pale tint reads as paper rather than ink.

`picture-context.mjs` rejects a crop that is at least 24% of the page and
text-heavy **even when a caption sits inside it**. That is the rule that removes
the watermark stencil, which the caption test alone would always let through.

`parser-entry.mjs` uses the new detector, falls back to the raster path only for
scanned pages, requires an embedded raster to be at least about a twentieth of
the page, and tags table crops as `kind: "table"`.

### Detection, server stack

`textbook_visual_fallbacks.py` now requires a borderless table to look tabular
whatever caption is beside it: at least three rows and three columns, a
consistent row shape, short cells, no algebra, and not tall and narrow. A tall,
narrow candidate is a column of prose that text-strategy inference has chopped
into cells.

`visuals.py` treats a page-sized one-bit image as the publisher's watermark
rather than a scan, so the scan notice stops firing on ordinary typeset books.
`EXTRACTOR_VERSION` moves to 8, which re-extracts existing books the first time
they are touched.

### Visibility across the three portals

- New `GET /api/faculty/modules/<module_id>/visuals/`, for faculty and
  administrators, returning that module's cropped pictures as data URLs. Faculty
  could previously only see pictures inside a generated lesson, so a book whose
  lessons had not been written yet looked as though nothing had been extracted.
- `ModuleSerializer` gains `source_visual_count`, so the outline can report how
  many pictures a module has without sending the bytes.
- The source picture report returns up to 24 thumbnails, each tagged with the
  module it belongs to.
- The faculty book screen gains a "Show pictures" panel on each module, and the
  picture report screen now shows the pictures rather than only counting them.
- Students were already served correctly by `learning/views.py` and by
  `enrich_lesson` in `tutor/views.py`; both now carry better pictures.

## Measured result

Sample: NCERT Physics Part I, chapter 1 (`leph101.pdf`), 44 pages, 31 numbered
figures and one table.

| | Before | After |
| --- | --- | --- |
| Private and offline parser | 6 crops, all page furniture | 31 crops |
| Server extractor | 33 crops, 2 of them prose columns | 31 crops |
| Watermarks, banners, page numbers, QR codes, equation blocks | present | none |
| Spurious "page-sized scan" notices | 16 | 0 |

Both stacks return figures 1.1 to 1.20, 1.22, 1.24 to 1.31, and the page 40
quantities table. Figure 1.21 is missed by both: its ink is too sparse to clear
the shape threshold, and loosening that threshold brings equation blocks back.
It is listed here rather than hidden.

## Tests

- `backend`: 636 tests. The two errors in `tests_visual_fallbacks` are
  pre-existing and environmental — `page.insert_image` raises a zlib error in
  the build sandbox, and they fail identically on an unmodified checkout.
- New backend tests: staff module picture endpoint, cross-faculty isolation,
  student rejection, picture count without bytes, report thumbnails, prose
  columns are not a table, and contract tests pinning the vector detector.
- New `tests/pdf-layout.test.mjs`: six unit tests for the transform stack, plain
  rules, banner and page-number rejection, caption assembly, fraction-bar
  rejection and gutter splitting. Registered in the private-library workflow.
- `tests/private-contracts.mjs` (57) and `tests/picture-context.test.mjs` (6)
  still pass.

Also fixed in passing: `test_private_parser_never_saves_original_pdf_page` was
failing on the branch before this change, because the invariant comment it
asserts had been dropped from `parser-entry.mjs`. The comment is back.

## Installing

1. `cd backend && python manage.py migrate` — no new migrations, but run it.
2. `cd frontend && npm install && npm run export:web`. The private parser is
   bundled by `scripts/prepare-private-assets.mjs`, which runs automatically on
   `postinstall` and before `export:web`, so the new detector only reaches the
   offline app after a rebuild. If your installation is still showing QR codes,
   it is running an older bundle than the branch source.
3. Existing books keep their old pictures until they are re-extracted. Run
   `python manage.py refresh_source_visuals` to re-extract now, or let the
   version bump handle it the next time a book is processed.
