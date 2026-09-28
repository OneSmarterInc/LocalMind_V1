"""Hand-written quizzes take two to six options per question; AI quizzes keep four."""
from django.test import TestCase

from core.exceptions import ValidationFailed

from .models import Assessment
from .services.generation import MANUAL_OPTION_RANGE, normalize_questions
from .tests import Base


def mcq(n, correct="A", question="Which statement is right?"):
    return {"type": "mcq", "question": question, "correct_answer": correct, "explanation": "Because.",
            "options": [{"key": "ABCDEF"[i], "text": f"Choice number {i + 1}"} for i in range(n)]}


class NormalizeOptionCountTests(TestCase):
    def test_manual_range_accepts_two_to_six(self):
        for n in range(2, 7):
            out = normalize_questions([mcq(n, correct="ABCDEF"[n - 1])], **MANUAL_OPTION_RANGE)
            self.assertEqual([o["key"] for o in out[0]["options"]], list("ABCDEF"[:n]))
            self.assertEqual(out[0]["correct_answer"], "ABCDEF"[n - 1])

    def test_manual_range_rejects_one_and_seven(self):
        for q in (mcq(1), {**mcq(6), "options": mcq(6)["options"] + [{"key": "G", "text": "Seventh"}]}):
            with self.assertRaises(ValidationFailed):
                normalize_questions([q], **MANUAL_OPTION_RANGE)

    def test_ai_default_still_requires_exactly_four(self):
        normalize_questions([mcq(4)])
        for n in (3, 5):
            with self.assertRaises(ValidationFailed):
                normalize_questions([mcq(n)])

    def test_keys_must_be_consecutive_and_answer_must_exist(self):
        gap = mcq(3); gap["options"][2]["key"] = "D"
        with self.assertRaises(ValidationFailed):
            normalize_questions([gap], **MANUAL_OPTION_RANGE)
        with self.assertRaises(ValidationFailed):
            normalize_questions([mcq(3, correct="D")], **MANUAL_OPTION_RANGE)
        with self.assertRaises(ValidationFailed):
            normalize_questions([mcq(3, correct="")], **MANUAL_OPTION_RANGE)

    def test_duplicate_texts_rejected_for_any_count(self):
        dup = mcq(3); dup["options"][2]["text"] = dup["options"][0]["text"]
        with self.assertRaises(ValidationFailed):
            normalize_questions([dup], **MANUAL_OPTION_RANGE)

    def test_letter_answer_e_and_f_accepted(self):
        out = normalize_questions([mcq(6, correct="(F)")], **MANUAL_OPTION_RANGE)
        self.assertEqual(out[0]["correct_answer"], "F")


class ManualQuizOptionApiTests(Base):
    def test_faculty_creates_and_edits_quiz_with_three_and_five_options_student_takes_it(self):
        quiz = self.manual_quiz(questions=[mcq(3, correct="C"), mcq(5, correct="E", question="Pick the fifth.")])
        self.assertEqual([len(q["options"]) for q in quiz.questions], [3, 5])
        edited = self.fc.patch(f"/api/faculty/quizzes/{quiz.id}/", {"questions": [mcq(2, correct="B")]}, format="json")
        self.assertIn(edited.status_code, (200, 201), edited.content)
        latest = Assessment.objects.filter(title=quiz.title).order_by("-created_at").first() or quiz
        latest.refresh_from_db()
        self.assertEqual(len(latest.questions[0]["options"]), 2)

    def test_student_scoring_with_five_options(self):
        quiz = self.manual_quiz(questions=[mcq(5, correct="E")])
        attempt = self.start(quiz)
        self.assertIn(attempt.status_code, (200, 201), attempt.content)
        qid = quiz.questions[0]["id"]
        res = self.submit(attempt.data["attempt_id"], {qid: "E"})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["score"], 1.0)

    def test_seven_options_rejected_by_api(self):
        q = mcq(6); q["options"].append({"key": "G", "text": "Seventh"})
        res = self.fc.post("/api/faculty/quizzes/", {"module_id": str(self.module.id), "questions": [q]}, format="json")
        self.assertEqual(res.status_code, 400)
