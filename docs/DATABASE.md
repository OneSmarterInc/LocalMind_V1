# LocalMind Database

Every application table extends `TimeStampedUUIDModel`: a UUID primary key `id`, and `created_at` / `updated_at` timestamps. Those three columns are omitted from the field lists below. Foreign keys are named for the model they reference; the column in the database is `<name>_id`. `PROTECT` means the referenced row cannot be deleted while this row exists; `SET_NULL` means the link is cleared; `CASCADE` means this row is deleted with its parent. Deletion is rare in practice because almost everything uses a status column instead.

The schema is identical on SQLite and PostgreSQL. JSON columns are `JSONField`, which maps to `jsonb` on PostgreSQL. Migrations for every app are committed; `python manage.py migrate` creates 39 tables.

## Table names

Every LocalMind table has a short name that says what it holds (set with `Meta.db_table`; migrations `*_short_table_names` renamed the old `app_model` names). The code still uses the model names in the last column.

| Table | What each row is | Model (old table name) |
|---|---|---|
| `users` | A person who can sign in: administrator, faculty member or student, with role and status | `accounts.User` (`accounts_user`) |
| `faculty_profiles` | Extra details of a faculty member: employee id, department, designation, phone | `accounts.FacultyProfile` (`accounts_facultyprofile`) |
| `student_profiles` | Extra details of a student: roll number, programme, batch, phone | `accounts.StudentProfile` (`accounts_studentprofile`) |
| `subjects` | A course, e.g. "Class 10 Science" | `academics.Subject` (`academics_subject`) |
| `faculty_subjects` | Which faculty member teaches which subject | `academics.FacultySubject` (`academics_facultysubject`) |
| `student_enrollments` | Which student is enrolled in which subject | `academics.Enrollment` (`academics_enrollment`) |
| `books` | An uploaded book or document of a subject, with processing and publishing status | `documents.Document` (`documents_document`) |
| `chapters` | A chapter of a book | `learning.Chapter` (`learning_chapter`) |
| `modules` | A section of a chapter that students read, are tutored on and quizzed on, with its text | `learning.Module` (`learning_module`) |
| `module_text_chunks` | A module's text cut into searchable pieces for the tutor | `documents.DocumentChunk` (`documents_documentchunk`) |
| `module_lessons` | The generated lesson of a module and its generation status | `tutor.ModuleLesson` (`tutor_modulelesson`) |
| `module_progress` | How far one student has got in one module | `learning.ModuleProgress` (`learning_moduleprogress`) |
| `quizzes` | A quiz with its questions and answers, written by hand or by the AI | `assessments.Assessment` (`assessments_assessment`) |
| `quiz_modules` | Which modules a multi-module quiz was written from | `Assessment.source_modules` (`assessments_assessment_source_modules`) |
| `quiz_attempts` | One student's attempt at a quiz: answers, score, result | `assessments.AssessmentAttempt` (`assessments_assessmentattempt`) |
| `auto_quiz_jobs` | The background job that writes a module's automatic quiz | `assessments.AutoQuizJob` (`assessments_autoquizjob`) |
| `assignments` | A written assignment with its rubric | `assignments.Assignment` (`assignments_assignment`) |
| `assignment_modules` | Which modules a multi-module assignment was written from | `Assignment.source_modules` (`assignments_assignment_source_modules`) |
| `assignment_submissions` | One student's submission and its marks | `assignments.AssignmentSubmission` (`assignments_assignmentsubmission`) |
| `tutor_conversations` | A student's chat with the tutor about a module | `tutor.Conversation` (`tutor_conversation`) |
| `tutor_messages` | One question or answer in a tutor chat | `tutor.Message` (`tutor_message`) |
| `login_sessions` | One sign-in, from login to logout or timeout | `activity.ApplicationSession` (`activity_applicationsession`) |
| `time_spent` | Seconds a user spent learning, on a quiz, an assignment or the tutor | `activity.ActivityEvent` (`activity_activityevent`) |
| `audit_log` | Who did what to which record, and when | `audit.AuditLog` (`audit_auditlog`) |
| `ai_checks` | The AI monitor's check of one tutor answer or AI-written quiz | `ai_monitor.Evaluation` (`ai_monitor_evaluation`) |
| `ai_incidents` | A problem the AI monitor found, and its review | `ai_monitor.Incident` (`ai_monitor_incident`) |
| `ai_incident_rules` | When a check becomes an incident, per kind of problem | `ai_monitor.Policy` (`ai_monitor_policy`) |
| `ai_check_feedback` | A reviewer's verdict on a check (correct, false positive...) | `ai_monitor.Feedback` (`ai_monitor_feedback`) |

Tables that belong to Django and its libraries keep their standard names, because those libraries look them up by name: `auth_permission`, `auth_group`, `auth_group_permissions`, `users_groups`, `users_user_permissions` (permission groups, unused by LocalMind), `django_content_type`, `django_admin_log`, `django_session` (Django's admin site), `django_migrations` (which migrations ran), `token_blacklist_outstandingtoken` and `token_blacklist_blacklistedtoken` (sign-in tokens issued and revoked).

## Entity relationships

```
User 1──* FacultySubject *──1 Subject 1──* Enrollment *──1 User
                                 │
                                 1──* Document 1──* Chapter 1──* Module
                                 │                                 │
                                 1──* Assessment ─────────────────┤ (module or chapter)
                                 1──* Assignment ─────────────────┤
                                                                   1──* ModuleProgress *──1 User
                                                                   1──* ModuleLesson
                                                                   1──* Conversation 1──* Message
Assessment 1──* AssessmentAttempt *──1 User
Assignment 1──* AssignmentSubmission *──1 User
User 1──* ApplicationSession
User 1──* ActivityEvent (optional Subject, Module)
User 1──* AuditLog (actor)
```

## accounts

### users

Custom user model (`AUTH_USER_MODEL = accounts.User`), email login, no username.

| Field | Type | Notes |
|---|---|---|
| email | varchar, unique | login identifier, stored lowercase |
| full_name | varchar | |
| role | varchar | `admin`, `faculty`, `student`; indexed |
| status | varchar | `active`, `discontinued`, `locked`; indexed |
| must_change_password | bool | true on creation and after admin reset |
| password_changed_at | datetime, null | |
| discontinued_at | datetime, null | |
| created_by | FK User, SET_NULL | the admin who created the account |
| organization_key | varchar | reserved for multi-tenant partitioning; empty today |
| password, last_login, is_superuser, groups, user_permissions | | Django internals; `is_active` and `is_staff` are properties derived from `status` and `role` |

### faculty_profiles and student_profiles

One-to-one with `User` (primary key is `user_id`). Faculty: `employee_id`, `department`, `designation`, `phone`. Student: `roll_number`, `program`, `batch`, `phone`. All optional strings.

## academics

### subjects

| Field | Type | Notes |
|---|---|---|
| name | varchar | |
| code | varchar, unique | uppercased on save |
| description | text | |
| status | varchar | `active`, `discontinued`, `archived` (terminal); indexed |
| created_by | FK User, SET_NULL | |
| discontinued_at, archived_at | datetime, null | |
| organization_key | varchar | reserved |

### faculty_subjects

Unique on (`faculty`, `subject`). `faculty` FK User CASCADE, `subject` FK Subject CASCADE, `status` (`active`, `discontinued`), `assigned_by` FK User SET_NULL, `assigned_at`, `discontinued_at`. Re-assigning reuses the row and sets it active again.

### student_enrollments

Unique on (`student`, `subject`). `student` FK User CASCADE, `subject` FK Subject CASCADE, `status` (`active`, `discontinued`, `completed`), `enrolled_at`, `discontinued_at`, `completed_at`, `created_by` FK User SET_NULL.

## audit

### audit_log

`actor` FK User SET_NULL plus snapshotted `actor_email` and `actor_role` so the row stays meaningful if the user changes; `action` (dotted verb such as `document.publish`), `target_type`, `target_id`, `target_label`, `summary` JSON with password and token keys scrubbed, `ip_address`. Indexed on (`action`, `created_at`) and (`target_type`, `target_id`).

## documents

### books

| Field | Type | Notes |
|---|---|---|
| subject | FK Subject, PROTECT | |
| uploaded_by | FK User, SET_NULL | |
| title | varchar | defaults to the file name without extension |
| original_name | varchar | |
| file | file | stored at `documents/<id>/original.<ext>` under MEDIA_ROOT |
| file_type | varchar | `pdf`, `docx`, `doc` |
| file_size | bigint | |
| status | varchar | `uploaded`, `processing`, `under_review`, `ready`, `published`, `unpublished`, `archived`, `error`; indexed |
| processed_markdown_path | varchar | relative path of the parsed markdown |
| extracted_headings | JSON | `[{"index", "level", "title", "start_page", "end_page"}]` from the parser |
| outline_source | varchar | `ai`, `source_hierarchy`, `edited` |
| parse_mode | varchar | parser mode used |
| error_message | text | populated when status is `error` |
| processing_started_at, processed_at, reviewed_at, published_at, unpublished_at, archived_at | datetime, null | |
| reviewed_by, published_by, last_edited_by | FK User, SET_NULL | |
| content_version | int | incremented on any text edit; lessons cache against it |
| last_edited_at | datetime, null | |

Indexed on (`subject`, `status`).

## learning

### chapters

`document` FK Document CASCADE, `title`, `order` (unique per document), `source_heading_index` (null when user-created), `source_text`, `start_page`, `end_page`, `is_user_edited`.

### modules

`chapter` FK Chapter CASCADE, `title`, `order` (unique per chapter), `source_heading_index`, `source_text`, `source_missing` (true only for a textless module kept because student work refers to it; hidden from students; every other textless module is removed), `start_page`, `end_page`, `is_user_edited`, `availability` (`locked`, `open`; indexed), `opened_by` FK User SET_NULL, `opened_at`.

### module_progress

Unique on (`student`, `module`). `status` (`not_started`, `in_progress`, `completed`, `needs_review`), `started_at`, `completed_at`, `last_viewed_at`, `best_quiz_percentage` float null, `quiz_attempts` int, `learning_seconds` int, `overridden_by` FK User SET_NULL (set when faculty change the status by hand).

## assessments

### quizzes

| Field | Type | Notes |
|---|---|---|
| subject | FK Subject, PROTECT | denormalised from the module or chapter for scoping |
| chapter | FK Chapter, PROTECT, null | exactly one of chapter / module is set |
| module | FK Module, PROTECT, null | |
| kind | varchar | `module`, `chapter` |
| title, instructions | | |
| questions | JSON | private; `[{"id", "type", "question", "options", "correct_answer", "explanation", "expected_rubric", "source_reference"}]` |
| generator | varchar | `ai`, `fallback`, `manual` |
| status | varchar | `draft`, `published`, `closed`, `superseded`; indexed |
| pass_percentage | smallint | default from settings (65) |
| max_attempts | smallint | 0 means unlimited |
| time_limit_minutes | smallint, null | |
| available_from, due_at | datetime, null | |
| version | int | starts at 1 |
| supersedes | one-to-one Assessment, null | the previous version this row replaced |
| created_by | FK User, SET_NULL | |
| published_at, closed_at | datetime, null | |
| content_version_at_creation | int | the document's content_version when questions were generated |

### quiz_attempts

Unique on (`assessment`, `student`, `attempt_number`). `assessment` FK PROTECT (an assessment with attempts is never deleted, only superseded or closed), `student` FK CASCADE, `status` (`in_progress`, `submitted`, `pending_evaluation`, `evaluated`), `started_at`, `submitted_at`, `time_taken_seconds` (server computed), `submitted_answers` JSON, `score` float, `total_questions`, `percentage` float, `passed` bool null, `detailed_results` JSON (per question: correct, awarded, feedback), `evaluation_notes` JSON (AI or faculty notes), `evaluated_by` FK User SET_NULL, `evaluated_at`. Rows are never updated after evaluation except through faculty re-evaluation, which is audited.

## assignments

### assignments

`subject` FK PROTECT, optional `chapter` and `module` FK PROTECT, `created_by`, `title`, `description`, `instructions`, `rubric` JSON `[{"criterion", "points"}]` summing to `max_score`, `max_score` smallint, `generator`, `status` (`draft`, `published`, `closed`), `available_from`, `due_at`, `allow_late`, `allow_resubmission`, `max_attempts` (positive int, null; with resubmission allowed, the total number of submissions a student may make, null meaning no limit; added by `assignments/0004_assignment_max_attempts`), `published_at`, `closed_at`. Indexed on (`subject`, `status`).

### assignment_submissions

Unique on (`assignment`, `student`, `attempt_number`). `content` text, `submitted_at`, `is_late`, `time_spent_seconds` (client-reported, clamped), `status` (`submitted`, `evaluated`, `returned`), `score` float null, `feedback`, `rubric_scores` JSON, `evaluated_by`, `evaluated_at`.

## tutor

### module_lessons

One row per module (`module` one-to-one, CASCADE), and the row is also the background job: `status` (`pending`, `generating`, `ready`, `failed`; indexed with `next_attempt_at`), `source_hash` (SHA-256 of the module text the lesson is for), `lesson` JSON (null until ready), `generator`, `model_name`, `attempts`, `last_error`, `requested_at`, `claimed_at`, `generated_at`, `next_attempt_at`, `version` (bumped on every state change; workers claim and finish with conditional updates on it). Shared across students because it depends only on source text.

### tutor_conversations and tutor_messages

A conversation belongs to one student and one module (`title`, `last_message_at`; indexed on student and module). Messages: `role` (`user`, `assistant`), `content`, `grounded` bool, `source_reference`, `model_name`, `latency_ms`. Ordered by `created_at`.

## activity

### login_sessions

`user` FK CASCADE, `login_at`, `last_heartbeat_at`, `logout_at` null, `ended_by` (`logout`, `timeout`, `relogin`), `duration_seconds` (server computed when closed), `user_agent`, `ip_address`. Indexed on (`user`, `logout_at`).

### time_spent

`user` FK CASCADE, `kind` (`learning`, `quiz`, `assignment`, `tutor`; indexed), optional `subject` and `module` FK SET_NULL, `reference_id` (attempt, submission or conversation id as text), `seconds`, `occurred_at` (indexed). Indexed on (`user`, `kind`, `occurred_at`).

## ai_monitor

The AI Monitoring & Guard tables. They point at the rows they judge with `SET_NULL` links so deleting a conversation or a quiz keeps the monitoring history.

### ai_checks

One row per (`interaction_kind`, `interaction_id`, `evaluator_version`), unique. `interaction_kind` is `tutor_answer` or `quiz`; `message` FK `tutor.Message` and `assessment` FK `assessments.Assessment` (SET_NULL); `user` (the student who asked or the faculty member who generated), `subject`, `module` (SET_NULL); `app_model_name` (indexed). Bounded excerpts `prompt_excerpt` and `response_excerpt` (4,000 characters), `evidence_json` (list of `{kind, ref, id?, text, truncated?}` passages), `validators_json` (list of `{name, passed, issue_type, severity, confidence, detail, evidence}`). Judge fields: `judge_invoked`, `judge_reason` (`suspicious`, `undecided`, `sampled`, `forced`), `judge_json` (normalised verdict), `judge_model`, `judge_latency_ms`, `judge_error`. Decision: `verdict` (`pass`, `issue`, `abstain`), `issue_type`, `severity` (`low` to `critical`), `confidence` (0 to 1), `reason`, `recommended_action`, `stage` (`done`, `failed`), `error`, `duration_ms`. Indexed on (`verdict`, `severity`), (`subject`, `created_at`), (`app_model_name`, `created_at`).

### ai_incidents

`evaluation` one-to-one CASCADE; `user`, `subject`, `assigned_to`, `resolved_by` FK SET_NULL; `issue_type`, `severity` (copied from the evaluation, possibly bumped by recurrence); `status` (`open`, `confirmed`, `false_positive`, `needs_investigation`, `escalated`, `closed`); `reviewer_note`; `recurrence` (same-type incidents on the same module in the previous seven days at creation); `resolved_at`. Indexed on (`status`, `severity`) and (`subject`, `status`).

### ai_incident_rules

One row per `issue_type` (unique): `enabled`, `min_confidence`, `min_severity`, `description`, `version` (bumped on every edit), `updated_by`. Defaults are created on first use from `ai_monitor.models.DEFAULT_POLICIES`.

### ai_check_feedback

`evaluation` FK CASCADE, `incident` FK SET_NULL, `reviewer` FK SET_NULL, `label` (`correct`, `false_positive`, `needs_investigation`; indexed), `note`. The false-positive rate and high-severity precision on the admin overview are computed from these rows.

## Invariants the services enforce

A subject that is archived accepts no new documents, quizzes, assignments, assignments of faculty or enrollments. A module never exists without source text unless student work refers to it (then it is flagged and hidden); a document may only be published with at least one module that has text. Once published, its chapter and module set is fixed; text may still change. A module referenced by any assessment, assignment, progress row or conversation cannot be deleted through the outline editor. An assessment with attempts is never edited in place; a new version is created. An attempt is written once at submission; later evaluation only fills evaluation fields. Session durations and attempt timings are never accepted from a client.

## Retention

Nothing is hard-deleted by the API. Users, subjects, enrollments and assignments are discontinued or archived; documents are archived and their files kept. `cleanup_media` finds media directories whose document row no longer exists (which can only happen through manual database work) and removes them on request. The one scheduled deletion is the AI monitor's retention: `monitor_ai --purge` (on the maintenance timer) removes `ai_monitor_evaluation` rows older than `AI_MONITOR_RETENTION_DAYS` together with their resolved incidents, and keeps any whose incident is still open, escalated or under investigation.
