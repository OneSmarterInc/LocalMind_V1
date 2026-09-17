import hashlib
import json
import tempfile
from uuid import uuid4
from unittest.mock import patch
from django.test import TestCase, override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from core.testing import make_faculty, make_student, make_subject, assign, client_for
from documents.models import Document, LocalAuthoringReceipt
from learning.models import Module

class LocalBookTests(TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.settings = override_settings(MEDIA_ROOT=self.folder.name)
        self.settings.enable()
        self.addCleanup(self.settings.disable)
        self.faculty = make_faculty()
        self.subject = make_subject()
        assign(self.faculty, self.subject)
        self.client = client_for(self.faculty)
        self.url = '/api/faculty/local-books/'
        self.raw = b'%PDF-1.7\nOffline source fixture\n%%EOF'
        self.data = {'id': str(uuid4()), 'subject_id': str(self.subject.pk),
                     'title': 'Local book', 'reviewed': True,
                     'sha256': hashlib.sha256(self.raw).hexdigest(),
                     'sections': [{'id': 's1', 'title': 'First module', 'source': 'Processes are programs in execution.', 'page': 1},
                                  {'id': 's2', 'title': 'Second module', 'source': 'A thread is a unit of execution.', 'page': 2}]}
    def post(self, data=None, client=None, raw=None):
        return (client or self.client).post(self.url, {'manifest': json.dumps(self.data if data is None else data),
            'file': SimpleUploadedFile('book.pdf', self.raw if raw is None else raw, 'application/pdf')}, format='multipart')
    def test_review_draft_no_server_generation_and_exact_replay(self):
        with patch('documents.services.documents._queue_lessons_after_commit', side_effect=AssertionError('No server jobs')):
            first = self.post()
            self.assertEqual(first.status_code, 200, first.data)
            self.assertEqual(self.post().data, first.data)
        doc = Document.objects.get()
        self.assertEqual(doc.status, 'under_review')
        self.assertEqual(doc.parse_mode, 'device-local')
        self.assertEqual(doc.file.read(), self.raw)
        self.assertEqual(Module.objects.count(), 2)
        self.assertEqual(set(Module.objects.values_list('availability', flat=True)), {'locked'})
        self.assertEqual(LocalAuthoringReceipt.objects.count(), 1)
        self.assertFalse(Document.objects.visible_to(make_student()).exists())
        # A generated lesson can now use the returned server mapping/revision.
        mapping = first.data['modules'][0]
        response = self.client.post(f"/api/faculty/modules/{mapping['module_id']}/local-authoring/", {
            'id': str(uuid4()), 'revision': mapping['revision'], 'kind': 'lesson', 'reviewed': True,
            'lesson': {'introduction': 'Understand processes.', 'sections': [{'heading': 'Process', 'content': 'A running program.', 'quote': self.data['sections'][0]['source']}], 'takeaways': ['A process executes.']}}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
    def test_checksum_and_malformed_manifest_leave_no_document(self):
        self.assertEqual(self.post(raw=b'%PDF-wrong').status_code, 400)
        for data in [None, [], {}, {'id': 'not-a-uuid'}]:
            result = self.client.post(self.url, {'manifest': json.dumps(data)}, format='multipart')
            self.assertEqual(result.status_code, 400, result.data)
        self.assertFalse(Document.objects.exists())
    def test_review_and_source_validation(self):
        for field, value in [('reviewed', False), ('sections', []), ('sha256', 'x')]:
            data = {**self.data, field: value}
            self.assertEqual(self.post(data).status_code, 400)
        for change in [{'source': ''}, {'page': True}, {'source': 'x' * 60001}]:
            data = {**self.data, 'sections': [{**self.data['sections'][0], **change}]}
            self.assertEqual(self.post(data).status_code, 400)
        data = {**self.data, 'sections': [self.data['sections'][0]] * 2}
        self.assertEqual(self.post(data).status_code, 400)
        self.assertFalse(Document.objects.exists())
    def test_changed_operation_and_duplicate_book_do_not_overwrite(self):
        self.assertEqual(self.post().status_code, 200)
        self.assertEqual(self.post({**self.data, 'title': 'Changed'}).status_code, 409)
        self.assertEqual(self.post({**self.data, 'id': str(uuid4())}).status_code, 409)
        self.assertEqual(Document.objects.count(), 1)
    def test_permissions_and_revocation_on_retry(self):
        for actor in [make_student(), make_faculty()]:
            self.assertIn(self.post(client=client_for(actor)).status_code, [403, 404])
        self.assertEqual(self.post().status_code, 200)
        from academics.models import FacultySubject
        FacultySubject.objects.filter(faculty=self.faculty).delete()
        self.assertEqual(self.post().status_code, 403)
    def test_late_failure_cleans_file_and_database(self):
        with patch.object(LocalAuthoringReceipt.objects, 'create', side_effect=RuntimeError('database failure')):
            self.assertEqual(self.post().status_code, 500)
        self.assertFalse(Document.objects.exists())
        from pathlib import Path
        self.assertFalse(any(p.is_file() for p in Path(self.folder.name).rglob('*')))

    def test_publication_and_source_edits_never_queue_server_ai(self):
        self.assertEqual(self.post().status_code, 200)
        doc = Document.objects.get()
        module = doc.chapters.first().modules.first()
        from documents.services.documents import publish, edit_module
        from tutor import lessons
        from tutor.models import ModuleLesson
        from assessments.services import auto_quiz
        from assessments.models import AutoQuizJob
        with self.captureOnCommitCallbacks(execute=True):
            publish(self.faculty, doc)
            edit_module(self.faculty, module, source_text=module.source_text + ' Updated source.')
        self.assertEqual(lessons.request_lessons([module], force=True), 0)
        self.assertEqual(auto_quiz.request_quizzes([module], force=True), 0)
        self.assertFalse(ModuleLesson.objects.exists())
        self.assertFalse(AutoQuizJob.objects.exists())
        with patch('tutor.lessons.start_worker', side_effect=AssertionError('No server worker')):
            result = lessons.lesson_for_student(module)
        self.assertEqual(result['ai_error'], 'local_authoring_required')
        self.assertIsNone(result['lesson'])

    @override_settings(DEVICE_AUTHORING_ONLY=True)
    def test_legacy_books_use_device_authoring_and_do_not_resume_server_jobs(self):
        self.assertEqual(self.post().status_code,200)
        doc=Document.objects.get();doc.parse_mode='native';doc.save()
        module=doc.chapters.first().modules.first()
        from tutor import lessons
        from assessments.services import auto_quiz
        from documents.services.documents import publish, edit_module
        with self.captureOnCommitCallbacks(execute=True):
            publish(self.faculty,doc)
            edit_module(self.faculty,module,source_text=module.source_text+' Revised.')
        self.assertEqual(lessons.request_lessons([module],force=True),0)
        self.assertEqual(auto_quiz.request_quizzes([module],force=True),0)
        self.assertIsNone(lessons.claim_next())
        self.assertIsNone(auto_quiz.claim_next())
        self.assertEqual(lessons.process_one(None),'device_required')
        self.assertEqual(auto_quiz.process_one(None),'device_required')
        with patch('assessments.services.auto_quiz.requeue_unchecked',side_effect=AssertionError('No server monitor retries')):
            self.assertEqual(auto_quiz.run_pending(),{'ready':0,'failed':0,'discarded':0})
        self.assertEqual(lessons.run_pending(),{'ready':0,'failed':0,'discarded':0})
        self.assertFalse(lessons.start_worker())
        self.assertEqual(lessons.lesson_for_student(module)['ai_error'],'local_authoring_required')
        response=self.client.post(f'/api/faculty/modules/{module.pk}/lesson/',{},format='json')
        self.assertEqual(response.status_code,409,response.data)
        self.assertEqual(response.data['error']['code'],'LOCAL_AUTHORING_REQUIRED')
