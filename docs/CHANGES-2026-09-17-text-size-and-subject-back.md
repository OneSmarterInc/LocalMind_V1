# Remove the reading text-size toggle; give the subject page a back button

Branch: `feature/integrated-private-library`.

## Student module: text-size toggle removed

The student reading view had a "Text size" button that enlarged the source
text. It is removed, along with the state and the enlarged rendering path, so
the reading view shows the source at its normal, consistent size. `SourceContent`
keeps its default size and no longer receives a `large` flag from this screen.

## Subject page: Upload replaced with Back to subjects

The subject workspace header had an "Upload a book" button top-right. It is
replaced with a "Back to subjects" button, so a person who opened a specific
subject can return to the subjects list, matching the back-button convention on
the book screen. Uploading a book is still reachable from the same subject
through "Books in this subject → All books," and the empty state still prompts
an upload, so no upload path is lost.

## Tests

- Backend documents suite passes. No backend behaviour changed here; both edits
  are in the web client.
- `npx tsc --noEmit` is clean.

## Installing

`cd frontend && npm install && npm run export:web`. No migrations.
