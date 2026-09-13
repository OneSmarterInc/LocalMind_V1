# Running LocalMind offline, on any machine, without Ollama

LocalMind's AI features (quiz and assignment generation, subjective-answer
evaluation, book outlining, and the student tutor's lessons, Q&A and
remediation) all go through one gateway (`backend/ai/gateway.py`). This
document describes the embedded provider that runs the model inside the
backend process, the single-process launcher, and how to package everything
for a machine that has no internet and nothing installed.

## What changed

The default `AI_PROVIDER` is now `llamacpp`. `backend/ai/llamacpp.py` loads a
GGUF model file with `llama-cpp-python` and generates JSON constrained by the
same schemas the Ollama provider used, so every caller is unchanged and every
deterministic fallback still applies. Ollama remains available with
`AI_PROVIDER=ollama`.

Two other pieces make the whole platform self-contained. Django now serves
the built Expo web client (`frontend/dist`) and `/media/` itself when the
build folder exists, so one port carries the UI, the API, the uploads and the
model; the client detects that it is being served by the backend and calls
the API on the same origin, so no `EXPO_PUBLIC_API_URL` is needed on any
machine. Docling's PDF layout models, which it would otherwise download from
Hugging Face on the first upload, are stored locally by `fetch_model --docling`
and the parser is pointed at that folder.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `AI_PROVIDER` | `llamacpp` | `llamacpp` (embedded, offline) or `ollama` |
| `AI_MODEL_PATH` | *(empty)* | Absolute path to the .gguf; overrides the two below |
| `AI_MODEL_FILE` | `Qwen3-1.7B-Q4_K_M.gguf` | File name under `backend/models/` |
| `AI_MODEL_REPO` | `unsloth/Qwen3-1.7B-GGUF` | Hugging Face repo `fetch_model` downloads from |
| `AI_THREADS` | `0` | CPU threads for inference; 0 means all cores but one |
| `AI_GPU_LAYERS` | `0` | Layers to offload when the wheel was built with CUDA/Metal |
| `DOCLING_ARTIFACTS` | `backend/models/docling` | Local Docling model folder |
| `SERVE_WEB` | `true` | Serve `frontend/dist` from Django when it exists |
| `SERVE_MEDIA` | same as `SERVE_WEB` | Serve `/media/` from Django (no nginx) |
| `WEB_DIST` | `frontend/dist` | Where the web build lives |

`OLLAMA_NUM_CTX`, `OLLAMA_NUM_PREDICT`, `OLLAMA_TIMEOUT_SECONDS` and
`OLLAMA_MAX_RETRIES` apply to both providers (they were always gateway-level
settings; the names are kept for compatibility). With the embedded provider
the timeout bounds how long a request waits for the model to be free; the
generation itself is bounded by `NUM_PREDICT` because llama.cpp cannot be
interrupted mid-completion.

## Commands

`python manage.py fetch_model` downloads the GGUF once (about 1 GB for the
Q4_K_M quantisation). `--docling` also fetches the PDF layout models.
`--from /path/model.gguf` copies a file you already have, `--url` overrides
the download address, and `--force` replaces an existing file. If the
default repo/file pair ever moves, pass `--url` with the direct link to any
Qwen3-1.7B or Qwen2.5-1.5B-Instruct GGUF; the provider does not care which
as long as it is a chat model.

`python manage.py check_ai` is provider-aware. With `AI_PROVIDER=llamacpp`
it verifies the library imports, the GGUF exists and is valid, loads it into
the process, and with `--smoke` runs two structured generations and confirms
the model was loaded exactly once (the log shows one `Model loaded` and one
`Reusing loaded GGUF model`). It never contacts Ollama or the network. With
`AI_PROVIDER=ollama` it probes the daemon and the pulled models instead, and
`--pull` fetches missing ones. The launcher runs it at start so the first
student question does not pay the load time.

`python run_localmind.py` is the one-process launcher: it writes a
`backend/.env` with a generated secret if there is none, migrates, creates
the first admin on an empty database, checks the model, then serves with
waitress on port 8000 and opens a browser. `start.bat` and `start.sh` wrap
it and create the virtual environment on first run, installing from
`wheelhouse/` when that folder exists (offline) or from PyPI otherwise.

## Building a bundle for machines with no internet

On a machine that has internet, Node and the same OS and Python version as
the targets:

```bash
python package_offline.py
```

This exports the web client, downloads the models, downloads every Python
wheel into `wheelhouse/`, and zips source + web build + models + wheels into
`dist/localmind-offline-<platform>.zip`. On the target machine, unzip and run
`start.bat` or `./start.sh`; the only prerequisite is Python 3.11 or 3.12.
Cross-platform wheel downloads (`--platform win_amd64 --python 3.12` from a
Linux box) work for most packages, but the torch wheels behind Docling are
large and platform-specific, so building the bundle on the same kind of
machine as the targets is the reliable path.

## System health

`GET /api/admin/ai/status/?refresh=1` (admin only) and `GET /api/health/?full=1`
(administrators, or requests from the server itself; everyone else gets the
up/down summary) return `system.components`, one
entry per dependency: backend, database, storage, ai_runtime, ai_model,
document_processing, web_client and offline_mode, each READY / ERROR /
MISSING with a one-line reason and the command that fixes it. The admin
Overview shows the same table under "System readiness", worded for the
provider actually configured (a llama.cpp installation never mentions
Ollama). `offline_mode` is READY only when the AI provider is the embedded
one, the model file is present and valid, and Docling's models are local.

## Current versus future

Current: Django, local database (SQLite or PostgreSQL), local storage,
llama.cpp with a GGUF model, local Docling artifacts, browser. No AWS, no
cloud AI, no internet at runtime. Future, not implemented: AWS deployment
with RDS PostgreSQL, S3 storage, a Redis-backed task worker and optionally a
cloud AI provider. Each of those slots in behind an existing abstraction
(`DATABASE_URL`, Django storage backends, `ai.gateway`, the `process/`
endpoints and maintenance commands, environment configuration) without
touching the frontend.

## Model lifecycle and memory

One GGUF instance lives in each Django process. `ai.llamacpp` keeps it in a
process-wide registry keyed by the model path, loads it lazily on the first
AI call (or when `check_ai` warms it up), and every caller (tutor, outline
builder, health probe) shares that instance under one lock. Nothing is loaded
at import time, and the model is closed explicitly at interpreter exit so
llama-cpp-python's destructors do not run after their module has been torn
down (the cause of the `'NoneType' object is not callable` deallocator
message).

Memory is the constraint on a laptop. Qwen3-1.7B at Q4_K_M maps about 1.1 GB
of weights; the 16k context adds roughly 1.9 GB of KV cache, and llama.cpp
allocates a float32 logits buffer of `n_batch` rows by the 152k-token
vocabulary, which is why `AI_BATCH` defaults to 256 (about 150 MB) rather
than llama.cpp's 512. Docling's layout model and the RapidOCR models are
PyTorch and take another 1 to 2 GB while a document is being parsed. The
document pipeline therefore parses first (reusing one cached Docling
converter per configuration for the whole job), releases those models, and
only then asks the LLM for an outline; one document is parsed at a time per
process. If the model still fails to load because RAM is short, the error is
treated as transient and the load is retried after `AI_LOAD_RETRY_SECONDS`
instead of marking the AI unavailable for the life of the process. Lower
`OLLAMA_NUM_CTX` to 8192 on a machine with 8 GB or less if the outline call
still fails after a large PDF.

On a modern laptop CPU a 10-question quiz takes 30 to 90 seconds, a tutor
answer 5 to 20 seconds. Each gunicorn worker is a separate process with its
own copy of the model, so the shipped Dockerfile and systemd unit use one
worker with 8 threads, and a second worker only makes sense with RAM for
another model copy; the launcher uses one process with 8 waitress
threads. Faculty generating a quiz while a student asks the tutor will queue
for a few seconds, which the frontend already tolerates.

## PDF parsing

`documents/services/parser.py` reads the PDF's text layer with pypdfium2
first (cheap, no model). If it holds real text, Docling runs once without
OCR and keeps the headings its layout model finds. If it does not (a scanned
book), Docling runs once with full-page OCR so every page is recognised, not
only the regions it detects as images. If Docling drops text the text layer
already gave us, the text layer is used. When the result has fewer than two
headings the parser promotes heading-like lines (numbered, "Chapter 3",
all-caps, Title Case before a paragraph) to Markdown headings, and a document
with no structure at all is split into page-group sections of about 6000
characters so faculty have something to review and edit. A file with no text
after all of that fails with a clear `NO_EXTRACTABLE_CONTENT` message rather
than an empty outline. DOCX parsing is untouched.

## Behaviour when the model is missing

Nothing breaks. `/api/health/` reports `ai.ready=false` with the reason,
quiz and assignment generation return their deterministic question sets
flagged `generator=fallback`, the tutor serves the module text with a note,
and the launcher prints the `fetch_model` instruction. Run `fetch_model` once
and restart; no other step is needed.
