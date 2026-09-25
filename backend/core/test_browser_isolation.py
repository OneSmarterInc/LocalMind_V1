from django.test import SimpleTestCase, RequestFactory
from django.http import HttpResponse
from core.isolation import BrowserIsolationMiddleware

class BrowserIsolationTests(SimpleTestCase):
    def test_headers_preserve_response_for_app_and_worker(self):
        for path in ['/student/private-library', '/private-assets/wllama/esm/wasm/wllama.wasm', '/sw.js']:
            response=HttpResponse(b'content')
            response['Cache-Control']='no-cache'
            result=BrowserIsolationMiddleware(lambda request:response)(RequestFactory().get(path))
            self.assertEqual(result['Cross-Origin-Opener-Policy'],'same-origin')
            self.assertEqual(result['Cross-Origin-Embedder-Policy'],'require-corp')
            self.assertEqual(result['Cache-Control'],'no-cache')
            self.assertEqual(result.content,b'content')

    def test_csp_is_report_only_and_limited_to_html(self):
        html = HttpResponse(b'<!doctype html>', content_type='text/html; charset=utf-8')
        result = BrowserIsolationMiddleware(lambda request: html)(RequestFactory().get('/student/private-library'))
        policy = result['Content-Security-Policy-Report-Only']
        self.assertNotIn('Content-Security-Policy', [k for k in result.headers if k == 'Content-Security-Policy'])
        for needed in ("'wasm-unsafe-eval'", 'worker-src', 'blob:', "frame-ancestors 'none'"):
            self.assertIn(needed, policy)
        wasm = HttpResponse(b'\0asm', content_type='application/wasm')
        result = BrowserIsolationMiddleware(lambda request: wasm)(RequestFactory().get('/private-assets/wllama/esm/wasm/wllama.wasm'))
        self.assertNotIn('Content-Security-Policy-Report-Only', result)
