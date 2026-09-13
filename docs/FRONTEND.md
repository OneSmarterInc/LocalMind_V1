# Frontend: screens by role

The client is an Expo app (`frontend/`). This page lists every screen and the endpoints behind it, so backend and client changes can be cross-checked. Setup and architecture are in `frontend/README.md`; the integration contract is in `FRONTEND_INTEGRATION.md`.

## Shared

| Screen | Route | Endpoints |
|---|---|---|
| Portal chooser, then one login screen per role | `/login`, `/login/student`, `/login/faculty`, `/login/admin` | `POST /auth/login/{role}/` |
| Forced password change | `/change-password` | `POST /auth/password/change/` |
| Profile / sign out | `(role)/profile` | `GET /auth/me/`, `POST /auth/logout/` |
| Heartbeat (background) | — | `POST /auth/heartbeat/` every 4 min in foreground |

## Student

| Screen | Route | Endpoints |
|---|---|---|
| Subjects | `(student)/` | `GET /student/subjects/` |
| Subject: books + stats | `(student)/subject/[id]` | `GET /student/subjects/{id}/documents/`, `GET /student/analytics/subjects/{id}/` |
| Book tree | `(student)/document/[id]` | `GET /student/documents/{id}/` |
| Module: read / lesson / ask | `(student)/module/[id]` | `GET /student/modules/{id}/`, `POST .../time/`, `GET .../teach/` (polled while the lesson is being prepared), `POST .../ask/`, `GET /student/quizzes/?module=` |
| Quizzes + recent results | `(student)/quizzes` | `GET /student/quizzes/`, `GET /student/scores/` |
| Take quiz | `(student)/quiz/[id]` | `POST /student/quizzes/{id}/attempts/`, `POST /student/quiz-attempts/{id}/submit/` |
| Result + remediation | `(student)/attempt/[id]` | `GET /student/quiz-attempts/{id}/`, `POST .../remediation/` |
| Assignments | `(student)/assignments`, `(student)/assignment/[id]` | `GET /student/assignments/`, `POST .../{id}/submissions/` |
| Progress | `(student)/progress` | `GET /student/analytics/overview/`, per-subject analytics |

## Faculty (and admin via "Content")

| Screen | Route | Endpoints |
|---|---|---|
| Subjects | `(manage)/` | `GET /faculty/subjects/`, `GET /faculty/analytics/overview/` |
| Subject: overview / students / modules | `(manage)/subject/[id]` | `GET /faculty/analytics/subjects/{id}/`, `.../students/`, `.../modules/`, `GET/POST /faculty/subjects/{id}/students/`, `POST .../discontinue/`, `GET /faculty/students/search/`, `POST /faculty/modules/{id}/availability/` |
| Books | `(manage)/books` | `GET /faculty/documents/?subject=&status=` |
| Upload | `(manage)/document/upload` | `POST /faculty/documents/`, `POST .../process/` |
| Book: status, outline review, publish | `(manage)/document/[id]` | `GET /faculty/documents/{id}/`, `GET/PUT .../outline/`, `POST .../{ready,publish,unpublish,archive}/`, `PATCH /faculty/modules/{id}/`, `POST .../availability/` |
| Quizzes | `(manage)/quizzes`, `(manage)/quiz/new` | `GET /faculty/quizzes/`, `POST .../generate/`, `POST /faculty/quizzes/` |
| Quiz: questions / settings / attempts | `(manage)/quiz/[id]` | `GET/PATCH /faculty/quizzes/{id}/`, `POST .../status/`, `GET .../attempts/`, `POST /faculty/quiz-attempts/{id}/re-evaluate/` |
| Assignments | `(manage)/assignments`, `(manage)/assignment/new`, `(manage)/assignment/[id]` | `GET/POST /faculty/assignments/`, `POST .../generate/`, `GET/PATCH .../{id}/`, `POST .../status/`, `GET .../submissions/`, `POST /faculty/assignment-submissions/{id}/evaluate/` |

## Administrator

| Screen | Route | Endpoints |
|---|---|---|
| Platform overview | `(admin)/` | `GET /admin/analytics/platform/`, `.../platform/subjects/` |
| Subjects | `(admin)/subjects`, `(admin)/subject/[id]` | `GET/POST /admin/subjects/`, `GET .../{id}/`, `POST .../status/`, `POST/DELETE .../faculty/`, `GET/POST .../students/`, `POST .../discontinue/`, `GET /admin/students/search/`, `GET /admin/faculty/` |
| People | `(admin)/users`, `(admin)/user/new`, `(admin)/user/[id]`, `(admin)/user/import` | `GET/POST /admin/{faculty,students}/`, `GET/PATCH .../{id}/`, `POST .../{discontinue,reactivate,reset-password}/`, `POST .../import/`, `GET /faculty/analytics/students/{id}/` |
| Audit log | `(admin)/audit` | `GET /admin/audit-logs/?action=&actor_email=&page=` |

## List freshness and post-create navigation

`useAsync` (src/hooks/useAsync.ts) reloads its query every time the screen
regains focus, not only on mount. Tab screens stay mounted while the user is
on a detail or create route, so previously a newly added faculty member or
student, or a subject's assigned-faculty list, only appeared after a manual
page refresh. Pull-to-refresh and the explicit `reload` remain.

Admin "Add" returns to People with the tab (students/faculty) preselected and
a success notice naming the account. "Import Excel" does the same when every
row imported cleanly; when some rows failed it stays on the report so the
admin can see which rows to fix, with a "Back to People" button.

When the web build is served by the backend (see docs/OFFLINE.md) the client
calls the API on the same origin; `EXPO_PUBLIC_API_URL` is only needed for
the Expo dev server and native builds.
