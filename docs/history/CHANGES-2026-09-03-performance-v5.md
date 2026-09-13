# LocalMind performance upgrade (v5), 3 September 2026 — implementation report

## Files changed

New
- `backend/ai/config.py` — the one place every AI budget comes from: performance modes, per-task output caps, sampling, context, source and history budgets, env overrides.
- `backend/documents/services/chunking.py` — split module text into stored retrieval chunks; rebuild on processing and edits.
- `backend/documents/services/retrieval.py` — offline BM25 retrieval over stored chunks; coverage sampling for quiz and lesson.
- `backend/documents/migrations/0002_document_chunk.py` — the `DocumentChunk` table.
- `backend/ai/management/commands/benchmark_ai.py`, `backend/documents/management/commands/benchmark_documents.py`.
- `backend/tutor/tests_performance.py` — retrieval, bounded prompts, task budgets, cache, queue.

Modified
- `backend/ai/gateway.py` — `generate(..., task=, max_tokens=, top_p=, source_chars=, retrieved_chunks=)`; per-request telemetry line and in-memory metrics; token counts on `AIResult`; performance snapshot in health.
- `backend/ai/llamacpp.py` — task-aware `generate_structured`, context from `ai.config`, `AI_BATCH_THREADS`, token counts returned.
- `backend/ai/prompts.py` — `trim=False` for callers that already sized the source.
- `backend/tutor/services.py` — Ask uses retrieval + bounded history + tutor budget + first-question cache; lesson uses coverage sample + lesson budget; single-worker pre-warm queue.
- `backend/assessments/services/generation.py`, `assessments.py`, `evaluation.py`; `backend/assignments/services.py`; `backend/documents/services/outline.py` — task names and compact sources.
- `backend/documents/services/documents.py` — chunking after processing and after outline/chapter/module edits; stage timings logged; publish enqueues pre-warm.
- `backend/documents/services/parser.py` — per-stage timings (`text_extract_ms`, `structure_ms`, `docling_ms`, `ocr_ms`, `pages`).
- `backend/documents/models.py` — `DocumentChunk`.
- `backend/config/settings.py` — new AI keys, `CACHES`.
- `backend/ai/tests.py`, `backend/documents/tests.py` — updated and extended.
- `deploy/localmind.service`, `backend/Dockerfile`, `docs/DEPLOYMENT.md` — one gunicorn worker by default, with the RAM arithmetic.
- `docs/ENVIRONMENT.md`, `backend/.env.example`.

Unchanged: every API endpoint, response shape, serializer, role, auth/refresh flow, the frontend, PostgreSQL/SQLite support, the offline llama.cpp provider as default, the optional Ollama provider.

## Database migrations

`documents.0002_document_chunk`: table `documents_documentchunk` (document FK, module FK, content_version, order, text, char_count, page_start, page_end, heading, terms JSON), unique on (module, content_version, order), index on (module, content_version). Run `python manage.py migrate`. Documents processed before this version have no chunks; the first tutor question on such a module builds them (`ensure_chunks`), after which they are read, never rebuilt, until the document version changes.

## New environment variables

`AI_PERFORMANCE_MODE` (fast|balanced|quality, default fast), `AI_NUM_CTX`, `AI_TUTOR_MAX_TOKENS`, `AI_QUIZ_MAX_TOKENS`, `AI_LESSON_MAX_TOKENS`, `AI_REMEDIATION_MAX_TOKENS`, `AI_OUTLINE_MAX_TOKENS`, `AI_EVALUATE_MAX_TOKENS`, `AI_ASSIGNMENT_MAX_TOKENS`, `AI_MAX_SOURCE_CHARS` (now 0 = mode value), `AI_MAX_CONVERSATION_MESSAGES`, `AI_RETRIEVAL_CHUNKS`, `AI_BATCH_THREADS`. From v4 and still in force: `AI_FLASH_ATTN`, `AI_PROMPT_CACHE_MB`, `PDF_LAYOUT_ENGINE`, `OUTLINE_MODE`, `LESSON_PREWARM`, `AI_GPU_LAYERS` (now documented as 0 / -1 / N). `OLLAMA_NUM_CTX` and `OLLAMA_NUM_PREDICT` are still read for old `.env` files; the latter is an absolute ceiling above the task caps.

Fast-mode defaults: context 8192; source 8000 chars; history 4 messages; output caps tutor 512, quiz 1400, lesson 1000, remediation 800, outline 800, evaluate 400, assignment 700.

## New services and classes

`ai.config.TaskConfig` / `task_config(task)` / `describe()`; `documents.models.DocumentChunk`; `documents.services.chunking.split_text / rebuild_for_module / rebuild_for_document / ensure_chunks`; `documents.services.retrieval.retrieve / coverage_sample / score_chunks`; `tutor.services.enqueue_prewarm` (single background worker); `ai.gateway.recent_metrics`; management commands `benchmark_ai`, `benchmark_documents`.

## Performance changes, by execution path

Ask/Doubt. The prompt used to be system + the whole module (trimmed at 14,000 chars) + eight history messages + question. It is now system + the 2–4 chunks that BM25 ranks highest for the question (the next chunk after the best hit is added when there is room, near-duplicates dropped, results in document order, total capped by the mode's source budget) + the last 4 messages (each capped at 400 chars) + question, with a 512-token output cap and an instruction to answer in 80–150 words. Short follow-ups ("why?") are retrieved together with the previous student turn so they land on the passage under discussion. Retrieval cost is sub-millisecond. An identical opening question on the same module version is served from a process-local cache for six hours; later turns are never cached. Page references from the chunks fill `source_reference` when the model leaves it empty.

Quiz. The source is a coverage sample: chunks taken evenly across the module inside the quiz budget, so questions span the whole module instead of the first 14,000 characters. Output cap 1400 tokens; explanations one sentence; source references under ten words; the prompt ends with "output only the JSON". The fallback generator and previous-question exclusion are untouched. Quiz results are not cached: faculty generate a new quiz precisely to get different questions (the previous five quizzes' questions are excluded), so a cache would return what they are trying to avoid.

Lesson. Coverage sample within the lesson budget, 1000-token cap, cached per module version as before. Pre-warm after publish now goes through one background worker with a queue (duplicates skipped), so two publishes never run two model loops at once and a live question waits for at most one lesson.

Remediation, evaluation, assignment, outline. Each has its own cap and sampling; every subjective answer in an attempt is graded against the same source block, so llama.cpp's prefix reuse applies across the batch.

Provider. Context window from the mode (8192 in fast; was 16384 everywhere), which also shrinks the KV cache allocation; per-call `max_tokens` and `top_p`; `AI_BATCH_THREADS` separate from `AI_THREADS`; token counts returned for telemetry. Lazy load, one model per process, one generation lock: unchanged.

Documents. The v4 font-metric path is kept; each stage is now timed and logged with the mode, page count and chunk count (`Processed document <id>: mode=fast_font pages=48 text_extract_ms=... structure_ms=... outline_ms=... chunk_ms=... total_ms=...`). Digital PDFs never touch OCR; Docling's layout model runs only when the font pass finds no structure; OCR only when the text layer is genuinely insufficient; converters are cached during one job and released before the outline call; one heavy job at a time per process (`_processing_lock`). No transaction is open during parsing, retrieval or generation; only the persist and the chunk delete/insert are atomic.

Telemetry. One line per AI request: `AI task=tutor purpose=ask model=... ok=True error=- attempts=1 latency_ms=... prompt_tokens=... generated_tokens=... tokens_per_sec=... prompt_chars=... source_chars=... retrieved_chunks=... max_tokens=512 num_ctx=8192 mode=fast`. Prompt text and student questions are never logged. The last 200 metrics are kept in memory; `/api/health/` shows the profile, request count, median latency and the last record under `ai.performance`.

## Before/after — what was measured

This sandbox has no GGUF model and no llama-cpp-python build (no network route to Hugging Face or the wheel index), so **no model latency was measured here**. The numbers below are measured prompt sizes and parser timings on this machine; the model-side gains follow from them arithmetically but must be confirmed with `python manage.py benchmark_ai` on the target laptop. I am not reporting a tutor or quiz latency improvement as fact.

Tutor prompt, 17,776-character module, question "How does deadlock detection work?":
- v4: 14,397 prompt chars (≈4,100 tokens), output cap 4,096 tokens.
- v5: 6,985 prompt chars (≈2,000 tokens) from 2 retrieved chunks, output cap 512 tokens.
- Retrieval: 0.63 ms per question over the module's 6 chunks.

Quiz prompt, same module: source 13,399 → 6,075 chars (≈3,830 → 1,740 tokens); output cap 4,096 → 1,400.

Prompt processing on a laptop CPU is roughly linear in prompt tokens and generation in output tokens, so halving the prompt and bounding the tutor answer at 512 tokens (a 120-word answer is ~180 tokens) is where the wall-clock time goes; the 8k context also halves the KV allocation at load.

Document parsing (`benchmark_documents`, this machine, engine auto): AI_ML_Beginner_Roadmap.pdf 3 pages, mode fast_font, total 209 ms (of which 192 ms is the first pypdfium2 import; 32 ms warm), 29 headings, 29 chunks; ai-data-scientist.pdf 158 ms; machine-learning.pdf 223 ms. No Docling or OCR initialised for any of them. In v3 these files would have run Docling's layout model (seconds per page after a ~10–20 s model load) and then an outline model call.

Tests: `python manage.py test` — 201 pass (16 new since v4: task config and env overrides, gateway budget passthrough, chunk splitting and versioning, retrieval relevance/order/fallback, coverage sampling, Ask sends chunks not the module, history bounded, first-question cache keyed by version, lesson task and compact source, single-worker queue, quiz source cap and budget, processing creates chunks and edits rebuild them). Existing auth, refresh, logout, document lifecycle, quiz, lesson, analytics and production-settings tests all still pass.

## How to get the real before/after on the target machine

```
AI_PERFORMANCE_MODE=quality AI_MAX_SOURCE_CHARS=14000 python manage.py benchmark_ai --repeat 3   # closest to v4 budgets
AI_PERFORMANCE_MODE=fast python manage.py benchmark_ai --repeat 3                                # v5 defaults
python manage.py benchmark_documents /path/to/a/real/textbook.pdf
python manage.py benchmark_documents --engine docling /path/to/a/real/textbook.pdf               # the v3 path, for comparison
```

`benchmark_ai` uses fixed prompts at temperature 0 and reports load time, median latency, prompt/generated tokens and tokens/second per task; the second run's tutor task also shows prefix reuse if the same module block is used.

## Known limitations

- The tutor targets of 2–6 s and quiz 10–25 s in the spec assume a reasonable desktop CPU. A 1.7B model on a 4-core laptop generates roughly 10–20 tokens/s; a 150-word answer is ~15 s of generation plus ~2,000 prompt tokens of processing. Fast mode makes both bounded and predictable; it does not make a slow CPU fast. GPU offload (`AI_GPU_LAYERS=-1` with a CUDA/Metal/Vulkan wheel) is the lever beyond that.
- Retrieval is lexical (BM25). A question phrased in words the book never uses falls back to the module's opening chunks rather than to a semantic match. An offline embedding model could be added behind the same `retrieve()` interface later; nothing else would change.
- The Ask cache is process-local (`LocMemCache`); with more than one worker each has its own. Swap `CACHES` for Redis without code changes if that matters.
- Chunk text is stored again in the database (plus a small term-frequency JSON); for a 300-page book that is a few megabytes.
- `prompt_tokens` counts the whole prompt even when llama.cpp skipped a cached prefix; the latency line, not the token line, shows reuse.

## Recommended deployment settings (single CPU machine, 8–16 GB)

```
AI_PROVIDER=llamacpp
AI_PERFORMANCE_MODE=fast
AI_THREADS=0            # physical cores
AI_BATCH_THREADS=0      # all logical cores
AI_FLASH_ATTN=true
AI_PROMPT_CACHE_MB=0
AI_GPU_LAYERS=0         # -1 on a machine with a GPU build of llama-cpp-python
PDF_LAYOUT_ENGINE=auto
OUTLINE_MODE=auto
LESSON_PREWARM=true
gunicorn --workers 1 --threads 8 --timeout 300
```

Memory: one worker ≈ 1.3 GB model + ~0.5 GB KV at 8k context + Docling/OCR only while a document is being parsed (released before generation). A 16 GB desktop can run `balanced`; `quality` and `--workers 2` want 32 GB or a GPU.
