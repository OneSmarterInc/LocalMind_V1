# Held results, remediation, Compose UI, sign-in hardening and CI (10 September 2026)

This pass fixes the issues found in the review of `Local_Mind_Integrated.zip` that would surface first in a classroom pilot, then the smaller deployment and disclosure items from the same review (section 6). Each fix has a regression test, and every number below was measured in this build rather than carried over from earlier notes.

## Verification

| Check | Before | After |
|---|---|---|
| Backend unit suite (`manage.py test`) | 282 of 287 (5 errors from undeclared test libraries) | 325 of 325 |
| Black-box system test (fake Ollama, CI settings) | 191 of 193 | 195 of 195 |
| `makemigrations --check` | clean | clean |
| Frontend `tsc --noEmit` | clean | clean |
| Frontend `eslint app src` | 0 errors, 2 warnings | 0 errors, the same 2 warnings |
| `expo export --platform web` | not run | builds |
| nginx in front of a live backend (`deploy/nginx.conf`) | `/` returned 404 | `/`, deep links and bundles return 200 |

A live run of the one-process server in the new default mode also confirmed the sign-in changes end to end. The bootstrap admin's one-time password worked and the old shared password was refused. A student created through the API signed in with their own password. Ten wrong guesses sent under ten different `X-Forwarded-For` values locked the account, and the audit log recorded the real client address rather than the forged ones.

## 1. Held quiz results no longer leak

Holding results used to hide the score only on the attempt screen. Three other routes still gave it away. The student analytics overview and subject view averaged held attempts into `average_percentage` and the pass count. The module page showed "needs review" and `best_quiz_percentage`, because progress was written at grading time. And `POST /student/quiz-attempts/{id}/remediation/` listed every wrong question with its explanation, which on a quiz with attempts left is the answer key.

Remediation now answers `403 RESULTS_NOT_RELEASED` until the result is visible. The student-facing analytics views pass `released_only=True`, which keeps submission counts but takes averages, pass counts and "evaluated" counts only from released results. Faculty and admins looking at the same student see everything, as before.

Progress is now written when the student may see the result. That happens at submit for immediate quizzes, when faculty release (the whole quiz or one attempt), or, for a scheduled release, on the student's next progress read after the time passes. Scheduled release still needs no scheduler. A new field, `AssessmentAttempt.outcome_recorded_at` (migration `assessments.0003`), records that the write happened. It also fixes an older bug where a faculty override on an already-graded attempt counted that attempt a second time in `quiz_attempts`. The migration marks every existing evaluated attempt as recorded, so upgrading counts nothing twice.

The query form of the visibility rule lives in `assessments.models.results_visible_q` and `AssignmentSubmission.visible_q`, next to the existing `results_visible` properties they mirror.

## 2. Remediation on a quiz that spans chapters

A quiz built from chosen modules in two chapters has neither `module` nor `chapter` set, and remediation assumed one of them, so it returned HTTP 500. It now uses `assessments.services.assessments.source_text_for`, the rule grading already used. That also means a same-chapter selection is remediated from the chosen modules rather than the whole chapter.

## 3. Docker Compose serves the web client

`deploy/nginx.conf` ended in `location / { return 404; }`, so Mode C (and Mode D, which copies the file) had a working API and no interface. Everything outside `/api/`, `/admin/` and `/static/` now goes to Django, which already serves the built client with `index.html` as the fallback for client-side routes. The `/admin/` block also forwards the client address now. SETUP_README's Mode D instructions say "all three occurrences" of `proxy_pass`.

## 4. Sign-in

**One-time passwords.** Every account used to start on the same `INITIAL_USER_PASSWORD`, so anyone who had been told it could claim a classmate's account before its owner did. The new default, `INITIAL_PASSWORD_MODE=unique`, gives each created account, each Excel import row and each admin reset its own random password. The format is three groups of four characters with look-alike characters removed, about 68 bits, checked against the password validators. The password is returned once in that response and never stored readably, logged or audited. `bootstrap_admin` prints the first admin's password once, and the launcher points to it. `shared` mode restores the old behaviour for anyone who wants it.

**Admin screens.** The admin screens show the password once in a new `OneTimeCredentials` card (`frontend/src/ui/OneTimeCredentials.tsx`). New user shows it and clears the form for the next person. Import lists every created account with Copy All and a CSV download, and guards against spreadsheet formula injection because names come from an uploaded sheet. Reset Password shows the replacement. The notices on those screens were reworded to say what now happens.

**Per-account lockout.** Ten failed sign-ins for one email within fifteen minutes now refuse that email with `429 TOO_MANY_ATTEMPTS`, even with the right password, until the window passes (`LOGIN_MAX_FAILURES`, `LOGIN_LOCKOUT_MINUTES`). A successful sign-in resets the count. Failures are counted from the audit log rather than a per-process cache, so the limit holds across gunicorn workers. The count is keyed by the email typed, so it reveals nothing about whether an account exists.

**Proxy trust.** DRF's login throttle keyed on `X-Forwarded-For` because `NUM_PROXIES` was unset, so a client could dodge the 20-per-minute limit by writing a new value into that header on every request. `core.utils.client_ip` had the same weakness for the audit log. A non-address value in that header would also have failed to save on PostgreSQL. A new `TRUSTED_PROXY_COUNT` sets both: `0` (default, standalone launcher) ignores the header, and `1` takes the address nginx appended. `deploy/docker-compose.yml` and `deploy/localmind.service` set `1`.

**Sessions after a password change.** Changing a password now revokes the account's other refresh tokens. The session that made the change receives a fresh pair, which the client already stores.

**Update, later the same day: the shared initial password is the default again.** At the product owner's request every account (created, imported or reset) starts on `INITIAL_USER_PASSWORD` once more, as before this pass, and the admin screens say so. One-time passwords remain available with `INITIAL_PASSWORD_MODE=unique`. Accounts created while one-time passwords were the default, whose passwords were never handed out, are put back on the initial password with `python manage.py reset_onboarding_passwords` (add `--dry-run` to list them first); it only touches accounts that have not chosen a password of their own. The per-account lockout, proxy trust and sign-out on password change are unchanged.

## 5. CI

CI strips `docling` to avoid PyTorch, which also removed `pypdfium2`, and `reportlab` was never listed, so five PDF parser tests errored. A new `backend/requirements-dev.txt` adds both, and the backend job installs it.

The system test had two lesson-caching failures, with two separate causes.

1. **Lesson pre-warming.** Publishing queues lessons for background generation, which raced "teach not cached on first call". The `LESSON_PREWARM` switch that the v5 notes documented now exists, and the system-test job sets it to `false`.
2. **Outline saves throwing away caches.** `replace_outline` bumped the content version on every save, even one that changed nothing, and that version keys every cached lesson, tutor answer and chunk set for the book. It now bumps only when chapter or module identity, order, titles or text actually changed.

Investigating the second cause turned up a quiet data-loss path. Text edited through `PATCH /faculty/modules/{id}/` stayed mapped to its source heading, so the next outline save refilled it from the parsed book and the edit vanished. The outline screen already works around this in the browser. The API now detaches an edited module from its heading too.

The system test had been resending an outline captured before a text edit, which reverted that edit. It now saves the current outline, and it gained two checks: an unchanged save keeps the version, and hand-edited text survives a save.

The duplicated `monitor_ai --purge` line is gone from the maintenance container and the systemd unit.

## 6. Deployment defaults and disclosure

**One gunicorn worker.** The Dockerfile and the systemd unit ran three workers with four threads. Every worker is a process with its own copy of the model, about 1.8 GB at the default context, so an 8 GB host could not hold them next to Docling. Each worker also has its own lesson pre-warm queue, AI monitor queue and tutor answer cache. Both now run one worker with eight threads. The Docker image reads `GUNICORN_WORKERS` and `GUNICORN_THREADS` for a larger host.

**Health check.** `GET /api/health/` was unauthenticated and, with `?full=1`, returned filesystem paths, model file names, provider URLs, error text and the monitor backlog to anyone on the network. From other machines it now returns the summary a load balancer or Docker `HEALTHCHECK` needs: `status`, `database`, and `ai.enabled`, `provider`, `reachable`, `ready`. Administrators with a bearer token, and requests from the server itself, still get everything. The loopback test uses the client address as `TRUSTED_PROXY_COUNT` defines it, so a forged `X-Forwarded-For: 127.0.0.1` does not qualify; the live check confirmed this. The admin dashboard already reads `/api/admin/ai/status/`, so nothing in the client changed.

**Live API docs.** `/api/schema/` and `/api/docs/` were public in production. They are now mounted only when `API_DOCS_ENABLED` is true, which defaults to `DJANGO_DEBUG`. Swagger UI loads its scripts from a CDN, so it never worked offline in any case, and `backend/openapi.yaml` is the committed copy.

**Legacy Word uploads.** The review suspected Docling could not read `.doc`. Checking the current release showed it can, but only by calling LibreOffice to convert the file, and older 2.x releases (which `docling>=2,<3` still allows) have no `.doc` support at all. Neither is part of the offline bundle, so a `.doc` was accepted at upload and then failed during processing. Upload now checks for both and, when either is missing, refuses with `LEGACY_WORD_UNSUPPORTED` and a message telling faculty to save as `.docx` or PDF. Where LibreOffice is installed, `.doc` still works. The `document_processing` row of the health report says which applies.

**Web client path check.** `core/webapp.py` confirmed a requested file was inside the web build with a string prefix test, which a sibling directory such as `dist-old` would pass. It now uses `Path.is_relative_to`.

**Repository contents.** `cloudflared.exe` (54 MB, referenced nowhere) and `db-backup/` (a SQLite WAL and SHM with no database file, holding audit rows) are removed, and `.gitignore` now excludes `*.exe`, `db-backup/` and SQLite side files at the root.

## Upgrading

Run `python manage.py migrate` (adds `assessments.0003`). Behind nginx or Caddy, set `TRUSTED_PROXY_COUNT=1` in `.env` if your unit file or compose file does not already. Rebuild the web client (`npm run export:web`) so the admin screens can show the new passwords. If you monitor `/api/health/?full=1` from another machine, point that monitor at `/api/admin/ai/status/` with an admin token, or at the plain summary. If a systemd unit was copied from an earlier release, change it to `--workers 1 --threads 8`.

## Not in this pass

1. **v5 performance features.** These were documented but never built: flash attention, batch threads, the prompt cache setting, the fast PDF path, request metrics and prompt-prefix reuse.
2. **`SERVE_MEDIA`.** The setting does nothing when `DJANGO_DEBUG` is false, because Django's `static()` helper returns no routes then. Nothing in the client fetches media, so this is harmless, but the setting and the launcher's `.env` line are misleading.
3. **Assignment remediation.** It was not reviewed for the held-results question because assignments have no remediation endpoint today, but any future one should check `results_visible` first.
