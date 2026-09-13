"""Fixes from the September review: held results in the student list, settings saves, clearing limits."""
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from core.testing import assign, client_for, enroll, make_faculty, make_published_document, make_student, make_subject
from learning.models import Module

from .models import Assessment

MCQ = {"type": "mcq", "question": "Which runs next?", "options": [{"key": k, "text": k} for k in "ABCD"], "correct_answer": "A"}


class Round3QuizTests(TestCase):
    def setUp(self):
        self.faculty = make_faculty()
        self.student = make_student()
        self.subject = make_subject(code="OS")
        assign(self.faculty, self.subject)
        enroll(self.student, self.subject)
        self.doc = make_published_document(self.subject)
        self.module = Module.objects.get(title="Process Management")
        self.fc = client_for(self.faculty)
        self.sc = client_for(self.student)

    def quiz(self, **extra):
        q = self.fc.post("/api/faculty/quizzes/", {"module_id": str(self.module.id), "title": "Check", "questions": [MCQ], **extra}, format="json").data
        self.fc.post(f"/api/faculty/quizzes/{q['id']}/status/", {"status": "published"}, format="json")
        return q

    def attempt(self, quiz_id):
        start = self.sc.post(f"/api/student/quizzes/{quiz_id}/attempts/").data
        return self.sc.post(f"/api/student/quiz-attempts/{start['attempt_id']}/submit/", {"submitted_answers": {start["questions"][0]["id"]: "A"}}, format="json").data

    def row(self, quiz_id):
        return next(r for r in self.sc.get("/api/student/quizzes/").data if r["id"] == quiz_id)

    def test_held_results_do_not_reach_the_student_quiz_list(self):
        q = self.quiz(results_release="held")
        self.attempt(q["id"])
        row = self.row(q["id"])
        self.assertIsNone(row["best_percentage"])
        self.assertIsNone(row["passed"])
        self.assertEqual(row["attempts_used"], 1)
        self.assertEqual(row["results_pending"], 1)
        self.assertEqual(row["subject_id"], str(self.subject.id))
        self.fc.post(f"/api/faculty/quizzes/{q['id']}/release-results/", {}, format="json")
        row = self.row(q["id"])
        self.assertEqual(row["best_percentage"], 100.0)
        self.assertTrue(row["passed"])
        self.assertEqual(row["results_pending"], 0)

    def test_attempts_used_counts_every_submitted_attempt(self):
        q = self.quiz()
        self.attempt(q["id"]); self.attempt(q["id"])
        self.assertEqual(self.row(q["id"])["attempts_used"], 2)

    def test_settings_save_with_attempts_updates_in_place(self):
        q = self.quiz(results_release="held")
        self.attempt(q["id"])
        full = self.fc.get(f"/api/faculty/quizzes/{q['id']}/").data
        res = self.fc.patch(f"/api/faculty/quizzes/{q['id']}/", {"title": "Renamed", "questions": full["questions"], "pass_percentage": 70}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["id"], q["id"])
        self.assertEqual(res.data["version"], 1)
        self.assertEqual(res.data["title"], "Renamed")
        self.assertEqual(res.data["results_release"], "held")
        self.assertEqual(Assessment.objects.get(pk=q["id"]).status, "published")

    def test_new_version_keeps_modules_and_release_and_survives_cross_chapter_quizzes(self):
        from learning.models import Chapter
        ch2 = Chapter.objects.create(document=self.doc, title="Chapter 2", order=2, source_heading_index=5)
        other = Module.objects.create(chapter=ch2, title="Files", order=1, source_heading_index=6, source_text="Files hold data on disk and have names.", availability="open")
        q = self.fc.post("/api/faculty/quizzes/", {"module_ids": [str(self.module.id), str(other.id)], "title": "Mixed", "questions": [MCQ],
                                                   "results_release": "held"}, format="json").data
        self.assertIsNone(q["chapter_id"])
        self.fc.post(f"/api/faculty/quizzes/{q['id']}/status/", {"status": "published"}, format="json")
        self.attempt(q["id"])
        changed = [{**MCQ, "question": "Which process runs next?"}]
        res = self.fc.patch(f"/api/faculty/quizzes/{q['id']}/", {"questions": changed, "max_attempts": 4}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertNotEqual(res.data["id"], q["id"])
        self.assertEqual(res.data["version"], 2)
        self.assertEqual(res.data["results_release"], "held")
        self.assertEqual(res.data["max_attempts"], 4)
        self.assertEqual(sorted(res.data["source_module_ids"]), sorted([str(self.module.id), str(other.id)]))
        old = Assessment.objects.get(pk=q["id"])
        self.assertEqual(old.status, "superseded")
        self.assertNotEqual(old.max_attempts, 4)

    def test_null_clears_limits_and_dates(self):
        q = self.quiz()
        due = (timezone.now() + timedelta(days=3)).isoformat()
        self.fc.patch(f"/api/faculty/quizzes/{q['id']}/", {"max_attempts": 3, "time_limit_minutes": 20, "due_at": due, "available_from": due}, format="json")
        res = self.fc.patch(f"/api/faculty/quizzes/{q['id']}/", {"max_attempts": None, "time_limit_minutes": None, "due_at": None, "available_from": None}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        for key in ("max_attempts", "time_limit_minutes", "due_at", "available_from"):
            self.assertIsNone(res.data[key], key)
        self.assertEqual(self.fc.get(f"/api/faculty/quizzes/{q['id']}/").data["title"], "Check")

    def test_assignment_dates_clear_and_submissions_show_release_time(self):
        due = (timezone.now() + timedelta(days=3)).isoformat()
        a = self.fc.post("/api/faculty/assignments/", {"module_id": str(self.module.id), "title": "Essay", "max_score": 10, "due_at": due,
                                                      "results_release": "held", "rubric": [{"criterion": "A", "points": 10}]}, format="json").data
        cleared = self.fc.patch(f"/api/faculty/assignments/{a['id']}/", {"due_at": None}, format="json")
        self.assertIsNone(cleared.data["due_at"])
        self.fc.post(f"/api/faculty/assignments/{a['id']}/status/", {"status": "published"}, format="json")
        sub = self.sc.post(f"/api/student/assignments/{a['id']}/submissions/", {"content": "text"}, format="json").data
        self.fc.post(f"/api/faculty/assignment-submissions/{sub['id']}/evaluate/", {"score": 8, "feedback": "Good"}, format="json")
        rows = self.fc.get(f"/api/faculty/assignments/{a['id']}/submissions/").data
        rows = rows["results"] if isinstance(rows, dict) else rows
        self.assertIn("results_released_at", rows[0])
        self.assertIsNone(rows[0]["results_released_at"])

    def test_hold_details_flag_only_the_questions_the_findings_name(self):
        from ai_monitor.models import Evaluation
        questions = [{**MCQ, "id": f"q{n}", "question": f"Question number {n} about scheduling?"} for n in (1, 2, 3)]
        q = Assessment.objects.create(subject=self.subject, module=self.module, chapter=self.module.chapter, kind="module", title="Auto",
                                      status="draft", auto_generated=True, held_for_review=True, hold_reason="check", questions=questions)
        # The generated response mentions every question; only question 2 has a finding.
        Evaluation.objects.create(interaction_kind="quiz", interaction_id=q.id, assessment=q, subject=self.subject, module=self.module,
                                  response_excerpt=" ".join(x["question"] for x in questions),
                                  evidence_json=[{"kind": "module", "ref": "Process Management", "text": "Processes are programs."}],
                                  validators_json=[{"name": "quiz_structure", "passed": True, "evidence": []},
                                                   {"name": "quiz_source_references", "passed": False, "detail": "1 of 3 cite text not in the source.",
                                                    "evidence": ["q2: 'made up phrase' not in source"]}],
                                  verdict="issue", issue_type="unsupported_claim", severity="high", confidence=0.8, reason="Question 1 and 3 look fine.")
        details = self.fc.get(f"/api/faculty/quizzes/{q.id}/").data["hold_details"]
        self.assertEqual(details["question_ids"], ["q2"])
        self.assertEqual(details["evidence"][0]["ref"], "Process Management")

    def test_hold_details_do_not_guess_when_no_question_is_named(self):
        from ai_monitor.models import Evaluation
        q = Assessment.objects.create(subject=self.subject, module=self.module, chapter=self.module.chapter, kind="module", title="Auto",
                                      status="draft", auto_generated=True, held_for_review=True, questions=[{**MCQ, "id": "a1"}])
        Evaluation.objects.create(interaction_kind="quiz", interaction_id=q.id, assessment=q, subject=self.subject, module=self.module,
                                  response_excerpt=MCQ["question"], validators_json=[{"name": "judge", "passed": False, "detail": "Unsupported.", "evidence": ["the answer is not in the text"]}],
                                  verdict="issue", issue_type="unsupported_claim", severity="high", confidence=0.8)
        self.assertEqual(self.fc.get(f"/api/faculty/quizzes/{q.id}/").data["hold_details"]["question_ids"], [])
