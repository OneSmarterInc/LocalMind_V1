from unittest.mock import patch

from django.test import TestCase

from ai.gateway import AIResult
from core.testing import MCQ, MCQ2, assign, client_for, enroll, make_faculty, make_published_document, make_student, make_subject
from learning.models import Module

from .models import Conversation, ModuleLesson


class TutorTests(TestCase):
    def setUp(self):
        self.faculty = make_faculty()
        self.student = make_student()
        self.other = make_student()
        self.subject = make_subject(code="OS")
        assign(self.faculty, self.subject)
        enroll(self.student, self.subject)
        make_published_document(self.subject)
        self.module = Module.objects.get(title="Process Management")
        self.sc = client_for(self.student)

    def test_teach_shows_a_plain_lesson_when_ai_is_off(self):
        res = self.sc.post(f"/api/student/modules/{self.module.id}/teach/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["status"], "unavailable")
        self.assertEqual(res.data["generator"], "fallback")
        self.assertIn("Processes are programs", res.data["lesson"]["sections"][0]["explanation"])
        self.assertFalse(ModuleLesson.objects.filter(status="ready").exists())

    def test_ask_returns_structured_503_when_ai_down(self):
        res = self.sc.post(f"/api/student/modules/{self.module.id}/ask/", {"question": "What is a process?"}, format="json")
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.data["error"]["code"], "AI_UNAVAILABLE")
        self.assertIn("conversation_id", res.data["error"]["details"])
        conv = Conversation.objects.get()
        self.assertEqual(conv.messages.count(), 1)  # the question is kept

    @patch("tutor.services.gateway")
    def test_ask_with_history_and_client_cannot_inject_source(self, gw):
        gw.return_value.generate.return_value = AIResult(ok=True, data={"answer": "A program in execution.", "grounded": True, "source_reference": "Processes are programs in execution.", "follow_up_suggestions": ["Scheduling?"]}, model="m")
        res = self.sc.post(f"/api/student/modules/{self.module.id}/ask/", {"question": "What is a process?", "source_text": "INJECTED"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        prompt = gw.return_value.generate.call_args.kwargs["user_prompt"]
        self.assertNotIn("INJECTED", prompt)
        conv_id = res.data["conversation_id"]
        res2 = self.sc.post(f"/api/student/modules/{self.module.id}/ask/", {"question": "And scheduling?", "conversation_id": conv_id}, format="json")
        self.assertEqual(res2.data["conversation_id"], conv_id)
        self.assertIn("What is a process?", gw.return_value.generate.call_args.kwargs["user_prompt"])
        detail = self.sc.get(f"/api/student/conversations/{conv_id}/").data
        self.assertEqual(len(detail["messages"]), 4)
        self.assertEqual(client_for(self.other).get(f"/api/student/conversations/{conv_id}/").status_code, 404)

    def test_locked_or_unenrolled_module_cannot_be_tutored(self):
        self.assertEqual(client_for(self.other).post(f"/api/student/modules/{self.module.id}/teach/").status_code, 404)
        self.module.availability = "locked"
        self.module.save()
        res = self.sc.post(f"/api/student/modules/{self.module.id}/ask/", {"question": "x"}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "MODULE_LOCKED")

    def test_remediation_from_attempt(self):
        fc = client_for(self.faculty)
        quiz = fc.post("/api/faculty/quizzes/", {"module_id": str(self.module.id), "questions": [MCQ, MCQ2]}, format="json").data
        fc.post(f"/api/faculty/quizzes/{quiz['id']}/status/", {"status": "published"}, format="json")
        attempt = self.sc.post(f"/api/student/quizzes/{quiz['id']}/attempts/").data["attempt_id"]
        self.sc.post(f"/api/student/quiz-attempts/{attempt}/submit/", {"submitted_answers": {"q1": "A", "q2": "C"}}, format="json")
        res = self.sc.post(f"/api/student/quiz-attempts/{attempt}/remediation/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["generator"], "fallback")
        self.assertEqual(len(res.data["items"]), 1)
        self.assertEqual(res.data["items"][0]["question"], MCQ2["question"])
        self.assertEqual(client_for(self.other).post(f"/api/student/quiz-attempts/{attempt}/remediation/").status_code, 404)


class OffTopicAnswerTests(TestCase):
    """A student asking about something the module does not cover should be
    told what to do next, not handed the model's raw wording."""

    def setUp(self):
        self.faculty = make_faculty()
        self.student = make_student()
        self.subject = make_subject(code="OFFT")
        assign(self.faculty, self.subject)
        enroll(self.student, self.subject)
        make_published_document(self.subject)
        self.module = Module.objects.get(title="Process Management")

    @patch("tutor.services.gateway")
    def test_an_ungrounded_answer_is_replaced_with_guidance(self, gw):
        gw.return_value.generate.return_value = AIResult(ok=True, model="m", data={
            "answer": "The source text does not cover physics. grounded=false",
            "grounded": False, "source_reference": "nothing", "follow_up_suggestions": [],
        })
        res = client_for(self.student).post(
            f"/api/student/modules/{self.module.id}/ask/", {"question": "Explain gravity"}, format="json")

        self.assertEqual(res.status_code, 201, res.content)
        answer = res.data["message"]["content"]
        self.assertNotIn("grounded", answer.lower())
        self.assertIn("Process Management", answer)
        self.assertIn("Read tab", answer)
        self.assertFalse(res.data["message"]["grounded"])
        # A reference to source the answer did not use would be misleading.
        self.assertEqual(res.data["message"]["source_reference"], "")

    @patch("tutor.services.gateway")
    def test_a_grounded_answer_is_kept_but_stripped_of_leaked_fields(self, gw):
        gw.return_value.generate.return_value = AIResult(ok=True, model="m", data={
            "answer": "A process is a program in execution. grounded=true",
            "grounded": True, "source_reference": "Processes are programs in execution.",
            "follow_up_suggestions": [],
        })
        res = client_for(self.student).post(
            f"/api/student/modules/{self.module.id}/ask/", {"question": "What is a process?"}, format="json")

        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["message"]["content"], "A process is a program in execution.")
        self.assertTrue(res.data["message"]["grounded"])
