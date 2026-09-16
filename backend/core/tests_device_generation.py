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

    def test_legacy_ai_outline_preserves_complete_source_without_model(self):
        from documents.services.outline import ai_outline, build_proposed_outline
        from documents.services.outline_policy import source_hierarchy_outline
        from documents.services.parser import extract_sections_from_markdown, _extract_headings
        self.doc.outline_strategy = "ai"
        sections = extract_sections_from_markdown("# Chapter One\nFirst text.\n## Module\nFull module content.\n# Chapter Two\nSecond text.")
        headings = _extract_headings(sections)
        with patch("documents.services.outline.gateway") as gateway:
            outline, source = build_proposed_outline(self.doc, sections, headings)
            self.assertIsNone(ai_outline(self.doc, headings))
        gateway.assert_not_called()
        self.assertEqual(source, "source_hierarchy")
        self.assertEqual(outline, source_hierarchy_outline(self.doc.original_name, sections))

    def test_legacy_written_answer_waits_for_faculty_and_can_be_graded(self):
        from core.testing import SUBJ
        from assessments.models import AssessmentAttempt
        from assessments.services.assessments import re_evaluate
        quiz = self.fc.post("/api/faculty/quizzes/", {"module_id": str(self.module.id),
                           "questions": [SUBJ]}, format="json")
        self.assertEqual(quiz.status_code, 201, quiz.content)
        quiz_id = quiz.data["id"]
        self.fc.post(f"/api/faculty/quizzes/{quiz_id}/status/", {"status": "published"}, format="json")
        started = self.sc.post(f"/api/student/quizzes/{quiz_id}/attempts/")
        attempt_id = started.data["attempt_id"]
        with patch("assessments.services.evaluation.gateway") as gateway:
            response = self.sc.post(f"/api/student/quiz-attempts/{attempt_id}/submit/",
                                    {"submitted_answers": {started.data["questions"][0]["id"]: "My preserved answer"}}, format="json")
            self.assertEqual(response.status_code, 200, response.content)
            attempt = AssessmentAttempt.objects.get(pk=attempt_id)
            self.assertEqual(attempt.status, "pending_evaluation")
            row = attempt.detailed_results[0]
            self.assertEqual(row["student_answer"], "My preserved answer")
            self.assertIsNone(row["score_awarded"])
            self.assertIn("FACULTY_REVIEW_REQUIRED", row["evaluation_error"])
            attempt = re_evaluate(self.faculty, attempt, overrides={started.data["questions"][0]["id"]: {"score_awarded": 1, "feedback": "Reviewed"}})
        gateway.assert_not_called()
        self.assertEqual(attempt.status, "evaluated")
        self.assertEqual(attempt.detailed_results[0]["feedback"], "Reviewed")
