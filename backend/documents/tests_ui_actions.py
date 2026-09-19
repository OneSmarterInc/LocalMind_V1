from datetime import timedelta
from django.test import TestCase
from django.utils import timezone
from core.testing import assign, client_for, make_admin, make_faculty, make_student, make_subject, make_published_document
from documents.models import Document
from learning.models import Module, ModuleProgress
from ai_monitor.models import Evaluation
from ai_monitor.services import overview
from tutor.models import Conversation, Message


class WorkspaceActionsTests(TestCase):
    def setUp(self):
        self.admin = make_admin()
        self.faculty = make_faculty()
        self.subject = make_subject()
        assign(self.faculty, self.subject)
        self.doc = make_published_document(self.subject)
        self.module = Module.objects.filter(chapter__document=self.doc).first()
        self.client = client_for(self.faculty)

    def test_restore_keeps_book_unpublished_and_records_intact(self):
        base = f'/api/faculty/documents/{self.doc.id}/'
        self.assertEqual(self.client.post(base+'archive/').status_code, 200)
        response = self.client.post(base+'restore/')
        self.assertEqual(response.status_code, 200)
        self.doc.refresh_from_db()
        self.assertEqual(self.doc.status, 'under_review')
        self.assertIsNone(self.doc.archived_at)
        self.assertTrue(Module.objects.filter(pk=self.module.pk).exists())
        self.assertEqual(self.client.post(base+'restore/').status_code, 409)

    def test_other_faculty_cannot_restore_or_delete_modules(self):
        stranger = client_for(make_faculty())
        self.assertIn(stranger.post(f'/api/faculty/documents/{self.doc.id}/restore/').status_code, (403,404))
        self.assertIn(stranger.delete(f'/api/faculty/modules/{self.module.id}/').status_code, (403,404))
        self.assertEqual(client_for(make_student()).delete(f'/api/faculty/modules/{self.module.id}/').status_code, 403)

    def test_delete_unused_module_updates_revision(self):
        version = self.doc.content_version
        response = self.client.delete(f'/api/faculty/modules/{self.module.id}/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(Module.objects.filter(pk=self.module.pk).exists())
        self.doc.refresh_from_db()
        self.assertEqual(self.doc.content_version, version+1)

    def test_student_history_prevents_module_deletion(self):
        student=make_student()
        ModuleProgress.objects.create(module=self.module, student=student)
        response=self.client.delete(f'/api/faculty/modules/{self.module.id}/')
        self.assertEqual(response.status_code,409,response.data)
        self.assertTrue(Module.objects.filter(pk=self.module.pk).exists())

    def test_coverage_counts_interactions_once_and_uses_interaction_window(self):
        conversation=Conversation.objects.create(student=make_student(),module=self.module)
        recent=Message.objects.create(conversation=conversation,role='assistant',content='Answer')
        old=Message.objects.create(conversation=conversation,role='assistant',content='Old answer')
        Message.objects.filter(pk=old.pk).update(created_at=timezone.now()-timedelta(days=40))
        for msg, version in [(recent,'v1'),(recent,'v2'),(old,'v1')]:
            Evaluation.objects.create(interaction_kind='tutor_answer',interaction_id=msg.id,message=msg,stage='done',evaluator_version=version)
        result=overview(30)
        self.assertEqual(result['interactions'],1)
        self.assertEqual(result['evaluated'],1)
        self.assertEqual(result['coverage_percent'],100)
