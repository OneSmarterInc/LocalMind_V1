# LocalMind V1: private offline study — experimental implementation

## Two independent applications

`backend/` and `frontend/` retain the existing classroom authoring, administration,
assessment and reporting functions. `student-runtime/` is a separate native study aid.
It has no classroom login, grade export, attempt sync, or dependency on the classroom
server during studying. Do not describe its private feedback as evidence of participation
or achievement. This follows the September 5 architecture boundary without deleting
existing classroom records.

The package identifier `localmind-study.experimental.v1` is deliberately provisional.
Complete the `device-spike/` measurements on actual target phones before freezing a
production format, model size, context budget or supported-device list.

## Run the classroom/authoring tier

Back up existing database and media before applying migrations. Never replace a working
`.env`, model folder or database with a source archive. Use Python 3.11/3.12 for the
native dependencies; verify wheel availability before selecting a different version.

```powershell
cd backend
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-dev.txt
.\.venv\Scripts\python.exe manage.py migrate
cd ../frontend
npm ci
npm run typecheck
npm run lint
npm run export:web
cd ..
python run_localmind.py
```

The launcher starts the durable database-backed job consumer in the same process as
the embedded model. Database records survive process restarts. There is no Redis or
cloud API prerequisite. Keep one consumer per model-host initially. The deployed web
process alone does not start this consumer: run `python manage.py run_jobs` separately
and budget RAM for that process's model. `--once` runs one claimable job.

`DURABLE_JOBS=true` queues document parsing and written classroom-answer evaluation.
MCQ classroom marking remains deterministic and immediate. Written answers are stored
before evaluation and show Pending rather than a made-up zero. Failed jobs retain
answers, use bounded retries, and expose an explicit faculty retry action. The new
study-generation, figure-extraction and policy-proposal actions also use this queue.

Lease fencing prevents an expired worker committing a stale result. Work can execute
more than once after a crash; consumers therefore use idempotent/fenced final writes.
This is not a claim of exactly-once model execution. Heavy parsing and inference still
need sufficient host RAM; a queue makes requests recoverable, not inference faster.

## Author a private-study package

Open a book in the faculty workspace and choose **Private study package**. Access is
limited to its assigned faculty or administrators. Student accounts cannot author.

1. Import the module text into bounded content blocks. Unchanged text retains block IDs;
   changed imports retire the old block and invalidate references instead of fuzzy matching.
2. Edit prose, table, figure, worked-example and callout blocks. Explicit edits create
   immutable revisions. Retired blocks remain available to published snapshots.
3. Extract PDF/DOCX figure candidates or upload PNG/JPEG. PDF detection requires locally
   fetched Docling assets. Review each figure against the original, place it in a block,
   and write its explanation and alternative text. Extraction is not guaranteed complete.
   Images are normalized to bounded PNG and metadata is stripped. Complex vector and
   unsupported artwork should be reviewed and supplied manually as a raster image.
4. Write MCQ or short-answer practice items, or request drafts from the configured
   upstream model. Add stored-block references and supporting source quotations. Every
   item must receive explicit human approval of its current content digest.
5. Add a simpler explanation, worked-example link, diagnostic item and prerequisite
   links where appropriate. Changes to their source revisions invalidate prior approval.
6. Review the complete bank and publish. There is no automatic publication of these
   private-study packages just because the model/monitor returned success.

When the classroom source changes, imported blocks can be refreshed. Authored blocks
are not overwritten automatically. Reconcile them explicitly, then confirm review of
the exact current source digest. Publication is blocked while that review is stale.

The publisher validates all current references, approved items and prerequisites,
rejects cycles, and embeds figure bytes, prompts, rubrics and the five-move policy.
Re-publishing creates a new version; old package bytes do not change.

## Configure the authoring model and signing key

Manual authoring works without a model. AI drafting/review requires an explicitly
configured upstream model. It never silently falls back to the classroom 1.7B model.
A model-name/path setting does not prove educational quality: select and evaluate an
adequate larger model using representative course questions and rubrics.

```dotenv
# Choose one locally hosted upstream model provider.
STUDY_AUTHOR_MODEL_PATH=/absolute/path/to/your/larger-instruct-model.gguf
# Alternative:
# STUDY_AUTHOR_OLLAMA_MODEL=your-reviewed-large-model-tag
# STUDY_AUTHOR_OLLAMA_URL=http://127.0.0.1:11434
STUDY_SIGNING_KEY_PATH=/outside/the/repository/publisher.pem
STUDY_SIGNING_KEY_ID=publisher-2026
STUDY_OBSERVATIONS_ENABLED=false
```

Generate the key once with `python manage.py study_signing_key /outside/project/publisher.pem --key-id publisher-2026`.
The command refuses overwrite and refuses a path inside the repository. Restrict the
private file with OS permissions, back it up securely, and never distribute/commit it.
Provision the printed **public** key and its fingerprint through a trusted channel.
A package cannot install its own signing key. Signatures establish authenticity, not
that its teaching content is correct.

Publishing is an explicit **public-content release**: signed package downloads are
unauthenticated by design and contain no classroom attempts or student records. Do not
publish restricted course material without distribution authority. Removing server
access cannot revoke content already installed on an offline device.

## Build and use the independent student app

```powershell
cd student-runtime
npm install
npm run typecheck
npm run test:core
npm run android
# On macOS with Xcode: npm run ios
```

This needs a native build with llama.rn; it does not run inside Expo Go. Do not run a
clean prebuild over unrelated hand-edited native projects. This directory is separate
from the classroom frontend. Native build/device acceptance is not implied by typecheck.

In Setup, enter the trusted publisher ID/public key and verify the displayed fingerprint
through the independent trusted channel. Import the signed JSON package. Select the
installed version explicitly. Import a compatible GGUF file into app storage and load
it. The model file is not included in Git, in packages or in policy updates.

Package import verifies the signature, structure, references, image hashes and limits
before an atomic database write. Installing does not activate an update. Re-entering
study re-verifies bytes; an open session stays pinned to its loaded package snapshot.

Q&A resolves the selected stored block and bounds the prompt. It refuses unsupported
or malformed model output rather than presenting it as an authoritative answer. Short
practice feedback compares against the stored rubric and returns covered/missing ideas,
not numerical course grades. MCQs use stored answers. The device never parses books
or generates a question bank. Quote checking cannot establish logical correctness of
every generated explanation; real-model/content quality evaluation is still required.

Help chooses only among available moves: re-teach, simplify, worked example,
diagnostic question or prerequisite. Missing authored aids cannot be invented by the
runtime. Coarse learner memory stays in local SQLite and can be reset.

## Optional flag-only observations and upstream review

Sharing is **off on the device and server by default**. Studying does not depend on it.
The chosen experimental payload is block-level flags, not verbatim questions/answers,
embeddings, user/device IDs, grades or the local learner record. The server rejects
unknown fields. Random per-event IDs support idempotent retry, not learner tracking.
Disabling sharing aborts the current client request and removes unsent events; it cannot
retract an already delivered event. Resetting local learner memory also clears the outbox.

Before enabling, review actual consent wording, server/proxy IP logging, retention,
deployment backups and privacy requirements. The Android app disables OS backup;
iOS backup exclusion still requires native/device verification before privacy sign-off.
The SQLite store is app-private, not an assertion of encrypted or forensic-proof storage.

An operator may set `EXPO_PUBLIC_STUDY_OBSERVATION_URL` to a trusted HTTPS endpoint and
`STUDY_OBSERVATIONS_ENABLED=true` on the server. No endpoint comes from a content package.
The app sends up to 50 queued events opportunistically; no attempt record is synced.
No names does not automatically mean no reidentification risk. Aggregate views suppress
small cells and count **events, not unique students**. They are descriptive, not causal
proof of teaching effectiveness. The larger upstream model may propose policy changes;
a human must accept them and publish a new package. Model weights are not updated.

## Validation and remaining work

Use `python scripts/check_offline_study.py` for executable pure contracts, real signature
fixtures, prompt constraints and draft persistence checks. Full Django and Expo checks
are separate. See the GitHub workflow and its actual status, not historical totals in
`validation/md-alignment-results.json`.

Not completed by source code alone: actual phone memory/latency measurements, real
model/content quality trials, full mobile/browser acceptance, final iOS backup policy,
complete figure coverage, and course-team preparation of teaching aids. An importer for
the original pre-user database is not included because no real legacy data mapping has
been supplied. Existing API schema warnings also need a separate documentation pass.
