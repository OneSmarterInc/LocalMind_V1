# AI Monitoring & Guard

An independent quality-control layer around the application AI. It watches
every tutor answer and every AI-generated quiz, checks them against the
course material and deterministic rules, asks a separate judge model only
when that is not enough, and raises an incident for an administrator when
the evidence and confidence clear a policy threshold. It never touches the
student-facing path: evaluation happens after the response is sent, on a
background thread, and every failure inside the monitor is recorded rather
than raised.

Code: `backend/ai_monitor/`. Admin UI: the "AI Monitor" tab in the admin
console (`frontend/app/admin/monitoring.tsx`, `incident/[id].tsx`,
`monitor-policies.tsx`).

## What is monitored

| Interaction | Trigger | Evidence rebuilt from |
|---|---|---|
| Tutor answer (`tutor.Message`, role `assistant`) | `post_save`, after commit | The student's question and the module chunks BM25 retrieval returns for it (the same passages the tutor was given) |
| AI-generated quiz (`assessments.Assessment`, `generator=ai`) | `post_save`, after commit | Every chunk of every module the quiz was written from |

Fallback-generated quizzes are not evaluated (they are not AI output and
cannot be published). Lessons, remediation and assignment grading go through
the same gateway but are not monitored in this version; the pipeline takes a
`kind` and adding one is a new `evaluate_*` function plus a signal.

## Pipeline

1. **Evidence.** A bounded set of reference passages (`AI_MONITOR_MAX_EVIDENCE_CHARS`,
   default 6000) with their heading and page range. Stored with the
   evaluation so the verdict is reproducible even if the book is edited later.
2. **Deterministic validators** (`validators.py`). Each returns pass, fail or
   undecided with an issue type, severity, confidence and the evidence it
   used. For tutor answers: response shape, leaked schema fields, whether the
   cited `source_reference` is in the source, content-word overlap with the
   source, numbers not in the source, relevance to the question, and a
   prompt-injection marker on the question (informational). For quizzes:
   structure (A-D keys, distinct options, key in range, explanation present),
   placeholder text, duplicate questions, source references, and whether the
   correct option and explanation use the source's vocabulary. Lexical checks
   stem tokens and are capped at 0.85 confidence; only structural checks reach
   the 0.9 "proven" bar.
3. **Judge decision** (`services._judge_reason`). The judge model is called
   when a validator failed below the proven bar ("suspicious"), when a
   validator could not decide ("undecided"), on a deterministic sample of
   clean answers (`AI_MONITOR_SAMPLE_PERCENT`, default 10%, keyed on the
   interaction id so it is reproducible), or when a reviewer forces it.
4. **Judge** (`judge.py`). Bounded evidence, the validator results, and the
   student/AI text wrapped in `<untrusted>` tags go to the model with the
   PRD's JSON schema (is_issue, issue_type, severity, confidence, reason,
   evidence, recommended_action). The embedded provider enforces the schema
   with a grammar; Ollama with `format`. The verdict is normalised (enum
   clamping, percent-to-fraction confidence).
5. **Combine** (`services.decide`). A proven validator failure stands on its
   own. A judge issue is taken, with confidence lifted by 0.05 when a
   validator agreed. A judge "no issue" at or above `AI_MONITOR_MIN_JUDGE_CONFIDENCE`
   overrides an unproven validator flag. A low-confidence judge answer never
   confirms anything: the validator flag stays at its own confidence, and with
   nothing else the verdict is `abstain`, which creates no incident. If the
   judge is unavailable, validators decide and undecided cases abstain.
6. **Policy** (`services.apply_policy`). One `Policy` row per issue type:
   enabled, minimum confidence, minimum severity. Severity is bumped one level
   when three or more incidents of the same type hit the same module in seven
   days, and to critical for confident safety issues. An incident is created
   only when the policy admits the verdict.

Every evaluation records the evaluator version (`AI_MONITOR_EVALUATOR_VERSION`);
bump it when the validators or judge prompt change so old verdicts are not
mistaken for new ones and `monitor_ai --backfill` re-evaluates.

## Judge model

By default the judge shares the application model (Qwen3 1.7B), which costs
no extra memory but is a weak evaluator. The PRD's recommendation is a 7-8B
instruct model. With the embedded provider:

```bash
# in backend/.env
AI_MONITOR_MODEL_FILE=qwen2.5-7b-instruct-q4_k_m.gguf
# then, once, with internet (about 4.7 GB)
python manage.py fetch_model --monitor --skip-llm
```

`AI_MONITOR_MODEL_REPO` / `AI_MONITOR_MODEL_DOWNLOAD_FILE` change the
download; `AI_MONITOR_MODEL_PATH` points at any GGUF you already have. A
second model is a second in-process copy: budget 5 GB extra RAM for a 7B
Q4 model and keep gunicorn at one worker. With Ollama, set
`AI_MONITOR_OLLAMA_MODEL=qwen2.5:7b-instruct` and `ollama pull` it.

`check_ai` does not load the judge; `manage.py monitor_ai --status` and the
`ai_monitor` row in `/api/health/?full=1` (administrators, or on the server itself) report its readiness.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `AI_MONITOR_ENABLED` | `true` | Master switch |
| `AI_MONITOR_MODE` | `async` (`sync` under the test runner) | `async`: background thread. `sync`: inline (tests, backfill). `off`: no automatic evaluation |
| `AI_MONITOR_JUDGE_ENABLED` | `true` (forced false under tests) | Allow judge calls at all |
| `AI_MONITOR_MODEL_FILE` / `_PATH` | empty (share app model) | Dedicated judge GGUF (llamacpp) |
| `AI_MONITOR_MODEL_REPO` / `_DOWNLOAD_FILE` | `Qwen/Qwen2.5-7B-Instruct-GGUF` / `qwen2.5-7b-instruct-q4_k_m.gguf` | What `fetch_model --monitor` downloads |
| `AI_MONITOR_OLLAMA_MODEL` | empty (tutor model) | Judge tag on Ollama |
| `AI_MONITOR_SAMPLE_PERCENT` | `10` | Share of clean answers still sent to the judge |
| `AI_MONITOR_MIN_JUDGE_CONFIDENCE` | `60` | Percent; below it a judge verdict never decides on its own |
| `AI_MONITOR_MAX_EVIDENCE_CHARS` | `6000` | Evidence stored and sent to the judge |
| `AI_MONITOR_EVIDENCE_CHUNKS` | `4` | Retrieval depth for tutor answers |
| `AI_MONITOR_RETENTION_DAYS` | `180` | `monitor_ai --purge` deletes older evaluations (open incidents kept) |
| `AI_MONITOR_EVALUATOR_VERSION` | `1.0` | Stamped on every evaluation |
| `AI_MONITOR_MAX_TOKENS` | profile (600/700/800) | Judge output ceiling |

## Commands

```bash
python manage.py monitor_ai --status                       # readiness, backlog, 30-day counts
python manage.py monitor_ai --backfill [--limit N] [--kind quiz|tutor_answer] [--since 2026-09-01] [--judge]
python manage.py monitor_ai --evaluate <uuid> --kind tutor_answer --judge
python manage.py monitor_ai --purge [--retention-days 90]
python manage.py monitor_ai --seed-policies
python manage.py monitor_benchmark [--judge] [--cases file.jsonl] [--json] [--min-confidence 0.7]
python manage.py fetch_model --monitor --skip-llm
```

`monitor_ai --purge` is on the maintenance timer and in the compose
maintenance loop, so retention is applied every 15 minutes.

## Benchmark

`monitor_benchmark` scores the pipeline against a labelled JSONL file
without writing to the database. Each line is a case with `kind`, the
prompt/response (or `questions`), the `evidence` text and a `label`
(`correct`, `hallucination`, `unsupported`, `irrelevant`,
`instruction_failure`, `quiz_error`, `factual_error`, `other`). It reports
precision, recall, false-positive and false-negative rates, per-label
recall, issue-type accuracy and median latency, and lists every wrong
decision. The bundled `ai_monitor/benchmark/sample_cases.jsonl` (15 cases)
is a smoke set, not the 100-300 case gate the PRD calls for; with validators
alone it scores 100% precision and recall with 73% issue-type accuracy,
because the validators are conservative about naming the type
(hallucination vs unsupported vs irrelevant) and leave that to the judge.
Build the real set from labelled production interactions and run with
`--judge` before choosing a judge model.

## API

Admin, under `/api/admin/monitor/`:

| Method, path | Purpose |
|---|---|
| `GET overview/?days=` | Counts, coverage, verdict mix, severity/type/status breakdowns, false-positive rate, high-severity precision, model health, monitor status |
| `GET trends/?days=` | Incidents per day by severity and type; evaluations and issues per day |
| `GET subjects/?days=` | Incident rate and common failures per subject |
| `GET impact/users/?days=` | Who was affected (counts only, no content) |
| `GET status/` | Judge readiness, queue depth, backlog |
| `GET incidents/` | Queue. Filters: `status` (or `active`), `severity`, `issue_type`, `kind`, `model`, `subject`, `user`, `assigned_to`, `since`, `until` |
| `GET incidents/{id}/` | Prompt, reference, response, validators, judge, feedback |
| `POST incidents/{id}/review/` | `{action, note?}` with confirm, false_positive, needs_investigation, escalate, close, reopen |
| `POST incidents/{id}/assign/` | `{assigned_to}` (admin id or null) |
| `GET evaluations/`, `GET evaluations/{id}/` | Every verdict, incident or not. Filters as above plus `verdict`, `stage`, `judged=1` |
| `POST evaluations/{id}/feedback/` | `{label, note?}` |
| `POST evaluations/{id}/reevaluate/` | Re-run with the judge forced |
| `POST evaluate/` | `{kind, id, force_judge?}` on demand |
| `GET/POST backlog/` | Pending count / evaluate up to `limit` inline |
| `GET policies/`, `PATCH policies/{issue_type}/` | Thresholds |

Faculty, under `/api/faculty/monitor/`: `subjects/`, `impact/users/`,
`incidents/`, `incidents/{id}/`, `incidents/{id}/review/` (confirm,
false_positive, needs_investigation only), `evaluations/`,
`evaluations/{id}/`, `evaluations/{id}/feedback/`. Scoped to the caller's
assigned subjects and to academic-content issue types (hallucination,
factual error, unsupported claim, quiz error).

Reviewer actions write `ai_monitor.incident_<action>`,
`ai_monitor.incident_assigned`, `ai_monitor.feedback` and
`ai_monitor.policy_updated` audit entries.

## Security and privacy

The monitor reads the interaction tables through the ORM and writes only
its own four tables. Student text is passed to the judge as untrusted data
inside tagged blocks, and the judge prompt says so. Evidence is bounded and
stored as an excerpt, not a conversation. Faculty see only their subjects
and only academic issue types; user-impact views carry counts, not content.
No action here changes a grade, a submission or an account. Evaluations are
purged on the retention schedule; incidents still under review are kept.

## Tests

`ai_monitor/tests.py`: 52 tests over the validators, the decision table,
the pipeline with a real module and retrieval, policy thresholds and
recurrence, the post-commit signals, the commands, the API and the
faculty/student scoping. The judge is mocked; nothing in the suite needs a
model.
