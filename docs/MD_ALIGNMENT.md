# Markdown requirements alignment — increment 1

Basis: **LocalMind Code Review Memo.md** (1 September 2026), **LocalMind Agentic Architecture Guidelines.md** (5 September 2026), and the accompanying `localmind-integrity-fixes.diff`.

Source base: the application code in uploaded `Local_Mind_Integrated-new-ui (4).zip`, checked against GitHub `development` commit `ebf62851db532b5d32546ebbff2f47d2bf85e7c6`. The application source trees match; `frontend/package-lock.json` differs between that ZIP and GitHub. This patch does not change the lockfile. No repository branch, commit or pull request was created: the connected GitHub integration rejected branch creation with HTTP 403.

## Scope and the two product boundaries

The memo's multi-user recommendations and the later architecture guideline's private-device premise are different designs. This increment preserves the existing student/faculty/admin classroom system, including authentication and historical assessment data. It does not pretend those server-side grades satisfy the no-collected-grades private-study-aid requirement.

The separate `device-spike/` app begins the experiment that the architecture document explicitly requires first. It is not an approved student release or final package specification.

## Implemented in this increment

| Requirement | Implementation and boundary |
|---|---|
| PDF table structure | Enabled in Docling; model-download command now includes TableFormer; old installs receive a refresh-assets readiness message. Actual extraction quality is not benchmarked here. |
| Reading tables and lists | New source renderer preserves table rows/columns, nested list markers, headings, line breaks and code blocks; web tables have real table/header semantics. It does not inject HTML or fetch embedded remote resources. This display parser is NOT the future stable content-block schema. |
| Authoritative authored structure | New `Document.outline_strategy`, default `source`, and an explicit faculty upload choice. Source mode skips both AI regrouping and automatic title/fragment tidying. AI mode falls back when the proposed module ranges lose source passages or overlap. |
| Text before first heading | Preserved as an Introduction. Existing heading indices remain unchanged. A parser-only -1 anchor is stored as explicit source text rather than written into unsigned database heading fields. |
| Short chapter introductions and skipped heading levels | Introductions remain Overview modules even below 200 characters. Headings before a shallower heading are preserved, not dropped by a minimum-level filter. |
| Word numbering | Reads `numbering.xml`, abstract/instance definitions, style inheritance, starts, overrides, nesting and restart rules. Supports decimal, zero-padded decimal, alpha, Roman and bullets; unsupported schemes fail visibly rather than silently becoming unordered bullets. |
| Answer normalization | Shared bare/decorated A-D and unambiguous option-text normalization; no arbitrary first-letter guessing. Option labels and duplicate options are checked. |
| Requested question counts | Model generation fails if the requested full set is not available; no partial quiz is stored. Manual authoring remains available. More generation attempts may now end with a visible error instead of an incomplete quiz. |
| Empty-source edits | New empty modules and explicit empty-text edits are refused before modifying/deleting the outline. Existing referenced hidden modules can still be round-tripped without manufacturing source text. |
| Empty-source tutoring | A module whose database text is actually empty is refused, including stale records not yet marked `source_missing`. |
| Generation temperature | Quiz generation changed from 0.7 to 0.2. Existing model selection and stored pass thresholds were not changed. |
| Unnecessary lesson padding | One objective/one section is allowed. The fallback no longer splits a single paragraph just to manufacture a second section. |
| Actual-device experiment code | Separate Expo/SQLite/llama.cpp spike with bounded local-source tasks, synthetic cases, metrics, cancellation and an Android memory-capture script. Real phone measurements are NOT available yet. |

## Already present and preserved

Role permissions, faculty/subject scope, student-owned progress/attempts/conversations, server-resolved source material, source-heading references, transactional outline reconciliation, and removal of the fake fallback question generator. The original review's requirement about a consistent pass threshold is respected without changing the classroom's current 65% default or historical quiz thresholds.

## Not implemented in this increment

| Remaining requirement | Status |
|---|---|
| Persistent worker queue for parsing and written-answer evaluation | Pending; existing thread/recovery behavior and synchronous written grading remain. |
| Legacy database migration from the original anonymous application | Pending; no old records or ownership have been invented or migrated. |
| Stable typed authoring blocks with revisions and dependency references | Pending; the reading renderer must not be mistaken for that data model. |
| Full figure/diagram extraction, storage, author review and device display | Pending. |
| Large-model authoring/review tier for approved question banks | Pending; the current authoring model is unchanged. |
| Production signed content packages, trust keys, revision pinning and visible update flow | Pending; format must follow the device experiment. |
| Finished private on-device student application | Pending; only the isolated engineering spike is provided. |
| Five enumerated teaching moves with enforced preconditions | Pending. |
| Authored simpler explanations, worked examples, diagnostic items and prerequisite edges | Pending; course-team authoring is required alongside engineering. |
| Coarse private learner model that is never synchronized | Pending. |
| Optional anonymized state → move → outcome collection and privacy controls | Pending; no telemetry is added now. |
| Large-model review of aggregate observations and policy improvements in later packages | Pending. |
| Actual-phone performance/quality/memory acceptance | Not measured. |
| Remaining UI save/draft/navigation defects from the prior ZIP audit | Not part of this increment; this change does not approve the entire existing UI. |

## Validation

Run the dependency-free suite from the repository root:

```powershell
python scripts/check_md_alignment.py
```

It executes 40 Python content-integrity cases and 30 JavaScript source/prompt cases, with strict TypeScript compilation of the dependency-free modules. It also parses Python syntax. It does NOT claim a full React Native application typecheck or Django database run.

Additional Django integration tests are included in `backend/documents/tests_md_integration.py`. Existing policy-sensitive tests have been updated to expect explicit empty-source errors and reject incomplete question sets. Before accepting the code, run:

```powershell
cd backend
python manage.py migrate
python manage.py test
python manage.py spectacular --file openapi.yaml
cd ../frontend
npm run typecheck
npm run lint
npm run export:web
```

The static OpenAPI document's Document schema includes the new field. Regenerating the whole schema in a working Django environment remains an acceptance step, not an action claimed to have run here.

### Required manual checks

Check all three portals with the real backend. Upload a DOCX with preamble, short chapter introduction, numbered/nested procedures and a table; verify no text is lost and the source order is retained. Try a PDF with tables and a scanned PDF after installing the required Docling assets. Compare “Keep headings” with explicit AI mode. Attempt an empty module save and confirm the existing outline stays intact. Generate a complete quiz, an incomplete model response and an unavailable-model response. Verify lists/tables at desktop and phone widths. Complete the separate actual-phone spike before approving the architecture's device/package decisions.

## Compatibility notes

A single new Django migration adds the per-document outline choice. It does not reparse any existing book, rewrite historical questions or alter scores. New processing and explicit retries use the stored choice. No new dependency is added to the classroom frontend or backend by the content fixes. The isolated device spike has its own dependencies and requires a native build.

The table-downloader confirmation marker records a successful requested asset download. It is not a cryptographic guarantee, a full integrity scan, or a quality test of PDF extraction.
