# A chapter heading can no longer become one giant module (11 September 2026)

## The problem

Uploading `Chapter_01_Introduction_to_Cybersecurity.docx` gave a first module of about 50,000 characters. The Word file was fine: it uses real heading styles (2 Heading 1, 26 Heading 2, 2 Heading 3).

A module's text is its heading plus everything nested under it. The AI outline picked the Heading 1 "Chapter 1: Introduction to Cybersecurity" as a module, and that section holds every Heading 2 under it, 50,784 characters. `ai_outline` only checked that each index existed and was used once, so it accepted the plan. The later modules repeated the same text, so the book was stored twice (about 102,000 characters of modules for a 51,000-character book), with a lesson and a quiz built from the whole chapter.

## The fix

**`ai_outline` rejects a plan in which a module contains other headings the plan uses.** Processing then falls back to the book's own heading levels (`source_hierarchy`), as it already does for any unusable AI plan. A plan that keeps each module to its own section is accepted as before.

Files: `backend/documents/services/outline.py` (new `_heading_spans` helper and the check), `backend/documents/tests.py` (one new test).

## Verification

| Check | Result |
|---|---|
| The uploaded .docx with an AI plan using "Chapter 1" as a module | Previous code: module 1 = 50,784 chars. New code: plan rejected, 22 modules, largest 6,872 chars |
| The same .docx with a well-formed AI plan | Still accepted, 21 modules |
| New test | Fails on the previous code, passes on the new code |
| Backend unit suite | 424 of 424 |

## Separate issue in this chapter (not a code change)

"Real-World Spotlight" and "Hands-On Activity" are Heading 2, the same level as the sections they sit inside. Three sections ("The Digital Districts", "Historical Evolution of Cybersecurity", "Advanced Cybersecurity Practices") therefore have no text of their own, and their text is filed under the box title. Changing those box headings to Heading 3 in Word gives all 22 modules the right titles.

## On the laptop

1. Unzip.
2. Restart `run_localmind.py`. No migration and no web rebuild are needed.
3. Delete the affected book and upload it again. Books already processed are not changed by this fix.
