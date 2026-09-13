"""Automatic module quizzes and the student's offline bundle."""
import shutil
import tempfile
from unittest.mock import patch

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from ai.gateway import AIResult
from core.testing import assign, client_for, enroll, make_faculty, make_published_document, make_student, make_subject
from learning.models import Module, ModuleProgress

from .models import Assessment, AutoQuizJob, AutoQuizStatus
from .services import auto_quiz
from .tests_generation import FakeModel

MEDIA = tempfile.mkdtemp(prefix="autoquiz-media-")
TEXT = ("Photosynthesis happens in the chloroplasts of green leaves. Chlorophyll absorbs sunlight. "
        "Plants take in carbon dioxide through stomata and release oxygen. ") * 12


RESP_TEXT = ("Respiration releases energy from glucose in the mitochondria of cells. Aerobic respiration uses oxygen. "
             "Anaerobic respiration happens without oxygen in yeast and muscles. ") * 12


def run_quizzes(fake=None):
    with patch("assessments.services.generation.gateway") as gw:
        gw.return_value.generate.side_effect = fake or FakeModel()
        return auto_quiz.run_pending(wait_for_students=False)


class Base(TestCase):
    def setUp(self):
        self.faculty = make_faculty()
        self.student = make_student()
        self.subject = make_subject(code="AQ")
        assign(self.faculty, self.subject)
        enroll(self.student, self.subject)
        self.doc = make_published_document(self.subject, modules=(("Photosynthesis", TEXT), ("Respiration", RESP_TEXT)))
        self.m1, self.m2 = Module.objects.get(title="Photosynthesis"), Module.objects.get(title="Respiration")
        self.fc, self.sc = client_for(self.faculty), client_for(self.student)

    def student_quizzes(self, module):
        res = self.sc.get("/api/student/quizzes/", {"module": str(module.id)})
        rows = res.data.get("results", res.data) if isinstance(res.data, dict) else res.data
        return rows


@override_settings(MEDIA_ROOT=MEDIA)
class GeneratedOnUploadTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(MEDIA, ignore_errors=True)
        super().tearDownClass()

    @override_settings(AUTO_QUIZ={**settings.AUTO_QUIZ, "ENABLED": True, "MIN_CHARS": 0, "MCQS": 1, "SUBJECTIVE": 0})
    def test_processing_queues_a_quiz_for_every_module_with_text(self):
        # One question is supportable by every nonempty section in fake_parse.
        # MIN_CHARS=0 no longer overrides the source budget for five questions.
        from documents.tests import PDF_BYTES, fake_parse
        faculty = make_faculty()
        subject = make_subject(code="UP")
        assign(faculty, subject)
        fc = client_for(faculty)
        with patch("documents.services.documents.parse_document", side_effect=fake_parse):
            res = fc.post("/api/faculty/documents/", {"subject_id": str(subject.id),
                                                     "file": SimpleUploadedFile("b.pdf", PDF_BYTES, content_type="application/pdf")},
                          format="multipart")
            if res.data["status"] != "under_review":
                fc.post(f"/api/faculty/documents/{res.data['id']}/process/")
        modules = Module.objects.filter(chapter__document_id=res.data["id"])
        self.assertTrue(modules.exists())
        self.assertEqual(AutoQuizJob.objects.filter(module__in=modules, status=AutoQuizStatus.PENDING).count(), modules.count())
        detail = fc.get(f"/api/faculty/documents/{res.data['id']}/").data
        self.assertEqual(detail["auto_quizzes"]["pending"], modules.count())

    @override_settings(AUTO_QUIZ={**settings.AUTO_QUIZ, "ENABLED": False})
    def test_switched_off(self):
        self.assertEqual(auto_quiz.request_quizzes([]), 0)
        self.assertEqual(auto_quiz.on_content_changed([], "x"), 0)


class PublishedWhenTheModuleOpensTests(Base):
    def test_ready_quiz_on_an_open_module_is_published_straight_away(self):
        auto_quiz.request_quizzes([self.m1])
        self.assertEqual(run_quizzes()["ready"], 1)
        quiz = Assessment.objects.get(module=self.m1, auto_generated=True)
        self.assertEqual(quiz.status, "published")
        self.assertEqual(len(quiz.questions), 5)
        self.assertEqual(len(self.student_quizzes(self.m1)), 1)

    def test_quiz_waits_while_the_module_is_locked_then_goes_live_when_opened(self):
        self.fc.post(f"/api/faculty/modules/{self.m2.id}/availability/", {"availability": "locked"}, format="json")
        auto_quiz.request_quizzes([self.m2])
        run_quizzes()
        quiz = Assessment.objects.get(module=self.m2, auto_generated=True)
        self.assertEqual(quiz.status, "draft")
        self.m2.refresh_from_db()
        self.assertEqual(self.m2.availability, "locked", "an automatic quiz never opens a locked module")
        with self.captureOnCommitCallbacks(execute=True):
            self.fc.post(f"/api/faculty/modules/{self.m2.id}/availability/", {"availability": "open"}, format="json")
        quiz.refresh_from_db()
        self.assertEqual(quiz.status, "published")

    def test_text_change_rewrites_an_unattempted_quiz_but_keeps_one_with_attempts(self):
        auto_quiz.request_quizzes([self.m1])
        run_quizzes()
        quiz = Assessment.objects.get(module=self.m1, auto_generated=True)
        first_questions = quiz.questions
        with self.captureOnCommitCallbacks(execute=True):
            self.fc.patch(f"/api/faculty/modules/{self.m1.id}/", {"source_text": TEXT + " Glucose is stored as starch."}, format="json")
        run_quizzes(FakeModel(question=lambda topic, i: f"After the edit, what is true of {topic} ({i})?"))
        quiz.refresh_from_db()
        self.assertNotEqual(quiz.questions, first_questions)
        self.assertEqual(Assessment.objects.filter(module=self.m1, auto_generated=True).count(), 1)
        # A student attempts it; a later edit must not change the questions.
        start = self.sc.post(f"/api/student/quizzes/{quiz.id}/attempts/")
        self.assertIn(start.status_code, (200, 201), start.content)
        kept = quiz.questions
        with self.captureOnCommitCallbacks(execute=True):
            self.fc.patch(f"/api/faculty/modules/{self.m1.id}/", {"source_text": TEXT + " Starch turns iodine blue."}, format="json")
        run_quizzes()
        quiz.refresh_from_db()
        self.assertEqual(quiz.questions, kept)
        self.assertIn("students have attempted", AutoQuizJob.objects.get(module=self.m1).note)

    def test_deleted_automatic_quiz_is_not_generated_again(self):
        auto_quiz.request_quizzes([self.m1])
        run_quizzes()
        quiz = Assessment.objects.get(module=self.m1, auto_generated=True)
        self.assertIn(self.fc.delete(f"/api/faculty/quizzes/{quiz.id}/").status_code, (200, 204))
        self.assertEqual(AutoQuizJob.objects.get(module=self.m1).status, AutoQuizStatus.DISMISSED)
        self.assertEqual(auto_quiz.request_quizzes([self.m1]), 0)
        res = self.fc.post(f"/api/faculty/modules/{self.m1.id}/auto-quiz/", {}, format="json")
        self.assertEqual(res.status_code, 202)
        self.assertEqual(run_quizzes()["ready"], 1)

    def test_model_down_is_retried_later_without_a_placeholder_quiz(self):
        auto_quiz.request_quizzes([self.m1])
        run_quizzes(lambda **k: AIResult(ok=False, error_code="unavailable", error="down"))
        job = AutoQuizJob.objects.get(module=self.m1)
        self.assertEqual(job.status, AutoQuizStatus.FAILED)
        self.assertIsNotNone(job.next_attempt_at)
        self.assertFalse(Assessment.objects.filter(module=self.m1).exists())

    def test_worker_marks_its_calls_as_background(self):
        auto_quiz.request_quizzes([self.m1])
        fake = FakeModel()
        run_quizzes(fake)
        self.assertTrue(all(call.get("background") for call in fake.calls))


class OfflineBundleTests(Base):
    def test_bundle_holds_open_modules_lessons_and_quizzes_in_the_apps_own_shapes(self):
        from tutor import lessons
        lessons.request_lessons([self.m1, self.m2])
        with patch("tutor.lessons.gateway") as gw:
            gw.return_value.generate.return_value = AIResult(ok=True, model="m", data={
                "title": "T", "learning_objectives": ["a", "b"], "summary": "s", "key_terms": [],
                "sections": [{"heading": "h", "explanation": "e", "source_reference": "s"}] * 2})
            lessons.run_pending(wait_for_students=False)
        auto_quiz.request_quizzes([self.m1])
        run_quizzes()
        self.fc.post(f"/api/faculty/modules/{self.m2.id}/availability/", {"availability": "locked"}, format="json")

        res = self.sc.get("/api/student/offline/")
        self.assertEqual(res.status_code, 200, res.content)
        entries = res.data["entries"]
        self.assertEqual(entries[f"/student/modules/{self.m1.id}/"], self.sc.get(f"/api/student/modules/{self.m1.id}/").data | {"progress": entries[f"/student/modules/{self.m1.id}/"]["progress"]})
        self.assertEqual(entries[f"/student/modules/{self.m1.id}/teach/"]["status"], "ready")
        self.assertIn(f"/student/quizzes/?module={self.m1.id}", entries)
        self.assertEqual(len(entries[f"/student/quizzes/?module={self.m1.id}"]), 1)
        self.assertIn(f"/student/documents/{self.doc.id}/", entries)
        self.assertIn("/student/subjects/", entries)
        self.assertNotIn(f"/student/modules/{self.m2.id}/", entries, "locked modules are not downloaded")
        self.assertTrue(res.data["version"])

    def test_downloading_does_not_mark_modules_as_read(self):
        ModuleProgress.objects.all().delete()
        self.sc.get("/api/student/offline/")
        self.assertFalse(ModuleProgress.objects.filter(student=self.student).exists())

    def test_version_changes_only_when_content_does(self):
        first = self.sc.get("/api/student/offline/").data["version"]
        self.assertEqual(self.sc.get("/api/student/offline/").data["version"], first)
        self.fc.post(f"/api/faculty/modules/{self.m2.id}/availability/", {"availability": "locked"}, format="json")
        self.assertNotEqual(self.sc.get("/api/student/offline/").data["version"], first)

    def test_other_students_and_faculty_get_nothing_of_it(self):
        outsider = client_for(make_student())
        entries = outsider.get("/api/student/offline/").data["entries"]
        self.assertFalse(any(str(self.m1.id) in key for key in entries))
        self.assertEqual(self.fc.get("/api/student/offline/").status_code, 403)


class OutlineEditsWithAutomaticQuizzesTests(Base):
    def _outline_without(self, module):
        outline = self.fc.get(f"/api/faculty/documents/{self.doc.id}/outline/").data
        for chapter in outline["chapters"]:
            chapter["modules"] = [m for m in chapter["modules"] if m["id"] != str(module.id)]
        return outline

    def test_a_module_whose_automatic_quiz_nobody_attempted_can_still_be_removed(self):
        auto_quiz.request_quizzes([self.m2])
        run_quizzes()
        self.assertTrue(Assessment.objects.filter(module=self.m2, auto_generated=True).exists())
        res = self.fc.put(f"/api/faculty/documents/{self.doc.id}/outline/", self._outline_without(self.m2), format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(Module.objects.filter(pk=self.m2.pk).exists())
        self.assertFalse(Assessment.objects.filter(auto_generated=True, module_id=self.m2.pk).exists())

    def test_but_not_once_a_student_has_attempted_it(self):
        auto_quiz.request_quizzes([self.m2])
        run_quizzes()
        quiz = Assessment.objects.get(module=self.m2, auto_generated=True)
        self.sc.post(f"/api/student/quizzes/{quiz.id}/attempts/")
        res = self.fc.put(f"/api/faculty/documents/{self.doc.id}/outline/", self._outline_without(self.m2), format="json")
        self.assertEqual(res.status_code, 409, res.content)
        self.assertEqual(res.data["error"]["code"], "MODULE_IN_USE")


class AutoQuizEditingTests(Base):
    def test_faculty_can_edit_an_attempted_automatic_quiz_into_a_new_version(self):
        auto_quiz.request_quizzes([self.m1])
        run_quizzes()
        quiz = Assessment.objects.get(module=self.m1, auto_generated=True)
        self.assertEqual(quiz.status, "published")
        self.assertEqual(quiz.chapter_id, self.m1.chapter_id)
        start = self.sc.post(f"/api/student/quizzes/{quiz.id}/attempts/")
        self.assertIn(start.status_code, (200, 201), start.content)
        questions = [dict(q) for q in quiz.questions]
        questions[0]["question"] = "Edited by faculty: where does photosynthesis happen?"
        res = self.fc.patch(f"/api/faculty/quizzes/{quiz.id}/", {"questions": questions}, format="json")
        self.assertIn(res.status_code, (200, 201), res.content)
        self.assertEqual(Assessment.objects.get(pk=quiz.pk).status, "superseded")
        self.assertEqual(Assessment.objects.get(pk=res.data["id"]).questions[0]["question"], questions[0]["question"])


class OfflineQuizEntriesMatchTheViewTests(Base):
    def test_every_per_module_quiz_entry_is_what_the_view_returns(self):
        mcq = {"type": "mcq", "question": "Where does photosynthesis happen?", "options": [{"key": k, "text": t} for k, t in zip("ABCD", ["Chloroplasts", "Roots", "Stem", "Bark"])], "correct_answer": "A"}
        for module in (self.m1, self.m1):
            q = self.fc.post("/api/faculty/quizzes/", {"module_id": str(module.id), "questions": [mcq]}, format="json").data
            self.fc.post(f"/api/faculty/quizzes/{q['id']}/status/", {"status": "published"}, format="json")
        chapter_quiz = self.fc.post("/api/faculty/quizzes/", {"chapter_id": str(self.m1.chapter_id), "questions": [mcq]}, format="json").data
        self.fc.post(f"/api/faculty/quizzes/{chapter_quiz['id']}/status/", {"status": "published"}, format="json")
        entries = self.sc.get("/api/student/offline/").data["entries"]
        for module in (self.m1, self.m2):
            key = f"/student/quizzes/?module={module.id}"
            self.assertEqual(entries[key], self.sc.get("/api/student/quizzes/", {"module": str(module.id)}).data, key)
        self.assertEqual(len(entries[f"/student/quizzes/?module={self.m1.id}"]), 2)
