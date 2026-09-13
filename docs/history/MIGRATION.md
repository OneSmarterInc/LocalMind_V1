# Migration Notes: from the reference codebase to LocalMind

The reference ZIP (`LocalMind_Clean_With_DB.zip`) was treated as a reference, not a base. This backend is a new project. Nothing in the reference database schema is preserved, no data migration is provided, and the reference API surface is not compatible. This document records what was carried over, what was replaced and why, and what the reference database's contents would mean if anyone wanted to bring them across by hand.

## What was reused

The document parser (`documents/services/parser.py`) is copied from the reference with its behaviour intact: Docling for PDF and legacy Word, a custom DOCX path, markdown output, and the indexed section list keyed by heading index. It is the most valuable piece of the reference and the only one with no design flaw of its own. The MCQ scoring rules (exact key match, one point per question, percentage against a pass mark) are the same. The prompt discipline of the tutor (answer only from the supplied source, cite it, say when the source does not cover the question) is kept, and the JSON-schema-constrained Ollama call pattern is kept and centralised. The idea of resolving outline modules to source sections by heading index rather than by fuzzy title matching was present in the reference as an aspiration and is now the only mechanism.

## What was replaced

Authentication did not exist. There is now a custom user model with roles, JWT with rotation and blacklisting, role-specific login portals, forced first-login password change, and account lifecycle.

The "latest object" fallback pattern (seven views resolved a missing or invalid id to the most recently created row) is gone entirely. Every lookup is a scoped `get` that returns 404 outside the caller's scope.

Client-supplied source text is gone. The reference tutor and quiz generator took `source_text` from the request body; the new services resolve it server-side from the module, and the client never sees a place to inject it.

`replace_outline` destroyed and recreated every chapter and module, minting new ids and orphaning every dependant. The reference database had 30 of 34 assessments and 5 of 7 conversations pointing at ids that no longer existed. The new `persist_outline` reconciles by id and refuses to delete a module anything depends on.

`LearningModule` and `MicroModule` were twin tables created in lockstep and only one was ever used by the client. There is one `Module` table.

Assessments in the reference had no student, no timing, no attempt cap and unlimited resubmission; questions with correct answers were sent to clients; a quiet Ollama outage produced templated pseudo-questions indistinguishable from real ones; subjective evaluation during an outage silently returned zero with the exception text as feedback. All of that is addressed by the `assessments` app design described in `ARCHITECTURE.md`: attempts are owned, timed, capped, immutable and versioned; answers are stripped; fallback questions are labelled and cannot be published; evaluation during an outage yields `pending_evaluation`, never a false zero.

Background processing was a `multiprocessing.Process` spawned from the request thread. It is now a claimed unit of work (`run_processing`) run inline or on a thread, ready to move to a queue.

Six duplicated Ollama call sites are one gateway. `sys.argv` test detection scattered through production modules is one `TESTING` flag in settings. `CORS_ALLOW_ALL_ORIGINS` with credentials, a committed secret key, empty password validators and `DEBUG=true` by default are replaced by environment-driven settings that refuse to start unsafely.

Errors were a mix of `{"detail"}` and `{"error"}` strings; they are one envelope with a code catalogue. There was no pagination, audit trail, OpenAPI schema, subjects, enrollment, module locking, assignments, sessions, time tracking or analytics; all exist now.

## API surface mapping

For anyone updating a client written against the reference API, the correspondence is as follows. Every new endpoint requires a bearer token and sits under a role portal.

| Reference | Replacement |
|---|---|
| `GET /api/documents/` | `GET /api/faculty/documents/?subject=` or `GET /api/student/subjects/{id}/documents/` |
| `POST /api/documents/upload/` | `POST /api/faculty/documents/` (adds `subject_id`) |
| `POST /api/documents/{id}/process/`, `GET /api/documents/{id}/` | same paths under `/api/faculty/` |
| `GET /api/documents/{id}/chapters/` | `GET /api/student/documents/{id}/` (structure without source text) plus `GET /api/student/modules/{id}/` (source text per module) |
| `GET/PUT /api/documents/{id}/outline/`, `POST .../outline/confirm/` | `GET/PUT /api/faculty/documents/{id}/outline/`, then `ready/` and `publish/`; review is mandatory, not skippable |
| `PATCH /api/learning/micro-modules/{id}/status/` | removed; progress is derived server-side from reads and quiz results, with faculty override |
| `POST /api/learning/assessment/generate/` | faculty-only `POST /api/faculty/quizzes/generate/`; students no longer generate quizzes |
| `GET /api/learning/assessment/{id}/`, `POST .../submit/` | `POST /api/student/quizzes/{id}/attempts/`, `POST /api/student/quiz-attempts/{id}/submit/` |
| `POST /api/learning/remediation/generate/` | `POST /api/student/quiz-attempts/{id}/remediation/` |
| `POST /api/tutor/teach/`, `POST /api/tutor/ask/` | `POST /api/student/modules/{id}/teach/`, `POST /api/student/modules/{id}/ask/` (no `source_text` in the body) |
| `GET /api/tutor/conversations/{id}/` | `GET /api/student/conversations/{id}/` |

Response field changes that matter to a client: `status` values are always lower-case; the teach response is `{"lesson": {title, learning_objectives, sections[], key_terms[], summary}, "generator", "cached"}` rather than `introduction/explanation/application/key_takeaways`; quiz options are `{"key", "text"}` and answers are submitted by key; `detailed_results` entries keep the reference names (`question_id`, `question`, `selected_option`, `correct_option`, `is_correct`, `score_awarded`, `explanation`; subjective rows add `student_answer`, `feedback`, `missing_points`) and are returned only after submission.

## Bringing reference data across

There is no automated path, and the reference data is small enough (one demo document and a handful of broken assessments) that recreating it is faster than migrating it. If a real deployment of the reference existed, the honest procedure is: export the original book files from its `media/` directory, create subjects and users in the new system, upload the books through the API, and let them be processed and reviewed afresh. Reference assessments cannot be carried over meaningfully because most reference their modules by ids that no longer resolve, and none record which student answered them.
