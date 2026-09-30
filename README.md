# LocalMind

LocalMind is a learning platform for schools and colleges. Faculty upload a book, and LocalMind turns it into modules, lessons and quizzes. Students study those modules with an AI tutor that runs on the institution's own server or on the student's own device. No cloud AI service or API key is needed, and students can keep studying offline.

It runs in the browser, on Android and on iOS.

## Who uses it

| Role | What they do |
|---|---|
| **Administrator** | Adds users (one by one or by Excel import), creates subjects, assigns faculty, enrolls students, watches AI activity and the audit log |
| **Faculty** | Uploads books (PDF, DOCX, TXT), reviews and publishes modules, creates AI or manual quizzes, grades and releases results |
| **Student** | Reads modules and lessons, asks the AI tutor, takes quizzes, tracks progress, studies offline |

## Features

- Lessons are generated automatically in the background after a book is uploaded.
- AI quizzes are built only from the modules faculty select.
- Faculty decide when students see their results.
- Students can download course content and a small AI model (about 1.1 GB) once, then study with no internet.
- Offline quiz answers sync to the server when the device reconnects.
- Every new account must change its first password at first login.

## Tech stack

| Part | Technology |
|---|---|
| Backend | Python 3.11 or 3.12, Django 5.2, Django REST Framework |
| Database | SQLite (local) or PostgreSQL (production) |
| AI | Qwen3 1.7B via llama.cpp (Ollama optional) |
| Client | Expo (React Native) for web, Android and iOS |
| Server | gunicorn behind nginx |

## Requirements

- Python 3.11 or 3.12 (3.13 is not supported)
- Node.js 20 LTS
- Git
- 8 GB RAM and about 6 GB free disk

## Quick start

**1. Get the code**

```bash
git clone https://github.com/OneSmarterInc/LocalMind_V1.git
cd LocalMind_V1
```

**2. Build the web client**

```bash
cd frontend
npm install
npm run export:web
cd ..
```

**3. Set up the backend**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .\.venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements.txt --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu
```

**4. Download the AI model (once, needs internet)**

```bash
python manage.py fetch_model --docling
python manage.py check_ai --smoke
cd ..
```

**5. Start LocalMind**

```bash
./start.sh                          # Windows: .\start.bat
```

Open `http://127.0.0.1:8000` and sign in as `admin@localmind.local`. The first password is the `INITIAL_USER_PASSWORD` value in `backend/.env`. You will be asked to change it.

## Project structure

```
LocalMind_V1/
├── backend/      Django API, AI, database models
├── frontend/     Expo app (web, Android, iOS)
├── deploy/       nginx and systemd files for the server
├── docs/         detailed guides
├── tests/        client tests
└── start.sh / start.bat   one-step launch
```

## Configuration

Settings live in `backend/.env`. The launcher creates this file on first run. Start from `backend/.env.example` for a server setup, and see `docs/ENVIRONMENT.md` for every option.

Never commit `.env`, database files or model files. They are already in `.gitignore`.

## Deployment

Production runs on an AWS EC2 server at `localmind.onesmarter.com`, with PostgreSQL, gunicorn and nginx installed directly on the host. See `docs/AWS_EC2_RUNBOOK.md`.

After pulling new code on the server, always run:

```bash
cd backend
source .venv/bin/activate
python manage.py migrate
python manage.py collectstatic --noinput
sudo systemctl restart <gunicorn-service>
```

Phone builds are covered in `frontend/MOBILE_BUILD.md`.

## Running tests

```bash
cd backend
pip install -r requirements-dev.txt
python manage.py test
```

## Common problems

| Problem | Fix |
|---|---|
| `llama-cpp-python` fails to install | Use Python 3.11 or 3.12 and keep the `--extra-index-url` |
| `frontend/dist is missing` | Run `npm run export:web` inside `frontend` |
| AI not ready | Run `python manage.py fetch_model --docling`, then restart |
| Old screens after an update | Hard refresh the browser (Ctrl+Shift+R) |
| Phone can't reach the server | Use the server's network address, not `127.0.0.1` |


