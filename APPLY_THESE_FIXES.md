# LocalMind connectivity and page-load fixes

Four files. Copy each over the same path in your repo, then rebuild and restart.

## Files

| File in this zip | Copy to |
|---|---|
| `frontend/src/api/client.ts` | `frontend\src\api\client.ts` |
| `frontend/src/offline/connectivity.ts` | `frontend\src\offline\connectivity.ts` |
| `backend/config/settings.py` | `backend\config\settings.py` |
| `run_localmind.py` | `run_localmind.py` (repo root) |

Each is the current branch file with one change applied. Nothing else was touched.

## What changed and why

1. **client.ts** — GET timeout raised from 15s to 45s. An aborted GET calls
   `reportOffline()`, so any request slower than 15 seconds showed the offline
   banner even though the server was fine. A sync burst on a single-laptop
   server crosses 15 seconds routinely.

2. **connectivity.ts** — offline ping interval lowered from 20s to 5s. Once
   offline, this is how fast the app notices the server is back. `/api/health/`
   is cached server-side for `AI_HEALTH_CACHE_SECONDS` (30), so the extra pings
   are nearly free.

3. **settings.py** — added `django.middleware.gzip.GZipMiddleware` directly
   after `SecurityMiddleware`. WhiteNoise only compresses collected static
   files; the built web client is served by `core.webapp` as a plain
   `FileResponse`, so the 2.35 MB entry chunk was crossing the tunnel
   uncompressed. Expect roughly 600 KB after gzip.

4. **run_localmind.py** — default `--threads` raised from 8 to 32. These
   threads serve JSON and SQLite reads, not inference, so they are I/O-bound
   and cheap. This is what removes the `waitress.queue: Task queue depth`
   warnings.

## Apply

```powershell
$LM = "C:\Users\Anshuman\OneDrive\Desktop\Final_Localmind\LocalMind_V1"

# copy the four files over, then:
cd $LM\frontend
npm run typecheck
npm run export:web

cd $LM
& "$LM\backend\.venv\Scripts\python.exe" run_localmind.py --host 0.0.0.0 --port 8000 --no-browser
```

`--host 0.0.0.0` is now also the built-in default, so the flag is optional.

## Verify

Gzip is working when this shows `Content-Encoding: gzip`:

```powershell
curl.exe -s -I -H "Accept-Encoding: gzip" https://localmind.taild0af72.ts.net/_expo/static/js/web/entry-66e803f4691e9da37767d1e85eaae827.js
```

Replace the filename with whatever `npm run export:web` prints after you rebuild.

Testers must hard-refresh (Ctrl+Shift+R) once, or the service worker keeps
serving the old cached shell.

## Not fixed here

The first visit still downloads about 4 MB of icon fonts, and Offline AI still
pulls 1.11 GB from huggingface.co per browser. Neither is a bug; both are
first-visit costs that the service worker removes on later visits.
