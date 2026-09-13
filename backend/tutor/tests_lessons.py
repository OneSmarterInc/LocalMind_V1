"""Background lesson generation: lessons are made when content arrives or
changes, stored, and read by students without the model being called."""
import shutil
import tempfile
from datetime import timedelta
from io import BytesIO
from unittest.mock import patch

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone

from ai import gateway as gateway_module
from ai.gateway import AIResult
from core.testing import assign, client_for, enroll, make_faculty, make_published_document, make_student, make_subject
from learning.models import Module

from . import lessons
from .models import LessonStatus, ModuleLesson

AI_ON = {**settings.AI, "ENABLED": True}
MEDIA = tempfile.mkdtemp(prefix="lessons-media-")


def lesson_json(tag="T"):
    return {"title": tag, "learning_objectives": ["a", "b"],
            "sections": [{"heading": "h", "explanation": f"explained {tag}", "source_reference": "s"}] * 2,
            "key_terms": [], "summary": "s"}


def ok(tag="T"):
    return AIResult(ok=True, data=lesson_json(tag), model="qwen3:1.7b")


class LessonTestBase(TestCase):
    def setUp(self):
        self.faculty = make_faculty()
        self.other_faculty = make_faculty()
        self.student = make_student()
        self.subject = make_subject(code="LSN")
        assign(self.faculty, self.subject)
        enroll(self.student, self.subject)
        self.doc = make_published_document(self.subject)
        self.module = Module.objects.get(title="Process Management")
        self.memory = Module.objects.get(title="Memory Management")
        self.fc = client_for(self.faculty)
        self.sc = client_for(self.student)

    def teach(self, module=None, client=None):
        return (client or self.sc).get(f"/api/student/modules/{(module or self.module).id}/teach/")

    def generate_all(self, result=None):
        with patch("tutor.lessons.gateway") as gw:
            if callable(result):
                gw.return_value.generate.side_effect = result
            else:
                gw.return_value.generate.return_value = result or ok()
            outcome = lessons.run_pending(wait_for_students=False)
        return gw, outcome


class StudentReadsStoredLessonsTests(LessonTestBase):
    def test_generated_lesson_is_served_without_calling_the_model(self):
        lessons.request_lessons([self.module, self.memory])
        gw, outcome = self.generate_all()
        self.assertEqual(outcome["ready"], 2)
        prompt = gw.return_value.generate.call_args_list[0].kwargs["user_prompt"]
        self.assertIn("SOURCE TEXT", prompt)
        with patch("tutor.lessons.gateway") as never:
            res = self.teach()
            post = self.sc.post(f"/api/student/modules/{self.module.id}/teach/")
        never.assert_not_called()
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["status"], "ready")
        self.assertEqual(res.data["generator"], "ai")
        self.assertEqual(res.data["lesson"]["title"], "T")
        self.assertEqual(post.data["status"], "ready")

    @override_settings(AI=AI_ON)
    def test_before_generation_the_student_is_told_it_is_being_prepared(self):
        lessons.request_lessons([self.module, self.memory])
        res = self.teach(self.memory)
        self.assertEqual(res.data["status"], "preparing")
        self.assertIsNone(res.data["lesson"])
        self.assertEqual(res.data["queue_position"], 2)

    def test_with_ai_off_the_student_gets_a_plain_lesson_from_the_text(self):
        lessons.request_lessons([self.module])
        res = self.teach()
        self.assertEqual(res.data["status"], "unavailable")
        self.assertEqual(res.data["generator"], "fallback")
        self.assertIn("Processes are programs", res.data["lesson"]["sections"][0]["explanation"])

    def test_access_rules_still_apply(self):
        lessons.request_lessons([self.module])
        self.generate_all()
        outsider = make_student()
        self.assertEqual(self.teach(client=client_for(outsider)).status_code, 404)
        self.fc.post(f"/api/faculty/modules/{self.module.id}/availability/", {"availability": "locked"}, format="json")
        self.assertEqual(self.teach().status_code, 403)

    def test_a_ready_lesson_for_old_text_is_never_shown(self):
        lessons.request_lessons([self.module])
        self.generate_all(ok("old"))
        Module.objects.filter(pk=self.module.pk).update(source_text="Entirely different text about threads and locks.")
        self.module.refresh_from_db()
        res = self.teach()
        self.assertNotEqual(res.data["status"], "ready")
        self.assertNotEqual((res.data.get("lesson") or {}).get("title"), "old")


@override_settings(MEDIA_ROOT=MEDIA)
class LessonsQueuedWhenContentArrivesTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(MEDIA, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        from documents.tests import fake_parse
        self.fake_parse = fake_parse
        self.faculty = make_faculty()
        self.subject = make_subject(code="UPL")
        assign(self.faculty, self.subject)
        self.fc = client_for(self.faculty)

    def _upload_and_process(self):
        from documents.tests import PDF_BYTES
        with patch("documents.services.documents.parse_document", side_effect=self.fake_parse):
            res = self.fc.post("/api/faculty/documents/", {"subject_id": str(self.subject.id),
                                                          "file": SimpleUploadedFile("book.pdf", PDF_BYTES, content_type="application/pdf")},
                               format="multipart")
            self.assertEqual(res.status_code, 201, res.content)
            doc_id = res.data["id"]
            if res.data["status"] != "under_review":
                processed = self.fc.post(f"/api/faculty/documents/{doc_id}/process/")
                self.assertIn(processed.status_code, (200, 202), processed.content)
        return doc_id

    def test_processing_queues_a_lesson_for_every_module_with_text(self):
        doc_id = self._upload_and_process()
        modules = Module.objects.filter(chapter__document_id=doc_id)
        self.assertTrue(modules.exists())
        self.assertEqual(ModuleLesson.objects.filter(module__in=modules, status=LessonStatus.PENDING).count(), modules.count())
        detail = self.fc.get(f"/api/faculty/documents/{doc_id}/").data
        self.assertEqual(detail["lessons"]["total"], modules.count())
        self.assertEqual(detail["lessons"]["pending"], modules.count())
        outline = self.fc.get(f"/api/faculty/documents/{doc_id}/outline/").data
        self.assertTrue(all(m["lesson_status"] == "pending" for c in outline["chapters"] for m in c["modules"]))

    @override_settings(LESSONS={**settings.LESSONS, "AUTO_GENERATE": False})
    def test_auto_generation_off_queues_nothing_until_faculty_ask(self):
        doc_id = self._upload_and_process()
        self.assertFalse(ModuleLesson.objects.exists())
        res = self.fc.post(f"/api/faculty/documents/{doc_id}/lessons/", {}, format="json")
        self.assertEqual(res.status_code, 202, res.content)
        self.assertEqual(res.data["queued"], Module.objects.filter(chapter__document_id=doc_id).count())

    def test_outline_save_queues_only_new_or_changed_modules(self):
        doc_id = self._upload_and_process()
        with patch("tutor.lessons.gateway") as gw:
            gw.return_value.generate.return_value = ok()
            lessons.run_pending(wait_for_students=False)
            first_round = gw.return_value.generate.call_count
        outline = self.fc.get(f"/api/faculty/documents/{doc_id}/outline/").data
        chapter = outline["chapters"][0]
        payload = {"chapters": [{"id": c["id"], "title": c["title"], "source_heading_index": c["source_heading_index"],
                                 "modules": [{"id": m["id"], "title": m["title"], "source_heading_index": m["source_heading_index"]}
                                             for m in c["modules"]]} for c in outline["chapters"]]}
        payload["chapters"][0]["modules"].append({"title": "Added by hand", "source_heading_index": None,
                                                  "source_text": "Hand-written notes on the working set model."})
        payload["chapters"][0]["modules"].append({"title": "Forgot the text", "source_heading_index": None, "source_text": ""})
        # An empty new module now rejects the entire edit. Check rollback,
        # not silent deletion, then retry with a valid outline.
        from documents.models import Document
        before_modules = list(Module.objects.filter(chapter__document_id=doc_id)
                              .order_by("id").values_list("id", "title", "source_text", "order"))
        before_lessons = list(ModuleLesson.objects.order_by("id").values_list("id", "status", "version"))
        before_version = Document.objects.get(pk=doc_id).content_version
        with self.captureOnCommitCallbacks(execute=True):
            rejected = self.fc.put(f"/api/faculty/documents/{doc_id}/outline/", payload, format="json")
        self.assertEqual(rejected.status_code, 400, rejected.content)
        self.assertEqual(rejected.data["error"]["code"], "EMPTY_SOURCE_TEXT")
        self.assertEqual(list(Module.objects.filter(chapter__document_id=doc_id)
                              .order_by("id").values_list("id", "title", "source_text", "order")), before_modules)
        self.assertEqual(list(ModuleLesson.objects.order_by("id").values_list("id", "status", "version")), before_lessons)
        self.assertEqual(Document.objects.get(pk=doc_id).content_version, before_version)
        self.assertFalse(Module.objects.filter(title="Added by hand").exists())
        self.assertFalse(Module.objects.filter(title="Forgot the text").exists())
        payload["chapters"][0]["modules"].pop()
        with self.captureOnCommitCallbacks(execute=True):
            res = self.fc.put(f"/api/faculty/documents/{doc_id}/outline/", payload, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(Module.objects.filter(title="Forgot the text").exists())
        added = Module.objects.get(title="Added by hand")
        self.assertEqual(ModuleLesson.objects.get(module=added).status, LessonStatus.PENDING)
        untouched = Module.objects.get(pk=chapter["modules"][0]["id"])
        self.assertEqual(ModuleLesson.objects.get(module=untouched).status, LessonStatus.READY)
        with patch("tutor.lessons.gateway") as gw:
            gw.return_value.generate.return_value = ok()
            lessons.run_pending(wait_for_students=False)
            self.assertEqual(gw.return_value.generate.call_count, 1, "only the new module is generated")
        self.assertGreater(first_round, 0)


class EditsDuringGenerationTests(LessonTestBase):
    def test_module_text_edited_while_its_lesson_is_generating(self):
        lessons.request_lessons([self.module])
        row = lessons.claim_next()
        self.assertEqual(row.status, LessonStatus.GENERATING)

        def edit_then_answer(**kwargs):
            # Faculty save new text while the model is still working on the old.
            with self.captureOnCommitCallbacks(execute=True):
                res = self.fc.patch(f"/api/faculty/modules/{self.module.id}/", {"source_text": "Threads share an address space."}, format="json")
            assert res.status_code == 200, res.content
            return ok("for old text")

        with patch("tutor.lessons.gateway") as gw:
            gw.return_value.generate.side_effect = edit_then_answer
            self.assertEqual(lessons.process_one(row), "discarded")
        fresh = ModuleLesson.objects.get(module=self.module)
        self.assertEqual(fresh.status, LessonStatus.PENDING)
        self.assertIsNone(fresh.lesson)
        gw, outcome = self.generate_all(ok("for new text"))
        self.assertEqual(outcome["ready"], 1)
        self.assertIn("Threads share an address space.", gw.return_value.generate.call_args.kwargs["user_prompt"])
        self.assertEqual(self.teach().data["lesson"]["title"], "for new text")

    def test_module_deleted_while_generating_is_discarded_quietly(self):
        lessons.request_lessons([self.module])
        row = lessons.claim_next()

        def delete_then_answer(**kwargs):
            Module.objects.filter(pk=self.module.pk).delete()
            return ok()

        with patch("tutor.lessons.gateway") as gw:
            gw.return_value.generate.side_effect = delete_then_answer
            self.assertEqual(lessons.process_one(row), "discarded")
        self.assertFalse(ModuleLesson.objects.exists())

    def test_one_job_cannot_be_claimed_twice(self):
        lessons.request_lessons([self.module])
        self.assertIsNotNone(lessons.claim_next())
        self.assertIsNone(lessons.claim_next())

    def test_a_job_abandoned_by_a_stopped_process_is_reclaimed(self):
        lessons.request_lessons([self.module])
        lessons.claim_next()
        self.assertIsNone(lessons.claim_next())
        ModuleLesson.objects.update(claimed_at=timezone.now() - timedelta(minutes=settings.LESSONS["STALE_MINUTES"] + 1))
        self.assertIsNotNone(lessons.claim_next())

    def test_published_books_are_generated_first(self):
        from documents.models import Document
        draft = make_published_document(self.subject, title="Draft", modules=(("Draft module", "Draft text about queues."),))
        Document.objects.filter(pk=draft.pk).update(status="under_review")
        draft_module = Module.objects.get(title="Draft module")
        lessons.request_lessons([draft_module])
        lessons.request_lessons([self.module])
        self.assertEqual(lessons.claim_next().module_id, self.module.id)


class FailureAndRetryTests(LessonTestBase):
    def test_model_unavailable_is_retried_on_a_timer_without_using_attempts(self):
        lessons.request_lessons([self.module])
        self.generate_all(AIResult(ok=False, error_code="unavailable", error="model missing"))
        row = ModuleLesson.objects.get(module=self.module)
        self.assertEqual(row.status, LessonStatus.FAILED)
        self.assertEqual(row.attempts, 0)
        self.assertIsNotNone(row.next_attempt_at)
        with override_settings(AI=AI_ON):
            res = self.teach()
        self.assertEqual(res.data["status"], "unavailable")
        self.assertTrue(res.data["retry_scheduled"])
        self.assertEqual(res.data["generator"], "fallback")
        self.assertIsNone(lessons.claim_next(), "not due yet")
        ModuleLesson.objects.update(next_attempt_at=timezone.now() - timedelta(seconds=1))
        _, outcome = self.generate_all()
        self.assertEqual(outcome["ready"], 1)

    def test_bad_model_output_gives_up_after_max_attempts_until_faculty_ask(self):
        lessons.request_lessons([self.module])
        bad = AIResult(ok=False, error_code="invalid_schema", error="missing sections")
        for attempt in range(1, settings.LESSONS["MAX_ATTEMPTS"] + 1):
            self.generate_all(bad)
            row = ModuleLesson.objects.get(module=self.module)
            self.assertEqual(row.attempts, attempt)
            ModuleLesson.objects.filter(next_attempt_at__isnull=False).update(next_attempt_at=timezone.now() - timedelta(seconds=1))
        row = ModuleLesson.objects.get(module=self.module)
        self.assertIsNone(row.next_attempt_at, "gave up")
        self.assertIsNone(lessons.claim_next())
        res = self.fc.post(f"/api/faculty/modules/{self.module.id}/lesson/", {}, format="json")
        self.assertEqual(res.status_code, 202, res.content)
        self.assertEqual(res.data["status"], "pending")
        row.refresh_from_db()
        self.assertEqual(row.attempts, 0)
        _, outcome = self.generate_all()
        self.assertEqual(outcome["ready"], 1)

    def test_a_crash_inside_generation_does_not_stop_the_queue(self):
        lessons.request_lessons([self.module, self.memory])
        calls = {"n": 0}

        def flaky(**kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("boom")
            return ok()

        _, outcome = self.generate_all(flaky)
        self.assertEqual(outcome, {"ready": 1, "failed": 1, "discarded": 0})


class FacultyLessonEndpointsTests(LessonTestBase):
    def test_preview_regenerate_and_scope(self):
        lessons.request_lessons([self.module])
        self.generate_all(ok("first"))
        detail = self.fc.get(f"/api/faculty/modules/{self.module.id}/lesson/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.data["status"], "ready")
        self.assertEqual(detail.data["lesson"]["title"], "first")
        self.assertEqual(client_for(self.other_faculty).get(f"/api/faculty/modules/{self.module.id}/lesson/").status_code, 404)
        self.assertEqual(self.sc.get(f"/api/faculty/modules/{self.module.id}/lesson/").status_code, 403)
        again = self.fc.post(f"/api/faculty/modules/{self.module.id}/lesson/", {}, format="json")
        self.assertEqual(again.status_code, 202)
        # A forced regeneration is a deliberate "this lesson is not good
        # enough", so the replacement is what students see once it is ready.
        self.generate_all(ok("second"))
        self.assertEqual(self.teach().data["lesson"]["title"], "second")

    def test_document_counts_and_generate_all(self):
        lessons.request_lessons([self.module])
        self.generate_all()
        res = self.fc.post(f"/api/faculty/documents/{self.doc.id}/lessons/", {}, format="json")
        self.assertEqual(res.status_code, 202)
        self.assertEqual(res.data["queued"], 1, "only the module without a lesson")
        self.assertEqual(res.data["ready"], 1)
        self.assertEqual(res.data["pending"], 1)
        forced = self.fc.post(f"/api/faculty/documents/{self.doc.id}/lessons/", {"force": True}, format="json")
        self.assertEqual(forced.data["queued"], 2)


class StudentsComeFirstTests(TestCase):
    def test_foreground_calls_are_counted_and_background_ones_are_not(self):
        seen = {}

        class Provider:
            name = "fake"

            def generate_structured(self, **kwargs):
                seen.setdefault("busy", []).append(gateway_module.foreground_busy())
                return AIResult(ok=True, data={"answer": "x"})

        gw = gateway_module.AIGateway(provider=Provider())
        schema = {"type": "object", "properties": {"answer": {"type": "string"}}, "required": ["answer"]}
        gw.generate(task="tutor", system_prompt="s", user_prompt="u", schema=schema)
        gw.generate(task="lesson", system_prompt="s", user_prompt="u", schema=schema, background=True)
        self.assertEqual(seen["busy"], [True, False])
        self.assertFalse(gateway_module.foreground_busy())

    def test_worker_waits_while_a_student_request_is_running(self):
        import time
        gateway_module._foreground_calls += 1
        try:
            started = time.monotonic()
            with override_settings(LESSONS={**settings.LESSONS, "YIELD_SECONDS": 0.05}):
                lessons._wait_for_students(max_wait=0.3)
            self.assertGreaterEqual(time.monotonic() - started, 0.3)
        finally:
            gateway_module._foreground_calls -= 1


class OlderClientsTests(LessonTestBase):
    @override_settings(AI=AI_ON)
    def test_post_from_an_older_client_always_carries_a_lesson(self):
        """Clients built before background lessons read lesson.title without a
        null check; a null lesson blanked their screen."""
        lessons.request_lessons([self.module])
        current = self.teach()
        self.assertEqual(current.data["status"], "preparing")
        self.assertIsNone(current.data["lesson"])
        older = self.sc.post(f"/api/student/modules/{self.module.id}/teach/")
        self.assertEqual(older.status_code, 200)
        self.assertEqual(older.data["status"], "preparing")
        self.assertEqual(older.data["generator"], "fallback")
        self.assertTrue(older.data["lesson"]["title"])
        self.assertTrue(older.data["lesson"]["sections"])
