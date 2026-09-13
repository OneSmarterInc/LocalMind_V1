# Frontend Integration Notes

These notes are for whoever builds or adapts the client (the reference Expo app or anything else). They describe what the client must do, in the order a session unfolds, and what it should never do.

## Configuration

The client needs one base URL. Everything is under `/api/`. The server's `DJANGO_CORS_ALLOWED_ORIGINS` must list the exact origin a web build runs from; native builds are unaffected by CORS. Tokens are sent in the `Authorization: Bearer` header, never as cookies, so credentials mode stays off.

## Offline reading

After a student signs in, fetch `GET /api/student/offline/` and store each entry of `entries` under its key (the request path, plus the sorted query when there is one). When a student GET fails because the server cannot be reached, answer it from that store. Refresh the bundle when the app starts online, when connectivity returns, when the app comes to the foreground and periodically; skip rewriting when `version` has not changed. Clear the store on sign-out and when a different user signs in. Anything that writes (tutor questions, quiz attempts, assignment submissions) needs the server.

## Login and first run

The client presents three separate login screens (behind a chooser) and calls `POST /api/auth/login/{role}/`. A wrong role, a wrong password and a discontinued account all produce the same 401 `INVALID_CREDENTIALS`, so the client should show one generic message. Store `access`, `refresh`, `user` (which includes `role`, `full_name`, `email` and `profile`) and `session_id`.

If the response has `must_change_password: true`, route directly to a password-change screen and allow nothing else. Every other call will return 403 `PASSWORD_CHANGE_REQUIRED` until `POST /api/auth/password/change/` succeeds; that response contains new tokens, which replace the stored pair.

## Keeping the session and tokens alive

Send `POST /api/auth/heartbeat/` with `{"session_id"}` on an interval shorter than the server's `SESSION_HEARTBEAT_TIMEOUT_MINUTES` (10 by default; every 3 to 5 minutes is fine) while the app is in the foreground. Stop when it goes to the background. This is what makes application-session time honest; there is no other way the server learns the app is still open.

Handle 401 on any call by calling `POST /api/auth/refresh/` with the refresh token, storing the new pair (the old refresh token is now blacklisted), and retrying once. If refresh fails with `INVALID_REFRESH`, clear state and return to login. On logout call `POST /api/auth/logout/` with `{"refresh", "session_id"}` and then clear state.

Access tokens carry the role; do not decode them for anything else. Treat `GET /api/auth/me/` as the source of truth for the current user after a refresh or app restart.

## Reading errors

Every error has `{"error": {"code", "message", "details?"}}`. Branch on `code`, display `message`, and use `details` for field-level validation (`VALIDATION_ERROR`) and import reports. A 404 for something the user just saw usually means their scope changed (unenrolled, unassigned, unpublished) rather than deletion; refresh the parent list. A 503 `AI_UNAVAILABLE` on `ask/` should be shown as a temporary condition with the option to retry, not as a failure of the student's question.

## Student screens

Subjects come from `GET /api/student/subjects/`; books per subject from `GET /api/student/subjects/{id}/documents/`. `GET /api/student/documents/{id}/` gives the tree with each module's `availability` and `progress` (`status`, `best_quiz_percentage`, `quiz_attempts`, `learning_seconds`) and a derived chapter status, but no text. Render locked modules as visibly locked and do not call their detail endpoint; if you do, you get 403 `MODULE_LOCKED`.

`GET /api/student/modules/{id}/` returns `source_text` and marks the module in progress. While the module is on screen, accumulate seconds and post them with `POST /api/student/modules/{id}/time/` every minute or two and on leaving the screen; chunks over fifteen minutes are clamped, so post often rather than once.

Lesson: `GET /api/student/modules/{id}/teach/`. It never waits for the model; lessons are generated in the background. On `status: "ready"` render `lesson.title`, `learning_objectives`, `sections[]` (each `heading`, `explanation`, `source_reference`), `key_terms[]` and `summary`. On `"preparing"` there is no lesson yet: say it is being prepared and call again every few seconds. On `"unavailable"` render the plain `lesson` built from the text and say so rather than hiding it.

Doubts: `POST /api/student/modules/{id}/ask/` with `question` and, to continue a thread, the `conversation_id` from the previous response. Render `message.content`, show `message.source_reference` as the citation, and offer `follow_up_suggestions` as tappable prompts. Do not send source text or history; the server holds both.

Quizzes: `GET /api/student/quizzes/?module={id}` lists what is available with `attempts_used`, `max_attempts` and `best_percentage`. `POST /api/student/quizzes/{id}/attempts/` returns `attempt_id`, `questions[]` with `id`, `type`, `question`, `options[{key, text}]` for MCQs, and `time_limit_minutes` if set. Calling it again while an attempt is open resumes the same attempt. Submit `{"submitted_answers": {"<question id>": "<option key or free text>"}}` to `POST /api/student/quiz-attempts/{id}/submit/`. Render `percentage`, `passed`, `time_taken_seconds` and `detailed_results[]`; when `status` is `pending_evaluation`, tell the student the written answers await evaluation and poll `GET /api/student/quiz-attempts/{id}/` later. Do not compute the pass mark on the client; `passed` is authoritative and the quiz's `pass_percentage` is in the payload for display.

Remediation after a failed quiz: `POST /api/student/quiz-attempts/{id}/remediation/`.

Assignments: `GET /api/student/assignments/`, `POST /api/student/assignments/{id}/submissions/` with `content` (and optionally `time_spent_seconds`), then `GET /api/student/assignment-submissions/` for status, `score` and `feedback`. Respect `due_at` and `allow_late` in the UI; the server enforces them too.

Own analytics for a dashboard: `GET /api/student/analytics/overview/`.

## Faculty screens

Subjects: `GET /api/faculty/subjects/` (plain array). Students per subject and enrolment: `GET/POST /api/faculty/subjects/{id}/students/`; search with `GET /api/faculty/students/search/?q=`.

Book upload is multipart with `subject_id`, `file` (PDF, DOCX or DOC; the reference client restricted the picker to PDF, which is no longer necessary) and optional `title`. After `POST .../process/`, poll `GET /api/faculty/documents/{id}/` every few seconds until `status` is `under_review` or `error` (show `error_message`). Then load `GET .../outline/` and present a real review screen: the chapter and module tree, each module's resolved `source_text` preview and `source_missing` flag, and the document's `extracted_headings` list so the reviewer can re-point a module by choosing a heading (`source_heading_index`). Save with `PUT .../outline/`, keeping `id` on every existing chapter and module. Do not auto-confirm; the reference client's habit of confirming immediately is exactly what the review state exists to prevent.

After review: `ready/`, `publish/` (may return `PUBLISH_ADMIN_ONLY` depending on deployment; show it as "sent to admin for publishing"), then open modules with `POST /api/faculty/modules/{id}/availability/` or a chapter at once. Students see nothing until a module is open.

Quizzes: generate with `POST /api/faculty/quizzes/generate/`, show the draft for editing (show `generation_warning` when present; a 503 `QUIZ_GENERATION_FAILED` means nothing was created), save edits with `PATCH`, publish with `status/`. Editing after attempts exist returns a new quiz id; update the list. Attempts and re-evaluation live under `.../attempts/` and `/api/faculty/quiz-attempts/{id}/re-evaluate/`.

Assignments mirror quizzes, with `rubric` points summing to `max_score` and evaluation at `/api/faculty/assignment-submissions/{id}/evaluate/`.

Analytics for a faculty dashboard: overview, per-subject summary, students table and module funnel, all under `/api/faculty/analytics/`. Each endpoint returns everything the screen needs in one call; do not fan out per student.

## Administrator screens

Users: list, create, edit, discontinue, reactivate and reset password under `/api/admin/faculty/` and `/api/admin/students/`; Excel import is multipart `file` to `.../import/`, and the response report should be shown row by row. Subjects and the two link tables under `/api/admin/subjects/`. Audit log with filters at `/api/admin/audit-logs/`. Platform analytics at `/api/admin/analytics/platform/`, and every faculty analytics endpoint also exists under `/api/admin/` unscoped. Admins may use every `/api/faculty/` endpoint as well, which is how they publish when faculty cannot.

## Things the client must not do

It must not send source text, conversation history, elapsed quiz time, scores or pass decisions; the server ignores or refuses them. It must not cache `questions` with answers because it never receives them. It must not decide what a student may see from cached lists; the server's 403 and 404 responses are the truth, so refresh on them. It must not treat a `fallback` generator flag as equivalent to AI output.

## Pagination

Paginated responses are `{"count", "next", "previous", "results"}`; pass `?page=` and `?page_size=` (up to 200). Short bounded lists (a user's subjects, an attempt's questions) are plain arrays. The OpenAPI schema marks which is which.
