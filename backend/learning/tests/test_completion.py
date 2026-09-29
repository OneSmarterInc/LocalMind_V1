"""Module completion: a module is complete once the student has done every step
it actually has (read; lesson when one is ready; quiz submitted, pass or fail,
when a module quiz is published). See learning.services.refresh_completion."""
from copy import deepcopy
from datetime import timedelta
from importlib import import_module

from django.apps import apps as django_apps
from django.test import TestCase, override_settings
from django.utils import timezone

from assessments.models import Assessment, AssessmentAttempt
from core.testing import MCQ, assign, client_for, enroll, make_faculty, make_published_document, make_student, make_subject
from learning.models import Module, ModuleProgress
from tutor.lessons import fallback_lesson, source_hash
from tutor.models import ModuleLesson


@override_settings(AI_ENABLED=False)
class ModuleCompletionTests(TestCase):
    def setUp(self):
        self.student = make_student()
        self.faculty = make_faculty()
        self.subject = make_subject()
        enroll(self.student, self.subject)
        assign(self.faculty, self.subject)
        doc = make_published_document(self.subject)
        self.module, self.other = list(Module.objects.filter(chapter__document=doc).order_by("order"))
        self.sc = client_for(self.student)
        self.fc = client_for(self.faculty)

    # ---- helpers ----
    def read(self, module=None):
        res = self.sc.get(f"/api/student/modules/{(module or self.module).id}/")
        self.assertEqual(res.status_code, 200, res.content)
        return res.data["progress"]["status"]

    def ready_lesson(self, module=None):
        m = module or self.module
        return ModuleLesson.objects.create(module=m, status="ready", lesson=fallback_lesson(m),
                                           source_hash=source_hash(m.source_text), generated_at=timezone.now())

    def quiz(self, release="immediate", module=None):
        q = deepcopy(MCQ)
        q["id"] = "q1"
        return Assessment.objects.create(subject=self.subject, module=module or self.module, kind="module", title="Module quiz",
                                         questions=[q], status="published", results_release=release, pass_percentage=65)

    def take(self, quiz, answer):
        start = self.sc.post(f"/api/student/quizzes/{quiz.id}/attempts/")
        self.assertEqual(start.status_code, 201, start.content)
        res = self.sc.post(f"/api/student/quiz-attempts/{start.data['attempt_id']}/submit/", {"submitted_answers": {"q1": answer}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        return res

    def status(self, module=None):
        return ModuleProgress.objects.get(student=self.student, module=module or self.module).status

    # ---- issue 1: nothing to do beyond reading ----
    def test_module_without_lesson_or_quiz_completes_when_read(self):
        self.assertEqual(self.read(), "completed")
        self.assertIsNotNone(ModuleProgress.objects.get(student=self.student, module=self.module).completed_at)
        self.assertFalse(ModuleProgress.objects.filter(student=self.student, module=self.other).exists())

    def test_offline_download_does_not_count_as_reading(self):
        self.ready_lesson()
        self.assertEqual(self.sc.get("/api/student/offline/").status_code, 200)
        self.assertFalse(ModuleProgress.objects.exists())

    # ---- lesson step ----
    def test_ready_lesson_must_be_opened(self):
        self.ready_lesson()
        self.assertEqual(self.read(), "in_progress")
        res = self.sc.get(f"/api/student/modules/{self.module.id}/teach/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["status"], "ready")
        self.assertEqual(self.status(), "completed")

    def test_opening_the_lesson_also_counts_as_reading(self):
        self.ready_lesson()
        self.sc.get(f"/api/student/modules/{self.module.id}/teach/")
        self.assertEqual(self.status(), "completed")

    def test_offline_lesson_event_completes(self):
        from uuid import uuid4
        self.ready_lesson()
        self.read()
        res = self.sc.post("/api/student/offline/events/", {"id": str(uuid4()), "kind": "lesson", "module_id": str(self.module.pk)}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(self.status(), "completed")

    # ---- issue 2: quiz counts once submitted, pass or fail ----
    def test_failed_quiz_completes_the_module(self):
        quiz = self.quiz()
        self.assertEqual(self.read(), "in_progress")
        res = self.take(quiz, "D")
        self.assertFalse(res.data["passed"])
        self.assertEqual(self.status(), "completed")
        # Faculty still see this student as needing review.
        rows = self.fc.get(f"/api/faculty/analytics/subjects/{self.subject.id}/students/").data
        rows = rows.get("students", rows) if isinstance(rows, dict) else rows
        self.assertEqual(rows[0]["modules_needs_review"], 1)
        modules = self.fc.get(f"/api/faculty/analytics/subjects/{self.subject.id}/modules/").data
        modules = modules.get("modules", modules) if isinstance(modules, dict) else modules
        row = next(m for m in modules if m["module_id"] == str(self.module.id))
        self.assertEqual(row["students_needs_review"], 1)
        self.assertEqual(row["students_completed"], 1)

    def test_passed_quiz_is_not_flagged_for_review(self):
        quiz = self.quiz()
        self.read()
        self.assertTrue(self.take(quiz, "A").data["passed"])
        self.assertEqual(self.status(), "completed")
        rows = self.fc.get(f"/api/faculty/analytics/subjects/{self.subject.id}/students/").data
        rows = rows.get("students", rows) if isinstance(rows, dict) else rows
        self.assertEqual(rows[0]["modules_needs_review"], 0)

    def test_lesson_and_quiz_both_required(self):
        self.ready_lesson()
        quiz = self.quiz()
        self.read()
        self.take(quiz, "D")
        self.assertEqual(self.status(), "in_progress")  # lesson not opened yet
        self.sc.get(f"/api/student/modules/{self.module.id}/teach/")
        self.assertEqual(self.status(), "completed")

    def test_quiz_alone_is_not_reading(self):
        quiz = self.quiz()
        self.take(quiz, "D")
        self.assertEqual(self.status(), "in_progress")
        self.assertEqual(self.read(), "completed")

    def test_held_results_complete_without_revealing_the_score(self):
        quiz = self.quiz(release="held")
        self.read()
        self.take(quiz, "D")
        progress = self.sc.get(f"/api/student/modules/{self.module.id}/").data["progress"]
        self.assertEqual(progress["status"], "completed")
        self.assertIsNone(progress["best_quiz_percentage"])
        # Before release, faculty see no failing score either.
        rows = self.fc.get(f"/api/faculty/analytics/subjects/{self.subject.id}/students/").data
        rows = rows.get("students", rows) if isinstance(rows, dict) else rows
        self.assertEqual(rows[0]["modules_needs_review"], 0)

    def test_completion_is_not_taken_back_by_a_later_quiz(self):
        self.assertEqual(self.read(), "completed")
        self.quiz()
        self.assertEqual(self.read(), "completed")

    # ---- existing rows ----
    def test_old_rows_are_brought_up_to_date_when_read(self):
        quiz = self.quiz()
        self.read()
        self.take(quiz, "D")
        ModuleProgress.objects.filter(student=self.student, module=self.module).update(status="needs_review", completed_at=None)
        doc = self.sc.get(f"/api/student/documents/{self.module.chapter.document_id}/").data
        statuses = {m["title"]: m["progress"]["status"] for ch in doc["chapters"] for m in ch["modules"]}
        self.assertEqual(statuses[self.module.title], "completed")

    def test_data_migration_completes_finished_modules_only(self):
        migration = import_module("learning.migrations.0006_complete_finished_modules")
        quiz = self.quiz()
        self.ready_lesson(self.other)
        self.read()
        self.take(quiz, "D")
        self.read(self.other)
        ModuleProgress.objects.filter(student=self.student, module=self.module).update(status="needs_review", completed_at=None)
        ModuleProgress.objects.filter(student=self.student, module=self.other).update(status="in_progress", completed_at=None)
        migration.forwards(django_apps, None)
        self.assertEqual(self.status(), "completed")
        self.assertEqual(self.status(self.other), "in_progress")  # its ready lesson was never opened
