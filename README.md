# LocalMind Backend

A role-based academic learning platform (backend plus an Expo client for iOS, Android and web): administrators manage people and subjects, faculty publish source material and author assessments, students learn from published modules with a source-grounded local AI tutor. Django 5.2, Django REST Framework, JWT authentication, PostgreSQL in production (SQLite for development), an embedded llama.cpp model (Qwen3 1.7B GGUF) for AI with graceful fallback when it is unavailable, and Ollama as an optional alternative provider.

## Quick start (standalone, works offline, no Ollama)

The AI model runs inside the backend process (llama.cpp) from a GGUF file in
`backend/models/`, so nothing has to be installed on the host beyond Python.
Do the two downloads once on a machine with internet, then the whole platform
runs with the network unplugged. See `docs/OFFLINE.md` for packaging a bundle
for other machines.

```bash
cd frontend && npm install && npm run export:web && cd ..   # builds the web client into frontend/dist
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu
python manage.py fetch_model --docling   # AI model (~1 GB) + PDF layout models, once
python manage.py check_ai --smoke        # loads the model and runs one generation
cd ..
python run_localmind.py                  # or start.bat / start.sh
```

That serves the API, media and the web client on one port for every device on
the network (`http://<host-ip>:8000`), creates the first admin on an empty
database and opens a browser. The Expo dev workflow (`npx expo start`) and
`python manage.py runserver` still work exactly as before.

To keep using a local Ollama daemon instead, set `AI_PROVIDER=ollama` in `.env`
and `ollama pull qwen3:1.7b`.

Interactive API docs are at `http://127.0.0.1:8000/api/docs/` and the raw OpenAPI 3 schema at `/api/schema/` in development (`DJANGO_DEBUG=true`) or when `API_DOCS_ENABLED=true`; the same schema is committed as `backend/openapi.yaml`. Health check at `/api/health/` (summary for everyone; the component report with `?full=1` for administrators and requests from the server itself).

Every account is created with the configured `INITIAL_USER_PASSWORD` and must change it at first login before any other endpoint responds (`INITIAL_PASSWORD_MODE=unique` gives each account its own one-time password instead).

## Tests

```bash
pip install -r requirements-dev.txt                      # reportlab + pypdfium2 for the PDF parser tests
python manage.py test                                    # SQLite, 315 tests
DATABASE_URL=postgres://user:pw@host:5432/db python manage.py test   # same suite on PostgreSQL
```

AI is disabled automatically under the test runner so the suite never depends on a running Ollama. Tests that need AI output mock the gateway.

Beyond the unit suite there is a black-box system test that drives a live server through every portal, endpoint, permission boundary and AI fallback over real HTTP (about 190 checks), using a stand-in Ollama so it runs on any machine:

```bash
python scripts/fake_ollama.py &                                  # speaks /api/tags, /api/pull, /api/chat
DJANGO_DEBUG=true python manage.py runserver 127.0.0.1:8011 &
python scripts/system_test.py http://127.0.0.1:8011 --fake-ollama http://127.0.0.1:11434
```

Point it at a server backed by real Ollama (omit `--fake-ollama`) for a pre-release check with the actual model; the AI-outage section is skipped in that mode.

The same suite runs against the embedded (offline) provider on a machine without the native library or a model, using a stand-in `llama_cpp` package and a placeholder model file:

```bash
python scripts/fake_llama_cpp/make_model.py /tmp/fake.gguf
PYTHONPATH=scripts/fake_llama_cpp AI_PROVIDER=llamacpp AI_MODEL_PATH=/tmp/fake.gguf DJANGO_DEBUG=true python manage.py runserver 127.0.0.1:8011 &
python scripts/system_test.py http://127.0.0.1:8011
```

## Client

```bash
cd frontend && npm install && EXPO_PUBLIC_API_URL=http://<backend-host>:8000 npx expo start
```

See `frontend/README.md` and `docs/FRONTEND.md`.

## Documentation

| Document | Contents |
|---|---|
| `docs/ARCHITECTURE.md` | Apps, layering, request lifecycle, permission model, AI gateway, background processing |
| `docs/API.md` | Portals, authentication, workflows, error envelope and code catalogue |
| `docs/DATABASE.md` | Every table and field, relationships, invariants, indexes |
| `docs/ENVIRONMENT.md` | Every environment variable with defaults and production guidance |
| `docs/DEPLOYMENT.md` | Production deployment (docker-compose or systemd), PostgreSQL, Ollama, media, operations |
| `docs/OFFLINE.md` | Embedded AI provider, one-process launcher, building an offline bundle for any machine |
| `docs/AI_MONITORING.md` | AI Monitoring & Guard: how tutor answers and quizzes are checked, the judge model, policies, incident review, benchmark |
| `deploy/` | docker-compose stack, nginx config, systemd units, maintenance timer |
| `docs/history/MIGRATION.md` | Relationship to the reference codebase and what changed |
| `docs/FRONTEND_INTEGRATION.md` | What a client must do: login, token handling, sessions, per-role screens |
| `docs/FRONTEND.md` | The Expo client: every screen and the endpoints behind it |
| `backend/openapi.yaml` | Generated OpenAPI 3 schema (150 operations; regenerate with `python manage.py spectacular --file openapi.yaml`) |
| `backend/samples/` | Excel import templates for faculty and students |

## Repository layout

```
frontend/        Expo app: app/ (routes by role), src/api, src/auth, src/ui
backend/
  config/        settings, env loading, URL mounting
  core/          shared models, exceptions, permissions, pagination, OpenAPI hook, test helpers
  accounts/      User, profiles, login, password change, admin user management, Excel import
  academics/     Subject, FacultySubject, Enrollment
  audit/         AuditLog and the admin audit endpoint
  ai/            provider-agnostic AI gateway: embedded llama.cpp (default, offline) or Ollama; check_ai, fetch_model
  documents/     upload, parsing, outline generation and review, publishing
  learning/      Chapter, Module, ModuleProgress, student reading endpoints
  assessments/   quizzes, attempts, deterministic and AI evaluation, versioning
  assignments/   assignments, submissions, faculty evaluation
  tutor/         structured lessons, grounded Q&A, remediation
  activity/      application sessions, heartbeat, time on task
  analytics/     scoped metrics for student, faculty and admin
  ai_monitor/    AI Monitoring & Guard: validators, judge model, incidents, policies, admin/faculty review API
docs/            the documents listed above
```
