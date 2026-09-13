# Cleanup release: API schema, tidy_book fixes, tested on the real chapter (11 September 2026)

Based on `development` at `5c63536` (after the duplicate-docs cleanup). Not pushed.

## Tested on the real textbook

The uploaded database holds what Docling extracted from `jesc105.pdf` (NCERT Class 10 Science, chapter 5) on the laptop: 38 headings and the text of every section. Running the previous `tidy_book` against a copy of it exposed three problems, which this release fixes.

**1. Respiration would have been folded into nutrition.** Processing drops a heading with no text of its own, and in this chapter "5.3 RESPIRATION" is followed straight away by the box "Activity 5.4". With the heading gone, the respiration boxes ("Activity 5.4" to "5.6", "More to Know!", "Do You Know?", "QUESTIONS") had no section of their own and would have joined "5.2.4 Nutrition in Human Beings". The same happened to "5.4 TRANSPORTATION" and "5.4.1 Transportation in Human Beings" before "Activity 5.7".

- **Existing books:** `tidy_book` now reads the book's extracted headings, finds numbered section headings no module carries, and makes the first module after each one that section's home. It takes the section's title, keeps its box heading inside the text, and the boxes that follow fold into it. On this book "Activity 5.4" becomes "5.3 RESPIRATION" and "Activity 5.7" becomes "5.4.1 Transportation in Human Beings".
- **New uploads:** these were already right, because the empty heading is still in the outline at that stage. That is now tested on the real headings.

**2. Overprinted titles the old repair missed.** The drop-cap copies in this PDF are not always split the same way: "5.3 RESPIR 5.3 RESPIRA ATION TION", "5.4 TR 5.4 TRANSPORT ANSPORTA ATION TION", "5.5 EX 5.5 EXCRETION CRETION". The repair is now general. When a title's words split into two in-order sequences that spell the same letters, it is two copies of one heading, and the repaired title keeps a space only where both copies had one. Every heading in the chapter now comes out right. A letter-spaced box title that lost its end in extraction ("E X E R C I S") becomes "EXERCISES" and is treated as a box. Short repeated titles such as "Bye Bye" are left alone.

**3. Books with all headings at one level.** Docling put all 38 headings at the same level, so each became its own chapter with one module. Two rules only looked inside a chapter, and here they never matched: "a short numbered heading that introduces the next subsection" (5.2 before 5.2.1), and "the next section" for a fragment at a chapter's start. Both now look across the book.

**Also fixed.**

- **Clear labels:** `tidy_book` says what each line is: `rename chapter and module:`, `rename module:`, `rename chapter:` and `new section home:`. A title shared by a chapter and its only module is listed once, not twice.
- **Folded box headings:** the heading put inside the text uses the repaired title ("## QUESTIONS", not "## Q U E S T I O N S").
- **Safe to repeat:** running `tidy_book` a second time now changes nothing. Before, a tidied module that no longer recorded its heading could be mistaken for a missing section.

## Result on this book

**Existing book** (`tidy_book` applied to a copy of the uploaded database):

| | Before | After |
|---|---|---|
| Modules | 34 | 24 |
| Titles repaired | | 7 |
| Boxes folded | | 10 |
| New section homes | | 2 (5.3 RESPIRATION, 5.4.1 Transportation in Human Beings) |
| Kept because students opened them | | 3 (two "QUESTIONS" boxes and "5.2 NUTRITION") |

- **Lessons and quizzes:** new lessons and automatic quizzes are queued only for the 7 modules that received text.
- **Automatic quizzes:** none left without a module.
- **Repeat run:** a second run changes nothing.

**Fresh upload** of the same chapter: the 38 headings become 21 modules:

5.1 WHAT ARE LIFE PROCESSES? · How do living things get their food? · 5.2.1 Autotrophic Nutrition · 5.2.2 Heterotrophic Nutrition · 5.2.3 How do Organisms obtain their Nutrition? · 5.2.4 Nutrition in Human Beings · 5.3 RESPIRATION · 5.4.1 Transportation in Human Beings · Our pump - the heart · Oxygen enters the blood in the lungs · Blood pressure · Lymph · 5.4.2 Transportation in Plants · Transport of water · Transport of food and other substances · 5.5 EXCRETION · 5.5.1 Excretion in Human Beings · Artificial kidney (Hemodialysis) · 5.5.2 Excretion in Plants · Organ donation · What you have learnt

## API schema

`backend/openapi.yaml` is regenerated from the code: 161 paths and 198 operations, up from 152 paths. The schema was missing 9 endpoints, which are now included for the APK team:

- `GET /api/student/offline/`
- `GET/POST /api/faculty/modules/{id}/lesson/`
- `POST /api/faculty/documents/{id}/lessons/`
- `POST /api/faculty/modules/{id}/auto-quiz/`
- `POST /api/faculty/documents/{id}/auto-quizzes/`

The README line about it is updated.

## Verification

| Check | Result |
|---|---|
| Backend unit suite | 416 of 416 (5 new) |
| Black-box system test (fake model) | 213 of 213 |
| `makemigrations --check` | no changes |
| `tidy_book` on a copy of the real database | dry run, apply, and repeat run as described above |

**Real textbook in the tests.** `backend/documents/test_data/jesc105_headings.json` holds the chapter's 38 extracted headings and each section's text length. It has no book text and no student data. The new tests use it to check every title repair and the 21-module result of a fresh upload.

**Not done here.** Docling was not re-run on the PDF: this machine has one CPU core and not the laptop's models. The headings Docling produced on the laptop, stored in your database, were used instead. They are its output for this exact PDF.

## Using it on the laptop

1. Unzip over `D:\Local_Mind_Integrated`, keeping `backend\.env`, `backend\db.sqlite3`, `backend\media` and `backend\models`.
2. No migration is needed.
3. From `backend`, run `python manage.py tidy_book --document 64930d50-89cd-4585-bc7d-555e2c5bd450 --dry-run`, check the list, then run it without `--dry-run`.
4. Start the server so the new lessons and quizzes are generated.
