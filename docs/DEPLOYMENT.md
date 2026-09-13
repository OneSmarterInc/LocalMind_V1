# LocalMind Deployment

## Current deployment: local and offline, no cloud

The current deployment is a self-contained web application on one machine: Django, a local database (SQLite by default, PostgreSQL optionally), local file storage under `MEDIA_ROOT`, the AI model running inside the backend process through llama.cpp from a GGUF file in `backend/models/`, Docling's layout models stored locally, and the built web client served by Django itself. Nothing in it calls out to the internet during normal operation, and nothing has to be installed on the host beyond Python. For that mode use `run_localmind.py` (or `start.bat` / `start.sh`) and see `docs/OFFLINE.md`; the rest of this document is the heavier single-server path with PostgreSQL and a reverse proxy, which is optional.

AWS is not part of the current deployment. It is a possible future target, and the code is arranged so that it can be introduced without a rewrite: the database is behind `DATABASE_URL` (RDS is a connection string), files go through Django's storage API (S3 is a storage backend), the AI provider is behind `ai.gateway` (a cloud model is one more provider class), background work is the `process/` endpoints plus the maintenance commands (a queue worker calls the same services), and every deployment knob is an environment variable. The frontend only ever talks to the Django API and carries no provider- or cloud-specific logic.

## Single-server deployment with PostgreSQL and a reverse proxy

This describes a single-server deployment: the API, PostgreSQL and the embedded AI model on one Linux machine, with a reverse proxy in front. Ollama remains supported as an alternative provider (`AI_PROVIDER=ollama`), in which case the coupling is the `OLLAMA_BASE_URL` variable; nothing else changes.

## Requirements

Python 3.11 or 3.12, PostgreSQL 14 or newer (tested on 16), the GGUF model in `backend/models/` (`python manage.py fetch_model --docling`, once, with internet), and a reverse proxy such as nginx or Caddy for TLS. If you choose Ollama instead of the embedded model, you need Ollama 0.9 or newer with `qwen3:1.7b` pulled; the version matters: the gateway sends `think: false` so qwen3 skips its reasoning pass and answers structured requests directly, and older servers ignore that flag (the gateway strips any `<think>` block that leaks through, so nothing breaks, but every call gets slower). The parser depends on `docling`, which pulls PyTorch; allow a few GB of disk for its models on first run.

Sizing for `qwen3:1.7b`: the weights are about 1.4 GB and the 16k context the gateway requests adds roughly 1 GB of KV cache, so 8 GB of RAM is enough for the model on CPU alongside the API and PostgreSQL. On a modern CPU a lesson or a ten-question quiz takes 20-60 seconds; a modest GPU (4 GB VRAM) brings that under ten. Ollama serves one request at a time per model by default; set `OLLAMA_NUM_PARALLEL=2` or more on hosts with spare memory if several students use the tutor at once, since queued requests still count against `OLLAMA_TIMEOUT_SECONDS`.

## Two ways to run it

`deploy/docker-compose.yml` brings up PostgreSQL, the API (with the embedded model mounted from `backend/models/` and the web build from `frontend/dist/`), a maintenance loop and nginx on one host; the Ollama service is behind the `ollama` compose profile and only starts with `--profile ollama` when `AI_PROVIDER=ollama`: copy `backend/.env.example` to `deploy/.env`, set `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, `POSTGRES_PASSWORD` and `INITIAL_USER_PASSWORD`, optionally `BOOTSTRAP_ADMIN_EMAIL`, then `cd deploy && docker compose up -d --build`. The API container migrates, collects static files and verifies (and pre-loads) the model before gunicorn starts. Uncomment the GPU block on the `ollama` service if the host has an NVIDIA card. Put TLS in front of the `web` service (or swap nginx for Caddy) before exposing it beyond the campus network.

The rest of this document is the bare-metal path using the unit files in `deploy/`; the two are equivalent and share the same environment variables.

## Installation

```bash
sudo useradd --system --home /opt/localmind --create-home localmind
sudo -u localmind bash
cd /opt/localmind
git clone <repository> app && cd app/backend
python3 -m venv .venv && source .venv/bin/activate
pip install --upgrade pip && pip install -r requirements.txt
cp .env.example .env    # then edit as described in ENVIRONMENT.md
```

Create the database and role:

```sql
CREATE ROLE localmind WITH LOGIN PASSWORD '<password>';
CREATE DATABASE localmind OWNER localmind;
```

Then:

```bash
python manage.py migrate
python manage.py collectstatic --noinput     # only for the Django admin site and Swagger UI assets
python manage.py bootstrap_admin --email admin@example.edu
```

The bootstrap admin receives the configured initial password and must change it at first login. (With `INITIAL_PASSWORD_MODE=unique` it gets a one-time password instead, printed once by `bootstrap_admin`; under Docker Compose read it from `docker compose logs api`.)

Then prepare the model host and prove it works end to end:

```bash
ollama pull qwen3:1.7b                      # and OLLAMA_OUTLINE_MODEL if it differs
python manage.py check_ai --smoke           # reachability, model presence, one real structured generation
```

For a release rehearsal run `python scripts/system_test.py https://<host>` against the staged server with the real model; it creates its own `SYS-` prefixed subject and users and exercises every workflow. `check_ai` exits non-zero when the configured provider is not ready (embedded GGUF missing or failing to load, or Ollama unreachable with a model missing) or the smoke generation fails, so it belongs in the deploy script (or as a systemd `ExecStartPre=`) rather than in a runbook. `check_ai --pull` pulls whatever is missing first; it blocks for several minutes on first use and must never be wired into a request path.

## Running

Use gunicorn with one worker and several threads. Each worker is a separate process that loads its own copy of the model, and the lesson pre-warm queue, the AI monitor queue and the tutor answer cache are per process, so a second worker costs another model's worth of RAM and splits those queues. Document processing runs on a thread in the worker that accepted the request, so give workers a generous timeout for the (rare) inline case and prefer the background default:

```
[Unit]
Description=LocalMind API
After=network.target postgresql.service

[Service]
User=localmind
WorkingDirectory=/opt/localmind/app/backend
EnvironmentFile=/opt/localmind/app/backend/.env
ExecStart=/opt/localmind/app/backend/.venv/bin/gunicorn config.wsgi:application \
    --bind 127.0.0.1:8000 --workers 1 --threads 8 --timeout 300
Restart=always

[Install]
WantedBy=multi-user.target
```

If you do run more than one worker, two things follow. First, a document being processed is locked by a database row lock, so two workers will not process the same book. Second, background threads live inside the worker process; if gunicorn recycles a worker mid-processing the document is left in `processing`. After `PROCESSING_STALE_MINUTES` (default 30) that document is considered abandoned: faculty can call `process/` again and it is re-claimed, and `python manage.py requeue_stuck_documents` re-runs every such document. Install `deploy/localmind-maintenance.service` and `.timer` (or rely on the `maintenance` container in compose) so this happens every 15 minutes without anyone noticing; the same job runs `flushexpiredtokens` to keep the JWT blacklist table small. For heavier use, replace the thread with a task queue (`documents.services.documents.run_processing(document_id)` is the unit of work).

Reverse proxy: forward `/api/` to gunicorn with `X-Forwarded-Proto` set, cap request bodies at `MAX_UPLOAD_MB`, and serve `/static/` from `STATIC_ROOT` if you use the admin site or Swagger UI. `/media/` need not be exposed at all; nothing in the client flow fetches raw files.

## Health and monitoring

`GET /api/health/` returns `{"status": "ok", "service": "LocalMind", "database": "ok", "ai": {...}}` after a real database round trip and is safe to poll. From other machines the `ai` block is the summary `enabled`, `provider`, `reachable`, `ready`; administrators (bearer token) and requests from the server itself also get `tutor_model`, `outline_model`, `error` and provider details, and only they receive the `?full=1` component report. Behind a proxy this depends on `TRUSTED_PROXY_COUNT` being right: set to 0 behind a same-host nginx, every request would look local. The `ai` block comes from a probe of Ollama's `/api/tags` cached for `AI_HEALTH_CACHE_SECONDS`. `status` stays `ok` while Ollama is down because reading, quizzes and grading keep working through their fallbacks; alert on `ai.ready == false` instead. `GET /api/health/?full=1` adds the component table, including `ai_monitor` (mode, judge readiness, pending backlog); that component does not affect the overall status, so a missing judge model never reports the platform as down. Administrators see the same probe as a banner at the top of their dashboard (`GET /api/admin/ai/status/?refresh=1` forces a fresh check).

Gateway log lines have the shape `AI <purpose> ok model=qwen3:1.7b attempt=1 latency_ms=...` on success and `AI <purpose> attempt 1/2 rejected: invalid_schema (...)` when a retry fires. A steady stream of `attempt 2/2` lines means the model is struggling with a particular prompt size; `latency_ms` climbing toward `OLLAMA_TIMEOUT_SECONDS` means the host is saturated. Application logs go to stdout in the format `time level logger: message`; `django.request` warnings cover 4xx, errors cover 5xx, and `localmind.api` logs every unexpected exception with the view name. Watch for `AI_UNAVAILABLE` rates and `error_code: timeout` in gateway logs as the signal that the model host is overloaded.

## Backups

Back up the PostgreSQL database and `MEDIA_ROOT` together; the database references files by path. A nightly `pg_dump` plus an rsync of media is sufficient. Restore is `psql < dump`, copy media back, done; migrations are already applied in the dump.

## Upgrades

```bash
git pull && pip install -r requirements.txt && python manage.py migrate && sudo systemctl restart localmind
```

Migrations are additive and safe to run against a live database. Check `python manage.py check --deploy` after changing settings.

## Operations

`python manage.py cleanup_media` lists media directories no document row references; add `--delete` to remove them. `python manage.py monitor_ai --status` reports the AI monitor's judge readiness and backlog, `--backfill` evaluates interactions recorded while it was off or before an evaluator-version bump, and `--purge` applies retention (the maintenance timer and the compose maintenance loop run it every 15 minutes). A dedicated judge model is optional; see `docs/AI_MONITORING.md` for sizing (a 7B Q4 judge is another 5 GB of RAM per worker). `python manage.py seed_demo` populates a development database and refuses to run when `DJANGO_DEBUG` is false. Rotating `DJANGO_SECRET_KEY` logs every user out. Rotating `INITIAL_USER_PASSWORD` affects only accounts created or reset after the change.

## Running the suite against production PostgreSQL

`DATABASE_URL=postgres://... python manage.py test` creates and destroys a `test_localmind` database, so the role needs `CREATEDB`. The suite passes identically on SQLite and PostgreSQL; one PostgreSQL-only behaviour (`FOR UPDATE` cannot lock the nullable side of an outer join) is already accounted for in `assessments.services`.
