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
