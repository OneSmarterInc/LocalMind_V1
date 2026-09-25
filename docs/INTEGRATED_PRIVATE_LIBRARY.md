# Integrated private study and scanned books

This is part of the existing LocalMind application. Admin/faculty book sharing,
Student Private library and Offline AI replace the old publishing screens in the
normal navigation. Private learning does not require blocks, teaching aids,
approval of practice questions or publisher signing keys.

## User flow

1. Admin opens **Books for private study**, chooses a book and its audience, then
   uploads it. Faculty can share with their assigned subjects. Published course
   originals are also offered to enrolled students.
2. Student opens **Private library** and either selects **Add to my library**
   under **From my institution**, or **Upload my book** for a local file.
3. In **Offline AI**, download Qwen3 1.7B (Q4_K_M, approximately 1.11 GB) or import a compatible GGUF.
   For the browser, also select **Check and save offline app files**.
4. Disconnect and reopen the same installed application/browser profile. Read any
   private module, generate or regenerate lessons/quizzes, check MCQs, and ask doubts.
   All private records stay on that device. No private progression locks apply.
5. Normal course doubts use the same installed model when the server is unavailable,
   provided the authorized module was downloaded. Known access denials cannot be
   bypassed through the fallback. Official course submissions still use the institution server.

## Scans, tables and diagrams

- **PDF:** Every page is rendered and retained as a local PNG, with its page number.
  Pages without useful selectable text, and pages containing raster images, also
  undergo English OCR. The OCR worker, WASM and language data are bundled with the
  application; no cloud OCR service or OCR API key is used.
- **Mixed PDFs:** Selectable text remains intact. Additional recognized lines from
  the image are appended, with provenance. OCR is not run only on the first page.
- **Reading and lessons:** Original pages appear beneath extracted text and beneath
  the generated lesson. **Enlarge page** opens the stored image for scrolling at
  its retained resolution. Images come from the selected module, never from AI URLs.
- **DOCX:** Text and tables are extracted, and supported embedded PNG/JPEG/GIF/WebP
  images are retained and OCRed. For exact Word page layout, merged-cell geometry,
  charts, SmartArt or vector drawings, import a PDF export. The importer explains
  this limitation rather than claiming those structures were reproduced exactly.
- **TXT/Markdown:** Local text import remains supported.
- OCR preserves recognized text for the text tutor; it does not provide visual
  reasoning. A diagram's appearance is preserved, but its unlabeled meaning cannot
  be inferred by the text-only starter model. OCR can misread values, formulas,
  handwriting and reading order. Compare with the original image.
- Image-only/blank pages remain viewable even when OCR returns no text. They are
  not given invented source text or fake generated lessons.

Limits: 35 MB input, 2 million extracted characters, 1,500 PDF pages and 48 MB of
encoded retained images per import. Each page is rendered up to 2.5x, bounded to
2,400 pixels on its longest side. Import large books in chapters when a limit is
reached. English is the bundled recognition language; other OCR languages are not
included in this release. Font rendering and scan quality can affect fidelity.

## Storage and updates

The default Offline AI download is Qwen3 1.7B Q4_K_M from
`unsloth/Qwen3-1.7B-GGUF`, pinned to a publisher revision with exact size and
SHA-256 verification on web and native. Devices with the earlier 0.6B model keep
using it until the user chooses **Download replacement model**. The existing
model is replaced only after a complete, verified download; books, lessons,
quizzes and study history are retained. Updating the app alone does not download
or replace a model. The download size is not the model's total runtime memory use.

Where the model file lives: in a browser, the default is the browser's private
file storage (on this computer's disk, inside the browser profile, not visible
in File Explorer, deleted if this site's data is cleared). In Chrome or Edge on a
computer, **Offline AI → Where the model is stored → Save model to a folder on
this computer** copies the model into a folder you choose, verifies its size and
SHA-256, and removes the browser copy only after the copy succeeds. The browser
may ask again for folder access after a restart; **Allow folder access** restores
it. **Use browser storage instead** moves it back. Other browsers keep the default.
The Android/iOS app stores the model in the app's documents folder.

Book metadata and module text are stored separately from page images so listing a
library does not load all its bitmaps. Assets are scoped by account, institution,
book and import instance. A failed/cancelled import cannot delete another import's
images. Removing a book removes its private work and images.

Reimporting an old, pre-OCR book creates a **new extraction** while retaining the
old book and its saved lessons and practice history. Regeneration saves a new
version only after validation. Failed generation retains earlier saved versions. New starter-model lessons are bounded to a short introduction, one explanatory section and one takeaway so generation fits the device budget.

Do not clear browser/app storage if you want to keep private records. There is no
automatic upload or cross-device backup. Model files are shared by local study and
course-doubt inference, while books and history are separated by account.

## Apply the update on a local checkout

Use the `feature/integrated-private-library` branch. Commit or otherwise preserve
any local code edits before pulling.

```powershell
git pull --ff-only origin feature/integrated-private-library
cd frontend
npm ci
npm run export:web
cd ../backend
python manage.py migrate
cd ..
.\start.bat
```

Use the existing activated Python environment. No cloud AI key is needed. The
migration command applies any earlier private-library migration not yet installed;
this OCR change adds no database migration. In a browser, open **Offline AI** and
save the new offline application files before disconnecting. Reimport older books
to obtain their new OCR and visuals.

Windows/macOS use the integrated browser application on HTTPS or localhost with
supported browser device storage. Android/iOS require an installed native release,
not Expo Go. Native JavaScript exports are not APK/IPA builds. Physical-device
installation, cold start, latency and memory testing remain platform acceptance work.

## Verification commands

```sh
cd frontend
npm ci
npm run typecheck
npm run lint
npm run test:private
npm run export:web
npm run test:private:web
LM_E2E_REAL_MODEL=1 npm run test:private:web
```

The normal browser suite uses a real disposable Django database and actual PDF/OCR
engines, with controlled text-model responses. It tests sharing, private imports,
regeneration, marking, account isolation, offline restart, course-doubt fallback,
access denial, source-image persistence, native parser HTML/CSP and cancellation.

The separate real-model suite downloads the pinned GGUF and performs actual local
inference after disconnecting. In a restricted development environment, set
`LM_E2E_MODEL_FILE` to an independently downloaded and checksum-verified GGUF to
exercise the model-import path. This does not count as browser-download verification.
Stage timings, failure details and actual host/browser metadata are attached under
`frontend/test-results/runs/`, including when a generation fails. Supplied model
files include their SHA-256. See `docs/DEVICE_ACCEPTANCE.md` for Windows commands.
`LM_BROWSER_PROXY` optionally configures only the browser test proxy.

GitHub workflows cover the full Django suite, migration drift, frontend checks,
web build, contracts, browser flows, actual inference and Android/iOS JavaScript
exports. Never treat an older green workflow as evidence for newer application code.


### September 14: private learning corrections

Save and leave now waits for the running local AI operation and its storage write; failed operations keep the page open with an error. A completed task no longer triggers a second unsaved-work prompt.

New PDF imports group positioned text into lines and retain numeric sub/superscripts where geometry identifies them. Reimport an older book to create a new extraction copy while preserving its existing lessons, quizzes and history. This is not a guarantee of exact mathematical OCR or multi-column reading order.

Lessons process consecutive source passages and save a complete version only when all passages finish. Each call remains bounded for the small local model. This increases total generation time with module length; it prevents the old single-paragraph cap but does not certify educational completeness. Private doubts retrieve bounded passages across the same stored book, tolerate small spelling mistakes, and constrain supporting quotations to those passages.

Embedded PDF raster illustrations are cropped from their original rendered positions with a small margin. Full pages are collapsed behind View original page and remain available for checking formulas, tables and context. Full-page scans and vector drawings are not reliably separable diagrams; use the original page where automatic cropping is unavailable. Crops are original pixels, not AI redrawings.


### Background generation

Private lessons, quizzes and doubts are application-owned jobs. Navigation no longer cancels them or opens a Save and leave prompt. Two jobs may be active while further jobs wait; the installed model serves individual inference calls in FIFO order, so lesson parts and quiz questions can interleave without loading duplicate models. Reading, checking saved MCQs, book imports and navigation remain available. One job per generation type/module is accepted at a time to prevent accidental duplicates.

Generation jobs has its own student navigation entry and lists progress, failures and per-job cancellation. Sign-out/account changes cancel that session's outstanding jobs. Removing a book cancels and drains its jobs before deleting records. Completed results remain device-local and update their screens automatically. Jobs survive in-app navigation, not browser reload, app termination or guaranteed operating-system background suspension. Keep the app open while work is pending; no partially generated lesson or quiz is marked complete.

## Automatic teaching copies (admin, faculty and student)

Every signed-in role now starts an automatic content refresh on startup, every
minute, on reconnection and when returning to the app. Student content continues
using the authorized student bundle. Admin/faculty copies include teaching
subjects, book details and outlines, module sources and lessons, revisioned local
authoring snapshots, quizzes and attempts, and teaching summaries. Each response
uses the existing authenticated, permission-filtered endpoint. Full paginated
lists and supported subject/status filters are available offline too.

Offline AI → **Content on this device** shows completion and the last successful
save; **Refresh saved content** retries immediately. A failed staff refresh does
not replace the previous complete copy. Successful refreshes remove teaching
records no longer present in the authorized copy. Account changes and logout
retain the existing separation/clear behavior. Private authoring drafts are in a
separate store and are not overwritten by a teaching-content refresh. Explicit
source-conflict recovery must still fetch a fresh server revision.

For an existing installation, pull and rebuild the web client, start LocalMind,
and leave the account connected until **Your content copy is saved on this
device** appears. The local model and app assets must also be installed once.
After that, previously unvisited saved teaching pages open offline and the
existing device generation flow can create lessons and quiz drafts from saved
sources. Institution publishing and central updates still require reaching the
LocalMind server; generated work stays local until synchronization succeeds.

Losing internet does not inherently disconnect a running server at 127.0.0.1.
The client continues trying the actual LocalMind server, independent of the
browser's internet indicator, then falls back to the account's saved content.
Stopping the local server or blocking requests uses the saved copy. Content that
has never reached a device cannot be reconstructed by disconnecting it.

Validation: browser regressions cover an unseen admin/faculty quiz page and
reload while disconnected, generation from an unvisited source after disconnect,
persistence of generated lessons/quizzes across reload, interrupted refresh
retention, student offline reading/quiz events, and account separation. These
workflow tests use disposable Django data and a deterministic model adapter;
they do not measure Qwen generation quality or laptop speed.

## Quiz generation and catalog

Quiz generation now retries up to four times per missing question, rotating
source passages and the fact to focus on. Accepted questions are checkpointed.
Duplicate comparisons ignore case and punctuation and apply within the current
quiz, including earlier parts of a multi-module draft. Reusing a valid question
from an older quiz version no longer makes a new generation fail. Exact-source
quote checks, answer validation and the requirement to finish the requested count
remain in place. If retries are exhausted, the message reports saved progress;
generating again resumes the missing questions.

The teaching and student quiz lists provide a book filter scoped to the selected
subject. Multi-book quizzes appear under each associated book. Both lists show
newest quizzes first; local quiz drafts now have creation timestamps and recover
older draft timestamps from their existing local source-book records. Private
quiz versions were already listed newest first; the current selection is retained
so generating another version does not interrupt answering the current one.

Validation covers forced duplicate output, saved-progress recovery, multi-module
generation, book filtering online/offline for all roles, and newest-first local
draft ordering across reload. Browser inference is a deterministic test adapter;
these tests do not promise that every real-model request will succeed.
