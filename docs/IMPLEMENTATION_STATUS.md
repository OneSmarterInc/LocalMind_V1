# Requirements implementation status

**Current integrated flow:** see [Integrated private study and scanned books](INTEGRATED_PRIVATE_LIBRARY.md).
The sections below describe the earlier signed-package foundation and its historical checks,
not the replacement private-library UI or acceptance of the latest OCR changes.

This branch adds source implementations for the private-study authoring/package/runtime
flow. It is not a production-completion claim. The earlier classroom application remains
separate, with its authentication and grade records unchanged.

## Implemented in source

- Stable typed content blocks with immutable revisions and explicit source acceptance.
- Reviewable raster figures, PDF/DOCX candidate extraction, captions and textual explanations.
- Referenced MCQ and short-answer practice banks, explicit upstream model configuration,
  model review proposals and mandatory human approval before package publication.
- Bounded, signed, immutable content packages; device signature and asset verification;
  explicit installation and version switching rather than silent source replacement.
- A separate native student runtime with SQLite, embedded llama.cpp, bounded source-based
  Q&A and short-answer rubric feedback. It does not collect course grades or synchronize
  classroom attempts. Model files and publisher keys are not bundled with the source.
- Five enumerated teaching moves with required-asset checks; coarse private learner state.
- Off-by-default, opt-in, flags-only observations and aggregate policy proposals that require
  human review. Aggregate thresholds count events, not unique students or causal effects.
- Persistent document-processing and written-answer-evaluation jobs, leases, retries,
  stale-worker protection, job status, and automatic-quiz capacity checks.
- Targeted classroom UI fixes for draft restoration, actual discard, storage failures,
  save-and-leave behavior, grading validation and new-quiz-version metadata.

Increment 1 integrity changes and its regression-test corrections are included. Historical
classroom pass thresholds are not changed. Published study packages contain no student records.

## Executed integration verification

The complete integration workflow passed for application-code commit
`11de79aa11966e09b0544127a8edb21cd7453405` on 13 September 2026:

https://github.com/OneSmarterInc/LocalMind_V1/actions/runs/34748544517

The successful run checked:

- Committed study/jobs migrations and Django migration drift.
- The full Django test suite, not only syntax parsing.
- Clean classroom dependency installation, full TypeScript checking, lint and production web export.
- Clean locked private-runtime dependency installation and full TypeScript checking.
- Content-integrity, package-signature, prompt-boundary and draft-persistence tests.
- No tracked-source rewrites during checks.

The workflow uses Bash pipefail and an explicit final outcome gate, so errors cannot be
hidden by piping logs through tee. Logs are attached to the workflow as a short-retention
artifact. Earlier integration failures were corrected; do not use an earlier run as the
acceptance result. This documentation update does not change the tested application code.

Tests use controlled model responses and do not load a GGUF or the Docling model runtimes.
They validate integration contracts and failure handling, not a real model's teaching quality
or real PDF-layout extraction accuracy. Native dependency installation and typechecking
are not substitutes for building an Android/iOS binary.

## Remaining acceptance and development work

- Actual target-phone measurements, native Android/iOS builds and device testing.
- Real-model response quality, grounding, memory headroom and latency validation.
- Desktop/mobile visual and end-to-end acceptance of the complete UI.
- Real-course question-bank and teaching-aid authoring, review and sign-off.
- Deployment privacy/logging/retention review and iOS backup-exclusion verification.
- Legacy pre-user database import, when real historical records need preserving.
- Complete annotations for the pre-existing classroom OpenAPI endpoints.
- Representative figure/table extraction and display coverage, including complex documents.
- Final device model selection, CPU/context budgets and package specification after the phone
  experiment required by the architecture guidelines. The present schema is provisional.

Use docs/OFFLINE_STUDY.md and student-runtime/README.md for setup. Keep signing private keys
outside the repository. Observation collection should stay disabled until the deployment's
privacy and consent behavior has been reviewed. No production deployment or database
migration on the user's machine has been performed by this change.
