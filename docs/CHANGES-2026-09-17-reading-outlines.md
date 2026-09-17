# Reading outlines — 17 September 2026

New institutional uploads group adjacent source sections into reading modules within detected chapters. Verified PDF bookmarks recover chapter boundaries when display-font headings flatten the hierarchy. Ambiguous flat outlines retain source order and show a review warning. Preliminary material remains available in a Before you begin group. No fixed chapter/module count is imposed.

Every extracted section must occur once, in order, with its original source text. Page ranges remain attached for original imagery. This verifies extracted-content coverage, not OCR accuracy or perfect extraction from every PDF. Local AI generation and central judging configuration are unchanged.

Private/offline imports group adjacent pages within verified bookmark chapters and preserve images. Reading units are separate from small inference chunks. Reimporting older private books creates a separate updated copy and retains existing practice history.

## Updating

Apply backend migrations (0011 adds outline quality), rebuild the frontend with npm run export:web, and restart the app. New uploads use reading outlines automatically.

For an existing unpublished institutional book, open Outline & source, choose Preview reading outline, review the proposal, then Save changes. Discard is read-only. Proposals come from original extracted source, so review previous manual corrections. Stale proposals are rejected; modules with protected student activity cannot be replaced. Existing books are never reorganized silently.

## Verification

- 167 backend document tests passed.
- 62 private contracts and 4 PDF grouping tests passed.
- TypeScript and web export passed; lint has no errors (7 existing warnings).
- Browser suite: 44 passed initially; two failures were fixed and passed on targeted rerun, together with three import/preview checks (5 passed).
- Actual 128-page Flexee PDF: 14 content chapters, 42 content modules, one introductory unit; all 131 extracted sections accounted for. Source comparison against its PDF text layer matched after excluding whitespace and Markdown heading markers.
- Tested real text-layer/font/bookmark fallback; Docling was unavailable in this environment. Scanned pages were exercised through browser OCR fixtures.

## Manual checks

1. Upload a book and inspect chapter/module grouping and coverage notice.
2. Compare module source with the original, including pages spanning boundaries.
3. Preview an older unpublished book; discard and verify no saved changes, then preview/save deliberately.
4. Check lessons and original page images, and import a book offline after app assets are available.

Unusual layouts, missing bookmarks, and OCR errors still require source review. Large indivisible sections may remain large reading modules to avoid arbitrary source splits.
