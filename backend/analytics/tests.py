from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from activity import services as activity
from activity.models import ApplicationSession
from assessments.models import Assessment, AssessmentAttempt
from core.testing import MCQ, MCQ2, assign, client_for, enroll, make_admin, make_faculty, make_published_document, make_student, make_subject
from learning.models import Module


class Base(TestCase):
    def setUp(self):
        self.admin = make_admin()
        self.faculty = make_faculty()
        self.other_faculty = make_faculty()
        self.student = make_student()
        self.other_student = make_student()
        self.subject = make_subject(code="OS")
        self.other_subject = make_subject(code="DB")
        assign(self.faculty, self.subject)
        assign(self.other_faculty, self.other_subject)
        enroll(self.student, self.subject)
        enroll(self.other_student, self.other_subject)
        make_published_document(self.subject)
        self.module = Module.objects.get(title="Process Management")
        self.ac, self.fc, self.sc = client_for(self.admin), client_for(self.faculty), client_for(self.student)
        self.ofc, self.osc = client_for(self.other_faculty), client_for(self.other_student)

    def run_quiz(self, answers=None):
        res = self.fc.post("/api/faculty/quizzes/", {"module_id": str(self.module.id), "questions": [MCQ, MCQ2]}, format="json")
        quiz = Assessment.objects.get(pk=res.data["id"])
        self.fc.post(f"/api/faculty/quizzes/{quiz.id}/status/", {"status": "published"}, format="json")
        attempt_id = self.sc.post(f"/api/student/quizzes/{quiz.id}/attempts/").data["attempt_id"]
        AssessmentAttempt.objects.filter(pk=attempt_id).update(started_at=timezone.now() - timedelta(seconds=120))
        res = self.sc.post(f"/api/student/quiz-attempts/{attempt_id}/submit/", {"submitted_answers": answers or {"q1": "A", "q2": "B"}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        return quiz, res.data


class StudentAnalyticsTests(Base):
    def test_overview_reflects_progress_quiz_and_time(self):
        self.sc.get(f"/api/student/modules/{self.module.id}/")
        self.sc.post(f"/api/student/modules/{self.module.id}/time/", {"seconds": 300}, format="json")
        self.run_quiz()
        res = self.sc.get("/api/student/analytics/overview/")
        self.assertEqual(res.status_code, 200, res.content)
        d = res.data
        self.assertEqual(d["subjects_enrolled"], 1)
        self.assertEqual(d["modules"]["total"], 2)
        self.assertEqual(d["modules"]["completed"], 1)
        self.assertEqual(d["modules"]["not_started"], 1)
        self.assertEqual(d["modules"]["completion_percentage"], 50.0)
        self.assertEqual(d["quizzes"]["attempts"], 1)
        self.assertEqual(d["quizzes"]["passed"], 1)
        self.assertEqual(d["quizzes"]["average_percentage"], 100.0)
        self.assertEqual(d["time"]["learning_seconds"], 300)
        self.assertGreaterEqual(d["time"]["quiz_seconds"], 120)

    def test_subject_detail_lists_every_published_module(self):
        self.sc.get(f"/api/student/modules/{self.module.id}/")
        res = self.sc.get(f"/api/student/analytics/subjects/{self.subject.id}/")
        self.assertEqual(res.status_code, 200)
        statuses = {m["title"]: m["status"] for m in res.data["modules"]}
        self.assertEqual(statuses, {"Process Management": "in_progress", "Memory Management": "not_started"})
        self.assertEqual(self.sc.get(f"/api/student/analytics/subjects/{self.other_subject.id}/").status_code, 404)

    def test_sessions_are_own_only_and_durations_server_computed(self):
        session = activity.open_session(self.student)
        ApplicationSession.objects.filter(pk=session.id).update(login_at=timezone.now() - timedelta(minutes=10))
        activity.close_session(self.student, session.id)
        res = self.sc.get("/api/student/analytics/sessions/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data["sessions"]), 1)
        self.assertGreaterEqual(res.data["total_seconds"], 590)
        self.assertEqual(self.sc.get(f"/api/faculty/analytics/users/{self.student.id}/sessions/").status_code, 403)

    def test_window_validation(self):
        self.assertEqual(self.sc.get("/api/student/analytics/overview/?since=nonsense").status_code, 400)
        self.assertEqual(self.sc.get("/api/student/analytics/overview/?since=2030-01-01T00:00:00Z&until=2020-01-01T00:00:00Z").status_code, 400)


class FacultyAnalyticsTests(Base):
    def test_subject_summary_and_scoping(self):
        self.sc.post(f"/api/student/modules/{self.module.id}/time/", {"seconds": 120}, format="json")
        self.run_quiz({"q1": "A", "q2": "A"})  # 50%, fails at the 65 threshold
        res = self.fc.get(f"/api/faculty/analytics/subjects/{self.subject.id}/")
        self.assertEqual(res.status_code, 200, res.content)
        d = res.data
        self.assertEqual(d["students_enrolled"], 1)
        self.assertEqual(d["students_active_in_window"], 1)
        self.assertEqual(d["quizzes"]["attempts"], 1)
        self.assertEqual(d["quizzes"]["passed"], 0)
        self.assertEqual(d["quizzes"]["average_percentage"], 50.0)
        self.assertEqual(d["modules"]["completion_percentage"], 0.0)
        self.assertEqual(d["time"]["learning_seconds"], 120)
        self.assertEqual(self.ofc.get(f"/api/faculty/analytics/subjects/{self.subject.id}/").status_code, 404)
        self.assertEqual(self.ac.get(f"/api/faculty/analytics/subjects/{self.subject.id}/").status_code, 200)

    def test_students_table_and_module_funnel(self):
        self.run_quiz()
        res = self.fc.get(f"/api/faculty/analytics/subjects/{self.subject.id}/students/")
        self.assertEqual(res.status_code, 200)
        row = res.data["students"][0]
        self.assertEqual(row["student_id"], str(self.student.id))
        self.assertEqual(row["modules_completed"], 1)
        self.assertEqual(row["quiz_average"], 100.0)
        self.assertIsNotNone(row["last_activity_at"])
        self.assertIn("session_seconds", row)
        self.assertIn("quiz_seconds", row)
        res = self.fc.get(f"/api/faculty/analytics/subjects/{self.subject.id}/modules/")
        funnel = {m["title"]: m for m in res.data["modules"]}
        self.assertEqual(funnel["Process Management"]["students_completed"], 1)
        self.assertEqual(funnel["Process Management"]["quiz_pass_rate"], 100.0)
        self.assertEqual(funnel["Memory Management"]["students_not_started"], 1)
        self.assertIsNone(funnel["Memory Management"]["quiz_pass_rate"])

    def test_student_detail_requires_shared_subject(self):
        self.assertEqual(self.fc.get(f"/api/faculty/analytics/students/{self.student.id}/").status_code, 200)
        self.assertEqual(self.fc.get(f"/api/faculty/analytics/students/{self.other_student.id}/").status_code, 404)
        self.assertEqual(self.ac.get(f"/api/faculty/analytics/students/{self.other_student.id}/").status_code, 200)
        self.assertEqual(self.fc.get(f"/api/faculty/analytics/students/{self.student.id}/subjects/{self.subject.id}/").status_code, 200)
        self.assertEqual(self.fc.get(f"/api/faculty/analytics/users/{self.student.id}/sessions/").status_code, 200)
        self.assertEqual(self.fc.get(f"/api/faculty/analytics/users/{self.other_student.id}/sessions/").status_code, 404)

    def test_overview_lists_only_own_subjects(self):
        res = self.fc.get("/api/faculty/analytics/overview/")
        self.assertEqual([s["subject"]["code"] for s in res.data["subjects"]], ["OS"])
        res = self.ac.get("/api/faculty/analytics/overview/")
        self.assertEqual([s["subject"]["code"] for s in res.data["subjects"]], ["DB", "OS"])

    def test_date_window_excludes_old_attempts(self):
        _, data = self.run_quiz()
        AssessmentAttempt.objects.filter(student=self.student).update(submitted_at=timezone.now() - timedelta(days=30))
        since = (timezone.now() - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        res = self.fc.get(f"/api/faculty/analytics/subjects/{self.subject.id}/?since={since}")
        self.assertEqual(res.data["quizzes"]["attempts"], 0)
        res = self.fc.get(f"/api/faculty/analytics/subjects/{self.subject.id}/")
        self.assertEqual(res.data["quizzes"]["attempts"], 1)


class AdminAnalyticsTests(Base):
    def test_platform_overview_is_admin_only(self):
        self.run_quiz()
        self.assertEqual(self.fc.get("/api/admin/analytics/platform/").status_code, 403)
        self.assertEqual(self.sc.get("/api/admin/analytics/platform/").status_code, 403)
        res = self.ac.get("/api/admin/analytics/platform/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["users"]["student"]["active"], 2)
        self.assertEqual(res.data["users"]["faculty"]["active"], 2)
        self.assertEqual(res.data["enrollments_active"], 2)
        self.assertEqual(res.data["quizzes"]["attempts"], 1)
        self.assertEqual(res.data["modules"]["total"], 2)

    def test_platform_subject_table(self):
        res = self.ac.get("/api/admin/analytics/platform/subjects/")
        rows = {r["code"]: r for r in res.data["subjects"]}
        self.assertEqual(rows["OS"]["students_enrolled"], 1)
        self.assertEqual(rows["OS"]["faculty"], [self.faculty.full_name])
        self.assertEqual(rows["OS"]["documents_published"], 1)
        self.assertEqual(rows["DB"]["documents_published"], 0)
