# Production readiness

What is finished, what the operator must decide, and what is deliberately out of scope for the first release.

## Verified in this repository

Backend: 145 unit tests on SQLite and PostgreSQL, plus `scripts/system_test.py`, a black-box run of about 190 checks over live HTTP covering every portal, endpoint, permission boundary, validation error, quiz versioning, document lifecycle, concurrent processing, pagination, rate limiting, token rotation and revocation, and the full AI-outage path (503 for open questions, cached lessons still served, fallbacks for uncached lessons, quizzes, assignments and remediation, subjective grading held pending and resolved by faculty override). Both run in CI, migrations in sync, `manage.py check --deploy` passes at error level, `python manage.py check_ai --smoke` proves the qwen3:1.7b path end to end. Frontend: `tsc --noEmit`, `eslint .` and a full `expo export --platform web` (every route bundles) clean. Every screen in the client calls a real endpoint; every backend endpoint the client needs exists. CI (`.github/workflows/ci.yml`) runs all of this on every push.

AI: one gateway, explicit 16k context window, output cap, one retry on bad JSON, health probe in `/api/health/` and on the admin dashboard, graceful fallbacks everywhere (source-hierarchy outlines, flagged placeholder quizzes that cannot be published, plain-text lessons, pending grading), and free-form tutor questions return a clear 503 rather than a hallucinated answer.

Operations: docker-compose stack or systemd units in `deploy/`, nginx config with upload and AI timeouts, maintenance job that requeues documents abandoned by a recycled worker and flushes expired tokens, media cleanup command, encrypted token storage on mobile, secret-key length enforced, proxy SSL header and optional HSTS.

## Before the first deploy (operator decisions)

1. Set `DJANGO_SECRET_KEY` (50+ random characters), `DJANGO_ALLOWED_HOSTS`, `DJANGO_CORS_ALLOWED_ORIGINS` (web client origin only; native apps send no Origin) and `INITIAL_USER_PASSWORD` to the department's policy.
2. Decide TLS. On a campus LAN plain http is common; if so leave `SECURE_HSTS_SECONDS=0`. If public, terminate TLS in nginx or Caddy, set `SECURE_HSTS_SECONDS=31536000`, and switch the `production` profile in `frontend/eas.json` to the https URL.
3. Size the model host: 8 GB RAM is enough for qwen3:1.7b on CPU (20–60 s per lesson or quiz); a small GPU brings that under 10 s. Set `OLLAMA_NUM_PARALLEL` if more than a handful of students use the tutor at once.
4. Edit the API URL placeholders in `frontend/eas.json` and `frontend/app.json` before building, then follow `frontend/MOBILE_BUILD.md`.
5. Schedule backups: `pg_dump` plus rsync of `MEDIA_ROOT`, together.

## Known limits (accepted for release, not bugs)

Document processing runs on a thread inside the gunicorn worker; the stale-reclaim path makes this safe, and a task queue is the upgrade if books are uploaded in bulk. There is no self-service "forgot password"; administrators reset passwords from the user screen, which is intentional for an installation that may have no outbound email. Subjective grading and remediation are only as good as a 1.7B model; faculty see every AI grade and can override it, and `OLLAMA_TUTOR_MODEL=qwen3:4b` is a drop-in upgrade on a stronger host. The client has no offline cache, push notifications or localisation.
