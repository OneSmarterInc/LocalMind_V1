# Reloading an administrator page no longer opens Django's admin site (11 September 2026)

## The problem

The LocalMind administrator portal lives at `/admin/...` in the web client (`/admin/users`, `/admin/monitoring`, `/admin/subject/<id>`). Moving between pages inside the app worked, because the browser never asked the server for those paths. Reloading one, or opening a bookmark or a link to it, did ask the server. Django had its own admin site registered at `/admin/`, ahead of the rule that hands every other path to the web client, so the server answered with Django's admin login instead of the app.

## The fix

**Django's own admin site moves to `/django-admin/`.** The path is set by `DJANGO_ADMIN_URL`.

- **Empty value:** `DJANGO_ADMIN_URL=` (empty) turns Django's admin site off.
- **Refused paths:** a value that would collide with the app (`admin`, `api`, `media`, `static`, `student`, `manage`, `login`, `_expo`, `assets`) stops the server at startup with a clear message.

**`/admin/...` is now a client-side route like `/student/...` and `/manage/...`.** The server returns the app, and the app opens the right page. `/api/`, `/media/`, `/static/` and the Django admin path still never fall through to the app.

**Docker Compose.** `deploy/nginx.conf` forwards `/django-admin/` instead of `/admin/`, so `/admin/...` reaches the web client there too.

**Who is affected.** Only people who used Django's admin site at `/admin/` directly (an operator tool, not the LocalMind portal). It is now at `/django-admin/`.

## Verification

| Check | Result |
|---|---|
| New tests | Reloading `/admin`, `/admin/`, `/admin/users`, `/admin/user/new` and `/admin/monitoring` loads the app; `/django-admin/` redirects to Django's admin login; an empty `DJANGO_ADMIN_URL` turns it off. Two of the three fail on the previous code. |
| Backend unit suite | 419 of 419 |
| Black-box system test | 213 of 213 |
| Live check (waitress, `DJANGO_DEBUG=false`, built web client) | `/admin/users`, `/admin/monitoring`, `/admin/`, `/student`, `/manage/books` return the app; `/django-admin/` returns 302 to its login; `/api/health/` returns 200; `/api/admin/subjects/` without a token returns 401 |
| `check --deploy --fail-level ERROR` | passes (warnings only: schema hints and the HTTPS settings that are off on a plain-http LAN) |

## On the laptop

1. Unzip.
2. Restart `run_localmind.py`. No migration and no web rebuild are needed, because the fix is on the server.
3. Optionally add `DJANGO_ADMIN_URL=django-admin/` to `backend\.env`. It is the default, so it can be left out.
