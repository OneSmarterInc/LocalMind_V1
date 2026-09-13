# LocalMind API Guide

This guide explains how the API is organised and how each role's workflow moves through it. Exact request and response fields for every operation are in the generated OpenAPI schema (`backend/openapi.yaml`, or live at `/api/schema/` with Swagger UI at `/api/docs/` when `DJANGO_DEBUG=true` or `API_DOCS_ENABLED=true`), so they are not repeated here field by field.

## Conventions

The base path is `/api/`. All request and response bodies are JSON except file uploads, which are `multipart/form-data`. Identifiers are UUIDs. Timestamps are ISO-8601 in UTC. List endpoints that return many rows are paginated as `{"count", "next", "previous", "results"}` with `?page=` and `?page_size=` (default 25, maximum 200); a few short lists (a faculty member's subjects, a student's subjects) are returned as plain arrays because they are bounded by design.

Authentication is a bearer JWT in the `Authorization: Bearer <access>` header. Access tokens expire after `ACCESS_TOKEN_MINUTES` (60 by default); refresh tokens after `REFRESH_TOKEN_DAYS` (7). Refreshing rotates the refresh token and blacklists the old one.

## Portals

The URL prefix is a portal, and a token only works on the portal for its role.

| Prefix | Who | Contents |
|---|---|---|
| `/api/auth/` | everyone | role-specific login, refresh, logout, me, password change, heartbeat |
| `/api/admin/` | admin | users, subjects, assignments of faculty and students, audit log, every content and assessment endpoint faculty have, platform analytics |
| `/api/faculty/` | faculty and admin | assigned subjects, students, documents and outlines, module availability, quizzes, assignments, subject analytics |
| `/api/student/` | student | enrolled subjects, published content, quizzes, assignments, tutor, time reporting, own analytics |

Within a portal, every queryset is scoped: faculty only ever see subjects they are actively assigned to, students only subjects they are actively enrolled in. A record outside the caller's scope returns 404, indistinguishable from one that does not exist.

## Error envelope

Every error, from any layer, has the same shape:

```json
{"error": {"code": "MODULE_LOCKED", "message": "This module has not been opened yet.", "details": {}}}
```

`details` is present only when there is structured information to add (validation failures list the offending fields; import reports list per-row errors). HTTP status follows the exception type: 400 validation, 401 authentication, 403 forbidden, 404 not found, 409 conflict, 422 processing failure, 429 rate limited, 503 AI unavailable, 500 internal.

### Code catalogue

Generic: `AUTHENTICATION_REQUIRED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `RATE_LIMITED`, `INTERNAL_ERROR`, `AI_UNAVAILABLE`.

Accounts: `INVALID_CREDENTIALS` (wrong password, wrong portal for the account, or inactive account; deliberately identical), `INVALID_ROLE`, `INVALID_REFRESH`, `PASSWORD_CHANGE_REQUIRED`, `INVALID_CURRENT_PASSWORD`, `PASSWORD_REUSED`, `ACCOUNT_INACTIVE`, `USER_EXISTS`, `SELF_DISCONTINUE`, `ALREADY_DISCONTINUED`, `ALREADY_ACTIVE`, `NOT_FACULTY`.

Excel import: `EXCEL_UNAVAILABLE`, `INVALID_WORKBOOK`, `EMPTY_WORKBOOK`, `MISSING_HEADERS`, `TOO_MANY_ROWS`, `INVALID_SUBJECT`.

Academics: `SUBJECT_CODE_EXISTS`, `SUBJECT_INACTIVE`, `SUBJECT_ARCHIVED`, `STATUS_UNCHANGED`, `SUBJECT_NOT_ASSIGNED`, `NOT_ASSIGNED`, `NOT_ENROLLED`, `INVALID_STUDENT`.

Documents: `UNSUPPORTED_FILE_TYPE`, `FILE_CONTENT_MISMATCH` (extension and magic bytes disagree), `FILE_TOO_LARGE`, `EMPTY_FILE`, `ALREADY_PROCESSING`, `PROCESSING_FAILED`, `NO_SECTIONS`, `EMPTY_OUTLINE`, `NO_MODULES`, `MISSING_TITLE`, `MODULE_IN_USE`, `CHAPTER_IN_USE`, `NO_SOURCE_TEXT` (an outline save would leave no module with text), `EMPTY_SOURCE_TEXT` (a module's text set to empty), `MODULE_SOURCE_MISSING`, `PUBLISHED_STRUCTURE_LOCKED`, `PUBLISH_ADMIN_ONLY`, `INVALID_STATE`.

Learning and assessments: `MODULE_LOCKED`, `NO_SOURCE`, `TARGET_REQUIRED`, `INVALID_QUESTIONS`, `INVALID_COUNTS`, `NO_QUESTIONS`, `PLACEHOLDER_QUESTIONS`, `QUIZ_CLOSED`, `MAX_ATTEMPTS_REACHED`, `ALREADY_SUBMITTED`, `NOT_SUBMITTED`, `SUPERSEDED`, `PAST_DUE`, `CONVERSATION_MISMATCH`.

## Authentication flow

1. `POST /api/auth/login/{admin|faculty|student}/` with `{"email", "password"}`. The role in the path must match the account. The response carries `access`, `refresh`, `user`, `must_change_password` and `session_id`. Logging in opens an application session.
2. If `must_change_password` is true, every endpoint except `POST /api/auth/password/change/`, `GET /api/auth/me/`, `POST /api/auth/logout/` and `POST /api/auth/heartbeat/` returns 403 `PASSWORD_CHANGE_REQUIRED`. Change it with `{"current_password", "new_password"}`; the response returns fresh tokens and `must_change_password: false`.
3. Send `POST /api/auth/heartbeat/` with `{"session_id"}` every few minutes while the app is in the foreground. A session with no heartbeat for `SESSION_HEARTBEAT_TIMEOUT_MINUTES` is closed at its last heartbeat.
4. `POST /api/auth/refresh/` with `{"refresh"}` when the access token expires.
5. `POST /api/auth/logout/` with `{"refresh", "session_id"}` blacklists the refresh token and closes the session.

Login is rate limited to 20 requests a minute per client; AI endpoints to 60.

## Administrator workflow

Create subjects with `POST /api/admin/subjects/` (`name`, `code`, optional `description`; codes are uppercased and unique). Change state with `POST .../status/` (`active`, `discontinued`, `archived`; archived is terminal).

Create faculty with `POST /api/admin/faculty/` (`email`, `full_name`, optional `profile` with `employee_id`, `department`, `designation`, `phone`, and optional `subject_ids` to assign immediately). Create students with `POST /api/admin/students/` (`profile` may hold `roll_number`, `program`, `batch`, `phone`). Both return the created user; the password is the configured initial password and must be changed at first login.

Bulk import with `POST /api/admin/faculty/import/` or `/students/import/` as multipart with a `file` field holding an `.xlsx`. Required columns are `name` and `email`; optional columns match the profile fields, and faculty may include `subject_codes` (comma-separated). Common header variants (`Full Name`, `E-mail`, `Roll No`, `Subjects`) are accepted. Parsing is separated from creation: the whole workbook is validated first, then each row is created in its own savepoint, and the response is a report `{"total_rows", "created", "already_existing", "invalid", "errors": [{"row", "email", "error"}]}`. Templates are in `backend/samples/`.

Manage assignment of faculty with `POST /api/admin/subjects/{id}/faculty/` (`faculty_ids`) and `DELETE .../faculty/{faculty_id}/`, or from the user side with `POST /api/admin/faculty/{id}/subjects/` (`subject_ids`). Enrol students with `POST /api/admin/subjects/{id}/students/` (`student_ids`); the response reports each id as `enrolled`, `already_enrolled`, `re_enrolled` or `skipped`. Discontinue a single enrollment with `POST .../students/{student_id}/discontinue/`; the row stays for history and the student's account is untouched.

Discontinue or reactivate any user with `POST /api/admin/{faculty|students}/{id}/discontinue/` (optional `reason`) and `.../reactivate/`. Discontinuing revokes outstanding refresh tokens. Reset a password to the initial value with `.../reset-password/`, which also sets the forced-change flag again.

Review everything that changed with `GET /api/admin/audit-logs/?action=&target_type=&target_id=&actor=&actor_email=&since=&until=`.

Platform-wide numbers are at `GET /api/admin/analytics/platform/` and `.../platform/subjects/` (one row per subject, including `modules_published`). Administrators use the faculty analytics endpoints themselves (`/api/faculty/analytics/...`), unscoped. Books, chapters, modules, quizzes, assignments and their analytics have one set of routes, under `/api/faculty/`, which both roles use; they are not repeated under `/api/admin/`.

## Faculty workflow

`GET /api/faculty/subjects/` lists assigned subjects. `GET /api/faculty/subjects/{id}/students/` lists enrolled students; `POST` enrols more (faculty may enrol into their own subjects), and `GET /api/faculty/students/search/?q=` finds students by name, email or roll number, returning minimal identity.

### Books

Upload with `POST /api/faculty/documents/` as multipart (`subject_id`, `file`, optional `title`). Accepted types are PDF, DOCX and DOC, checked by extension and content. Then `POST /api/faculty/documents/{id}/process/`. In the default configuration processing runs in the background and the response shows status `processing`; poll `GET /api/faculty/documents/{id}/` until it is `under_review` or `error`. When `PROCESS_DOCUMENTS_INLINE` is set the call blocks and returns the final state, with 422 `PROCESSING_FAILED` on failure.

`GET /api/faculty/documents/{id}/outline/` returns chapters, their modules, each module's `source_heading_index`, `source_text`, `source_missing` flag and `availability`, plus the document's `extracted_headings` so a review screen can offer the real section list. `PUT` the same shape back to edit: keep `id` on chapters and modules you are editing (they update in place, including reordering), omit `id` to create, leave out a module to delete it. Deleting a module that has quizzes, assignments, progress or conversations attached fails with `MODULE_IN_USE`. You may set a module's `source_heading_index` to point it at a different section, or supply `source_text` directly. A module whose text resolves to nothing is not kept: the save removes it (and any chapter left with no modules) and lists what it removed in `outline_report` (`removed_empty_modules`, `removed_empty_chapters`, and `hidden_empty_modules` for textless modules kept only because student work refers to them). Each module in the outline carries `lesson_status` (`ready`, `pending`, `generating`, `failed`, `none`), and the document detail carries `lessons` counts.

Edit text without touching structure with `PATCH /api/faculty/chapters/{id}/` and `PATCH /api/faculty/modules/{id}/` (`title`, `source_text`); these bump the document's `content_version`. Changing a module's text queues a new lesson for that module; setting it to empty is refused with `EMPTY_SOURCE_TEXT`. `GET /api/faculty/modules/{id}/lesson/` previews a module's lesson and its generation state; `POST` to it regenerates that lesson, and `POST /api/faculty/documents/{id}/lessons/` queues every module without a current lesson (`{"force": true}` regenerates all).

Mark the document `ready/`, then `publish/`. Publishing needs at least one module with source text. Whether faculty may publish is controlled by `FACULTY_CAN_PUBLISH`; when it is false the call returns `PUBLISH_ADMIN_ONLY` and an administrator publishes from the admin portal. `unpublish/` hides the book from students without losing anything; `archive/` retires it.

Modules are `locked` on publish. Open them with `POST /api/faculty/modules/{id}/availability/` (`{"availability": "open"}`) or a whole chapter at once with `POST /api/faculty/chapters/{id}/availability/`. Modules without source text do not exist except where student work refers to them; those stay hidden and cannot be opened.

### Quizzes

Create manually with `POST /api/faculty/quizzes/` giving exactly one of `module_id` or `chapter_id`, a `questions` array, and optional `title`, `instructions`, `pass_percentage`, `max_attempts`, `time_limit_minutes`, `available_from`, `due_at`. Each MCQ question needs `type: "mcq"`, `question`, `options` as `[{"key", "text"}]`, `correct_answer` matching a key, and optionally `explanation` and `source_reference`. Each subjective question needs `type: "subjective"`, `question`, `expected_rubric`, and optionally `source_reference`.

Generate with `POST /api/faculty/quizzes/generate/` (`module_ids` for a chosen set, or `module_id`, or `chapter_id`; plus `num_mcqs` and `num_subjective`). Questions are written only from those modules: each module gets at least one question when at least as many are requested as there are modules, the rest follow how much text each has, and no module is asked for more than its text supports. Each question records its `source_module_id`. Questions are checked before they are kept: no references to "the source text" or "the passage", and four distinct, real options (no "Option A", "All of the above" or bracketed filler), shuffled so the correct letter varies. When fewer questions than requested could be written, the quiz is created with those and `generation_warning` explains the shortfall. When none could be written (model unavailable, or nothing usable), the call returns 503 `QUIZ_GENERATION_FAILED` and nothing is created; there are no placeholder drafts.

`PATCH /api/faculty/quizzes/{id}/` edits a draft in place. Editing a quiz that already has attempts creates a new version: the response is the new row, the old one becomes `superseded`, and historical attempts keep pointing at the questions they answered. `POST .../status/` moves between `draft`, `published` and `closed`.

`PATCH /api/faculty/quizzes/{id}/` updates settings in place. A new version is created only when the questions actually change and the quiz already has attempts; the new version keeps its source modules and result-release settings. `null` clears `max_attempts`, `time_limit_minutes`, `available_from`, `due_at` and `results_release_at` (the same for assignment dates). A held automatic quiz includes `hold_details`: `question_ids` of the questions the failing checks name (their evidence refers to questions by id, or `q<n>`; empty when no check names one, for example a judge-only finding), the failing `findings` with the questions each names, and the source passages it compared. `GET /api/faculty/quizzes/{id}/attempts/?student=` lists attempts with the student (`student_email`, `student_name`), scores and per-question results. `POST /api/faculty/quiz-attempts/{id}/re-evaluate/` re-runs AI evaluation of subjective answers, or with `overrides` (`{"q3": {"score_awarded": 1.0, "feedback": "..."}}`, scores on a 0 to 1 scale per question) applies faculty scores directly; either resolves a `pending_evaluation` attempt.

### Assignments

`POST /api/faculty/assignments/` with `module_id`, `chapter_id` or `subject_id`, a `title`, `max_score`, and a `rubric` of `{"criterion", "points"}` items whose points must sum to `max_score`; optional `description`, `instructions`, `available_from`, `due_at`, `allow_late`, `allow_resubmission`, `max_attempts` (total submissions allowed when resubmission is on; null for no limit, over the limit returns 409 `ATTEMPT_LIMIT`). `POST .../generate/` drafts one from the source text (fallback produces a generic rubric). Publish and close via `.../status/`. Submissions are listed at `GET .../submissions/` (each with `student_email`, `student_name` and `results_released_at`); evaluate with `POST /api/faculty/assignment-submissions/{id}/evaluate/` (`score`, `feedback`, optional `rubric_scores`).

### Analytics

`GET /api/faculty/analytics/overview/` summarises each assigned subject. Per subject: `.../subjects/{id}/` (headline numbers), `.../subjects/{id}/students/` (one row per enrolled student with completion, quiz and assignment averages, time on task and last activity), `.../subjects/{id}/modules/` (a per-module funnel with quiz pass rates). Per student: `.../students/{id}/` and `.../students/{id}/subjects/{subject_id}/`, allowed only when the student shares a subject with the caller. Session logs are at `.../users/{id}/sessions/`. All accept `?since=&until=` on time-stamped facts. Roster rows from `.../subjects/{id}/students/` include each student's `best_quiz_percentage`. The per-student subject view also lists that student's recent quiz attempts (`quiz_attempts`: quiz, attempt number, status, percentage, whether results are released). `GET /api/faculty/analytics/activity/` returns recent teaching activity in the caller's subjects (quiz attempts and assignment submissions grouped per item and day, books reaching review or publication, lessons generated), newest first.

## Student workflow

`GET /api/student/subjects/` lists active enrollments. `GET /api/student/subjects/{id}/documents/` lists published books; `GET /api/student/documents/{id}/` returns the chapter and module tree with each module's `availability` and the student's progress state, but no source text. `GET /api/student/modules/{id}/` returns the module with its source text and marks it `in_progress` on first read; a locked module returns 403 `MODULE_LOCKED`.

Report reading time with `POST /api/student/modules/{id}/time/` (`{"seconds"}`), in small chunks; each chunk is clamped to fifteen minutes.

Learn with `GET` (or `POST`) `/api/student/modules/{id}/teach/`. Lessons are generated in the background when content arrives, so this never waits for the model. `status` is `ready` (`lesson` is the tutor's structured lesson: `title`, `learning_objectives`, `sections` each with a `heading`, `explanation` and `source_reference`, `key_terms`, `summary`), `preparing` (`lesson` is null and `queue_position` says how far along it is; ask again in a few seconds), or `unavailable` (`lesson` is a plain version built from the source text, `generator` is `fallback`, and `retry_scheduled` says whether the tutor's lesson is still coming). Ask questions with `POST /api/student/modules/{id}/ask/` (`question`, optional `conversation_id` to continue a thread); answers are grounded in the module's source and cite it, and the response includes `follow_up_suggestions`. When the AI is down this endpoint returns 503 `AI_UNAVAILABLE` rather than an invented answer. Threads are listed at `GET /api/student/conversations/?module=`.

`GET /api/student/quizzes/?module=&subject=` lists published quizzes on open modules, with `subject_id`, `attempts_used`, `results_pending` (submitted attempts whose results are not visible yet) and `best_percentage`/`passed`, which only count attempts whose results the student may see. `POST /api/student/quizzes/{id}/attempts/` starts (or resumes) an attempt and returns questions with answers and rubrics stripped. `POST /api/student/quiz-attempts/{id}/submit/` with `{"submitted_answers": {"q1": "A", "q2": "free text"}}` scores it: the response has `score`, `percentage`, `passed`, `time_taken_seconds` (server computed) and `detailed_results`, or status `pending_evaluation` if subjective evaluation could not run. A second submit returns 409 `ALREADY_SUBMITTED`. `GET /api/student/scores/?subject=` lists every evaluated attempt; `POST /api/student/quiz-attempts/{id}/remediation/` returns targeted explanations for the questions missed.

`GET /api/student/assignments/` lists published assignments; `POST .../{id}/submissions/` with `content` submits (late submissions are flagged `is_late`, and refused when `allow_late` is false). `GET /api/student/assignment-submissions/` shows status, score and feedback.

Own analytics: `GET /api/student/analytics/overview/`, `.../subjects/{id}/`, `.../sessions/`. `GET /api/student/subjects/` includes `faculty_names` for each subject, and `GET /api/student/modules/{id}/` includes `module_number`, `module_count` (position in the book) and `faculty_names`.

## The acceptance flow, end to end

Administrator logs in, changes password, creates a subject, creates a faculty account assigned to it, creates or imports students and enrols them. Faculty logs in, changes password, uploads a book, processes it, reviews and fixes the outline, publishes, opens the first module, generates and publishes a quiz, publishes an assignment. Student logs in, changes password, sees the subject and book, reads the open module (the locked ones refuse), asks the tutor a question, takes the quiz and is scored deterministically, submits the assignment, and sees their progress. Faculty sees the attempt and the submission, evaluates it, and the cohort analytics reflect all of it. This exact sequence is what the acceptance script in `backend/scripts/acceptance.py` exercises against a running server.

## AI Monitoring & Guard

Administrators review the independent evaluations of tutor answers and generated quizzes under `/api/admin/monitor/` (overview, trends, subjects, user impact, incidents with review and assignment, evaluations with feedback and re-evaluation, on-demand evaluation, backlog, policies). Faculty get a read-and-label subset under `/api/faculty/monitor/`, scoped to their subjects and to academic-content issue types. The full endpoint table and the decision logic are in `docs/AI_MONITORING.md`. Review actions use the codes `INVALID_ACTION` (unknown action) and `ACTION_NOT_ALLOWED` (faculty attempting close/escalate/reopen); `NOT_AN_AI_RESPONSE` is returned when a user message is submitted for evaluation and `INVALID_KIND` when `kind` is not `tutor_answer` or `quiz`.
