"""Conditional staff downloads. Views still authenticate and authorize every request."""
import hashlib
from django.http import HttpResponseNotModified
from django.utils.cache import patch_vary_headers
from django.utils.http import parse_etags

class OfflineRevalidationMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        allowed = request.path.startswith(("/api/faculty/", "/api/admin/subjects/", "/api/admin/analytics/", "/api/meta/choices/"))
        if (request.method != "GET" or request.headers.get("X-LocalMind-Sync") != "1"
                or not allowed or response.status_code != 200 or response.streaming):
            return response
        etag = '"' + hashlib.sha256(response.content).hexdigest() + '"'
        if etag in [value.removeprefix("W/") for value in parse_etags(request.headers.get("If-None-Match", ""))]:
            response = HttpResponseNotModified()
        response["ETag"] = etag
        response["Cache-Control"] = "private, no-cache"
        patch_vary_headers(response, ["Authorization", "X-LocalMind-Sync"])
        return response
