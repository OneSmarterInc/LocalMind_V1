# Short, readable database table names (11 September 2026)

## What changed

Every LocalMind table used Django's default `app_model` name: `assessments_assessmentattempt`, `learning_moduleprogress`, `activity_applicationsession`. Each model now names its own table (`Meta.db_table`), and ten migrations named `*_short_table_names` rename the existing tables in place. **No data is copied, moved or changed.** The code, the API and the screens are unaffected; only the names in the database differ.

| New table | What each row is | Old table |
|---|---|---|
| `users` | A person who can sign in (admin, faculty, student) | `accounts_user` |
| `faculty_profiles` | Employee id, department, designation of a faculty member | `accounts_facultyprofile` |
| `student_profiles` | Roll number, programme, batch of a student | `accounts_studentprofile` |
| `subjects` | A course | `academics_subject` |
| `faculty_subjects` | Which faculty member teaches which subject | `academics_facultysubject` |
| `student_enrollments` | Which student is enrolled in which subject | `academics_enrollment` |
| `books` | An uploaded book of a subject | `documents_document` |
| `chapters` | A chapter of a book | `learning_chapter` |
| `modules` | A section students read and are quizzed on, with its text | `learning_module` |
| `module_text_chunks` | A module's text in searchable pieces for the tutor | `documents_documentchunk` |
| `module_lessons` | The generated lesson of a module | `tutor_modulelesson` |
| `module_progress` | One student's progress in one module | `learning_moduleprogress` |
| `quizzes` | A quiz with its questions and answers | `assessments_assessment` |
| `quiz_modules` | Modules a multi-module quiz was written from | `assessments_assessment_source_modules` |
| `quiz_attempts` | One student's attempt at a quiz | `assessments_assessmentattempt` |
| `auto_quiz_jobs` | Background job writing a module's automatic quiz | `assessments_autoquizjob` |
| `assignments` | A written assignment and its rubric | `assignments_assignment` |
| `assignment_modules` | Modules a multi-module assignment was written from | `assignments_assignment_source_modules` |
| `assignment_submissions` | One student's submission and marks | `assignments_assignmentsubmission` |
| `tutor_conversations` | A student's chat with the tutor about a module | `tutor_conversation` |
| `tutor_messages` | One question or answer in a tutor chat | `tutor_message` |
| `login_sessions` | One sign-in, from login to logout or timeout | `activity_applicationsession` |
| `time_spent` | Seconds spent learning, on a quiz, an assignment or the tutor | `activity_activityevent` |
| `audit_log` | Who did what to which record, and when | `audit_auditlog` |
| `ai_checks` | The AI monitor's check of a tutor answer or AI quiz | `ai_monitor_evaluation` |
| `ai_incidents` | A problem the AI monitor found, and its review | `ai_monitor_incident` |
| `ai_incident_rules` | When a check becomes an incident, per kind of problem | `ai_monitor_policy` |
| `ai_check_feedback` | A reviewer's verdict on a check | `ai_monitor_feedback` |

**Tables that keep their standard names.** Those belonging to Django and its libraries, because those libraries find them by name. Renaming them is unsupported and would break upgrades:

- **Permissions:** `auth_permission`, `auth_group`, `auth_group_permissions`, and `users_groups` and `users_user_permissions`. These last two are Django's permission links, renamed automatically along with `users` and unused by LocalMind.
- **Django internals:** `django_content_type`, `django_admin_log`, `django_session`, `django_migrations`.
- **Sign-in tokens:** `token_blacklist_outstandingtoken` and `token_blacklist_blacklistedtoken`.

Indexes whose names were derived from the old table names are renamed with them. `docs/DATABASE.md` now starts with this table guide.

## Verification

| Check | Result |
|---|---|
| Copy of the laptop's database (uploaded `db.sqlite3`) | All 10 migrations applied. 39 tables before and after, and every row kept: the total went from 1,197 to 1,207, the 10 new rows being the migration records themselves. `PRAGMA foreign_key_check` found no violations and `integrity_check` returned ok. Reading users, modules, quizzes, lessons and quiz-module links through the app worked, and `tidy_book --dry-run` gave the same plan as before. |
| PostgreSQL 16 with existing data (created on the previous release) | Renamed in place. The quiz-module links read back through the new link table, and foreign keys are still enforced (an orphan insert is refused). |
| Rolling back | Migrating each app back one step restores the old names, and migrating forward again reapplies all 10. |
| Backend unit suite, SQLite | 423 of 423 |
| Backend unit suite, PostgreSQL | 423 of 423 (1 skipped, as before) |
| Black-box system test, fresh database | 213 of 213 |
| `makemigrations --check` | no changes |

## Upgrading the laptop

1. **Stop the server** and **copy `backend\db.sqlite3` somewhere safe** first.
2. Unzip.
3. From `backend`, run `python manage.py migrate`. You should see ten `..._short_table_names... OK` lines.
4. Start the server as usual.

Anything outside the app that queries the database by table name, such as DB Browser for SQLite saved queries or report scripts, must use the new names.

**To undo** (with the old code), restore the copied `db.sqlite3`, or run `python manage.py migrate` back to each app's previous migration.
