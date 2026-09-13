# Outline workspace rewrite (frontend)

Three files changed. The backend, the API contracts and every other screen are
untouched.

| File | Change |
| --- | --- |
| `frontend/app/manage/document/[id].tsx` | The book screen is now a workspace: fixed header, scrolling chapter/module tree on the left, the selected chapter or module on the right. |
| `frontend/src/api/types.ts` | `Document.missing_source_modules` retyped from `number` to `string[]`, which is what the detail endpoint actually returns. |
| `frontend/app/manage/books.tsx` | Uses `.length` on that field instead of the value itself. |

## What the screen does now

A book with no outline yet (uploaded, processing, failed) keeps the plain
scrolling page. Once an outline exists the screen fills the window. The title,
status badge and the Mark Ready / Publish / Delete buttons stay fixed at the
top. The tree on the left expands one chapter at a time in place; the search
box filters chapters and modules together and auto-expands whatever matched.
Selecting a chapter opens a chapter pane (rename, reorder, add module, remove
chapter, jump into a module); selecting a module opens it with its title, the
heading picker, position arrows and a source text box that takes the whole
remaining height. Under 900px the two panes take turns, with an Outline button
to get back, and the phone lands on the tree rather than inside a module.

The save contract is unchanged: edits live in local state and one PUT replaces
the outline. The removal confirmations, the change summary in the save dialog
and the dirty handshake with Mark Ready and Publish all behave as before.

## Bugs fixed along the way

1. **Availability toggle discarded unsaved edits.** Opening or locking a module
   reloaded the whole outline straight after the call, which wiped every edit on
   the page. The new availability is merged into local state instead.
2. **The missing-source warning fired on every book.** `missing_source_modules`
   is a list of module ids; an empty array is truthy in JS, so the warning showed
   with a blank count on books that had nothing missing.
3. **Editing the text of a mapped module was silently discarded.** The backend
   (`documents/services/outline.py`, `_fill_from_section`) resolves a heading
   index and refills `source_text` from that section, so text typed against a
   mapped module never survived a save, despite the field label promising an
   override. Editing now clears the module's `source_heading_index`, which makes
   the override real, and a line under the field says so. Re-picking the heading
   restores the section's own text.
4. **The client resent every module's `source_text` on every save.** Because the
   backend treats explicit text as a reviewer override, any module whose heading
   index failed to resolve was quietly converted to hand-typed text. Only text
   that actually changed is sent now.

Item 3 is a client-side fix that leaves the server contract alone. The other
route would be for the backend to prefer explicit text over the resolved
section, which keeps the mapping and the edit together; that is a decision worth
making deliberately.

## Verification

`npx tsc --noEmit`, `npx eslint app src` and `npx expo export --platform web`
all clean. The screen was then driven through a running server with a seeded
three-chapter, forty-module book (with a real parsed markdown file behind it so
heading indices resolve): title edit and save, availability toggle with unsaved
edits present, Publish while dirty, add module, and a save that leaves 39 of 40
mappings intact with the fortieth correctly detached. No page errors. The
backend suite still passes untouched at 214 tests.

## Running it

Nothing new is required.

```
cd frontend && npm install && npm run export:web && cd ..
cd backend && python manage.py migrate && cd ..
python run_localmind.py
```
