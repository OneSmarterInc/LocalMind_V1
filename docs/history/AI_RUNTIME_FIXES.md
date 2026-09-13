# AI runtime, memory and PDF parsing fixes (September 2026)

This note records the targeted changes made to the existing LocalMind backend
for four reported problems: the embedded GGUF model being loaded more than
once and failing on allocation, RAM pressure from Docling, RapidOCR and Qwen
resident together, PDFs producing zero sections, and `check_ai` describing
Ollama when the configured provider is `llamacpp`. The architecture, API
contracts, frontend, DOCX parser, OCR fallback and both AI providers are
unchanged.

## Files changed

| File | Change |
| --- | --- |
| `backend/ai/llamacpp.py` | Process-wide shared model registry (`_SharedModel`), lazy thread-safe load, transient vs permanent load errors with retry, explicit `close()` at exit, `status_line()`, richer `describe()`. |
| `backend/ai/gateway.py` | Provider-neutral docstrings; health logs the provider status line; never falls back to another provider. |
| `backend/ai/apps.py` | Logs `AI provider / Model / Mode / Status` once per process at startup without loading anything. |
| `backend/ai/management/commands/check_ai.py` | Provider-aware help and flow; llamacpp path never touches Ollama; `--smoke` proves the model is loaded once and reused. |
| `backend/config/settings.py` | New `AI_BATCH` (default 256) and `AI_LOAD_RETRY_SECONDS` (default 60). |
| `backend/core/system_health.py` | Reports load count, mode and whether a load error is transient. |
| `backend/documents/services/parser.py` | pypdfium2 text-layer probe, one Docling pass per document, full-page OCR for scans, cached converters with `release_document_models()`, heading inference, page-group sections, `NoExtractableContent`. |
| `backend/documents/services/documents.py` | Parse, release parser models, then call the LLM; one document at a time per process; clear error for unreadable files. |
| `backend/ai/tests.py`, `backend/documents/tests.py` | 17 new tests covering all of the above. |
| `backend/Dockerfile`, `README.md`, `docs/OFFLINE.md`, `docs/ENVIRONMENT.md`, `docs/DEPLOYMENT.md` | Wording and the new settings. |
| `.gitignore` | `node_modules/` and `backend/models/` were on one line (so neither pattern worked); split, and `frontend/.expo/` added. |

## Root cause of the second load and the allocation failure

`check_ai --smoke` and the web server are separate processes, so the server
always had to load its own copy; that part is expected. The damage came from
what happened inside the server process. A document upload runs Docling's
PyTorch layout model and the RapidOCR models in a background thread, and the
outline step then asked the embedded provider for the model for the first
time in that process, while those parser models were still resident. llama.cpp
failed allocating its float32 logits buffer (`n_batch` 512 rows by the 151,936
token vocabulary, the 297 MiB in the log). The provider then remembered that
failure permanently, so every later call, including the Doubt section,
reported `AI not ready (llamacpp)` even after memory was free again. The
destructor message came from llama-cpp-python objects being finalised during
interpreter teardown, after the `llama_cpp` module globals they call had been
set to `None`.

## Memory solution

The loaded `Llama` object now lives in a registry keyed by model path, so
every `LlamaCppProvider`, the health probe and `check_ai` share one instance
per process; a lock guards both the lazy load and generation, so concurrent
first requests cannot construct two models. Allocation errors are classified
as transient and retried after `AI_LOAD_RETRY_SECONDS`; a missing library is
permanent. `AI_BATCH` defaults to 256, halving the logits buffer. The
document pipeline now parses first, releases the Docling/OCR converters and
runs `gc.collect()`, and only then calls the LLM; converters are cached
during a job so the no-OCR and OCR passes (or several documents) do not
reload PyTorch models, and only one document is parsed at a time per process.
The model is closed explicitly through an `atexit` hook, which removes the
`'NoneType' object is not callable` deallocator error caused by our lifecycle
(a native-library ordering issue can still print it on some Python versions;
that would be a dependency matter, not application code).

## PDF solution

`extract_sections_from_markdown` already fell back to one "Document Content"
section when there were no headings, but only if any text survived cleanup.
For `machine-learning.pdf` Docling's OCR pass returned markdown that
contained only `<!-- image -->` and page-break markers: the text check in
`parse_document` saw a non-empty string and continued, cleanup then removed
every marker, and the section list came out empty, which surfaced later as
`NO_SECTIONS`. Two things contributed: Docling's default OCR only covers
regions its layout model classifies as bitmaps, so scanned pages with a
stray text layer or unusual layout got little or no OCR, and the fallback
decision was made on Docling's output rather than on the PDF itself.

The parser now reads the text layer with pypdfium2 first. Real text means
one Docling pass without OCR; if Docling drops that text, the text layer is
used directly. No text means one Docling pass with full-page OCR. If the
result has fewer than two headings, heading-like lines (numbered, "Chapter
3", all caps, Title Case before a paragraph) are promoted to Markdown
headings deterministically, so re-reading `document.md` later reproduces the
same indices; text with no structure at all becomes page-group sections of
about 6000 characters. A file with no text after all of that raises
`NoExtractableContent`, which `run_processing` stores as a clear error
message instead of a traceback. DOCX output has no page markers and follows
the original code path unchanged.

## Validation performed here

`python manage.py check` passes and the full suite (167 tests) passes on
Linux with Django 5.2. `check_ai --smoke` was run against the stub
`llama_cpp` module in `backend/scripts/fake_llama_cpp` and shows one `Model
loaded` followed by `Reusing loaded GGUF model` on the second generation.
The pypdfium2 probe was exercised on generated PDFs; Docling itself and the
real GGUF could not be run in this environment, so the Docling API usage was
checked against docling 2.124 source and the OCR mode is set in a
version-tolerant way (`OcrMode.FULL_PAGE` where available, the older
`force_full_page_ocr` flag otherwise).

## Still to verify on the target machine

Run these with the real model and Docling artifacts present, then with the
network disabled: `python manage.py check_ai --smoke`, upload
`machine-learning.pdf` and confirm `sections > 0` and the outline builds,
upload `Chapter_02_Personal_Cybersecurity.docx` and confirm 36 headings and
sections, then use the Doubt section. If the outline call still fails on an
8 GB machine after a large PDF, set `OLLAMA_NUM_CTX=8192`.
