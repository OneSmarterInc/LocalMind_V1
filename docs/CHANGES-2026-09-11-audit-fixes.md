# Route and code audit, and the fixes from it (11 September 2026)

## How the audit was done

| Check | Scope |
|---|---|
| Route inventory | Every URL the server registers (258 before, 221 after) |
| Web client against server | Every API call in the web client (116), matched to a route and an allowed method |
| Access | 568 reads and 132 writes by a student, a second faculty member and a signed-out visitor against every staff and student route with an id |
| Database cost | Query counts on 17 main screens with 25 quizzes, 26 students and 8 books |
| Code | Python lint, frontend lint and type check, API schema generator, Django deploy check |

## What was already fine

- **Routes:** no path is registered twice, and no route is shadowed by an earlier one. Every web client call reaches a real route with an allowed method.
- **Access:** no student read staff data, no faculty member read or changed another faculty member's content, signed-out visitors were refused everywhere except health and login, and no request caused a server error.
- **Build and deploy:** migrations are in sync, and the deploy check passes.

## Fixed

**1. Duplicate API routes (37 removed).** Books, chapters, modules, quizzes, assignments and their analytics were mounted twice: under `/api/faculty/` and again under `/api/admin/`, with the same code. The web client only uses `/api/faculty/`, including for administrators, whom those views already admit. The `/api/admin/` copies are removed, along with the 37 duplicate route names.

- **What stays under `/api/admin/`:** what only administrators do: users, subjects, audit log, platform analytics, AI status and the AI monitor.
- **API schema:** now 124 paths and 150 operations.
- **Tests and scripts:** the tests and the black-box and acceptance scripts that used the copies now use the single routes.

**2. Paged lists without a fixed order (bug).** The book list and the faculty and student user lists added counts to their query, which drops the model's default ordering. A paged list with no order can repeat or skip rows between pages once there are more than 25. Both now sort explicitly: books newest first, people by name. A new test fetches every paged list as each role and fails if Django warns that any of them is unordered.

**3. Database queries on busy screens.**

| Screen | Before | After |
|---|---|---|
| Faculty quiz list, 25 quizzes | 52 queries (two more per quiz) | 3 |
| Student book list, 8 books | 20 queries (one more per book) | 6 |
| Offline download, 8 books and 16 modules | 220 queries | 146 |

- **Quiz list:** attempt counts are computed in the list query.
- **Book list:** progress is read once for all books.
- **Offline download:** each student's quiz results are settled once per download instead of once per screen. Per-module quiz lists are taken from the full quiz list already built, and a new test proves each one is identical to what the real view returns.

**4. Faculty could not release a held automatic quiz.** The book screen told faculty to "mark the incident a false positive", but only the admin portal has incident screens. A held quiz now shows **Questions Are Right: Release It** on the quiz screen for faculty and administrators. It marks the quiz's incident a false positive through the faculty incident route, which is already limited to the faculty member's own subjects, and the quiz goes live when its module is open. The quiz data now carries `hold_incident_id`, and the book screen hint says what to do. Tests show a second faculty member cannot release someone else's quiz.

**5. Code hygiene.**

- **Python:** 18 unused imports, an unused variable and a needless `nonlocal` removed. The three imports that remain on purpose (signal registration, library availability checks) are marked.
- **Frontend:** both lint warnings fixed. One was an unused import; the other was a module picker recalculating its chapter list on every render.

## Found, not changed

| Item | Why it is left |
|---|---|
| About 99 API operations with no request or response shapes in `openapi.yaml` | Only matters to a separate client; the web client uses its own types |
| 15 client API helpers with no screen (mostly admin monitor charts), plus the student sessions endpoint | Unused but harmless; candidates for screens later |
| `quiz-attempts/{id}/re-evaluate/` vs `monitor/evaluations/{id}/reevaluate/` spelling | Renaming would break callers for no gain |
| Web sign-in tokens kept in browser storage; `DJANGO_ALLOWED_HOSTS=*`; version ranges in `requirements.txt`; Python 3.14 on the laptop (3.11 or 3.12 supported) | Belong to the cloud move |

## Verification

| Check | Result |
|---|---|
| Backend unit suite | 423 of 423 (4 new: paged-list order, offline quiz entries equal the view, faculty release, other faculty refused) |
| Black-box system test | 213 of 213 |
| Client routes after removing the copies | every call still matches a route and method |
| Route inventory after | 0 duplicate paths, 0 shadowed routes, 0 duplicate names |
| Frontend | `tsc` clean, `eslint` 0 warnings, web export builds |
| Python lint (application code) | only the three intentional imports remain |

## Upgrading

1. Unzip.
2. Rebuild the web client with `npm run export:web`, because the quiz screen changed.
3. Restart. No migration is needed.

Anything outside the web client that called `/api/admin/documents/...`, `/api/admin/quizzes/...`, `/api/admin/assignments/...` or `/api/admin/analytics/{overview,subjects,students,users}/...` must use the same path under `/api/faculty/` with an administrator token.
