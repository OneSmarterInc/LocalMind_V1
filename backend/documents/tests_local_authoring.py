from uuid import uuid4
from unittest.mock import patch
from django.test import TestCase
from core.testing import make_faculty, make_student, make_admin, make_subject, assign, client_for, make_published_document
from documents.models import LocalAuthoringReceipt
from tutor.models import ModuleLesson
from assessments.models import Assessment

class LocalAuthoringTests(TestCase):
    def setUp(self):
        self.faculty = make_faculty()
        subject = make_subject()
        assign(self.faculty, subject)
        self.doc = make_published_document(subject)
        self.module = self.doc.chapters.first().modules.first()
        self.client = client_for(self.faculty)
        self.url = f'/api/faculty/modules/{self.module.pk}/local-authoring/'
        self.base = self.client.get(self.url).data['revision']
        self.quote = 'Processes are programs in execution.'
    def event(self, kind='lesson'):
        data = {'id': str(uuid4()), 'revision': self.base, 'reviewed': True, 'kind': kind}
        if kind == 'lesson':
            data['lesson'] = {'introduction': 'Understand processes.', 'sections': [{'heading': 'Processes', 'content': 'A process is a running program.', 'quote': self.quote}], 'takeaways': ['A process runs a program.']}
        else:
            data['questions'] = [{'question': 'What is a process?', 'options': ['A running program', 'A file', 'A disk', 'A frame'], 'answer': 0, 'explanation': 'A process is a program in execution.', 'quote': self.quote}]
        return data
    def post(self, data):
        return self.client.post(self.url, data, format='json')
    def test_lesson_replay_and_changed_operation(self):
        data = self.event()
        with patch('ai.gateway.gateway.complete', side_effect=AssertionError('No server inference'), create=True):
            first = self.post(data)
            self.assertEqual(first.status_code, 200, first.data)
            self.assertEqual(self.post(data).data, first.data)
        self.assertEqual(ModuleLesson.objects.get(module=self.module).version, 1)
        data['lesson']['introduction'] = 'Changed'
        self.assertEqual(self.post(data).status_code, 409)
        self.assertEqual(LocalAuthoringReceipt.objects.count(), 1)
    def test_stale_source_or_lesson_preserves_existing_work(self):
        self.assertEqual(self.post(self.event()).status_code, 200)
        self.assertEqual(self.post(self.event()).status_code, 409)
        self.base = self.client.get(self.url).data['revision']
        data = self.event()
        self.module.source_text += ' A new definition.'
        self.module.save()
        self.assertEqual(self.post(data).status_code, 409)
        self.assertEqual(ModuleLesson.objects.get(module=self.module).version, 1)
    def test_invalid_output_rolls_back(self):
        for bad in ['invented quotation', '']:
            data = self.event()
            data['lesson']['sections'][0]['quote'] = bad
            self.assertEqual(self.post(data).status_code, 400)
        data = self.event()
        data['reviewed'] = False
        self.assertEqual(self.post(data).status_code, 400)
        self.assertFalse(ModuleLesson.objects.exists())
        self.assertFalse(LocalAuthoringReceipt.objects.exists())
    def test_quiz_is_draft_and_replay_does_not_duplicate(self):
        data = self.event('quiz')
        first = self.post(data)
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(self.post(data).data, first.data)
        quiz = Assessment.objects.get()
        self.assertEqual(quiz.status, 'draft')
        self.assertEqual(quiz.questions[0]['correct_answer'], 'A')
    def test_invalid_quiz_does_not_create_receipt(self):
        for answer in [True, -1, 4, 'A']:
            data = self.event('quiz')
            data['questions'][0]['answer'] = answer
            self.assertEqual(self.post(data).status_code, 400)
        self.assertFalse(Assessment.objects.exists())
        self.assertFalse(LocalAuthoringReceipt.objects.exists())
    def test_permissions_rechecked_on_replay(self):
        data = self.event()
        self.assertEqual(self.post(data).status_code, 200)
        from academics.models import FacultySubject
        FacultySubject.objects.filter(faculty=self.faculty).delete()
        self.assertEqual(self.post(data).status_code, 404)
        for actor in [make_student(), make_faculty()]:
            response = client_for(actor).post(self.url, self.event(), format='json')
            self.assertIn(response.status_code, [403, 404])
        self.assertEqual(client_for(make_admin()).get(self.url).status_code, 200)
