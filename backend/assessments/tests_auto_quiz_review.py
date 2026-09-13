"""Automatic quizzes: checked before going live, held when the check finds a
serious problem, and not written for modules too short to support one."""
from io import StringIO
from unittest.mock import patch

from django.conf import settings
from django.core.management import call_command
from django.test import TestCase, override_settings

from ai_monitor.models import Incident
from core.testing import assign, client_for, enroll, make_admin, make_faculty, make_published_document, make_student, make_subject
from learning.models import Module

from .models import Assessment, AutoQuizJob
from .services import auto_quiz
from .tests_auto_quiz import RESP_TEXT, TEXT, run_quizzes

# A module whose title never appears in its text: the fake model quotes the
# title, so the monitor's grounding check fails and raises a high incident.
UNGROUNDED = ("Leaves carry tiny pores on their lower surface that open and close with guard cells. " * 12)


class Base(TestCase):
    def setUp(self):
        self.faculty = make_faculty()
        self.admin = make_admin()
        self.student = make_student()
        self.subject = make_subject(code="HOLD")
        assign(self.faculty, self.subject)
        enroll(self.student, self.subject)
        self.doc = make_published_document(self.subject, modules=(
            ("Photosynthesis", TEXT), ("Respiration", RESP_TEXT), ("Stomata facts", UNGROUNDED),
            ("Q U E S T I O N S", "1. What is photosynthesis? 2. Why do plants need light?")))
        self.good = Module.objects.get(title="Photosynthesis")
        self.flagged = Module.objects.get(title="Stomata facts")
        self.short = Module.objects.get(title="Q U E S T I O N S")
        self.fc, self.sc = client_for(self.faculty), client_for(self.student)

    def visible_to_student(self, module):
        res = self.sc.get("/api/student/quizzes/", {"module": str(module.id)})
        rows = res.data.get("results", res.data) if isinstance(res.data, dict) else res.data
        return [r["id"] for r in rows]

    def quiz_for(self, module):
        return Assessment.objects.get(module=module, auto_generated=True)


class HeldForReviewTests(Base):
    def test_a_quiz_that_passes_its_check_goes_live(self):
        auto_quiz.request_quizzes([self.good])
        run_quizzes()
        quiz = self.quiz_for(self.good)
        self.assertEqual(quiz.status, "published")
        self.assertIsNotNone(quiz.checked_at)
        self.assertFalse(quiz.held_for_review)
        self.assertIn(str(quiz.id), self.visible_to_student(self.good))

    def test_a_serious_finding_holds_the_quiz_away_from_students(self):
        auto_quiz.request_quizzes([self.flagged])
        run_quizzes()
        quiz = self.quiz_for(self.flagged)
        self.assertEqual(quiz.status, "draft")
        self.assertTrue(quiz.held_for_review)
        self.assertIn("AI monitor", quiz.hold_reason)
        self.assertEqual(self.visible_to_student(self.flagged), [])
        self.assertTrue(Incident.objects.filter(evaluation__assessment=quiz, severity__in=["high", "critical"]).exists())
        self.assertEqual(auto_quiz.state_for(self.flagged), "held")
        detail = self.fc.get(f"/api/faculty/documents/{self.doc.id}/").data
        self.assertEqual(detail["auto_quizzes"]["held"], 1)
        # Opening the module again does not publish a held quiz.
        auto_quiz.publish_ready_for([self.flagged])
        quiz.refresh_from_db()
        self.assertEqual(quiz.status, "draft")

    def test_faculty_publishing_it_is_the_review(self):
        auto_quiz.request_quizzes([self.flagged])
        run_quizzes()
        quiz = self.quiz_for(self.flagged)
        res = self.fc.post(f"/api/faculty/quizzes/{quiz.id}/status/", {"status": "published"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        quiz.refresh_from_db()
        self.assertFalse(quiz.held_for_review)
        self.assertIn(str(quiz.id), self.visible_to_student(self.flagged))

    def test_marking_the_incident_a_false_positive_releases_and_publishes(self):
        auto_quiz.request_quizzes([self.flagged])
        run_quizzes()
        quiz = self.quiz_for(self.flagged)
        incident = Incident.objects.get(evaluation__assessment=quiz)
        # Faculty can mark a false positive on their own subject's incidents.
        res = self.fc.post(f"/api/faculty/monitor/incidents/{incident.id}/review/", {"action": "false_positive"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        quiz.refresh_from_db()
        self.assertFalse(quiz.held_for_review)
        self.assertEqual(quiz.status, "published")

    def test_confirming_the_incident_keeps_the_hold(self):
        from ai_monitor import services
        auto_quiz.request_quizzes([self.flagged])
        run_quizzes()
        quiz = self.quiz_for(self.flagged)
        services.review_incident(self.admin, Incident.objects.get(evaluation__assessment=quiz), "confirm")
        quiz.refresh_from_db()
        self.assertTrue(quiz.held_for_review)
        self.assertEqual(quiz.status, "draft")

    def test_waiting_for_an_asynchronous_check_is_shown_and_nothing_goes_live_early(self):
        from ai_monitor import services
        monitor = {**settings.AI_MONITOR, "MODE": "async"}
        with override_settings(AI_MONITOR=monitor), patch.object(services, "enqueue_assessment") as enqueue:
            auto_quiz.request_quizzes([self.good])
            run_quizzes()
            quiz = self.quiz_for(self.good)
            self.assertTrue(enqueue.called)
            self.assertEqual(quiz.status, "draft")
            self.assertEqual(auto_quiz.state_for(self.good), "checking")
            services.evaluate_assessment(quiz)
        quiz.refresh_from_db()
        self.assertEqual(quiz.status, "published")

    @override_settings(AI_MONITOR={**settings.AI_MONITOR, "MODE": "off"})
    def test_without_the_monitor_quizzes_go_live_straight_away(self):
        auto_quiz.request_quizzes([self.flagged])
        run_quizzes()
        quiz = self.quiz_for(self.flagged)
        self.assertEqual(quiz.status, "published")
        self.assertIsNone(quiz.checked_at)

    def test_a_check_that_never_arrived_is_sent_again(self):
        from django.utils import timezone
        from datetime import timedelta
        from ai_monitor import services
        monitor = {**settings.AI_MONITOR, "MODE": "async"}
        with override_settings(AI_MONITOR=monitor), patch.object(services, "enqueue_assessment") as enqueue:
            auto_quiz.request_quizzes([self.good])
            run_quizzes()
            quiz = self.quiz_for(self.good)
            Assessment.objects.filter(pk=quiz.pk).update(updated_at=timezone.now() - timedelta(hours=1))
            enqueue.reset_mock()
            self.assertEqual(auto_quiz.requeue_unchecked(), 1)
            enqueue.assert_called_once()

    def test_the_existing_migration_holds_quizzes_already_flagged(self):
        from importlib import import_module

        from django.apps import apps
        auto_quiz.request_quizzes([self.flagged])
        with override_settings(AI_MONITOR={**settings.AI_MONITOR, "MODE": "off"}):
            run_quizzes()
        quiz = self.quiz_for(self.flagged)
        self.assertEqual(quiz.status, "published")
        from ai_monitor import services
        # Evaluate as the previous release did, with no publish-or-hold step.
        with patch("assessments.services.auto_quiz.after_check"):
            services.evaluate_assessment(quiz)
        quiz.refresh_from_db()
        self.assertEqual(quiz.status, "published")
        Assessment.objects.filter(pk=quiz.pk).update(checked_at=None)
        migration = import_module("assessments.migrations.0006_hold_flagged_auto_quizzes")
        migration.hold_flagged(apps, None)
        quiz.refresh_from_db()
        self.assertTrue(quiz.held_for_review)
        self.assertEqual(quiz.status, "draft")
        self.assertIsNotNone(quiz.checked_at)


class ShortModulesTests(Base):
    def test_short_modules_get_no_automatic_quiz(self):
        queued = auto_quiz.request_quizzes([self.good, self.short])
        self.assertEqual(queued, 1)
        self.assertFalse(AutoQuizJob.objects.filter(module=self.short).exists())
        self.assertEqual(auto_quiz.state_for(self.short), "short")
        detail = self.fc.get(f"/api/faculty/documents/{self.doc.id}/").data
        self.assertEqual(detail["auto_quizzes"]["short"], 1)
        self.assertEqual(detail["auto_quizzes"]["min_chars"], 500)

    def test_a_job_queued_before_the_limit_is_dropped_when_its_turn_comes(self):
        AutoQuizJob.objects.create(module=self.short, status="pending", source_hash="x")
        out = run_quizzes()
        self.assertEqual(out["discarded"], 1)
        self.assertFalse(Assessment.objects.filter(module=self.short).exists())

    @override_settings(AUTO_QUIZ={**settings.AUTO_QUIZ, "MIN_CHARS": 0})
    def test_zero_gives_every_module_a_quiz(self):
        self.assertEqual(auto_quiz.request_quizzes([self.short]), 1)

    def test_command_removes_short_automatic_quizzes_nobody_attempted(self):
        with override_settings(AUTO_QUIZ={**settings.AUTO_QUIZ, "MIN_CHARS": 0}, AI_MONITOR={**settings.AI_MONITOR, "MODE": "off"}):
            auto_quiz.request_quizzes([self.short, self.good])
            run_quizzes()
        short_quiz = self.quiz_for(self.short)
        out = StringIO()
        call_command("generate_auto_quizzes", "--remove-short", "--dry-run", stdout=out)
        self.assertIn("would delete", out.getvalue())
        self.assertTrue(Assessment.objects.filter(pk=short_quiz.pk).exists())
        call_command("generate_auto_quizzes", "--remove-short", stdout=StringIO())
        self.assertFalse(Assessment.objects.filter(pk=short_quiz.pk).exists())
        self.assertTrue(Assessment.objects.filter(module=self.good, auto_generated=True).exists())

    def test_command_keeps_a_short_quiz_that_students_attempted(self):
        with override_settings(AUTO_QUIZ={**settings.AUTO_QUIZ, "MIN_CHARS": 0}, AI_MONITOR={**settings.AI_MONITOR, "MODE": "off"}):
            auto_quiz.request_quizzes([self.short])
            run_quizzes()
        quiz = self.quiz_for(self.short)
        self.sc.post(f"/api/student/quizzes/{quiz.id}/attempts/")
        out = StringIO()
        call_command("generate_auto_quizzes", "--remove-short", stdout=out)
        self.assertIn("kept (has attempts)", out.getvalue())
        self.assertTrue(Assessment.objects.filter(pk=quiz.pk).exists())


class FacultyReleasesFromTheQuizScreenTests(Base):
    def test_quiz_carries_its_incident_and_faculty_can_release_it(self):
        auto_quiz.request_quizzes([self.flagged])
        run_quizzes()
        quiz = self.quiz_for(self.flagged)
        detail = self.fc.get(f"/api/faculty/quizzes/{quiz.id}/").data
        self.assertTrue(detail["held_for_review"])
        self.assertTrue(detail["hold_incident_id"])
        res = self.fc.post(f"/api/faculty/monitor/incidents/{detail['hold_incident_id']}/review/", {"action": "false_positive"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        after = self.fc.get(f"/api/faculty/quizzes/{quiz.id}/").data
        self.assertFalse(after["held_for_review"])
        self.assertIsNone(after["hold_incident_id"])
        self.assertEqual(after["status"], "published")

    def test_another_faculty_member_cannot_release_it(self):
        auto_quiz.request_quizzes([self.flagged])
        run_quizzes()
        incident_id = self.fc.get(f"/api/faculty/quizzes/{self.quiz_for(self.flagged).id}/").data["hold_incident_id"]
        other = make_faculty(email="other-faculty@example.edu")
        res = client_for(other).post(f"/api/faculty/monitor/incidents/{incident_id}/review/", {"action": "false_positive"}, format="json")
        self.assertIn(res.status_code, (403, 404))
        self.assertTrue(self.quiz_for(self.flagged).held_for_review)
