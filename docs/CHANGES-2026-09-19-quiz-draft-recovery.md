# Quiz draft recovery and concurrent-read safety

Base reviewed: `2bcf7b23b31ea11b9393dfc799064082c9d94036` on
`feature/integrated-private-library`.

## Confirmed defects

1. The local model deliberately permits a partial set of grounded questions.
   Selected-module quiz drafts nevertheless advanced their completion cursor by
   an entire section. When every section was marked finished but the question
   count was short, the UI offered neither Resume nor Approve. Calling generation
   again also did no work.
2. Listing a legacy draft without a creation timestamp read the book metadata,
   then wrote the entire earlier draft back. Questions saved during that await
   could be overwritten by the list refresh, which runs every second.

## Narrow repair

Only `frontend/src/authoring/quizzes.ts` changes application behavior.
Progress is derived from the saved question section and module IDs. Old incomplete
records become resumable when listed or opened. A resumed generation requests only
missing questions and skips already complete sections. If a model response is
still short, valid questions are saved and an explicit resume message is returned;
there is no new automatic retry loop. Listing derives legacy date metadata for
sorting without writing the draft back.

The required question count, review/approval requirement, source checks, duplicate
checks, account guard, synchronization API, and saved question schema are retained.
No database migration or user data reset is required.

## Validation

The unmodified branch failed three regression scenarios: partial result handling,
recovery of an already-stuck draft, and concurrent generation during a legacy
metadata lookup. All pass after the change.

Seven new regression tests also cover completed-draft approval, cancellation,
duplicate rejection, offline approval followed by synchronization, and bounded
progress over repeated short responses. They run in the integration workflow.
Existing private contracts (62), authoring races (3), download/offline recovery
(16), batch authoring (5), and authentication navigation (6) pass: 99 tests total
including the seven new tests. TypeScript, strict lint, and production web export
pass; the offline manifest contains 68 assets.

These are controlled service/component tests. They do not establish real-model
quality, laptop inference speed, full browser acceptance, or whole-system freedom
from regressions. This audit found and repaired two specific data/progress defects;
it is not a certification of the entire repository.

## Update

Stop the app and preserve any local edits before updating:

```powershell
cd D:\MindLocal
git status --short
git switch feature/integrated-private-library
git pull --ff-only origin feature/integrated-private-library
cd frontend
npm ci
npm run export:web
cd ..
.\start.bat
```

Open Quiz drafts. Previously incomplete selections should offer generation again;
existing saved questions remain available for review.
