from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from ai.gateway import AIResult
from audit.models import AuditLog
from core.testing import (
    MCQ, MCQ2, SUBJ, assign, client_for, enroll, make_faculty, make_published_document, make_student, make_subject,
)
from learning.models import Module, ModuleProgress

from .models import Assessment, AssessmentAttempt


class Base(TestCase):
    def setUp(self):
        self.faculty = make_faculty()
        self.other_faculty = make_faculty()
        self.student = make_student()
        self.other_student = make_student()
        self.subject = make_subject(code="OS")
        assign(self.faculty, self.subject)
        enroll(self.student, self.subject)
        self.doc = make_published_document(self.subject)
        self.module = Module.objects.get(title="Process Management")
        self.chapter = self.module.chapter
        self.fc = client_for(self.faculty)
        self.sc = client_for(self.student)

    def manual_quiz(self, questions=(MCQ, MCQ2), publish=True, **extra):
        res = self.fc.post("/api/faculty/quizzes/", {"module_id": str(self.module.id), "questions": list(questions), **extra}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        quiz = Assessment.objects.get(pk=res.data["id"])
        if publish:
            pub = self.fc.post(f"/api/faculty/quizzes/{quiz.id}/status/", {"status": "published"}, format="json")
            self.assertEqual(pub.status_code, 200, pub.content)
            quiz.refresh_from_db()
        return quiz

    def start(self, quiz, client=None):
        return (client or self.sc).post(f"/api/student/quizzes/{quiz.id}/attempts/")

    def submit(self, attempt_id, answers, client=None):
        return (client or self.sc).post(f"/api/student/quiz-attempts/{attempt_id}/submit/", {"submitted_answers": answers}, format="json")


class AuthoringTests(Base):
    def test_manual_creation_validates_questions(self):
        bad = self.fc.post("/api/faculty/quizzes/", {"module_id": str(self.module.id), "questions": [{"type": "mcq", "question": "x", "options": [], "correct_answer": "Z"}]}, format="json")
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(bad.data["error"]["code"], "INVALID_QUESTIONS")
        quiz = self.manual_quiz(publish=False)
        self.assertEqual(quiz.kind, "module")
        self.assertEqual(quiz.generator, "manual")
        self.assertEqual(quiz.status, "draft")

    @patch("assessments.services.generation.gateway")
    def test_ai_generation_grounded_and_stored(self, gw):
        gw.return_value.generate.return_value = AIResult(ok=True, data={"mcq_questions": [
            {"question": MCQ["question"], "options": MCQ["options"], "correct_answer": "A", "explanation": "e", "source_reference": "s"}]})
        res = self.fc.post("/api/faculty/quizzes/generate/", {"module_id": str(self.module.id), "num_mcqs": 1}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["generator"], "ai")
        self.assertIsNone(res.data["generation_warning"])
        prompt = gw.return_value.generate.call_args.kwargs["user_prompt"]
        self.assertIn("Processes are programs in execution", prompt)

    def test_generation_without_ai_creates_nothing_instead_of_placeholders(self):
        res = self.fc.post("/api/faculty/quizzes/generate/", {"module_id": str(self.module.id), "num_mcqs": 2, "num_subjective": 1}, format="json")
        self.assertEqual(res.status_code, 503, res.content)
        self.assertEqual(res.data["error"]["code"], "QUIZ_GENERATION_FAILED")
        self.assertFalse(Assessment.objects.exists())

    def test_chapter_quiz_uses_all_module_text(self):
        res = self.fc.post("/api/faculty/quizzes/", {"chapter_id": str(self.chapter.id), "questions": [MCQ]}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["kind"], "chapter")
        self.assertIsNone(res.data["module_id"])

    def test_other_faculty_cannot_author_or_see(self):
        oc = client_for(self.other_faculty)
        self.assertEqual(oc.post("/api/faculty/quizzes/", {"module_id": str(self.module.id), "questions": [MCQ]}, format="json").status_code, 404)
        quiz = self.manual_quiz()
        self.assertEqual(oc.get(f"/api/faculty/quizzes/{quiz.id}/").status_code, 404)
        self.assertEqual(len(oc.get("/api/faculty/quizzes/").data["results"]), 0)

    def test_editing_after_attempts_creates_new_version(self):
        quiz = self.manual_quiz()
        attempt_id = self.start(quiz).data["attempt_id"]
        self.submit(attempt_id, {"q1": "A", "q2": "B"})
        res = self.fc.patch(f"/api/faculty/quizzes/{quiz.id}/", {"questions": [MCQ]}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertNotEqual(res.data["id"], str(quiz.id))
        self.assertEqual(res.data["version"], 2)
        self.assertEqual(res.data["supersedes"], quiz.id)
        self.assertEqual(res.data["status"], "draft")
        quiz.refresh_from_db()
        self.assertEqual(quiz.status, "superseded")
        self.assertEqual(len(quiz.questions), 2)  # old version untouched
        old_attempt = AssessmentAttempt.objects.get(pk=attempt_id)
        self.assertEqual(old_attempt.assessment_id, quiz.id)
        self.assertEqual(len(old_attempt.detailed_results), 2)

    def test_editing_without_attempts_edits_in_place(self):
        quiz = self.manual_quiz(publish=False)
        res = self.fc.patch(f"/api/faculty/quizzes/{quiz.id}/", {"questions": [MCQ], "title": "Renamed"}, format="json")
        self.assertEqual(res.data["id"], str(quiz.id))
        self.assertEqual(res.data["title"], "Renamed")
        self.assertEqual(res.data["question_count"], 1)


class AttemptTests(Base):
    def test_student_only_sees_published_quizzes_on_open_modules(self):
        draft = self.manual_quiz(publish=False)
        quiz = self.manual_quiz()
        ids = {q["id"] for q in self.sc.get("/api/student/quizzes/").data}
        self.assertEqual(ids, {str(quiz.id)})
        self.module.availability = "locked"
        self.module.save()
        self.assertEqual(self.sc.get("/api/student/quizzes/").data, [])
        self.assertEqual(self.start(quiz).status_code, 404)

    def test_publishing_a_quiz_opens_its_locked_module(self):
        self.module.availability = "locked"
        self.module.save()
        draft = self.manual_quiz(publish=False)
        self.assertEqual(self.sc.get("/api/student/quizzes/").data, [])
        res = self.fc.post(f"/api/faculty/quizzes/{draft.id}/status/", {"status": "published"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.module.refresh_from_db()
        self.assertEqual(self.module.availability, "open")
        self.assertEqual([q["id"] for q in self.sc.get("/api/student/quizzes/").data], [str(draft.id)])

    def test_start_hides_answers_and_submit_scores_deterministically(self):
        quiz = self.manual_quiz()
        res = self.start(quiz)
        self.assertEqual(res.status_code, 201, res.content)
        for q in res.data["questions"]:
            self.assertNotIn("correct_answer", q)
            self.assertNotIn("explanation", q)
        attempt_id = res.data["attempt_id"]
        res = self.submit(attempt_id, {"q1": "a", "q2": "C"})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["score"], 1.0)
        self.assertEqual(res.data["percentage"], 50.0)
        self.assertFalse(res.data["passed"])
        self.assertEqual(res.data["status"], "evaluated")
        self.assertEqual(res.data["detailed_results"][0]["is_correct"], True)
        self.assertEqual(res.data["detailed_results"][1]["correct_option"], "B")
        self.assertIsNotNone(res.data["time_taken_seconds"])
        progress = ModuleProgress.objects.get(student=self.student, module=self.module)
        self.assertEqual(progress.status, "needs_review")
        self.assertEqual(progress.best_quiz_percentage, 50.0)

    def test_pass_completes_module_and_time_is_server_computed(self):
        quiz = self.manual_quiz()
        attempt_id = self.start(quiz).data["attempt_id"]
        AssessmentAttempt.objects.filter(pk=attempt_id).update(started_at=timezone.now() - timedelta(seconds=90))
        res = self.submit(attempt_id, {"q1": "A", "q2": "B", "time_taken_seconds": "1"})
        self.assertTrue(res.data["passed"])
        self.assertGreaterEqual(res.data["time_taken_seconds"], 90)
        self.assertEqual(ModuleProgress.objects.get(student=self.student, module=self.module).status, "completed")

    def test_resubmission_rejected_and_attempts_are_immutable(self):
        quiz = self.manual_quiz()
        attempt_id = self.start(quiz).data["attempt_id"]
        self.submit(attempt_id, {"q1": "A"})
        res = self.submit(attempt_id, {"q1": "B"})
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["error"]["code"], "ALREADY_SUBMITTED")

    def test_max_attempts_and_attempt_numbering(self):
        quiz = self.manual_quiz(max_attempts=2)
        a1 = self.start(quiz).data
        self.assertEqual(a1["attempt_number"], 1)
        again = self.start(quiz)
        self.assertEqual(again.status_code, 200)
        self.assertTrue(again.data["resumed"])
        self.submit(a1["attempt_id"], {"q1": "A"})
        a2 = self.start(quiz).data
        self.assertEqual(a2["attempt_number"], 2)
        self.submit(a2["attempt_id"], {"q1": "A"})
        res = self.start(quiz)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["error"]["code"], "MAX_ATTEMPTS_REACHED")
        self.assertEqual(AssessmentAttempt.objects.filter(student=self.student, assessment=quiz).count(), 2)

    def test_due_date_enforced(self):
        quiz = self.manual_quiz(due_at=(timezone.now() - timedelta(hours=1)).isoformat())
        res = self.start(quiz)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["error"]["code"], "QUIZ_CLOSED")

    def test_other_student_cannot_see_or_submit_attempt(self):
        quiz = self.manual_quiz()
        attempt_id = self.start(quiz).data["attempt_id"]
        oc = client_for(self.other_student)
        self.assertEqual(oc.get(f"/api/student/quiz-attempts/{attempt_id}/").status_code, 404)
        self.assertEqual(self.submit(attempt_id, {"q1": "A"}, client=oc).status_code, 404)
        self.assertEqual(self.start(quiz, client=oc).status_code, 404)  # not enrolled

    def test_subjective_pending_when_ai_down_then_faculty_reevaluates(self):
        quiz = self.manual_quiz(questions=(MCQ, SUBJ))
        attempt_id = self.start(quiz).data["attempt_id"]
        res = self.submit(attempt_id, {"q1": "A", "q2": "A process is a program in execution."})
        self.assertEqual(res.data["status"], "pending_evaluation")
        self.assertIsNone(res.data["percentage"])
        self.assertEqual(res.data["detailed_results"][1]["evaluation_status"], "pending")
        with patch("assessments.services.assessments.evaluate_subjective", return_value=({"is_correct": True, "score_awarded": 1.0, "feedback": "Good", "missing_points": [], "evaluator": "test"}, True)):
            res = self.fc.post(f"/api/faculty/quiz-attempts/{attempt_id}/re-evaluate/", {}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["status"], "evaluated")
        self.assertEqual(res.data["percentage"], 100.0)
        self.assertTrue(res.data["passed"])

    def test_faculty_override_score(self):
        quiz = self.manual_quiz(questions=(MCQ, SUBJ))
        attempt_id = self.start(quiz).data["attempt_id"]
        self.submit(attempt_id, {"q1": "B", "q2": "blank-ish"})
        res = self.fc.post(f"/api/faculty/quiz-attempts/{attempt_id}/re-evaluate/", {"overrides": {"q2": {"score_awarded": 1, "feedback": "Accepted"}}}, format="json")
        self.assertEqual(res.data["status"], "evaluated")
        self.assertEqual(res.data["percentage"], 50.0)
        self.assertEqual(res.data["detailed_results"][1]["evaluator"], f"faculty:{self.faculty.email}")
        self.assertTrue(AuditLog.objects.filter(action="quiz.attempt_reevaluated").exists())

    def test_faculty_sees_attempts_and_student_sees_scores(self):
        quiz = self.manual_quiz()
        attempt_id = self.start(quiz).data["attempt_id"]
        self.submit(attempt_id, {"q1": "A", "q2": "B"})
        res = self.fc.get(f"/api/faculty/quizzes/{quiz.id}/attempts/")
        self.assertEqual(len(res.data["results"]), 1)
        self.assertEqual(res.data["results"][0]["student_email"], self.student.email)
        scores = self.sc.get("/api/student/scores/").data["results"]
        self.assertEqual(scores[0]["percentage"], 100.0)
        listing = self.sc.get("/api/student/quizzes/").data[0]
        self.assertEqual(listing["best_percentage"], 100.0)
        self.assertEqual(listing["attempts_used"], 1)


class GenerationRulesTests(TestCase):
    def test_duplicate_option_texts_are_rejected(self):
        from assessments.services.generation import normalize_questions
        from core.exceptions import ValidationFailed
        q = {"type": "mcq", "question": "Q?", "options": [{"key": k, "text": "same"} for k in "ABCD"], "correct_answer": "A"}
        with self.assertRaises(ValidationFailed) as ctx:
            normalize_questions([q])
        self.assertIn("distinct", str(ctx.exception.details))

    @patch("assessments.services.generation.gateway")
    def test_ai_output_that_only_repeats_is_refused(self, gw):
        from assessments.services.generation import QuizGenerationFailed, generate_questions
        mk = {"question": "What is a process?", "options": ["Round robin", "Paging", "TCP", "Segmentation"], "answer": "A", "explanation": "e", "quote": "s"}
        gw.return_value.generate.return_value = AIResult(ok=True, data={"mcq_questions": [mk]})
        module = Module(title="Processes", source_text="Processes are programs in execution. " * 5)
        with self.assertRaises(QuizGenerationFailed):
            generate_questions([module], num_mcqs=1, previous_questions=[{"question": "What is a process?"}])

    @patch("assessments.services.evaluation.gateway")
    def test_evaluator_marks_incorrect_when_model_lists_missing_points(self, gw):
        from assessments.services.evaluation import evaluate_subjective
        gw.return_value.generate.return_value = AIResult(ok=True, provider="ollama", model="qwen3:1.7b", data={
            "is_correct": True, "score_awarded": 1, "feedback": "Nearly.", "missing_points": ["did not mention scheduling"]})
        result, ok = evaluate_subjective("src", "Q", "rubric", "an answer")
        self.assertTrue(ok)
        self.assertFalse(result["is_correct"])
        self.assertEqual(result["score_awarded"], 0.0)
        self.assertEqual(result["evaluator"], "ollama:qwen3:1.7b")


class QuizDeleteTests(TestCase):
    """Faculty and admins delete quizzes outright, so the PROTECT chain from
    attempts has to be cleared before the row goes."""

    def setUp(self):
        self.faculty = make_faculty()
        self.subject = make_subject(code="DELQ")
        assign(self.faculty, self.subject)
        self.student = make_student()
        enroll(self.student, self.subject)

    def _quiz(self):
        from .models import Assessment, AssessmentKind, AssessmentStatus
        return Assessment.objects.create(subject=self.subject, kind=AssessmentKind.values[0], title="Removable",
                                         status=AssessmentStatus.DRAFT, questions=[])

    def test_delete_removes_the_quiz_and_its_attempts(self):
        from .models import Assessment, AssessmentAttempt

        quiz = self._quiz()
        AssessmentAttempt.objects.create(assessment=quiz, student=self.student, attempt_number=1)
        res = client_for(self.faculty).delete(f"/api/faculty/quizzes/{quiz.id}/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(Assessment.objects.filter(pk=quiz.pk).exists())
        self.assertFalse(AssessmentAttempt.objects.exists())
        self.assertTrue(AuditLog.objects.filter(action="quiz.deleted").exists())

    def test_faculty_cannot_delete_a_quiz_in_a_subject_they_do_not_manage(self):
        from .models import Assessment

        quiz = self._quiz()
        other = make_faculty()
        res = client_for(other).delete(f"/api/faculty/quizzes/{quiz.id}/")
        self.assertIn(res.status_code, (403, 404))
        self.assertTrue(Assessment.objects.filter(pk=quiz.pk).exists())


class ModuleSelectionQuizTests(Base):
    """A quiz written from several chosen modules rather than one target."""

    def setUp(self):
        super().setUp()
        self.other = Module.objects.get(title="Memory Management")

    def test_manual_quiz_from_two_modules(self):
        res = self.fc.post("/api/faculty/quizzes/", {
            "module_ids": [str(self.module.id), str(self.other.id)],
            "questions": [MCQ, MCQ2],
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        quiz = Assessment.objects.get(pk=res.data["id"])
        self.assertEqual(quiz.kind, "selection")
        self.assertEqual(quiz.source_modules.count(), 2)
        # Both share a chapter, so the chapter stays set for scoped queries.
        self.assertEqual(quiz.chapter_id, self.module.chapter_id)
        self.assertIsNone(quiz.module_id)
        self.assertCountEqual(res.data["source_module_ids"], [str(self.module.id), str(self.other.id)])

    def test_one_module_id_in_the_list_is_still_a_module_quiz(self):
        res = self.fc.post("/api/faculty/quizzes/", {"module_ids": [str(self.module.id)], "questions": [MCQ]}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        quiz = Assessment.objects.get(pk=res.data["id"])
        self.assertEqual(quiz.kind, "module")
        self.assertEqual(quiz.module_id, self.module.id)

    def test_selection_source_text_covers_every_chosen_module(self):
        from .services.assessments import _source_text
        res = self.fc.post("/api/faculty/quizzes/", {
            "module_ids": [str(self.module.id), str(self.other.id)], "questions": [MCQ]}, format="json")
        quiz = Assessment.objects.get(pk=res.data["id"])
        text = _source_text(quiz)
        self.assertIn("scheduler", text)
        self.assertIn("Paging", text)

    def test_unknown_module_is_not_found(self):
        import uuid
        res = self.fc.post("/api/faculty/quizzes/", {"module_ids": [str(uuid.uuid4())], "questions": [MCQ]}, format="json")
        self.assertEqual(res.status_code, 404)

    def test_selection_hidden_until_every_module_is_open(self):
        res = self.fc.post("/api/faculty/quizzes/", {
            "module_ids": [str(self.module.id), str(self.other.id)], "questions": [MCQ]}, format="json")
        quiz = Assessment.objects.get(pk=res.data["id"])
        self.fc.post(f"/api/faculty/quizzes/{quiz.id}/status/", {"status": "published"}, format="json")
        listed = self.sc.get("/api/student/quizzes/")
        self.assertEqual(listed.status_code, 200)
        ids = [q["id"] for q in listed.data]
        self.assertIn(str(quiz.id), ids)
        # Lock one of the two: the quiz asks about material the student no longer has.
        self.fc.post(f"/api/faculty/modules/{self.other.id}/availability/", {"availability": "locked"}, format="json")
        listed = self.sc.get("/api/student/quizzes/")
        self.assertNotIn(str(quiz.id), [q["id"] for q in listed.data])


class ResultsReleaseTests(Base):
    """Whether a student may see the outcome of their own attempt."""

    def _attempt(self, quiz, answers=None):
        start = self.sc.post(f"/api/student/quizzes/{quiz.id}/attempts/", {}, format="json")
        self.assertIn(start.status_code, (200, 201), start.content)
        attempt_id = start.data["attempt_id"]
        qs = start.data["questions"]
        answers = answers or {q["id"]: "A" for q in qs}
        return attempt_id, self.sc.post(f"/api/student/quiz-attempts/{attempt_id}/submit/", {"submitted_answers": answers}, format="json")

    def test_immediate_is_the_default_and_shows_the_score(self):
        quiz = self.manual_quiz()
        _, res = self._attempt(quiz)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIsNotNone(res.data["score"])
        self.assertTrue(res.data["detailed_results"])

    def test_held_results_are_withheld_on_submit_and_on_read(self):
        quiz = self.manual_quiz(results_release="held")
        attempt_id, res = self._attempt(quiz)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIsNone(res.data["score"])
        self.assertEqual(res.data["detailed_results"], [])
        self.assertFalse(res.data["results_released"])
        # Reading it back later says the same.
        again = self.sc.get(f"/api/student/quiz-attempts/{attempt_id}/")
        self.assertIsNone(again.data["score"])
        # The grading itself happened; only the response withholds it.
        self.assertIsNotNone(AssessmentAttempt.objects.get(pk=attempt_id).score)

    def test_faculty_release_makes_the_result_visible(self):
        quiz = self.manual_quiz(results_release="held")
        attempt_id, _ = self._attempt(quiz)
        detail = self.fc.get(f"/api/faculty/quizzes/{quiz.id}/")
        self.assertEqual(detail.data["pending_release_count"], 1)
        rel = self.fc.post(f"/api/faculty/quizzes/{quiz.id}/release-results/", {}, format="json")
        self.assertEqual(rel.status_code, 200, rel.content)
        self.assertEqual(rel.data["released"], 1)
        self.assertEqual(rel.data["pending"], 0)
        after = self.sc.get(f"/api/student/quiz-attempts/{attempt_id}/")
        self.assertIsNotNone(after.data["score"])

    def test_one_attempt_can_be_released_on_its_own(self):
        quiz = self.manual_quiz(results_release="held")
        attempt_id, _ = self._attempt(quiz)
        rel = self.fc.post(f"/api/faculty/quizzes/{quiz.id}/release-results/", {"attempt_id": attempt_id}, format="json")
        self.assertEqual(rel.data["released"], 1)
        self.assertIsNotNone(self.sc.get(f"/api/student/quiz-attempts/{attempt_id}/").data["score"])

    def test_scheduled_release_opens_by_itself_once_the_time_passes(self):
        later = timezone.now() + timedelta(hours=2)
        quiz = self.manual_quiz(results_release="scheduled", results_release_at=later.isoformat())
        attempt_id, res = self._attempt(quiz)
        self.assertIsNone(res.data["score"])
        # No scheduler runs: moving the time into the past is enough.
        Assessment.objects.filter(pk=quiz.id).update(results_release_at=timezone.now() - timedelta(minutes=1))
        self.assertIsNotNone(self.sc.get(f"/api/student/quiz-attempts/{attempt_id}/").data["score"])

    def test_scheduled_without_a_time_is_refused(self):
        res = self.fc.post("/api/faculty/quizzes/", {
            "module_id": str(self.module.id), "questions": [MCQ], "results_release": "scheduled"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_scores_list_hides_held_results(self):
        quiz = self.manual_quiz(results_release="held")
        self._attempt(quiz)
        scores = self.sc.get("/api/student/scores/")
        self.assertEqual(scores.status_code, 200)
        self.assertIsNone(scores.data["results"][0]["score"])

    def test_a_student_cannot_release_their_own_results(self):
        quiz = self.manual_quiz(results_release="held")
        self._attempt(quiz)
        res = self.sc.post(f"/api/faculty/quizzes/{quiz.id}/release-results/", {}, format="json")
        self.assertIn(res.status_code, (403, 404))


class HeldResultsDoNotLeakTests(ResultsReleaseTests):
    """A held score must not reach the student by any other route: the
    analytics overview, the subject analytics, the module's progress row, or
    the remediation endpoint (which names the wrong answers)."""

    def _wrong_attempt(self, quiz):
        start = self.sc.post(f"/api/student/quizzes/{quiz.id}/attempts/", {}, format="json")
        attempt_id = start.data["attempt_id"]
        self.sc.post(f"/api/student/quiz-attempts/{attempt_id}/submit/",
                     {"submitted_answers": {q["id"]: "D" for q in start.data["questions"]}}, format="json")
        return attempt_id

    def test_overview_and_subject_analytics_exclude_held_results(self):
        quiz = self.manual_quiz(results_release="held")
        self._wrong_attempt(quiz)
        overview = self.sc.get("/api/student/analytics/overview/").data
        self.assertEqual(overview["quizzes"]["attempts"], 1)
        self.assertIsNone(overview["quizzes"]["average_percentage"])
        self.assertEqual(overview["quizzes"]["passed"], 0)
        self.assertEqual(overview["modules"]["needs_review"], 0)
        detail = self.sc.get(f"/api/student/analytics/subjects/{self.subject.id}/").data
        self.assertIsNone(detail["quiz_average"])
        row = next(m for m in detail["modules"] if m["module_id"] == str(self.module.id))
        self.assertIsNone(row["best_quiz_percentage"])
        # Faculty looking at the same student still see the real figure.
        fac = self.fc.get(f"/api/faculty/analytics/students/{self.student.id}/")
        self.assertEqual(fac.status_code, 200, fac.content)
        self.assertEqual(fac.data["quizzes"]["average_percentage"], 0.0)

    def test_module_progress_waits_for_release_then_counts_once(self):
        quiz = self.manual_quiz(results_release="held")
        attempt_id = self._wrong_attempt(quiz)
        progress = self.sc.get(f"/api/student/modules/{self.module.id}/").data["progress"]
        self.assertNotEqual(progress["status"], "needs_review")
        self.assertIsNone(progress["best_quiz_percentage"])
        self.fc.post(f"/api/faculty/quizzes/{quiz.id}/release-results/", {}, format="json")
        progress = self.sc.get(f"/api/student/modules/{self.module.id}/").data["progress"]
        self.assertEqual(progress["status"], "needs_review")
        self.assertEqual(progress["best_quiz_percentage"], 0.0)
        self.assertEqual(progress["quiz_attempts"], 1)
        # A faculty override on an already-recorded attempt updates progress
        # without counting the attempt a second time.
        attempt = AssessmentAttempt.objects.get(pk=attempt_id)
        overrides = {row["question_id"]: {"score_awarded": 1} for row in attempt.detailed_results}
        res = self.fc.post(f"/api/faculty/quiz-attempts/{attempt_id}/re-evaluate/", {"overrides": overrides}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        progress = ModuleProgress.objects.get(student=self.student, module=self.module)
        self.assertEqual(progress.quiz_attempts, 1)
        self.assertEqual(progress.status, "completed")

    def test_scheduled_release_settles_progress_on_read(self):
        later = timezone.now() + timedelta(hours=2)
        quiz = self.manual_quiz(results_release="scheduled", results_release_at=later.isoformat())
        self._wrong_attempt(quiz)
        self.assertIsNone(self.sc.get(f"/api/student/modules/{self.module.id}/").data["progress"]["best_quiz_percentage"])
        Assessment.objects.filter(pk=quiz.id).update(results_release_at=timezone.now() - timedelta(minutes=1))
        progress = self.sc.get(f"/api/student/modules/{self.module.id}/").data["progress"]
        self.assertEqual(progress["best_quiz_percentage"], 0.0)
        self.assertEqual(progress["quiz_attempts"], 1)

    def test_remediation_refused_while_held_and_allowed_after_release(self):
        quiz = self.manual_quiz(results_release="held")
        attempt_id = self._wrong_attempt(quiz)
        res = self.sc.post(f"/api/student/quiz-attempts/{attempt_id}/remediation/")
        self.assertEqual(res.status_code, 403, res.content)
        self.assertEqual(res.data["error"]["code"], "RESULTS_NOT_RELEASED")
        self.fc.post(f"/api/faculty/quizzes/{quiz.id}/release-results/", {}, format="json")
        res = self.sc.post(f"/api/student/quiz-attempts/{attempt_id}/remediation/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(len(res.data["items"]), 2)

    def test_immediate_quiz_still_records_progress_at_submit(self):
        quiz = self.manual_quiz()
        self._wrong_attempt(quiz)
        progress = ModuleProgress.objects.get(student=self.student, module=self.module)
        self.assertEqual(progress.status, "needs_review")
        self.assertEqual(progress.quiz_attempts, 1)


class RemediationSourceTests(Base):
    def test_remediation_on_a_selection_spanning_chapters(self):
        from learning.models import Chapter
        chapter2 = Chapter.objects.create(document=self.doc, title="Chapter 2", order=2, source_heading_index=9)
        files = Module.objects.create(chapter=chapter2, title="Files", order=1, source_heading_index=10,
                                      source_text="A file system stores files in directories.", availability="open")
        res = self.fc.post("/api/faculty/quizzes/", {"module_ids": [str(self.module.id), str(files.id)],
                                                     "questions": [MCQ, MCQ2]}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        quiz = Assessment.objects.get(pk=res.data["id"])
        self.assertIsNone(quiz.chapter_id)
        self.fc.post(f"/api/faculty/quizzes/{quiz.id}/status/", {"status": "published"}, format="json")
        start = self.start(quiz)
        attempt_id = start.data["attempt_id"]
        self.submit(attempt_id, {q["id"]: "D" for q in start.data["questions"]})
        with patch("tutor.services.gateway") as gw:
            gw.return_value.generate.return_value = AIResult(ok=False, error_code="unavailable")
            res = self.sc.post(f"/api/student/quiz-attempts/{attempt_id}/remediation/")
            self.assertEqual(res.status_code, 200, res.content)
            prompt = gw.return_value.generate.call_args.kwargs["user_prompt"]
        self.assertIn("file system", prompt)
        self.assertIn("scheduler", prompt)
