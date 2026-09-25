import hashlib
import json
from datetime import timedelta
from uuid import uuid4
from django.utils import timezone
from django.test import TestCase
from django.core.files.uploadedfile import SimpleUploadedFile
from core.testing import client_for, make_faculty, make_student
from documents import tests_local_books as fixtures
from documents.models import Document, LocalBookUpload, LocalBookUploadChunk


class BookTransferTests(TestCase):
    setUp = fixtures.LocalBookTests.setUp
    def begin(self, data=None, client=None):
        value={'id':self.data['id'],'subject_id':str(self.subject.pk),'name':'book.pdf',
               'size':len(self.raw),'sha256':hashlib.sha256(self.raw).hexdigest()}
        value.update(data or {})
        return (client or self.client).post('/api/faculty/local-books/transfers/', value, format='json')
    def chunk(self, offset, raw, sha=None, client=None):
        return (client or self.client).post(f"/api/faculty/local-books/transfers/{self.data['id']}/", {
            'offset':str(offset), 'sha256':sha or hashlib.sha256(raw).hexdigest(),
            'chunk':SimpleUploadedFile('source.part',raw)}, format='multipart')
    def finish(self):
        return self.client.post(self.url, {'manifest':json.dumps(self.data)}, format='multipart')
    def test_resume_after_lost_ack_and_final_response(self):
        self.assertEqual(self.begin().data['received'],0)
        half=len(self.raw)//2
        first=self.chunk(0,self.raw[:half]);self.assertEqual(first.status_code,200,first.data)
        self.assertEqual(self.begin().data['received'],half)
        self.assertEqual(self.chunk(0,self.raw[:half]).data,first.data)
        self.assertEqual(self.finish().status_code,409)
        self.assertFalse(Document.objects.exists())
        self.assertEqual(self.chunk(half,self.raw[half:]).status_code,200)
        finished=self.finish();self.assertEqual(finished.status_code,200,finished.data)
        self.assertEqual(Document.objects.get().file.read(),self.raw)
        self.assertFalse(LocalBookUploadChunk.objects.exists())
        self.assertFalse(LocalBookUpload.objects.exists())
        self.assertTrue(self.begin().data['completed'])
        self.assertEqual(self.finish().data,finished.data)
        self.assertEqual(Document.objects.count(),1)
    def test_bad_hash_gaps_and_changed_replays_do_not_advance(self):
        self.begin()
        self.assertEqual(self.chunk(0,self.raw,sha='0'*64).status_code,400)
        self.assertEqual(self.chunk(1,self.raw).status_code,409)
        self.assertEqual(LocalBookUpload.objects.get().received,0)
        self.chunk(0,self.raw[:10])
        self.assertEqual(self.chunk(0,b'not same!!').status_code,409)
        self.assertEqual(self.begin({'name':'changed.pdf'}).status_code,409)
        self.assertEqual(LocalBookUpload.objects.get().received,10)
    def test_final_checksum_rejects_corrupted_source(self):
        self.begin();wrong=b'x'*len(self.raw);self.chunk(0,wrong)
        self.assertEqual(self.finish().status_code,400)
        self.assertFalse(Document.objects.exists())
    def test_permissions_on_resume_chunks_and_cleanup(self):
        self.begin()
        other=client_for(make_faculty())
        self.assertEqual(self.chunk(0,self.raw,client=other).status_code,404)
        self.assertEqual(self.begin(client=client_for(make_student())).status_code,403)
        from academics.models import FacultySubject
        FacultySubject.objects.filter(faculty=self.faculty).delete()
        self.assertEqual(self.begin().status_code,403)
        self.assertEqual(self.chunk(0,self.raw).status_code,403)
        self.assertEqual(self.finish().status_code,403)
        self.assertEqual(self.client.delete(f"/api/faculty/local-books/transfers/{self.data['id']}/").status_code,204)
        self.assertFalse(LocalBookUpload.objects.exists())
    def test_expiration_and_active_transfer_limit(self):
        for _ in range(4):self.assertEqual(self.begin({'id':str(uuid4())}).status_code,200)
        self.assertEqual(self.begin().status_code,409)
        LocalBookUpload.objects.update(updated_at=timezone.now()-timedelta(days=8))
        self.assertEqual(self.begin().status_code,200)
        self.assertEqual(LocalBookUpload.objects.count(),1)
    def test_size_and_chunk_bounds(self):
        for size in [-1,0,True,101*1024*1024]:
            self.assertEqual(self.begin({'size':size}).status_code,400)
        self.begin()
        self.assertEqual(self.chunk(0,b'x'*(1024*1024+1)).status_code,400)
        self.assertEqual(LocalBookUpload.objects.get().received,0)

    def test_cleanup_removes_only_expired_staging(self):
        self.begin();self.chunk(0,self.raw[:5])
        LocalBookUpload.objects.update(updated_at=timezone.now()-timedelta(days=8))
        # Create a live staging row without going through opportunistic cleanup.
        LocalBookUpload.objects.create(actor=self.faculty,subject=self.subject,operation_id=uuid4(),original_name='live.pdf',sha256='0'*64,size=20)
        from django.core.management import call_command
        from io import StringIO
        call_command('cleanup_book_transfers',stdout=StringIO())
        self.assertEqual(LocalBookUpload.objects.count(),1)
        self.assertFalse(LocalBookUploadChunk.objects.exists())
