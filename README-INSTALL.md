# LocalMind fixes — built against feature/integrated-private-library

This bundle is built on the branch you sent me, not on my own copy. There is no
wrapper folder inside the zip: `backend/` and `frontend/` sit at the root, so
extracting to the repo root drops all 19 files straight into place.

## Install

```powershell
$LM = "C:\Users\Anshuman\OneDrive\Desktop\Final_Localmind\LocalMind_V1"

cd $LM
git checkout -- .          # start clean; this bundle is complete on its own

# Unzip this file to $LM, choosing "replace files". Confirm:
Select-String -Path "$LM\frontend\src\private\core.ts"        -Pattern "export function prose"
Select-String -Path "$LM\frontend\src\authoring\local.ts"     -Pattern "isFrontMatter"
Select-String -Path "$LM\frontend\src\ui\index.tsx"           -Pattern "SEGMENTS"

cd $LM\frontend; npm run export:web
cd $LM; & "$LM\backend\.venv\Scripts\python.exe" run_localmind.py --host 127.0.0.1 --port 8000 --no-browser
```

Hard-refresh the browser (Ctrl+Shift+R), and delete the LocalMind IndexedDB once
per browser (F12, Application, Storage). Modules already recorded as Failed keep
that verdict until their stored state is cleared.

---

# I was wrong about the truncation, and the real cause is worse

I told you the lesson text was being cut off by the token budget. It was not.

Every field in the generation schema carries a `maxLength`, and the model is
decoded under a strict JSON grammar. The grammar enforces a `maxLength` by
**ending the string when it reaches the cap**. The output is well-formed JSON
containing a sentence that stops mid-word, and `finish_reason` comes back as
"stop", not "length", so the check that was meant to catch incomplete responses
never fired.

Your own draft proves it to the character:

| Field | What you saw ended with | Length | Schema cap |
|---|---|---|---|
| introduction | "…and their tactics is" | 158 | 160 |
| takeaway | "…such as cyberattacks, 2" | 120 | 120 |
| quote | "…how they are transforming th" | 240 | 240 |

The stray "2" is the first character of the next word, admitted just under the
cap. The quote was not mangled by the model at all: `groundedSchema` built the
list of allowed quotations by slicing long sentences every 240 characters
regardless of where words fell, so the broken text was what we offered it.

Three changes follow from that. The caps are raised to lengths the model can
finish a thought inside. Quotation candidates are sliced on word boundaries.
And a new `prose` helper repairs anything that still lands short: it keeps the
complete sentences and discards the dangling clause, or if there is no sentence
boundary at all, removes only the half-word and any punctuation left hanging.
It never invents an ending and never adds an ellipsis the model did not write.

---

# What else is in this bundle

## Chapter Objectives is no longer treated as teaching material

A book splits into modules at its headings, so "Chapter Objectives" became
Module 1 — seven hundred characters of "readers should be able to…". A lesson
from that restates the objectives; a quiz from it can only ask which objective
is listed third. It then sat in your readiness table as Failed, which reads as a
broken system rather than a list of goals.

`isFrontMatter` matches the handful of headings that are unambiguously front
matter — objectives, outcomes, contents, preface, foreword, acknowledgements,
copyright, about the author — plus "Introduction" and "Overview" **only** when
they are shorter than 900 characters, because plenty of books open with a
substantial introduction that deserves a lesson.

Automatic preparation skips these modules. The readiness table shows "Front
matter" instead of Queued or Failed, and they no longer count against the
"X of Y lessons prepared" headline. Students still read them on the Read tab.

Deliberately, the module screen does **not** block you. It explains what it
thinks the module is and leaves both Generate buttons live, because title
matching will occasionally be wrong — "Objectives and Scope of Encryption" is a
real section heading in some books — and a wrong guess should not be a dead end.

## A one-question quiz is kept, not thrown away

The quiz generator stopped when two consecutive questions burned every attempt,
and rethrew the error — discarding the questions it had already written. A
module that honestly holds one good question was reported as
"Incomplete quiz: no playable quiz was saved" and left with nothing.

It now stops in the same place but keeps what was written. Only a module that
produced nothing at all is a failure, and it says why: the source is too thin or
too repetitive for a grounded quiz.

The prompt also stopped contradicting itself. It used to end with "Ask about
that fact, not the module title or chapter objectives", which on a chapter
objectives module told the model to avoid the only content it had been given.

## Ask a doubt stops discarding correct answers

Three separate defects, all in the course path.

`answerCourse` passed the bare `ANSWER_SCHEMA` while every other grounded call
passes `groundedSchema`. With the quotation field unconstrained the model was
free to paraphrase by one word, and validation then threw the entire answer
away. The field is constrained at decode time now, so an unmatched quotation is
impossible rather than fatal.

`retrieve` returned exactly one chunk of the module. If the sentence that
answered the question sat in the second-best chunk, it was not in the reference
and no model could have succeeded. It returns the two best chunks now, in source
order.

Its scoring used a substring test, so "are" scored a hit on "share" and "the" on
"other" — every common word in the question counted for every chunk equally. It
matches whole words now and ignores common question words.

One more, affecting every grounded call: `groundedSchema` can only fit 24
quotation candidates in the grammar, and it took the first 24 in document order.
On anything longer than a page the sentence that mattered often was not among
them. When the caller says what the quotation is for, the most relevant
candidates are offered instead, then put back into source order.

## Approving a lesson no longer waits for the quiz

The lock was per module. Approving a finished lesson while the quiz was still
being written was rejected with "This module already has an operation in
progress on this device" — your red banner.

Lesson work and quiz work touch different fields and have no reason to exclude
each other. The lock is per lane now: two operations on the same kind still
exclude each other, and anything that rewrites the module wholesale (refresh,
download, link) still excludes everything.

That alone would have introduced a quieter bug. A generation run holds its draft
in memory for minutes, and saving that whole object at the end would have undone
an approval made meanwhile. Generation now writes back only the fields it owns.

## The score ring shows the score

It was a plain circle with a pale border and one dark segment fixed at the top.
12% and 100% drew the identical quarter-green ring; only the number changed.

It is drawn from the value now, as a ring of segments filled clockwise from
twelve o'clock — segments rather than a true arc because this project has no SVG
or charting library, and rotated-mask tricks behave differently on web and
native. Solid green at 100%, and honest at every value below it.

## The offline quiz result looks like the online one

The attempt screen has a branch for attempts that have not synchronized yet, and
it was a single line of code: one raw sentence per question, no cards, no option
letters, no option text, and four identical full-width primary buttons stacked
on each other. Everything the results screen had been given lived in the branch
below it and was never reached by a student marking a quiz offline — which is
most of them.

It reuses the same components now: score ring, per-question rows, the wording of
the answer chosen and the correct one, and the synchronization controls in their
own card with sensible button weights.

## Practice quiz alignment

The letter and the option text were one run of text, so an option that wrapped
put its second line under the letter instead of lining up with the first word.
The letter has its own fixed column now and the text flows in its own, so every
option starts on the same left edge.

Two things came with it. `stripOptionLabel` runs on display as well as on parse,
so quizzes saved before labels were stripped stop rendering "A. A. Cloud
computing". And the correct-answer notice names the option, not just its letter.

---

# Everything from the earlier bundles, still here

Student Previous/Next with locked neighbours shown but not pressable. Module
search across every enrolled book. Figures assigned by page when the text
matcher declines, so students see what staff see. Option text in faculty and
student review. Per-job cancel. The regeneration loop. "Working" appearing on
finished modules. Restart versus resume. The two-reviewer lock. English-only
generation and the CJK strip, including the hole where a field written entirely
in Chinese passed validation and came out empty. Cached figure placement.
Dynamic thread scaling. The rebuilt authoring screen.

# Verification

Every changed TypeScript file was parsed with the TypeScript compiler API. The
Python was parsed with `ast`. They were not typechecked — `node_modules` was not
available to me — so watch the `npm run export:web` output.

The new logic was executed, not just written:

```
prose: trims a dangling clause back to the last complete sentence      PASS
prose: leaves clean text untouched                                      PASS
prose: with no sentence boundary, drops only the half-word              PASS
prose: rejects a field the model wrote entirely in Chinese              PASS
quoteIn: accepts a quotation differing only in punctuation              PASS
quoteIn: rejects an invented quotation                                  PASS
quoteIn: rejects an all-punctuation quotation                           PASS
groundedSchema: no candidate is cut mid-word                            PASS
groundedSchema: with a focus, the relevant sentence is offered          PASS
isFrontMatter: objectives, outcomes, contents, preface, short intro     PASS
isFrontMatter: long introduction, numbered sections, conclusion kept    PASS
_by_page: covering, ambiguous, pageless and out-of-range figures        PASS
```

# Still open

Nothing from your list that I can see. The two things I would watch after this
build are whether any real teaching section gets caught by the front-matter
title match, and whether figures are delivered to a module but not anchored
inside the lesson body — the anchoring half lives in `visual_context.py`, which
is not in this bundle.
