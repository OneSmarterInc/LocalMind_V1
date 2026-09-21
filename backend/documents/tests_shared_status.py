"""Item 5: content synchronized by one faculty member is visible to the others."""
from uuid import uuid4
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from core.testing import make_faculty, make_subject, assign, client_for, make_published_document
from assessments.models import Assessment


class SharedStatusTests(TestCase):
    def setUp(self):
        subject = make_subject()
        self.first = make_faculty(name='Asha Rao')
        self.second = make_faculty(name='Ravi Iyer')
        assign(self.first, subject)
        assign(self.second, subject)
        self.doc = make_published_document(subject)
        self.module = self.doc.chapters.first().modules.first()
        self.url = f'/api/faculty/modules/{self.module.pk}/local-authoring/'
        self.quote = 'Processes are programs in execution.'

    def sync(self, client, kind):
        revision = client.get(self.url).data['revision']
        data = {'id': str(uuid4()), 'revision': revision, 'reviewed': True, 'kind': kind}
        if kind == 'lesson':
            data['lesson'] = {'introduction': 'Understand processes.', 'sections': [{'heading': 'Processes', 'content': 'A process is a running program.', 'quote': self.quote}], 'takeaways': ['A process runs a program.']}
        else:
            data['questions'] = [{'question': 'What is a process?', 'options': ['A running program', 'A file', 'A disk', 'A frame'], 'answer': 0, 'explanation': 'A process is a program in execution.', 'quote': self.quote}]
        response = client.post(self.url, data, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_other_faculty_sees_synced_quiz_and_lesson_with_author(self):
        first = client_for(self.first)
        quiz_id = self.sync(first, 'quiz')['quiz_id']
        self.sync(first, 'lesson')
        institution = client_for(self.second).get(self.url).data['institution']
        self.assertEqual(institution['quiz']['id'], quiz_id)
        self.assertEqual(institution['quiz_by'], 'Asha Rao')
        self.assertEqual(institution['lesson_by'], 'Asha Rao')
        self.assertIsNotNone(institution['lesson'])

    def test_book_detail_reports_shared_quiz_and_lesson_author(self):
        first = client_for(self.first)
        quiz_id = self.sync(first, 'quiz')['quiz_id']
        self.sync(first, 'lesson')
        doc = client_for(self.second).get(f'/api/faculty/documents/{self.doc.pk}/').data
        row = next(m for c in doc['chapters'] for m in c['modules'] if m['id'] == str(self.module.pk))
        self.assertEqual(row['shared_quiz_id'], quiz_id)
        self.assertEqual(row['shared_quiz_status'], 'draft')
        self.assertEqual(row['shared_quiz_by'], 'Asha Rao')
        self.assertEqual(row['lesson_synced_by'], 'Asha Rao')
        self.assertEqual(row['lesson_status'], 'ready')

    def test_nothing_shared_reports_nulls_and_existing_fields_are_unchanged(self):
        doc = client_for(self.second).get(f'/api/faculty/documents/{self.doc.pk}/').data
        row = doc['chapters'][0]['modules'][0]
        for key in ('shared_quiz_id', 'shared_quiz_status', 'shared_quiz_by', 'lesson_synced_by'):
            self.assertIsNone(row[key])
        for key in ('lesson_status', 'quiz_status', 'auto_quiz_id'):
            self.assertIn(key, row)
        institution = client_for(self.second).get(self.url).data['institution']
        self.assertIsNone(institution['quiz'])
        self.assertIsNone(institution['quiz_by'])

    def test_superseded_quiz_is_not_reported(self):
        quiz_id = self.sync(client_for(self.first), 'quiz')['quiz_id']
        Assessment.objects.filter(pk=quiz_id).update(status='superseded')
        doc = client_for(self.second).get(f'/api/faculty/documents/{self.doc.pk}/').data
        self.assertIsNone(doc['chapters'][0]['modules'][0]['shared_quiz_id'])

    def test_shared_status_is_batched_per_chapter(self):
        client = client_for(self.second)
        client.get(f'/api/faculty/documents/{self.doc.pk}/')
        with CaptureQueriesContext(connection) as ctx:
            client.get(f'/api/faculty/documents/{self.doc.pk}/')
        shared = [q for q in ctx.captured_queries if 'audit' in q['sql'].lower() and 'authoring.device_received' in q['sql']]
        self.assertLessEqual(len(shared), self.doc.chapters.count())
