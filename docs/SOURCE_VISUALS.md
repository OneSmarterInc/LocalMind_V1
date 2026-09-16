# Cropped source pictures and context matching

This increment adapts the supplied `picture_extraction_feature_code.py` reference,
not its illustrative incomplete upload view or Excel/Ollama-specific prompts.

Integrated from `Image_Extraction` commit `20dd59760e084500e56c591aa2f79470cbf13a96`.
The source branch remains unchanged.

## Implemented

- Current device authoring saves authorized source pictures with the module snapshot
  and displays them alongside locally generated explanations, including offline
  restart. Private and staff-local imports use the same browser parser.
- When a device-authored book is synchronized, the central server deterministically
  extracts pictures from its uploaded original for institutional delivery; this
  does not invoke the central language model or regenerate lesson text. Existing
  device-authored books are included by `refresh_source_visuals --all`.
- Course PDF extraction retains raster figure, vector-cluster and table crops.
  Page-sized regions are rejected; rotated pages use consistent coordinates.
- Course DOCX imports now retain internal raster pictures, including pictures in
  table paragraphs and anchored drawings. Authored heading paths and nearby text
  are metadata. Word's source crop is honored. External picture links, SVG and
  unsupported drawings are not fetched or executed; problems are reported.
- Caption text is copied from the source where available. Otherwise a factual
  location label is used. No caption model call happens when reading a lesson.
- One normalized PNG per content hash, but distinct source occurrences retain
  separate IDs and module associations. Repeated body figures are never removed
  merely for being repeated. Only small repeated margin pictures on at least four
  different PDF pages are filtered as running artwork.
- Page ranges constrain PDF assignment; headings and source context disambiguate
  multiple modules on the same page and locate DOCX pictures. Ties/weak evidence
  stay unassigned. No fallback to chapter/module one is permitted.
- Generated course and private lessons carry picture associations. Display also
  recomputes associations for previously saved lessons, without inference.
  Confident matches appear by the relevant explanation; other figures belonging
  to that module remain in its source-picture gallery.
- Faculty/admin lesson previews have a **Source picture report** link. It lists
  extraction warnings and unassigned occurrences. Their image bytes are retained
  in the extraction manifest, not inserted into an unrelated lesson.
- Private imports preserve source context/captions, deduplicate PNG storage while
  retaining occurrences, reject old full-page parser output, and honor Word
  crops. Existing private books/history are preserved. Reimport creates a new
  version-5 copy where needed.
- The private PDF parser masks the word boxes from its existing OCR pass before
  detecting scanned drawing regions. It does not run an extra OCR/model pass.
  Storage failures still roll back the entire private import.

## Update an existing installation

Stop the application before pulling and migrating. In the repository root:

```powershell
git switch feature/integrated-private-library
git pull --ff-only origin feature/integrated-private-library
python -m pip install -r backend/requirements.txt
python backend/manage.py migrate
```

Use the project's existing virtual environment. Its existing llama-cpp install
instructions still apply; this increment adds no AI key, hosted provider or new
model. Rebuild the frontend through the existing launcher, or run:

```powershell
cd frontend
npm ci
npm run export:web
cd ..
```

Already-processed course books do not need deletion or text regeneration:

```powershell
python backend/manage.py refresh_source_visuals --all
# Or one book only:
python backend/manage.py refresh_source_visuals --document <document-UUID>
```

This refreshes extraction/assignment only: module IDs, student progress, quiz
attempts and lesson text stay intact. Reopen/refresh the lesson and refresh the
student's offline course copy. For an earlier private import, reimport its
original file; the prior copy and practice history remain unchanged.

## Boundaries

This is original-source picture preservation and text-based association, NOT
visual reasoning. The local text model does not see or interpret image pixels.
Nearby captions may be used as textual evidence; chart values are not invented.

PDF/DOCX are supported. Native Word charts/SmartArt/legacy VML without a raster
fallback need a PDF export. Legacy `.doc` keeps its previous text-only handling.
A full-page scan that cannot be segmented is skipped/reported, never silently
saved as a lesson image. Exact detection still depends on the source layout;
matching confidence is a heuristic, not a guarantee. There is no automatic
assignment to an unrelated chapter and no manual reassignment UI in this change.

Images are bounded to 2,200 pixels on the longest side. Backend picture decoding
limits are 16 MB input / 36 million pixels; documents are limited to 500 visual
occurrences and 128 MB of unique generated PNGs, with visible warnings on limits.
All existing authorization and private-device storage separation are retained.
The official course offline bundle includes authenticated image bytes, not
public media links. No deploy to production or main-branch merge is required.

## Verification

```text
cd backend
python manage.py test
python manage.py makemigrations --check --dry-run
cd ..
node tests/picture-context.test.mjs
node tests/private-contracts.mjs
cd frontend
npm run typecheck
npm run lint
npm run export:web
npm run test:private:web
```

Extraction tests use real DOCX and PDF files. Browser integration runs a disposable
Django database. Normal lesson inference is stubbed in that suite; it does not
claim a live model vision test or physical-device validation.
