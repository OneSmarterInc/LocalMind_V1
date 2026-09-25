# Frontend: screens by role

The client is an Expo app (`frontend/`). This page lists every screen and the endpoints behind it, so backend and client changes can be cross-checked. Setup is in the root `README.md`; the integration contract is in `FRONTEND_INTEGRATION.md`. How the client is put together is described at the end of this page.

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

# Client architecture

## How it is put together

`src/api/client.ts` is the only place that talks HTTP. It resolves the base URL, attaches the bearer token, retries once after a transparent refresh on 401, blacklists nothing itself (the server rotates), and turns every backend error envelope into an `ApiError` with `code`, `status` and `details`. `src/api/endpoints.ts` is a thin, typed map of every endpoint the screens use, split into `auth`, `student`, `manage` (faculty portal, also used by admins) and `admin`. `src/api/types.ts` mirrors the backend's response shapes.

`src/auth/AuthContext.tsx` owns the session: it restores tokens from storage on launch, verifies them with `/auth/me/`, tracks `must_change_password`, and runs the heartbeat every four minutes while the app is in the foreground (the server closes sessions after ten minutes without one). The root layout's `Gate` component reads that state and routes: no user → `/login`; flagged → `/change-password` and nothing else; otherwise the group for the role, and any attempt to open another role's group is bounced.

Screens live under `app/student`, `app/manage` and `app/admin`, each a tab navigator with hidden detail routes. They are deliberately thin: a `useAsync` call for data, `useAction` for mutations, and the shared components in `src/ui` for layout. Nothing computes a pass mark, a score, elapsed time or a permission on the client; every one of those comes from the server, and the screens only render what they are given.

## Look and feel

The client uses one design system, `src/ui`, and every screen draws from it, so a colour or spacing change is a single-file edit. `theme.ts` holds the palette (deep navy canvas `#080F13`, lifted navy surfaces, teal `#25D0AA` for anything primary or active, blue, violet and amber for secondary emphasis), the two-stop gradients, spacing, radii and breakpoints. `Gradient.tsx` wraps `expo-linear-gradient` so no screen imports it directly; the brand mark, primary buttons, progress bars, stat tiles, the desktop sidebar and the login backdrop all use presets from `theme.gradients`.

`Shell.tsx` gives the three portals the same chrome. On viewports of 960px and wider the tab navigator is positioned on the left and rendered as a 264px sidebar with the brand, the portal name, the tab list, an optional cross-portal link and a local-AI status card. Below that width the same tabs render as a dark bottom bar. The header is custom too: a back arrow when there is somewhere to go back to, the page icon and title, the portal name as subtitle on desktop, and a user pill on the right that opens profile, change-password and sign-out. Because the shell is supplied through `useShell()` in each group's `_layout.tsx`, screens never render their own chrome; root screens whose title already appears in the header no longer repeat it in the body.

`index.tsx` exports the components screens compose: `Screen` (responsive gutters of 34, 24 or 18px and a 1100px content cap so cards line up with the header title), `Card`, `Grid`, `Row`, `PageHeading`, `Stat` (tinted icon, value, optional helper), `ProgressBar`, `ListRow`, `Button` (gradient primary, bordered secondary, danger, ghost), `Input`, `Chip`, `Badge`, `Notice`, `ErrorBanner`, `Empty` and `Loading`. All of them are dark-theme only; there is no light variant yet.

## Behaviours worth knowing

Reading time is accumulated on the module screen in five-second ticks while the app is foregrounded and flushed to `POST /student/modules/{id}/time/` every minute and on leaving the screen. The server clamps each chunk, so the client posts often rather than once.

The quiz screen resumes an open attempt if one exists, shows a countdown when a time limit is set, warns about blank answers before submit, and routes to the result. Results with written answers awaiting evaluation are shown as pending; pull to refresh later.

The faculty outline editor preserves ids on every chapter and module it round-trips, which is what lets the backend update in place instead of recreating rows. Reordering, adding and removing are enabled while the book is under review; once published, structure is frozen and the same screen switches to per-module text edits. Modules can be mapped to a parsed heading or given pasted text; ones with neither are flagged and cannot be opened or published.

Quiz editing after attempts exist creates a new version server-side; the screen follows the new id. Quiz generation never produces placeholder questions: when the tutor cannot write them the request fails and nothing is created, and a shortfall is shown as a note on the new quiz.

Uploads use `expo-document-picker` and send multipart with the picked file; on web the `File` object is appended directly, on native the `{uri, name, type}` triple.
