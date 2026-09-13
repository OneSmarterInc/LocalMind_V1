"""Serve the built Expo web client from Django.

Used by the standalone/offline launcher so the whole platform is one
process: no nginx, no separate static host. Files under WEB_DIST are served
directly (with long cache headers for the hashed bundles); anything else
returns index.html so expo-router's client-side routes work on reload.
"""
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse
from django.views.decorators.cache import cache_control
from django.views.decorators.csrf import csrf_exempt

IMMUTABLE_PREFIXES = ("_expo/", "assets/")


def _resolve(path: str) -> Path | None:
    root: Path = settings.WEB_DIST
    candidate = (root / path).resolve() if path else None
    # is_relative_to, not a string prefix: "/srv/web-old/x" starts with
    # "/srv/web" but is outside it.
    if candidate and candidate.is_file() and candidate.is_relative_to(root.resolve()):
        return candidate
    return None


@csrf_exempt
def webapp(request, path=""):
    # Server-side paths never fall through to the app. /admin/ is not one of
    # them: it is the administrator portal, a client-side route.
    reserved = ("api/", "media/", "static/") + ((settings.DJANGO_ADMIN_URL,) if settings.DJANGO_ADMIN_URL else ())
    if path.startswith(reserved):
        raise Http404
    target = _resolve(path)
    if target is not None:
        response = FileResponse(open(target, "rb"))
        if path.startswith(IMMUTABLE_PREFIXES):
            response["Cache-Control"] = "public, max-age=31536000, immutable"
        return response
    index = settings.WEB_DIST / "index.html"
    if not index.exists():
        return HttpResponse("Web client not built. Run `npm run export:web` in frontend/.", status=503, content_type="text/plain")
    return _index(request, index)


@cache_control(no_cache=True, no_store=True)
def _index(request, index: Path):
    return HttpResponse(index.read_bytes(), content_type="text/html; charset=utf-8")
