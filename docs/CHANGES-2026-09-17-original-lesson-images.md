# Original book images in lessons

Adds original source figures to faculty/admin lesson review, published student lessons, and private-study lessons. Image enlargement preserves proportions. No AI redraw, caption invention, remote image request, or additional model invocation is involved.

## Boundaries

The existing chapter/module outlining, source text, IDs, generation, approval and quiz policies are unchanged. Only selected imagery helpers were adapted from Image_Extraction; that branch was not merged. PDF figures/tables/diagrams are rasterized from their original page regions. DOCX embedded raster pictures retain their source appearance. Source page/caption provenance accompanies each figure. Conservative source matching leaves ambiguous section matches in the module gallery and never assigns ambiguous module matches to an arbitrary module.

New faculty uploads create a separate image manifest after the existing outline is saved. Existing lessons gain images through read-time enrichment without regenerating text. The authenticated lesson response and ordinary automatic offline bundle include original image bytes. Local authoring snapshots retain the same images on the device. Private-study images remain exclusively in the existing device library and are not uploaded.

## Existing books

From the repository root, with the backend environment activated:

```powershell
python -m pip install "PyMuPDF>=1.26,<2"
python backend/manage.py refresh_source_visuals --all
cd frontend
npm ci
npm run export:web
cd ..
```

Restart the usual launcher, open the app online and let automatic synchronization finish. No database migration is required. The backfill command extracts imagery only and does not modify outlines or lessons. Existing private imports display figures already saved on the device; their saved originals are not reprocessed automatically. Existing private-study history is not rewritten.

## Check

1. Upload an illustrated PDF/DOCX as faculty; verify the outline still follows the source headings.
2. Open a module and review its generated lesson; inspect original figures and use Enlarge image / Close image.
3. Approve/synchronize and publish through the existing flow. As an enrolled student, open the lesson online, then offline after synchronization. The same figures should remain visible.
4. Import an illustrated PDF in private study, generate a lesson, then reload offline and enlarge a figure.
5. Run the backfill on an older course book and verify module titles/counts, source text and saved lesson text are unchanged.

## Limits

Detection is conservative: complex scanned pages may only be available through View original page in private study. Word SmartArt/charts without a raster fallback require a PDF export. Unmatched course images are retained in the image manifest rather than attached to an unrelated module. Extraction warnings are recorded in that manifest; unexpected extraction errors are logged without failing the already-parsed book. The reference extractor caps retained course imagery at 500 occurrences / 128 MiB and records a notice for remaining imagery; it does not reject the book. Device storage quota still applies.

## Verification

54 backend tests covering extraction, pixel-preserving delivery, authorization, offline bundles, immutable outlines, authoring, lessons and course synchronization; frontend TypeScript and production export; private contract tests; browser tests for offline student images, faculty image review, private lesson images, real illustrated PDF parsing, native parser OCR and native image storage acknowledgement. Browser inference is stubbed for these UI tests; no model-speed claim is made. Lint reports no errors and the same seven existing warnings.
