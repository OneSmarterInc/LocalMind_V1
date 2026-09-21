from django.test import TestCase
from core.testing import MCQ, assign, client_for, enroll, make_admin, make_faculty, make_published_document, make_student, make_subject
from academics.services import set_subject_status
from assessments.models import Assessment
from audit.models import AuditLog
from documents.services.documents import archive


class UnarchiveTests(TestCase):
    def setUp(self):
        self.faculty = make_faculty()
        self.subject = make_subject()
        self.link = assign(self.faculty, self.subject)
        self.student = make_student()
        self.enrollment = enroll(self.student, self.subject)
        self.doc = make_published_document(self.subject)
        self.url = f'/api/faculty/documents/{self.doc.pk}/unarchive/'

    def test_book_round_trip_preserves_content(self):
        module = self.doc.chapters.first().modules.first()
        module.availability = 'locked'
        module.save()
        quiz = Assessment.objects.create(subject=self.subject, module=module, kind='module', title='Saved', questions=[MCQ])
        from tutor.models import ModuleLesson
        lesson = ModuleLesson.objects.create(module=module, status='ready', source_hash='saved', lesson={'introduction': 'Saved lesson'})
        archive(self.faculty, self.doc)
        response = client_for(self.faculty).post(self.url)
        self.assertEqual(response.status_code, 200, response.data)
        self.doc.refresh_from_db()
        module.refresh_from_db()
        quiz.refresh_from_db()
        self.assertEqual(self.doc.status, 'unpublished')
        self.assertIsNone(self.doc.archived_at)
        self.assertEqual(module.availability, 'locked')
        self.assertTrue(module.source_text)
        self.assertEqual(quiz.questions, [MCQ])
        lesson.refresh_from_db()
        self.assertEqual(lesson.lesson, {'introduction': 'Saved lesson'})
        self.assertTrue(AuditLog.objects.filter(action='document.unarchived', target_id=str(self.doc.pk)).exists())
        self.assertEqual(client_for(self.faculty).post(self.url).data['error']['code'], 'INVALID_STATE')
        self.assertEqual(client_for(self.faculty).post(f'/api/faculty/documents/{self.doc.pk}/publish/').status_code, 200)

    def test_book_permission_scoping(self):
        archive(self.faculty, self.doc)
        self.assertEqual(client_for(make_faculty()).post(self.url).status_code, 404)
        self.assertEqual(client_for(self.student).post(self.url).status_code, 403)
        self.assertEqual(client_for(make_admin()).post(self.url).status_code, 200)

    def test_subject_round_trip_and_discontinued_restriction(self):
        admin = make_admin()
        set_subject_status(admin, self.subject, 'archived')
        url = f'/api/admin/subjects/{self.subject.pk}/status/'
        client = client_for(admin)
        self.assertEqual(client.post(url, {'status': 'discontinued'}, format='json').status_code, 409)
        self.assertEqual(client.post(url, {'status': 'active'}, format='json').status_code, 200)
        self.subject.refresh_from_db()
        self.link.refresh_from_db()
        self.enrollment.refresh_from_db()
        self.assertEqual(self.subject.status, 'active')
        self.assertIsNone(self.subject.archived_at)
        self.assertEqual(self.link.status, 'active')
        self.assertEqual(self.enrollment.status, 'active')
        self.assertTrue(AuditLog.objects.filter(action='subject.unarchived', target_id=str(self.subject.pk)).exists())
