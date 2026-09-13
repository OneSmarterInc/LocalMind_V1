"""Data added for the new interface: faculty names, module position, per-student
quiz attempts, the teaching activity feed, published-by and assignment attempt limits."""
from django.test import TestCase

from assessments.models import Assessment
from core.testing import assign, client_for, enroll, make_faculty, make_published_document, make_student, make_subject
from learning.models import Module


class UiAdditionsTests(TestCase):
    def setUp(self):
        self.faculty = make_faculty(name="Meera Shah")
        self.other_faculty = make_faculty()
        self.student = make_student()
        self.subject = make_subject(code="OS")
        self.other = make_subject(code="DB")
        assign(self.faculty, self.subject)
        assign(self.other_faculty, self.other)
        enroll(self.student, self.subject)
        self.doc = make_published_document(self.subject)
        self.module = Module.objects.get(title="Process Management")
        self.fc = client_for(self.faculty)
        self.sc = client_for(self.student)

    def test_student_subjects_list_faculty_names(self):
        rows = self.sc.get("/api/student/subjects/").data
        self.assertEqual(rows[0]["faculty_names"], ["Meera Shah"])

    def test_module_has_position_count_and_faculty(self):
        data = self.sc.get(f"/api/student/modules/{self.module.id}/").data
        total = Module.objects.filter(chapter__document=self.doc, source_missing=False).count()
        self.assertEqual(data["module_count"], total)
        self.assertTrue(1 <= data["module_number"] <= total)
        self.assertEqual(data["faculty_names"], ["Meera Shah"])

    def test_document_reports_who_published_it(self):
        res = self.fc.get(f"/api/faculty/documents/{self.doc.id}/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("published_by_name", res.data)

    def test_faculty_student_subject_detail_lists_quiz_attempts(self):
        quiz = self.fc.post("/api/faculty/quizzes/", {"module_id": str(self.module.id), "title": "Check", "questions": [
            {"type": "mcq", "question": "Q?", "options": [{"key": k, "text": k} for k in "ABCD"], "correct_answer": "A"}]}, format="json").data
        self.fc.post(f"/api/faculty/quizzes/{quiz['id']}/status/", {"status": "published"}, format="json")
        start = self.sc.post(f"/api/student/quizzes/{quiz['id']}/attempts/").data
        self.sc.post(f"/api/student/quiz-attempts/{start['attempt_id']}/submit/", {"submitted_answers": {start["questions"][0]["id"]: "A"}}, format="json")
        roster = self.fc.get(f"/api/faculty/analytics/subjects/{self.subject.id}/students/").data["students"]
        self.assertEqual(roster[0]["best_quiz_percentage"], 100.0)
        data = self.fc.get(f"/api/faculty/analytics/students/{self.student.id}/subjects/{self.subject.id}/").data
        self.assertEqual(len(data["quiz_attempts"]), 1)
        self.assertEqual(data["quiz_attempts"][0]["quiz_title"], "Check")
        self.assertTrue(data["modules"])
        # The student's own view of the same subject does not carry the list.
        own = self.sc.get(f"/api/student/analytics/subjects/{self.subject.id}/").data
        self.assertEqual(own.get("quiz_attempts", []), [])

    def test_teaching_activity_is_scoped_to_the_callers_subjects(self):
        quiz = self.fc.post("/api/faculty/quizzes/", {"module_id": str(self.module.id), "title": "Feed quiz", "questions": [
            {"type": "mcq", "question": "Q?", "options": [{"key": k, "text": k} for k in "ABCD"], "correct_answer": "A"}]}, format="json").data
        self.fc.post(f"/api/faculty/quizzes/{quiz['id']}/status/", {"status": "published"}, format="json")
        start = self.sc.post(f"/api/student/quizzes/{quiz['id']}/attempts/").data
        self.sc.post(f"/api/student/quiz-attempts/{start['attempt_id']}/submit/", {"submitted_answers": {start["questions"][0]["id"]: "A"}}, format="json")
        mine = self.fc.get("/api/faculty/analytics/activity/").data["items"]
        self.assertTrue(any(i["kind"] == "quiz_attempts" and i["detail"] == "Feed quiz" for i in mine))
        theirs = client_for(self.other_faculty).get("/api/faculty/analytics/activity/").data["items"]
        self.assertFalse(any(i["detail"] == "Feed quiz" for i in theirs))
        self.assertEqual(self.sc.get("/api/faculty/analytics/activity/").status_code, 403)

    def test_assignment_max_attempts_limits_resubmissions(self):
        res = self.fc.post("/api/faculty/assignments/", {"module_id": str(self.module.id), "title": "Essay", "max_score": 10,
                                                        "allow_resubmission": True, "max_attempts": 2,
                                                        "rubric": [{"criterion": "A", "points": 10}]}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        aid = res.data["id"]
        self.assertEqual(res.data["max_attempts"], 2)
        self.fc.post(f"/api/faculty/assignments/{aid}/status/", {"status": "published"}, format="json")
        for text in ("one", "two"):
            self.assertEqual(self.sc.post(f"/api/student/assignments/{aid}/submissions/", {"content": text}, format="json").status_code, 201)
        third = self.sc.post(f"/api/student/assignments/{aid}/submissions/", {"content": "three"}, format="json")
        self.assertEqual(third.status_code, 409)
        self.assertEqual(third.data["error"]["code"], "ATTEMPT_LIMIT")
        cleared = self.fc.patch(f"/api/faculty/assignments/{aid}/", {"max_attempts": None}, format="json")
        self.assertEqual(cleared.status_code, 200, cleared.content)
        self.assertIsNone(cleared.data["max_attempts"])
        self.assertEqual(self.sc.post(f"/api/student/assignments/{aid}/submissions/", {"content": "three"}, format="json").status_code, 201)

    def test_admin_subject_snapshot_counts_published_modules(self):
        from core.testing import make_admin
        rows = client_for(make_admin()).get("/api/admin/analytics/platform/subjects/").data["subjects"]
        os_row = next(r for r in rows if r["code"] == "OS")
        published = Module.objects.filter(chapter__document=self.doc, source_missing=False).count()
        self.assertEqual(os_row["modules_published"], published)

    def test_attempts_and_submissions_carry_the_student_name(self):
        self.student.full_name = "Aditi Sharma"; self.student.save(update_fields=["full_name"])
        quiz = self.fc.post("/api/faculty/quizzes/", {"module_id": str(self.module.id), "title": "Named", "questions": [
            {"type": "mcq", "question": "Q?", "options": [{"key": k, "text": k} for k in "ABCD"], "correct_answer": "A"}]}, format="json").data
        self.fc.post(f"/api/faculty/quizzes/{quiz['id']}/status/", {"status": "published"}, format="json")
        start = self.sc.post(f"/api/student/quizzes/{quiz['id']}/attempts/").data
        self.sc.post(f"/api/student/quiz-attempts/{start['attempt_id']}/submit/", {"submitted_answers": {start["questions"][0]["id"]: "A"}}, format="json")
        attempts = self.fc.get(f"/api/faculty/quizzes/{quiz['id']}/attempts/").data
        attempts = attempts["results"] if isinstance(attempts, dict) else attempts
        self.assertEqual(attempts[0]["student_name"], "Aditi Sharma")
        a = self.fc.post("/api/faculty/assignments/", {"module_id": str(self.module.id), "title": "Essay", "max_score": 10, "rubric": [{"criterion": "A", "points": 10}]}, format="json").data
        self.fc.post(f"/api/faculty/assignments/{a['id']}/status/", {"status": "published"}, format="json")
        self.sc.post(f"/api/student/assignments/{a['id']}/submissions/", {"content": "text"}, format="json")
        subs = self.fc.get(f"/api/faculty/assignments/{a['id']}/submissions/").data
        subs = subs["results"] if isinstance(subs, dict) else subs
        self.assertEqual(subs[0]["student_name"], "Aditi Sharma")

