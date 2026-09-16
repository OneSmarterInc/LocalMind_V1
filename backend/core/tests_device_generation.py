"""Legacy authoring endpoints cannot bypass device-first generation.
Central AI judging has separate coverage in ai_monitor.tests.
"""
from unittest.mock import patch

from django.test import TestCase, override_settings

from assessments.models import Assessment
from core.testing import MCQ, assign, client_for, enroll, make_faculty, make_published_document, make_student, make_subject
from tutor.models import Conversation, Message


@override_settings(DEVICE_AUTHORING_ONLY=True)
class DeviceGenerationBoundaryTests(TestCase):
    def setUp(self):
        self.faculty = make_faculty()
        self.student = make_student()
        self.subject = make_subject()
        assign(self.faculty, self.subject)
        enroll(self.student, self.subject)
        self.doc = make_published_document(self.subject)
        self.module = self.doc.chapters.first().modules.first()
        self.fc = client_for(self.faculty)
        self.sc = client_for(self.student)

    def assert_local_required(self, response):
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.data["error"]["code"], "LOCAL_AUTHORING_REQUIRED")

    def test_legacy_doubt_does_not_call_server_or_save_partial_conversation(self):
        with patch("tutor.services.gateway") as gateway:
            response = self.sc.post(f"/api/student/modules/{self.module.id}/ask/",
                                    {"question": "What is a process?"}, format="json")
        self.assert_local_required(response)
        gateway.assert_not_called()
        self.assertFalse(Conversation.objects.exists())
        self.assertFalse(Message.objects.exists())

    def test_legacy_quiz_generation_does_not_create_a_draft(self):
        with patch("assessments.services.generation.gateway") as gateway:
            response = self.fc.post("/api/faculty/quizzes/generate/",
                                    {"module_id": str(self.module.id), "num_mcqs": 1}, format="json")
        self.assert_local_required(response)
        gateway.assert_not_called()
        self.assertFalse(Assessment.objects.exists())

    def test_existing_quiz_submission_still_works_but_remediation_cannot_generate(self):
        quiz = self.fc.post("/api/faculty/quizzes/", {"module_id": str(self.module.id),
                           "questions": [MCQ], "results_release": "immediate"}, format="json")
        self.assertEqual(quiz.status_code, 201, quiz.content)
        quiz_id = quiz.data["id"]
        self.fc.post(f"/api/faculty/quizzes/{quiz_id}/status/", {"status": "published"}, format="json")
        started = self.sc.post(f"/api/student/quizzes/{quiz_id}/attempts/")
        self.assertEqual(started.status_code, 201, started.content)
        attempt_id = started.data["attempt_id"]
        response = self.sc.post(f"/api/student/quiz-attempts/{attempt_id}/submit/",
                               {"submitted_answers": {"q1": "D"}}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        with patch("tutor.services.gateway") as gateway:
            response = self.sc.post(f"/api/student/quiz-attempts/{attempt_id}/remediation/")
        self.assert_local_required(response)
        gateway.assert_not_called()
