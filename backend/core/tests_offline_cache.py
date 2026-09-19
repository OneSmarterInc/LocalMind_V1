from django.test import SimpleTestCase, RequestFactory
from django.http import HttpResponse
from .offline_cache import OfflineRevalidationMiddleware

class OfflineRevalidationTests(SimpleTestCase):
    def test_conditional_download_still_executes_view_and_handles_gzip_etag(self):
        calls = []
        def view(request):
            calls.append(request)
            return HttpResponse('authorized content')
        middleware = OfflineRevalidationMiddleware(view)
        factory = RequestFactory()
        first = middleware(factory.get('/api/faculty/modules/', HTTP_X_LOCALMIND_SYNC='1'))
        second = middleware(factory.get('/api/faculty/modules/', HTTP_X_LOCALMIND_SYNC='1', HTTP_IF_NONE_MATCH='W/' + first['ETag']))
        self.assertEqual(second.status_code, 304)
        self.assertEqual(len(calls), 2)
        self.assertIn('Authorization', second['Vary'])
        changed = OfflineRevalidationMiddleware(lambda r: HttpResponse('changed'))
        self.assertEqual(changed(factory.get('/api/faculty/modules/', HTTP_X_LOCALMIND_SYNC='1', HTTP_IF_NONE_MATCH=first['ETag'])).status_code, 200)

    def test_errors_and_normal_requests_are_not_revalidated(self):
        factory = RequestFactory()
        for status in (401, 403, 404, 500):
            response = OfflineRevalidationMiddleware(lambda r: HttpResponse(status=status))(factory.get('/api/faculty/modules/', HTTP_X_LOCALMIND_SYNC='1'))
            self.assertEqual(response.status_code, status)
            self.assertNotIn('ETag', response)
        response = OfflineRevalidationMiddleware(lambda r: HttpResponse('ok'))(factory.get('/api/faculty/modules/'))
        self.assertNotIn('ETag', response)
