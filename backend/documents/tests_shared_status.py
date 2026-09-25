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

    def test_shared_quiz_survives_unarchive_and_obeys_publish_guards(self):
        """A's restore/publish rules must preserve B's shared device content."""
        first, second = client_for(self.first), client_for(self.second)
        quiz_id = self.sync(first, 'quiz')['quiz_id']
        book_url = f'/api/faculty/documents/{self.doc.pk}/'
        quiz_url = f'/api/faculty/quizzes/{quiz_id}/status/'
        self.assertEqual(first.post(book_url + 'archive/').status_code, 200)
        self.assertEqual(second.post(book_url + 'unarchive/').status_code, 200)
        snapshot = second.get(self.url).data
        self.assertEqual(snapshot['institution']['quiz']['id'], quiz_id)
        self.assertEqual(snapshot['institution']['quiz_by'], 'Asha Rao')
        blocked = second.post(quiz_url, {'status': 'published'}, format='json')
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.data['error']['code'], 'BOOK_NOT_PUBLISHED')
        self.assertEqual(second.post(book_url + 'publish/').status_code, 200)
        self.module.availability = 'locked'
        self.module.save(update_fields=['availability'])
        blocked = second.post(quiz_url, {'status': 'published'}, format='json')
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.data['error']['code'], 'MODULE_LOCKED_FOR_QUIZ')
        self.module.refresh_from_db()
        self.assertEqual(self.module.availability, 'locked')
        self.module.availability = 'open'
        self.module.save(update_fields=['availability'])
        self.assertEqual(second.post(quiz_url, {'status': 'published'}, format='json').status_code, 200)
        detail = second.get(book_url).data
        row = next(m for c in detail['chapters'] for m in c['modules'] if m['id'] == str(self.module.pk))
        self.assertEqual(row['shared_quiz_id'], quiz_id)
        self.assertEqual(row['shared_quiz_status'], 'published')

    def detail_queries(self, chapters):
        from learning.models import Chapter, Module
        for c in range(self.doc.chapters.count() + 1, chapters + 1):
            ch = Chapter.objects.create(document=self.doc, title=f'C{c}', order=c, source_heading_index=c * 10)
            for m in range(1, 4):
                Module.objects.create(chapter=ch, title=f'M{c}.{m}', order=m, source_heading_index=c * 10 + m, source_text='Text here.', availability='open')
        client = client_for(self.second)
        url = f'/api/faculty/documents/{self.doc.pk}/'
        client.get(url)
        with CaptureQueriesContext(connection) as ctx:
            client.get(url)
        return len(ctx.captured_queries)

    def test_shared_status_cost_does_not_grow_with_book_size(self):
        small = self.detail_queries(2)
        large = self.detail_queries(15)
        self.assertEqual(small, large, 'book detail queries must not scale with chapters')
