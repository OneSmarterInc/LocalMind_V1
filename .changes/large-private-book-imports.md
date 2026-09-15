# Larger private books: incremental image persistence

The previous parser accumulated every page and diagram as a base64 PNG and
aborted once the strings exceeded 48 MiB. A small compressed PDF could therefore
fail before all its pages were imported.

The integrated browser and native import paths now await a local database write
for each image before continuing. Images remain lossless PNGs at the existing
rendering resolution. The parser returns source text and image identifiers;
it does not retain the full set of images in memory. Native WebView messages
carry one image at a time and wait for a storage acknowledgement.

The book becomes visible only after parsing, checksum verification and saving
its metadata complete. Storage failures, cancellation and duplicate imports
remove the new asset set, leaving existing books and their history alone.
A storage-full error explains the actual problem. The library hides stale
progress text following an error.

This removes the cumulative 48 MiB image limit. It is not unlimited storage:
actual device quota, the existing 35 MiB input-file limit, 1,500 PDF-page limit
and two-million-character extraction limit still apply. PDF input and extracted
text remain in memory; only accumulated image memory is eliminated. Force-closing
an app during import can leave unreferenced images; automatic recovery of those
interrupted imports is not included in this change.

Update the feature branch, rebuild the web export, restart the local launcher,
then use Offline AI → Check and save offline app files and reload. Retry the
failed book. Existing successfully imported books do not need re-importing.

Validation: a 44-page illustrated PDF saved more than 48 MiB of PNG strings to
real browser IndexedDB, with one image write in flight and no accumulated parser
image array. Six browser scenarios passed, covering this case, native bridge
acknowledgements, scan OCR, parser cancellation, readable illustrated content,
and import rollback/duplicate/reload persistence. The 57 portable checks include
cancellation during a native storage write. TypeScript, lint (zero errors; seven
existing warnings) and the web export passed. Physical phone builds and the
user's particular PDF were not tested.
