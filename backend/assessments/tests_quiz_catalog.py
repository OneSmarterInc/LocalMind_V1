from django.test import TestCase
from core.testing import MCQ, assign, client_for, enroll, make_faculty, make_student, make_subject, make_published_document
from learning.models import Module
from .models import Assessment


class QuizCatalogTests(TestCase):
    def test_book_ids_and_newest_first_do_not_expose_student_answers(self):
        faculty, student = make_faculty(), make_student()
        subject = make_subject()
        assign(faculty, subject)
        enroll(student, subject)
        first = make_published_document(subject, title='First book', modules=(('First source', 'A readable source. ' * 20),))
        second = make_published_document(subject, title='Second book', modules=(('Second source', 'Another readable source. ' * 20),))
        m1, m2 = Module.objects.get(chapter__document=first), Module.objects.get(chapter__document=second)
        old = Assessment.objects.create(subject=subject, module=m1, kind='module', title='Older', questions=[MCQ], status='published')
        new = Assessment.objects.create(subject=subject, kind='selection', title='Newest', questions=[MCQ], status='published')
        new.source_modules.set([m1, m2])
        for actor, area in [(faculty, 'faculty'), (student, 'student')]:
            response = client_for(actor).get(f'/api/{area}/quizzes/')
            self.assertEqual(response.status_code, 200)
            rows = response.data if isinstance(response.data, list) else response.data['results']
            self.assertEqual([str(row['id']) for row in rows], [str(new.id), str(old.id)])
            self.assertEqual(set(rows[0]['document_ids']), {str(first.id), str(second.id)})
            self.assertEqual(rows[1]['document_ids'], [str(first.id)])
            self.assertIn('created_at', rows[0])
            if area == 'student':
                self.assertNotIn('questions', rows[0])
