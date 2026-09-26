# LocalMind

LocalMind is a role-based learning platform for schools and colleges. Administrators manage people and subjects, faculty upload books and author quizzes, and students study published modules with a local AI tutor. The AI runs on the institution's own machine or on the student's device, so no cloud AI service or API key is needed.

The repository holds one Django backend and one Expo client that builds for web, Android and iOS.

## Contents

1. [What it does](#what-it-does)
2. [Tech stack](#tech-stack)
3. [Repository layout](#repository-layout)
4. [Requirements](#requirements)
5. [Quick start on Windows](#quick-start-on-windows)
6. [Quick start on macOS or Linux](#quick-start-on-macos-or-linux)
7. [Developer mode](#developer-mode)
8. [Configuration](#configuration)
9. [Tests](#tests)
10. [Deployment](#deployment)
11. [Remote testers and the launcher](#remote-testers-and-the-launcher)
12. [Phone apps](#phone-apps)
13. [Maintenance commands](#maintenance-commands)
14. [Troubleshooting](#troubleshooting)
15. [Further documentation](#further-documentation)

## What it does

| Portal | Main features |
|---|---|
| Administrator | Users (single or Excel import), subjects, faculty and student assignment, books for private study, audit log, AI Monitor, system health |
| Faculty | Upload books (PDF, DOCX, TXT), review outlines, publish modules, background lessons, AI and manual quizzes, grading, Synchronize all, analytics |
| Student | Enrolled subjects, reading modules, lessons, quizzes, results, Private library, Offline AI |

Some behaviour that matters day to day:

- Lessons for every module are generated in the background after upload and stored in the database. Students see them when they open a module.
- Modules with no source text are removed automatically.
- AI quizzes are generated only from the selected modules.
- Synchronize all sends whatever lessons and quizzes are ready at that moment. Content still being written goes out on a later press.
- Content that one faculty member has synchronized shows as synchronized (and by whom) to other faculty.
- A quiz cannot be published while its book is unpublished or its module is locked.
- Archived books and subjects can be restored.
- Every account starts on one shared initial password (`INITIAL_USER_PASSWORD`) and must change it at first login.
- Quiz time limits are advisory. A late submission is accepted and marked late.
- In the browser, a service worker caches the application shell so the app opens offline.

Private library and Offline AI let a student import a book, download the Qwen3 1.7B model (about 1.11 GB) once, and then read, generate lessons and quizzes, and ask doubts with no network. Private records stay on that device. See `docs/INTEGRATED_PRIVATE_LIBRARY.md`.

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11 or 3.12, Django 5.2, Django REST Framework, JWT auth |
| Database | SQLite for development and single-machine use, PostgreSQL for production |
| Server AI | llama.cpp (embedded) with Qwen3 1.7B GGUF, or Ollama as an option |
| PDF parsing | Docling on the server, pdf.js and bundled OCR in the browser |
| Client | Expo (React Native) with Expo Router, TypeScript |
| Device AI | wllama in the browser, llama.rn on native |
| Serving | waitress (launcher), gunicorn and nginx (production) |

## Repository layout

```
LocalMind_V1/
├── backend/                 Django project
│   ├── config/              settings, env loading, URLs
│   ├── core/                shared models, permissions, web app serving, seed_demo
│   ├── accounts/            users, login, password change, Excel import
│   ├── academics/           subjects, faculty assignment, enrolment
│   ├── documents/           upload, parsing, outlines, publishing
│   ├── learning/            chapters, modules, reading progress
│   ├── tutor/               lessons, grounded Q&A
│   ├── assessments/         quizzes, attempts, evaluation
│   ├── assignments/         retired feature (kept for migrations only)
│   ├── private_library/     books shared for private study
│   ├── study/               offline study packages and sync
│   ├── ai/                  AI gateway (llama.cpp or Ollama), fetch_model, check_ai
│   ├── ai_monitor/          AI Monitoring & Guard
│   ├── jobs/                background job runner
│   ├── activity/            sessions, heartbeat, time on task
│   ├── analytics/           metrics for each role
│   ├── audit/               audit log
│   ├── samples/             Excel import templates
│   ├── scripts/             system test, fake Ollama, fake llama.cpp
│   ├── openapi.yaml         generated API schema
│   ├── requirements.txt
│   └── requirements-dev.txt
├── frontend/                Expo client (web, Android, iOS)
│   ├── app/                 routes: admin/, manage/ (faculty), student/, login/
│   ├── src/                 api, auth, offline, private, authoring, ui, screens
│   ├── scripts/             private asset preparation, PDF layout, offline manifest
│   ├── tests/               Playwright browser tests
│   ├── public/sw.js         service worker
│   ├── android/, ios/       native projects
│   ├── vercel.json          web hosting config
│   └── MOBILE_BUILD.md      phone build guide
├── tests/                   Node contract tests for the client
├── scripts/                 check_offline_study.py
├── deploy/                  docker-compose, nginx, systemd units
├── launcher/                small client launcher for remote testers
├── docs/                    reference documentation
├── run_localmind.py         one-process launcher
├── start.bat / start.sh     first-run setup plus launch
└── package_offline.py       builds an offline install bundle
```

## Requirements

| Tool | Version |
|---|---|
| Python | 3.11 or 3.12 (3.13 is not supported by the pinned wheels) |
| Node.js | 20 LTS |
| Git | any recent version |
| RAM | 8 GB minimum (model plus PDF parsing peaks at 4 to 5 GB) |
| Disk | about 6 GB free (model, Docling, Python environment) |

Install on Windows (PowerShell as Administrator), then reopen PowerShell:

```powershell
winget install Python.Python.3.12
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

## Quick start on Windows

```powershell
git clone https://github.com/OneSmarterInc/LocalMind_V1.git
cd LocalMind_V1

# 1. Build the web client (repeat after any frontend change)
cd frontend
npm install
npm run export:web
cd ..

# 2. Backend environment
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu

# 3. AI model (about 1 GB) and PDF layout models, once, needs internet
python manage.py fetch_model --docling
python manage.py check_ai --smoke
cd ..

# 4. Start
.\start.bat
```

If PowerShell refuses to activate the environment, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

`start.bat` creates `backend\.venv` on first run if it is missing, then calls `run_localmind.py`. The launcher writes `backend\.env` with a generated secret if none exists, applies migrations, creates the first admin on an empty database, loads the model and serves everything on one port.

Open `http://127.0.0.1:8000` (or the LAN address the console prints) and sign in:

| Field | Value |
|---|---|
| Email | `admin@localmind.local` |
| Password | the `INITIAL_USER_PASSWORD` value in `backend\.env` (the launcher writes a laptop-only default) |

You must change the password at first login.

Launcher options:

```powershell
python run_localmind.py --port 8080          # different port
python run_localmind.py --no-browser         # do not open a browser
python run_localmind.py --host 127.0.0.1     # this machine only, not the LAN
python run_localmind.py --threads 16         # waitress threads (default 32)
python run_localmind.py --admin-email me@school.edu   # first admin (empty database only)
python run_localmind.py --skip-ai-check      # start even if the model is missing
```

After a frontend change, rebuild and restart, then hard refresh the browser (Ctrl+Shift+R) so the service worker picks up the new shell.

## Quick start on macOS or Linux

```bash
git clone https://github.com/OneSmarterInc/LocalMind_V1.git
cd LocalMind_V1
cd frontend && npm install && npm run export:web && cd ..
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu
python manage.py fetch_model --docling
python manage.py check_ai --smoke
cd ..
./start.sh            # or: python run_localmind.py
```

## Developer mode

Use this when editing code. The backend runs with Django's dev server and the client with Expo hot reload.

Backend (first terminal):

```powershell
cd backend
.\.venv\Scripts\Activate.ps1          # macOS/Linux: source .venv/bin/activate
python manage.py migrate
python manage.py bootstrap_admin --email admin@localmind.local
python manage.py runserver 0.0.0.0:8000
```

For development, set these in `backend/.env`:

```ini
DJANGO_DEBUG=true
DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost,<your-lan-ip>
DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:8081
```

Client (second terminal):

```powershell
cd frontend
$env:EXPO_PUBLIC_API_URL="http://127.0.0.1:8000"; npx expo start
# macOS/Linux: EXPO_PUBLIC_API_URL=http://127.0.0.1:8000 npx expo start
```

Press `w` for web, `a` for Android, `i` for iOS. Without `EXPO_PUBLIC_API_URL` the client falls back to `extra.apiUrl` in `frontend/app.json`.

Demo data (development only):

```powershell
$env:DJANGO_DEBUG="true"; python manage.py seed_demo
```

Client checks:

```bash
cd frontend
npm run typecheck
npm run lint
npm run export:web
```

To use Ollama instead of the embedded model, set `AI_PROVIDER=ollama` in `backend/.env`, run `ollama pull qwen3:1.7b`, then `python manage.py check_ai --smoke`. Ollama 0.9 or newer is required.

## Configuration

Settings are read from `backend/.env`. The launcher creates a working file on first run. The most common values:

| Variable | Purpose | Launcher default |
|---|---|---|
| `DJANGO_SECRET_KEY` | Required when `DJANGO_DEBUG=false` | generated |
| `DJANGO_DEBUG` | Development mode and API docs | `false` |
| `DJANGO_ALLOWED_HOSTS` | Hosts the server answers to | `*` |
| `DATABASE_URL` | SQLite or PostgreSQL URL | `sqlite:///db.sqlite3` |
| `AI_PROVIDER` | `llamacpp` or `ollama` | `llamacpp` |
| `SERVE_WEB` / `SERVE_MEDIA` | Serve the web client and uploads from Django | `true` |
| `INITIAL_USER_PASSWORD` | Shared first password for every new or reset account. Required when `DJANGO_DEBUG=false` | laptop-only default |
| `TRUSTED_PROXY_COUNT` | Number of proxies in front of the server | `0` |
| `AI_MONITOR_ENABLED` / `AI_MONITOR_MODE` | AI Monitoring & Guard | `true` / `async` |

The full list is in `docs/ENVIRONMENT.md`. Never commit `.env`, database files, models or keys. They are already in `.gitignore`.

## Tests

Backend (from `backend/`, environment active):

```bash
pip install -r requirements-dev.txt
python manage.py test
python manage.py makemigrations --check --dry-run
```

Client contract tests (from `frontend/`):

```bash
npm run test:private         # Node contract tests in ../tests
npm run test:private:web     # Playwright browser tests (run: npx playwright install chromium first)
python ../scripts/check_offline_study.py   # study contracts and draft persistence
```

Black-box system test against a running server with a fake Ollama (from `backend/`):

```bash
python scripts/fake_ollama.py &
DJANGO_DEBUG=true AI_PROVIDER=ollama OLLAMA_BASE_URL=http://127.0.0.1:11434 AI_MONITOR_MODE=off python manage.py runserver 127.0.0.1:8011 --noreload &
python scripts/system_test.py http://127.0.0.1:8011 --fake-ollama http://127.0.0.1:11434
```

## Deployment

Production runs on one AWS EC2 server: Docker Compose with PostgreSQL, the Django API (which also serves the built web client), a maintenance loop and Caddy for automatic https. Start from `backend/.env.example` and follow `docs/AWS_EC2_RUNBOOK.md` step by step. Devices download the AI model from Hugging Face, not from the server.

| Option | Files | Guide |
|---|---|---|
| **AWS EC2 (production)** | `deploy/docker-compose.yml`, `deploy/Caddyfile`, `backend/.env.example` | `docs/AWS_EC2_RUNBOOK.md` |
| Web client on Vercel | `frontend/vercel.json` (build `npm run export:web`, output `dist`) | `docs/DEPLOYMENT.md` |
| Docker Compose on your own Linux host | `deploy/docker-compose.yml`, `deploy/Caddyfile` (`deploy/nginx.conf` for plain http on a LAN) | `docs/DEPLOYMENT.md` |
| Linux with systemd | `deploy/localmind.service`, `deploy/localmind-maintenance.*` | `docs/DEPLOYMENT.md` |
| Offline bundle for another machine | `python package_offline.py` | `docs/OFFLINE.md` |

Caddy provides TLS in the compose stack. Put TLS in front of any other server exposed beyond the local network. The web client on Vercel is optional and not the recommended setup: serving it from the same server keeps the API same-origin and keeps the browser-isolation headers the in-browser AI needs.

## Remote testers and the launcher

For team testing, one Windows laptop runs LocalMind as the single server and database. Testers do not install the stack. They run a small launcher that opens the shared server in a browser.

The launcher source is `launcher/localmind_launcher.py`. The server address lives in `launcher/client/LocalMind.ini`. Build the exe with PyInstaller:

```powershell
pip install pyinstaller
cd launcher
pyinstaller LocalMind.spec
```

Share the exe from `launcher\dist\` together with `LocalMind.ini`. Build outputs (`build/`, `dist/`, zips) are not committed.

## Phone apps

The APK is being built by a separate team. It fetches data when online, works from that data offline, submits offline quiz answers once back online and then refreshes. Build steps (EAS or local Gradle/Xcode) are in `frontend/MOBILE_BUILD.md`. The `preview` and `production` profiles in `frontend/eas.json` point at `https://localmind.onesmarter.com`; change them if your server lives elsewhere. Release builds allow https only, so a phone build cannot reach a plain-http LAN server (use the `development` profile for that).

## Maintenance commands

Run from `backend/` with the environment active.

```bash
python manage.py check_ai --smoke                 # AI readiness plus one generation
python manage.py generate_lessons --status        # lesson queue status
python manage.py generate_lessons --queue         # queue modules without a current lesson
python manage.py generate_auto_quizzes --status   # automatic quiz status
python manage.py requeue_stuck_documents          # retry documents stuck in processing
python manage.py tidy_book --list                 # books with ids and module counts
python manage.py cleanup_media --delete           # remove orphaned media folders
python manage.py monitor_ai --status              # AI monitor status
python manage.py reset_onboarding_passwords       # move untouched accounts back to INITIAL_USER_PASSWORD
python manage.py bootstrap_admin --email x@y.edu  # add an admin
python manage.py flushexpiredtokens               # trim the JWT blacklist
```

Health check: `http://<host>:8000/api/health/`. Add `?full=1` on the server itself for the component report.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `pip install` fails on `llama-cpp-python` | Add the `--extra-index-url` shown above and use Python 3.11 or 3.12 |
| `frontend/dist is missing` | `cd frontend` then `npm run export:web` |
| AI not ready | `python manage.py fetch_model --docling`, then restart. The app still runs with fallbacks |
| Another device cannot connect | Use the LAN address the launcher prints, open port 8000 in the firewall |
| CORS errors in Expo web | Add `http://localhost:8081` to `DJANGO_CORS_ALLOWED_ORIGINS` |
| Phone cannot reach the backend | Phones cannot use `127.0.0.1`. Use the LAN address |
| Old screens after an update | Hard refresh (Ctrl+Shift+R) so the service worker loads the new shell |
| Document stuck in processing | `python manage.py requeue_stuck_documents` |
| `seed_demo` refuses to run | Set `DJANGO_DEBUG=true` or pass `--force` |

## Further documentation

| Document | Contents |
|---|---|
| `docs/ARCHITECTURE.md` | Apps, layering, permissions, AI gateway, background processing |
| `docs/API.md` | Portals, authentication, workflows, error codes |
| `docs/DATABASE.md` | Tables, fields, relationships, indexes |
| `docs/ENVIRONMENT.md` | Every environment variable |
| `docs/AWS_EC2_RUNBOOK.md` | Step-by-step AWS EC2 production setup, costs and savings |
| `docs/DEPLOYMENT.md` | Production deployment on your own Linux host |
| `docs/OFFLINE.md` | Embedded AI, launcher, offline bundles |
| `docs/INTEGRATED_PRIVATE_LIBRARY.md` | Private library, OCR, Offline AI, model storage |
| `docs/DEVICE_ACCEPTANCE.md` | Real-device acceptance checks |
| `docs/AI_MONITORING.md` | AI Monitoring & Guard |
| `docs/FRONTEND.md` | Client structure, every screen and its endpoints |
| `docs/FRONTEND_INTEGRATION.md` | Client contract: login, tokens, sessions |
| `frontend/MOBILE_BUILD.md` | Android and iOS builds |
| `backend/openapi.yaml` | OpenAPI schema (`python manage.py spectacular --file openapi.yaml` to regenerate) |

Interactive API docs are at `/api/docs/` when `DJANGO_DEBUG=true` or `API_DOCS_ENABLED=true`.
