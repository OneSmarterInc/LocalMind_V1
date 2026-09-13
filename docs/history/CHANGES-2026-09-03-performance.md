# Performance changes, 3 September 2026

Three complaints drove this round: quiz generation was slow, asking doubts was slow, and parsing an uploaded book took a long time. Nothing below is a shortcut or a fixed value; each change removes work the pipeline was repeating, and every knob is an environment variable with a documented default (`docs/ENVIRONMENT.md`).

## Where the time went

On a laptop CPU with the 1.7B model, every tutor call was doing the same expensive thing: reading the module's source text (up to 14,000 characters, roughly 4,000 tokens) through the model before writing a single output token. That prompt-processing phase is typically 30 to 90 seconds and is paid again on every question, every quiz, every lesson. Generation of the answer itself is the second cost and is proportional to how much JSON the schema asks for.

For parsing, Docling's layout model (a PyTorch vision model) was run over a rendering of every page of every text PDF to find headings, which is seconds per page and minutes for a book, followed by a model call to outline the headings.

## AI calls

1. **One prompt scaffold for every feature** (`ai/prompts.py`). The tutor, quiz generator and remediation now send an identical system prompt and open their user prompt with the same `MODULE / SOURCE TEXT` block; the feature-specific task, the conversation history and the student's question come after the source. llama.cpp (and Ollama) keep the processed key/value state of the previous prompt and skip whatever prefix the next prompt shares with it, so the second and later calls on a module do not re-read the source. A student's second question on a module, or a quiz generated after a lesson on it, pays only for the new tokens. The instructions are unchanged in content; they moved from before the source to after it, which is also where a small model attends to them best.
2. **Lesson pre-warm on publish** (`tutor.services.prewarm_lessons`, `LESSON_PREWARM`). Lessons were already cached per module and document version, but the first student to open a module paid the full generation. Publishing a book now starts a background thread that generates each open module's lesson in order, through the same provider lock as live requests, so a live question waits for at most one lesson.
3. **llama.cpp load settings** (`ai/llamacpp.py`). Flash attention is on by default (`AI_FLASH_ATTN`, dropped automatically if the wheel rejects it); generation threads default to one per physical core instead of all logical cores but one, which is faster on hyper-threaded CPUs, while prompt processing keeps every core; an optional multi-prompt KV cache (`AI_PROMPT_CACHE_MB`, off by default because of RAM) extends prefix reuse across several modules. Each generation now logs prompt tokens, completion tokens and latency, so the effect of prefix reuse is visible in the log: a repeat call on the same module should show the same prompt token count at a fraction of the latency.

## Parsing

1. **Font-metric structure pass** (`documents/services/pdf_structure.py`, `PDF_LAYOUT_ENGINE=auto`). pypdfium2, already a Docling dependency, exposes the size and font name of every character. The pass reads them, takes the size that carries the most characters as the body size, treats distinct larger sizes as heading levels (largest first) and short bold lines at body size as the level below, merges wrapped titles, and demotes text that repeats on three or more pages (running headers). It emits the same Markdown-with-page-breaks the Docling path does, in well under a second for a whole book, and never loads a model. Docling's layout model now runs on a text PDF only when this pass finds no structure (`auto`), or when `PDF_LAYOUT_ENGINE=docling`. Scanned PDFs still go to full-page OCR as before. The three roadmap PDFs supplied with the request parse in 0.02 to 0.10 seconds; the Beginner Roadmap comes out as one chapter with six phase modules and their topics as sub-sections.
2. **Text before the first heading is kept** (`extract_sections_from_markdown`). A preface, abstract or chapter opening that came before the first heading belonged to no section and was silently dropped from every module. It is now a leading "Introduction" section at the shallowest level, and the outline treats it like any other chapter.
3. **Heading inference** (`infer_pdf_headings`, used when the font pass and Docling find nothing). Keyword headings now include Phase, Stage, Step, Week, Day and Level (the Beginner Roadmap is organised by phase). An all-caps line has to contain a real word, or be set off by a blank line above and a paragraph below, before it is promoted, so a row of acronyms in a diagram ("RNN GRU LSTM", "LOOCV") no longer becomes a section.
4. **Outline** (`OUTLINE_MODE=auto`). The model was asked to group the headings of every document, reading up to 600 of them through the 1.7B model for minutes at a time. It is now asked only when the parser found a single flat level, where grouping adds something; a document that already has chapter and section levels is outlined by the deterministic source hierarchy in milliseconds. `always` restores the old behaviour, `never` disables the call.

## Verification

`python manage.py test`: 185 tests pass (10 new: font-metric headings, uniform text yields none, running headers demoted, parser prefers the font pass, `auto` falls back to Docling, `fast` never runs Docling, preamble kept, outline auto mode, shared prompt prefix across features, thread-count sanity).

## What still costs time, and the knobs for it

The first call on a module after a process start (or after another module was used, with the prompt cache off) still reads the full source. `AI_MAX_SOURCE_CHARS` bounds that read; `OLLAMA_NUM_PREDICT` bounds the output; both are per-deployment choices, not code. Each gunicorn worker holds its own model copy and its own lock, so more workers do not add tutor throughput on one CPU (see `docs/OFFLINE.md`).
