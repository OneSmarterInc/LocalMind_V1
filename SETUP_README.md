# LocalMind: Step-by-Step Setup Guide

This guide covers every command needed to get LocalMind (`Local_Mind_Integrated`) running, from a fresh machine to a working platform, in four modes:

| Mode | Use it when | Section |
|---|---|---|
| **A. Standalone / offline** (one process, one port, opens a browser) | Classroom or lab machine, demos, first run | [Part 2](#part-2-mode-a--standalone-launcher-recommended-first-run) |
| **B. Developer mode** (Django `runserver` + Expo dev server with hot reload) | You are editing code | [Part 3](#part-3-mode-b--developer-mode) |
| **C. Docker Compose** (PostgreSQL + API + nginx + maintenance loop) | Single-server production on Linux | [Part 4](#part-4-mode-c--docker-compose-production) |
| **D. Bare metal with systemd** (PostgreSQL + gunicorn + nginx) | Production without Docker | [Part 5](#part-5-mode-d--bare-metal-production-with-systemd) |

The AI Monitoring & Guard layer (from `AI_Monitoring_Guard_PRD_v2.docx`) is implemented in this build as the `ai_monitor` app. It is on by default in every mode; [Part 11](#part-11-ai-monitoring--guard) covers the judge model, policies, backfill, benchmark and retention.

Everything below was taken from the scripts and docs inside the repository (`start.sh`, `start.bat`, `run_localmind.py`, `backend/.env.example`, `deploy/`, `docs/OFFLINE.md`, `docs/DEPLOYMENT.md`, `docs/AI_MONITORING.md`, `frontend/MOBILE_BUILD.md`).

---

## Part 1: Prerequisites (all modes)

### 1.1 Required software

| Tool | Version | Why |
|---|---|---|
| Python | **3.11 or 3.12** (3.13 is not supported by the pinned wheels) | Backend (Django 5.2) |
| Node.js + npm | **Node 20 LTS** | Builds the Expo web client and runs the dev server |
| Git | any recent | Cloning / updating |
| Docker + Docker Compose v2 | latest | Mode C only |
| PostgreSQL | 14+ (16 tested) | Modes C and D only (SQLite is the default elsewhere) |

Hardware: at least **8 GB RAM** (the 1.7B model plus Docling PDF parsing needs 4 to 5 GB peak), roughly **6 GB free disk** (1 GB model, 2 to 3 GB for Docling/PyTorch, plus the Python environment).

### 1.2 Install prerequisites

**Ubuntu / Debian**

```bash
sudo apt update
sudo apt install -y python3.12 python3.12-venv python3-pip git build-essential libpq-dev curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
python3 --version   # must print 3.11.x or 3.12.x
node --version      # must print v20.x
```

**macOS (Homebrew)**

```bash
brew install python@3.12 node@20 git
brew link --overwrite node@20
python3 --version
node --version
```

**Windows (PowerShell as Administrator)**

```powershell
winget install Python.Python.3.12
winget install OpenJS.NodeJS.LTS
winget install Git.Git
# Close and reopen PowerShell, then:
python --version
node --version
```

### 1.3 Get the code

Either unzip `Local_Mind_Integrated-quiz-assignment.zip`:

```bash
unzip Local_Mind_Integrated-quiz-assignment.zip
cd Local_Mind_Integrated
```

or clone the repository:

```bash
git clone <repository-url> Local_Mind_Integrated
cd Local_Mind_Integrated
```

All paths below are relative to this `Local_Mind_Integrated/` folder.

---

## Part 2: Mode A – Standalone launcher (recommended first run)

One process serves the API, uploaded media, and the built web client on port 8000. Works fully offline after the two downloads in steps 2.3 and 2.4.

### 2.1 Build the web client (once, or after frontend changes)

```bash
cd frontend
npm install
npm run export:web        # writes frontend/dist
cd ..
```

Check: `ls frontend/dist` should show `index.html` and an `_expo/` folder.

### 2.2 Create the Python environment and install the backend

**macOS / Linux**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu
```

**Windows (PowerShell)**

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu
```

The `--extra-index-url` gives you a prebuilt CPU wheel for `llama-cpp-python` so no C compiler is needed. This step pulls PyTorch (via `docling`) and takes several minutes.

If PowerShell refuses to run the activate script:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### 2.3 Create the environment file

```bash
cp .env.example .env            # Windows: copy .env.example .env
```

Open `backend/.env` and set at least:

```ini
DJANGO_SECRET_KEY=<paste a long random string, see below>
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=*
DATABASE_URL=sqlite:///db.sqlite3
AI_PROVIDER=llamacpp
SERVE_WEB=true
SERVE_MEDIA=true
INITIAL_USER_PASSWORD=Welcome@LocalMind1
# Nothing sits in front of the launcher, so no forwarded-for header is trusted.
TRUSTED_PROXY_COUNT=0
# AI monitor (on by default; see Part 11 for the judge model and tuning)
AI_MONITOR_ENABLED=true
AI_MONITOR_MODE=async
```

Generate a secret key:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

(If you skip this step, `run_localmind.py` writes a `.env` with a generated secret for you, with exactly these defaults.)

### 2.4 Download the AI model and PDF layout models (once, needs internet)

```bash
python manage.py fetch_model --docling
```

This downloads `Qwen3-1.7B-Q4_K_M.gguf` (about 1 GB) into `backend/models/` and Docling's PDF models into `backend/models/docling/`.

Alternatives:

```bash
python manage.py fetch_model --from /path/to/model.gguf --docling   # copy a GGUF you already have
python manage.py fetch_model --url https://huggingface.co/.../model.gguf  # different download link
python manage.py fetch_model --docling --skip-llm                   # only the Docling models
python manage.py fetch_model --force                                # replace an existing file
python manage.py fetch_model --monitor --skip-llm                   # dedicated judge model for the AI monitor (Part 11)
```

### 2.5 Verify the AI works

```bash
python manage.py check_ai --smoke
```

Expected: it loads the model, runs two structured generations, and exits 0. The log should show one `Model loaded` and one `Reusing loaded GGUF model`.

### 2.6 Apply migrations and create the first admin (optional; the launcher does this)

```bash
python manage.py migrate
python manage.py bootstrap_admin --email admin@localmind.local
```

`bootstrap_admin` is idempotent. Add `--full-name "Your Name"` or `--password <pw>` if you want to skip the forced first-login password change.

### 2.7 Start the platform

```bash
cd ..                             # back to Local_Mind_Integrated/
python run_localmind.py
```

Or use the wrappers, which also create the venv and install packages on first run:

```bash
./start.sh          # macOS / Linux  (chmod +x start.sh if needed)
start.bat           # Windows
```

Useful launcher options:

```bash
python run_localmind.py --port 8080                 # different port
python run_localmind.py --no-browser                # do not open a browser
python run_localmind.py --admin-email me@school.edu # first admin email (empty DB only)
python run_localmind.py --skip-ai-check             # start even if the model is missing
python run_localmind.py --host 127.0.0.1            # local only, not the LAN
python run_localmind.py --threads 4                 # waitress threads (default 8)
```

The console prints `LocalMind is running at http://<your-lan-ip>:8000`. Any device on the same network opens that URL in a browser.

### 2.8 First login

| Field | Value |
|---|---|
| URL | `http://127.0.0.1:8000` (or the LAN URL printed) |
| Portal | Admin |
| Email | `admin@localmind.local` (or what you passed to `--admin-email`) |
| Password | `Welcome@LocalMind1` (the `INITIAL_USER_PASSWORD` in `.env`) |

You will be forced to change the password before anything else works. Every user you create later also gets `INITIAL_USER_PASSWORD` and must change it at first login. Accounts created while `INITIAL_PASSWORD_MODE=unique` was set can be put back on that password with `python manage.py reset_onboarding_passwords` (only accounts that have not chosen their own password are touched).

### 2.9 Verify

```bash
curl http://127.0.0.1:8000/api/health/
curl "http://127.0.0.1:8000/api/health/?full=1"      # per-component readiness table
```

Look for `"ai": {"ready": true}` and, in the full view, `offline_mode: READY`. The full view also has an `ai_monitor` row (judge readiness and evaluation backlog). Run these on the server itself: from any other machine `/api/health/` gives only the up/down summary, and administrators get the full report at `/api/admin/ai/status/`. Interactive API docs (`/api/docs/`) are served only with `DJANGO_DEBUG=true` or `API_DOCS_ENABLED=true`; the schema is also in `backend/openapi.yaml`.

```bash
cd backend
python manage.py monitor_ai --status      # monitor mode, judge model, backlog
```

### 2.10 Optional: seed demo data (development only)

```bash
cd backend
DJANGO_DEBUG=true python manage.py seed_demo        # Windows: set DJANGO_DEBUG=true first
```

Creates one admin, two faculty, four students, two subjects, published content, a quiz and an assignment. Refuses to run unless `DJANGO_DEBUG=true` (or `--force`).

---

## Part 3: Mode B – Developer mode

Backend on `:8000` with Django's dev server, frontend on `:8081` with Expo hot reload.

### 3.1 Backend

```bash
cd backend
source .venv/bin/activate          # Windows: .\.venv\Scripts\Activate.ps1
```

Edit `backend/.env` for development:

```ini
DJANGO_DEBUG=true
DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost,<your-lan-ip>
DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:8081,http://localhost:8082
```

Then:

```bash
python manage.py migrate
python manage.py bootstrap_admin --email admin@localmind.local
python manage.py runserver 0.0.0.0:8000
```

### 3.2 Frontend (second terminal)

```bash
cd frontend
npm install
EXPO_PUBLIC_API_URL=http://127.0.0.1:8000 npx expo start
```

Then press `w` (web), `a` (Android emulator) or `i` (iOS simulator). For a physical phone, install Expo Go and use your LAN IP:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:8000 npx expo start
```

On Windows PowerShell set the variable first:

```powershell
$env:EXPO_PUBLIC_API_URL="http://127.0.0.1:8000"; npx expo start
```

If `EXPO_PUBLIC_API_URL` is not set, the client falls back to `extra.apiUrl` in `frontend/app.json` (`http://127.0.0.1:8000`). Android emulators rewrite `127.0.0.1` to `10.0.2.2` automatically.

### 3.3 Frontend checks

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # expo lint
npm run export:web     # static web build into dist/
npm run doctor         # expo-doctor
```

### 3.4 Using Ollama instead of the embedded model (optional)

```bash
# install Ollama from https://ollama.com, then:
ollama pull qwen3:1.7b
```

In `backend/.env`:

```ini
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_TUTOR_MODEL=qwen3:1.7b
OLLAMA_OUTLINE_MODEL=qwen3:1.7b
```

Then:

```bash
python manage.py check_ai --pull      # pulls missing models
python manage.py check_ai --smoke
```

Ollama 0.9 or newer is required (the gateway sends `think: false`).

---

## Part 4: Mode C – Docker Compose (production)

Brings up PostgreSQL 16, the API (gunicorn), a maintenance loop, and nginx on port 80.

### 4.1 Prepare the host artifacts

The compose file mounts `backend/models/` and `frontend/dist/` from the host, so build them first (needs Node and Python on the host, once):

```bash
cd frontend && npm install && npm run export:web && cd ..
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu
python manage.py fetch_model --docling
deactivate && cd ..
```

### 4.2 Create `deploy/.env`

```bash
cp backend/.env.example deploy/.env
```

Edit `deploy/.env` and set:

```ini
DJANGO_SECRET_KEY=<long random string>
DJANGO_ALLOWED_HOSTS=localmind.yourschool.edu,<server-ip>
DJANGO_CORS_ALLOWED_ORIGINS=http://localmind.yourschool.edu
POSTGRES_PASSWORD=<strong password>
INITIAL_USER_PASSWORD=<change from default>
BOOTSTRAP_ADMIN_EMAIL=admin@yourschool.edu
AI_PROVIDER=llamacpp
```

`DATABASE_URL`, `MEDIA_ROOT`, `WEB_DIST` and `DJANGO_DEBUG` are set by the compose file itself; leave them alone in `deploy/.env`.

### 4.3 Start the stack

```bash
cd deploy
docker compose up -d --build
docker compose logs -f api        # watch migrate, collectstatic, check_ai, gunicorn start
```

With Ollama instead of the embedded model:

```bash
docker compose --profile ollama up -d --build
```

(and set `AI_PROVIDER=ollama` in `deploy/.env`; uncomment the GPU block in `docker-compose.yml` for NVIDIA hosts).

### 4.4 Verify and operate

```bash
curl http://localhost/api/health/
docker compose ps
docker compose exec api python manage.py check_ai --smoke
docker compose exec api python manage.py bootstrap_admin --email admin@yourschool.edu
```

Stop, restart, update:

```bash
docker compose down
docker compose up -d
git pull && docker compose up -d --build      # upgrade
```

Backups:

```bash
docker compose exec db pg_dump -U localmind localmind > localmind-$(date +%F).sql
docker run --rm -v deploy_media:/data -v $(pwd):/backup alpine tar czf /backup/media-$(date +%F).tgz -C /data .
```

Put TLS in front of the `web` service (Caddy, or extend `deploy/nginx.conf`) before exposing it outside the campus network.

---

## Part 5: Mode D – Bare-metal production with systemd

### 5.1 System user and code

```bash
sudo useradd --system --home /opt/localmind --create-home localmind
sudo -u localmind bash
cd /opt/localmind
git clone <repository-url> app
cd app/backend
python3 -m venv .venv && source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu
cp .env.example .env
```

### 5.2 PostgreSQL

```bash
sudo apt install -y postgresql
sudo -u postgres psql
```

```sql
CREATE ROLE localmind WITH LOGIN PASSWORD '<password>';
CREATE DATABASE localmind OWNER localmind;
\q
```

In `/opt/localmind/app/backend/.env`:

```ini
DJANGO_SECRET_KEY=<long random string>
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=localmind.yourschool.edu
DATABASE_URL=postgres://localmind:<password>@localhost:5432/localmind
MEDIA_ROOT=/opt/localmind/media
INITIAL_USER_PASSWORD=<change me>
TRUSTED_PROXY_COUNT=1
AI_PROVIDER=llamacpp
SERVE_WEB=true
```

### 5.3 Model, migrations, admin, web build

```bash
python manage.py fetch_model --docling
python manage.py check_ai --smoke
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py bootstrap_admin --email admin@yourschool.edu
cd ../frontend && npm install && npm run export:web && cd ../backend
exit    # back to your sudo user
```

### 5.4 systemd units

```bash
sudo cp /opt/localmind/app/deploy/localmind.service /etc/systemd/system/
sudo cp /opt/localmind/app/deploy/localmind-maintenance.service /etc/systemd/system/
sudo cp /opt/localmind/app/deploy/localmind-maintenance.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now localmind
sudo systemctl enable --now localmind-maintenance.timer
sudo systemctl status localmind
sudo journalctl -u localmind -f
```

The unit runs `migrate` and `check_ai` as `ExecStartPre`, then gunicorn on `127.0.0.1:8000` with 1 worker and 8 threads. Each worker loads its own copy of the model, so add workers only on a host with RAM for another copy (about 1.8 GB each); the Docker image reads `GUNICORN_WORKERS` and `GUNICORN_THREADS` for the same choice.

### 5.5 nginx reverse proxy

```bash
sudo apt install -y nginx
sudo cp /opt/localmind/app/deploy/nginx.conf /etc/nginx/sites-available/localmind
sudo ln -s /etc/nginx/sites-available/localmind /etc/nginx/sites-enabled/
```

Edit the copied file: change `proxy_pass http://api:8000;` to `proxy_pass http://127.0.0.1:8000;` (all three occurrences) and `alias /srv/static/;` to `alias /opt/localmind/app/backend/staticfiles/;`. Then:

```bash
sudo nginx -t
sudo systemctl reload nginx
curl http://localhost/api/health/
```

For TLS: `sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx -d localmind.yourschool.edu`.

### 5.6 Upgrades

```bash
sudo -u localmind bash
cd /opt/localmind/app && git pull
cd backend && source .venv/bin/activate
pip install -r requirements.txt --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu
python manage.py migrate
python manage.py check --deploy
cd ../frontend && npm install && npm run export:web
exit
sudo systemctl restart localmind
```

---

## Part 6: Tests and verification

Run from `backend/` with the venv active.

```bash
pip install -r requirements-dev.txt                      # test-only: reportlab + pypdfium2 for the PDF parser tests
python manage.py test                                    # unit suite on SQLite (315 tests; 52 cover the AI monitor)
DATABASE_URL=postgres://user:pw@host:5432/db python manage.py test   # same suite on PostgreSQL (role needs CREATEDB)
python manage.py makemigrations --check --dry-run        # migrations in sync
DJANGO_SECRET_KEY=<key> DJANGO_DEBUG=false python manage.py check --deploy --fail-level ERROR
```

Black-box system test (about 190 HTTP checks) with a fake Ollama, no model needed:

```bash
python scripts/fake_ollama.py &
DJANGO_DEBUG=true AI_PROVIDER=ollama OLLAMA_BASE_URL=http://127.0.0.1:11434 AI_MONITOR_MODE=off python manage.py runserver 127.0.0.1:8011 --noreload &
sleep 5
python scripts/system_test.py http://127.0.0.1:8011 --fake-ollama http://127.0.0.1:11434
```

`AI_MONITOR_MODE=off` matters here: the suite counts calls to its fake Ollama, and the monitor's background judge calls would skew that count (two "cached lesson" checks fail otherwise). The monitor has its own suite and benchmark:

```bash
python manage.py test ai_monitor                          # 52 tests, judge mocked, no model needed
python manage.py monitor_benchmark                        # validators only, bundled 15-case set
```

Same suite against the embedded provider with a placeholder model:

```bash
python scripts/fake_llama_cpp/make_model.py /tmp/fake.gguf
PYTHONPATH=scripts/fake_llama_cpp AI_PROVIDER=llamacpp AI_MODEL_PATH=/tmp/fake.gguf DJANGO_DEBUG=true python manage.py runserver 127.0.0.1:8011 &
python scripts/system_test.py http://127.0.0.1:8011
```

Against a real server with the real model (pre-release check):

```bash
python scripts/system_test.py http://<host>:8000
```

Performance benchmarks:

```bash
python manage.py benchmark_ai --tasks tutor,quiz,lesson --repeat 3
python manage.py benchmark_documents /path/to/book.pdf --engine auto
```

---

## Part 7: Building an offline bundle for other machines

On a machine with internet, Node, and the **same OS and Python version** as the targets:

```bash
python package_offline.py                              # bundle for this OS/Python
python package_offline.py --platform win_amd64 --python 3.12   # cross-platform wheels (torch may fail; prefer same-OS build)
```

Output: `dist/localmind-offline-<platform>.zip` containing source, `frontend/dist`, both model sets and a `wheelhouse/` of every Python dependency. On the target machine:

```bash
unzip localmind-offline-<platform>.zip
cd Local_Mind_Integrated     # or wherever it unzipped
./start.sh                   # Windows: start.bat
```

Only Python 3.11/3.12 needs to be present on the target. `start.sh` / `start.bat` detect `wheelhouse/` and install with `pip install --no-index --find-links wheelhouse`.

---

## Part 8: Phone apps (Android / iOS)

### 8.1 Point the app at the server

Edit `frontend/eas.json` and replace `http://192.168.1.20:8000` (development and preview profiles) and `https://localmind.example.edu` (production) with your backend URL. Make sure `DJANGO_ALLOWED_HOSTS` and `DJANGO_CORS_ALLOWED_ORIGINS` on the backend accept that address.

### 8.2 EAS cloud build (no Android Studio or Xcode needed)

```bash
cd frontend
npm install -g eas-cli
eas login
eas init                   # writes projectId into app.json
npm run build:android      # preview profile -> sideloadable .apk
npm run build:ios          # preview profile -> .ipa
npm run build:all          # production profile -> .aab + App Store build
```

### 8.3 Local build

```bash
npm run prebuild                       # regenerate android/ and ios/ after app.json changes
cd android && ./gradlew assembleRelease # APK in android/app/build/outputs/apk/release/
# or with a device plugged in:
npm run android
# iOS (macOS only):
cd ios && pod install && cd ..
npm run ios
```

---

## Part 9: Day-to-day maintenance commands

```bash
python manage.py requeue_stuck_documents           # re-run documents abandoned mid-processing
python manage.py generate_lessons --status          # lessons queued, generating, ready, failed
python manage.py generate_lessons --queue           # queue every module without a current lesson (after an upgrade)
python manage.py generate_lessons --run --limit 10  # generate in this process instead of the web worker
python manage.py generate_auto_quizzes --status     # automatic module quizzes: queued, ready, failed, dismissed
python manage.py generate_auto_quizzes --queue      # queue a quiz for every module without one (books uploaded before this feature)
python manage.py generate_auto_quizzes --remove-short --dry-run  # automatic quizzes on modules under AUTO_QUIZ_MIN_CHARS (drop --dry-run to delete unattempted ones)
python manage.py tidy_book --list                   # books with their ids and module counts
python manage.py tidy_book --document <id> --dry-run # fold textbook boxes and tiny modules into their sections (drop --dry-run to apply)
python manage.py requeue_stuck_documents --dry-run
python manage.py flushexpiredtokens                # trim JWT blacklist
python manage.py monitor_ai --purge                # apply AI-monitor retention (open incidents kept)
python manage.py monitor_ai --backfill --limit 50  # evaluate interactions the monitor has not seen
python manage.py cleanup_media                     # list orphaned media dirs
python manage.py cleanup_media --delete            # remove them
python manage.py check_ai                          # provider readiness (exit code 0 = ready)
python manage.py check_ai --smoke                  # plus one real generation
python manage.py check_ai --pull                   # Ollama only: pull missing models
python manage.py bootstrap_admin --email x@y.edu   # another admin (idempotent)
```

Health endpoints:

```bash
curl http://<host>:8000/api/health/                  # up/down summary, from anywhere
curl "http://127.0.0.1:8000/api/health/?full=1"      # component report, on the server itself
# admin token required:
curl -H "Authorization: Bearer <token>" "http://<host>:8000/api/admin/ai/status/?refresh=1"
```

---

## Part 10: Troubleshooting

| Symptom | Fix |
|---|---|
| `pip install` fails building `llama-cpp-python` | You forgot `--extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu`, or you are on Python 3.13. Use 3.11/3.12. |
| `DJANGO_SECRET_KEY` error at start | Set it in `backend/.env`; required whenever `DJANGO_DEBUG=false`. |
| `WARNING: frontend/dist is missing` | `cd frontend && npm run export:web`. |
| `AI not ready` / `ai.ready=false` | `cd backend && python manage.py fetch_model --docling`, then restart. The app still runs with deterministic fallbacks. |
| Model fails to load, RAM short | Set `OLLAMA_NUM_CTX=8192` in `.env` (applies to llamacpp too); use 1 gunicorn worker. |
| Browser on another device cannot connect | Use the LAN IP the launcher printed, not `127.0.0.1`; open port 8000 in the firewall; `DJANGO_ALLOWED_HOSTS=*` or add the IP. |
| Expo web shows CORS errors | Add `http://localhost:8081` (and your LAN origin) to `DJANGO_CORS_ALLOWED_ORIGINS`. |
| Phone cannot reach backend | Phones cannot use `127.0.0.1`; set `EXPO_PUBLIC_API_URL=http://<lan-ip>:8000`. |
| `seed_demo` refuses to run | Needs `DJANGO_DEBUG=true` or `--force`. |
| Document stuck in `processing` | `python manage.py requeue_stuck_documents` (automatic every 15 min in Modes C/D). |
| `docker compose` fails with `set POSTGRES_PASSWORD` | Add `POSTGRES_PASSWORD=...` to `deploy/.env`. |
| PowerShell will not activate the venv | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. |
| AI Monitor tab says "Judge model unavailable" | Validators still run. Either accept `abstain` verdicts for ambiguous cases, or configure a judge model (Part 11.2). With `AI_PROVIDER=ollama`, `ollama pull` the tag in `AI_MONITOR_OLLAMA_MODEL`. |
| Incident queue is empty but interactions exist | `python manage.py monitor_ai --status` shows `pending_backlog`; run `--backfill`. If `enabled` is false, check `AI_MONITOR_ENABLED` / `AI_MONITOR_MODE`. |
| Too many low-value incidents | Raise `min_confidence` or `min_severity` for that issue type in Admin → AI Monitor → Policies, and mark them false positive so the precision metric reflects it. |
| Out of memory after adding a dedicated judge model | A 7B Q4 judge is another 5 GB in-process. Use one gunicorn worker, or drop `AI_MONITOR_MODEL_FILE` to share the app model. |

Logs: the launcher and `runserver` print to the console; Docker: `docker compose logs -f api`; systemd: `journalctl -u localmind -f`. Gateway lines look like `AI <purpose> ok model=... latency_ms=...`; a steady stream of `attempt 2/2` or `error_code: timeout` means the host is saturated.

---

## Part 11: AI Monitoring & Guard

`AI_Monitoring_Guard_PRD_v2.docx` is implemented as the `backend/ai_monitor/` app and the "AI Monitor" tab in the admin console. It runs in every mode above with no extra steps: the migration is applied by `migrate` (or the launcher), the default policies are created on first use, and every tutor answer and AI-generated quiz is evaluated on a background thread after the response is sent. This part covers what is optional: a stronger judge model, tuning, backfilling old data, benchmarking, and retention. Design details are in `docs/AI_MONITORING.md`.

### 11.1 Check it is running

```bash
cd backend && source .venv/bin/activate     # Windows: .\.venv\Scripts\Activate.ps1
python manage.py monitor_ai --status
```

You should see `enabled: True`, `mode: async`, the judge model name and `pending_backlog`. The same information is in the admin UI (AI Monitor tab, "Monitor health" card) and in `curl "http://127.0.0.1:8000/api/health/?full=1"` under the `ai_monitor` component. Under Docker: `docker compose exec api python manage.py monitor_ai --status`.

### 11.2 Optional: a dedicated judge model (recommended for production)

By default the judge shares the application model (Qwen3 1.7B). The PRD's baseline is a 7-8B instruct model, which is a much better evaluator but needs about 5 GB more RAM.

Embedded provider (`AI_PROVIDER=llamacpp`):

```bash
# backend/.env
AI_MONITOR_MODEL_FILE=qwen2.5-7b-instruct-q4_k_m.gguf
```

```bash
cd backend
python manage.py fetch_model --monitor --skip-llm        # ~4.7 GB, once, needs internet
python manage.py monitor_ai --status                     # judge_ready should be True
```

To use a GGUF you already have: `AI_MONITOR_MODEL_PATH=/absolute/path/judge.gguf` instead. A different download: set `AI_MONITOR_MODEL_REPO` and `AI_MONITOR_MODEL_DOWNLOAD_FILE` before running `fetch_model --monitor`.

Ollama provider (`AI_PROVIDER=ollama`):

```bash
ollama pull qwen2.5:7b-instruct
```

```bash
# backend/.env
AI_MONITOR_OLLAMA_MODEL=qwen2.5:7b-instruct
```

Restart the server after either change. Under Docker Compose the model file goes in `backend/models/` on the host (it is mounted read-only into the container); add the `AI_MONITOR_MODEL_FILE` line to `deploy/.env` and `docker compose up -d`.

### 11.3 Tuning

All knobs are environment variables in `backend/.env` (full table in `docs/ENVIRONMENT.md`):

```ini
AI_MONITOR_ENABLED=true            # master switch
AI_MONITOR_MODE=async              # async | sync | off
AI_MONITOR_JUDGE_ENABLED=true      # false = validators only, ambiguous cases abstain
AI_MONITOR_SAMPLE_PERCENT=10       # share of clean answers still sent to the judge
AI_MONITOR_MIN_JUDGE_CONFIDENCE=60 # judge verdicts below this never decide alone
AI_MONITOR_MAX_EVIDENCE_CHARS=6000 # evidence stored / sent to the judge
AI_MONITOR_RETENTION_DAYS=180
AI_MONITOR_EVALUATOR_VERSION=1.0   # bump after changing validators or the judge prompt
```

Incident thresholds per issue type (enabled, minimum confidence, minimum severity) are edited in the UI: Admin → AI Monitor → Policies. Or via the API:

```bash
curl -X PATCH -H "Authorization: Bearer <admin-token>" -H "Content-Type: application/json" \
  -d '{"min_confidence": 0.8, "min_severity": "high"}' \
  http://127.0.0.1:8000/api/admin/monitor/policies/unsupported_claim/
```

### 11.4 Backfill existing data

Interactions created before the monitor was installed, or while it was off, are evaluated with:

```bash
python manage.py monitor_ai --backfill                       # everything pending, oldest first
python manage.py monitor_ai --backfill --limit 100           # in batches
python manage.py monitor_ai --backfill --kind quiz           # quizzes only (or tutor_answer)
python manage.py monitor_ai --backfill --since 2026-09-01
python manage.py monitor_ai --backfill --judge               # force the judge on every one (slow)
```

The admin UI has an "Evaluate N pending" button that does the same 25 at a time. One interaction on demand:

```bash
python manage.py monitor_ai --evaluate <uuid> --kind tutor_answer --judge
```

### 11.5 Review workflow

1. Admin console → **AI Monitor**. Filter the queue by severity, status, issue type, kind, period.
2. Open an incident: student question | reference material | AI response | monitoring verdict side by side, then every validator result and the judge's quoted evidence.
3. **Confirm issue**, **False positive**, **Needs investigation**, **Escalate**, **Close** or **Reopen**; add a note. Confirm and False positive write a reviewer label that feeds the false-positive rate and high-severity precision on the overview.
4. **Re-evaluate with judge** re-runs the pipeline with the judge forced (useful after installing a better judge model).

Faculty see academic-content incidents (hallucination, factual error, unsupported claim, quiz error) in their own subjects through `/api/faculty/monitor/…` and may confirm, reject or flag them; they cannot close or escalate. There is no faculty screen for this yet, only the API.

### 11.6 Benchmark before choosing a judge model

```bash
python manage.py monitor_benchmark                           # bundled 15-case set, validators only
python manage.py monitor_benchmark --judge                   # same set through the judge model
python manage.py monitor_benchmark --cases labelled.jsonl --judge --json > report.json
```

The case file format (one JSON object per line: `kind`, `prompt`, `response`, `grounded`, `source_reference`, `evidence`, `label`, or `questions` for quizzes) is documented in `docs/AI_MONITORING.md`. The PRD's selection gate is 100 to 300 labelled real interactions; the bundled set is a smoke test.

### 11.7 Retention

`python manage.py monitor_ai --purge` deletes evaluations older than `AI_MONITOR_RETENTION_DAYS` (incidents that are still open, escalated or under investigation are kept). It is already wired into `deploy/localmind-maintenance.service` (Mode D) and the `maintenance` container (Mode C), so it runs every 15 minutes there. In Mode A run it by hand or from cron:

```bash
crontab -e
# 0 3 * * * cd /path/to/Local_Mind_Integrated/backend && .venv/bin/python manage.py monitor_ai --purge
```

### 11.8 Turning it off

```ini
AI_MONITOR_MODE=off        # nothing evaluated automatically; manual evaluation still works
AI_MONITOR_ENABLED=false   # fully off
```
