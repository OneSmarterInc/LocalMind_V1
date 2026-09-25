"""Enable local WASM threads for the integrated web app, including offline caches.

Also sends a Content-Security-Policy in *report-only* mode on HTML pages. Report-only
never blocks anything: the browser logs what an enforced policy would have refused,
so the policy can be checked against the browser AI (wllama WASM + workers), the book
parser (blob module script and blob workers) and model downloads before anyone turns
enforcement on. Set CSP_REPORT_ONLY to an empty string to switch it off.
"""
from django.conf import settings

DEFAULT_CSP = "; ".join([
    "default-src 'self'",
    # wasm-unsafe-eval: wllama compiles WebAssembly. unsafe-eval: pdf.js font programs.
    # blob: the offline copy of the book parser and its OCR worker load from blob URLs.
    "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' blob:",
    "worker-src 'self' blob:",
    # https: the model is downloaded from its published host and redirected to a CDN.
    "connect-src 'self' blob: data: https:",
    "img-src 'self' blob: data:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
])


class BrowserIsolationMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
        self.csp = getattr(settings, "CSP_REPORT_ONLY", DEFAULT_CSP)

    def __call__(self, request):
        response = self.get_response(request)
        response['Cross-Origin-Opener-Policy'] = 'same-origin'
        response['Cross-Origin-Embedder-Policy'] = 'require-corp'
        if self.csp and response.get('Content-Type', '').startswith('text/html') \
                and 'Content-Security-Policy-Report-Only' not in response:
            response['Content-Security-Policy-Report-Only'] = self.csp
        return response
