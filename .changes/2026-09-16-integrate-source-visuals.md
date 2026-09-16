# Integrate image extraction into the device-first platform

Source: Image_Extraction at 20dd59760e084500e56c591aa2f79470cbf13a96.
Only extraction, source-visual delivery/UI, tests and associated documentation/CI
changes were ported. The source branch and central AI judge are unchanged.

The integrated code supports PDF raster/vector/table crops, DOCX figures and
captions, context-based placement, duplicate asset storage, staff extraction
reports and offline course copies. Current faculty authoring snapshots now
persist source images; local lesson review displays them by matching sections.
Device-authored book synchronization now also prepares institutional source
visuals from the uploaded original, without model inference. The backfill command
includes those books. Ambiguous matches stay in the extraction report.

A merge migration joins the source branch's document report field with the current
local-book receipt/transfer migrations; no existing tables or records are removed.
Reimport older private books to create a new parser-version copy, retaining the old
copy and its history. Run refresh_source_visuals for existing institution books.

Integration testing corrected a corrupt test PNG and a browser QR heuristic that
could classify colorful textures as navigation codes. Test PDFs now contain
captioned instructional crops instead of miniature full-page screenshots.

See docs/SOURCE_VISUALS.md for update commands and extraction boundaries.

Verification: the full backend suite passed 676 tests; after the final QR filter
change, all 41 focused visual policy/extraction tests passed. Browser coverage
passed 39/40 in the full run; the remaining outdated label assertion was corrected
and its OCR/offline/restart test passed on rerun. TypeScript, web export, migration
consistency, 12 visual JavaScript tests and 57 private contract tests passed. Lint
has zero errors and seven existing warnings. Real GGUF hardware performance was
not measured by these tests.
