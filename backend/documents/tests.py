import threading
from django.db import OperationalError, connection
from django.test import TransactionTestCase
from documents.services import documents as documents_service
from datetime import timedelta
from django.utils import timezone
import shutil
import tempfile
from io import BytesIO
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from audit.models import AuditLog
from core.testing import assign, client_for, enroll, make_admin, make_faculty, make_student, make_subject
from learning.models import Chapter, Module

from core.exceptions import ValidationFailed

from .models import Document, DocumentStatus
from .services.outline import ai_outline, persist_outline, source_hierarchy_outline
from .services.parser import extract_sections_from_markdown

MEDIA = tempfile.mkdtemp(prefix="lm-media-")

SAMPLE_MD = """# Operating Systems
Intro paragraph about operating systems.

## Process Management
Processes are programs in execution.

### Scheduling
Round robin and priority scheduling.

## Memory Management
Paging and segmentation.

# Networks
## Transport Layer
TCP and UDP.
"""

PDF_BYTES = b"%PDF-1.4\n%fake\n"


def fake_parse(document):
    import os
    sections = extract_sections_from_markdown(SAMPLE_MD)
    from .services.parser import _extract_headings
    path = ""
    if document is not None:
        folder = os.path.join(MEDIA, "processed", str(document.id))
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, "document.md")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(SAMPLE_MD)
    return {"markdown": SAMPLE_MD, "markdown_path": path, "headings": _extract_headings(sections),
            "sections": sections, "parse_mode": "test"}


def pdf_upload(name="book.pdf", content=PDF_BYTES):
    return SimpleUploadedFile(name, content, content_type="application/pdf")


@override_settings(MEDIA_ROOT=MEDIA)
class ParserAndOutlineTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(MEDIA, ignore_errors=True)
        super().tearDownClass()

    def test_sections_are_indexed_and_bounded_by_sibling_or_ancestor(self):
        sections = extract_sections_from_markdown(SAMPLE_MD)
        titles = [(s["index"], s["level"], s["title"]) for s in sections]
        self.assertEqual(titles[0], (0, 1, "Operating Systems"))
        self.assertIn("Scheduling", sections[1]["source_text"])   # H2 keeps its H3 content
        self.assertNotIn("Memory Management", sections[1]["source_text"])
        self.assertNotIn("Networks", sections[0]["source_text"])

    def test_inline_heading_marker_is_recovered(self):
        sections = extract_sections_from_markdown("# Alpha\nsome text. ## Beta\nmore")
        self.assertEqual([s["title"] for s in sections], ["Alpha", "Beta"])

    def test_source_hierarchy_outline(self):
        sections = extract_sections_from_markdown(SAMPLE_MD)
        outline = source_hierarchy_outline("book.pdf", sections)
        self.assertEqual([c["title"] for c in outline["chapters"]], ["Operating Systems", "Networks"])
        self.assertEqual([m["title"] for m in outline["chapters"][0]["modules"]], ["Operating Systems: Overview", "Process Management", "Memory Management"])
        self.assertEqual(outline["chapters"][0]["modules"][1]["source_heading_index"], 1)
        self.assertIn("Intro paragraph", outline["chapters"][0]["modules"][0]["source_text"])

    def _doc(self):
        subject = make_subject()
        return Document.objects.create(subject=subject, original_name="book.pdf", title="book", file_type="pdf")

    @patch("documents.services.outline.gateway")
    def test_ai_outline_with_invalid_index_is_discarded(self, gw):
        from ai.gateway import AIResult
        gw.return_value.generate.return_value = AIResult(ok=True, data={"document_title": "X", "chapters": [
            {"title": "Made up", "source_heading_index": 99, "modules": []}]})
        headings = fake_parse(None)["headings"]
        self.assertIsNone(ai_outline(self._doc(), headings))

    @patch("documents.services.outline.gateway")
    def test_ai_outline_using_a_chapter_heading_as_a_module_is_discarded(self, gw):
        # The H1 section holds every H2 under it, so that module would repeat
        # the whole chapter (a Word chapter uploaded as one 50,000-char module).
        from ai.gateway import AIResult
        gw.return_value.generate.return_value = AIResult(ok=True, data={"document_title": "X", "chapters": [
            {"title": "Course", "source_heading_index": 1,
             "modules": [{"title": "Operating Systems", "source_heading_index": 0}]}]})
        self.assertIsNone(ai_outline(self._doc(), fake_parse(None)["headings"]))

    @patch("documents.services.outline.gateway")
    def test_ai_outline_keeps_source_index_mapping(self, gw):
        from ai.gateway import AIResult
        gw.return_value.generate.return_value = AIResult(ok=True, data={"document_title": "OS Course", "chapters": [
            {"title": "Fundamentals", "source_heading_index": 0,
             "modules": [{"title": "Processes", "source_heading_index": 1}, {"title": "Memory", "source_heading_index": 3}]}]})
        parsed = fake_parse(None)
        doc = self._doc()
        outline = ai_outline(doc, parsed["headings"])
        self.assertEqual(outline["chapters"][0]["modules"][1]["source_heading_index"], 3)
        persist_outline(doc, outline, parsed["sections"])
        module = Module.objects.get(chapter__document=doc, title="Memory")
        self.assertIn("Paging", module.source_text)
        self.assertFalse(module.source_missing)

    def test_persist_outline_never_creates_a_module_without_text(self):
        doc = self._doc()
        parsed = fake_parse(None)
        outline = {"document_title": "T", "chapters": [
            {"title": "C", "source_heading_index": 0,
             "modules": [{"title": "Real", "source_heading_index": 1}, {"title": "Ghost", "source_heading_index": None}]},
            {"title": "Empty chapter", "modules": [{"title": "Also ghost", "source_heading_index": None, "source_text": "   "}]}]}
        with self.assertRaises(ValidationFailed) as ctx:
            persist_outline(doc, outline, parsed["sections"], user_edited=True)
        self.assertEqual(ctx.exception.code, "EMPTY_SOURCE_TEXT")
        self.assertFalse(Module.objects.filter(chapter__document=doc).exists())
        self.assertFalse(Chapter.objects.filter(document=doc).exists())

    def test_an_outline_with_no_text_anywhere_is_refused(self):
        doc = self._doc()
        parsed = fake_parse(None)
        outline = {"document_title": "T", "chapters": [{"title": "C", "modules": [{"title": "Ghost", "source_heading_index": None}]}]}
        with self.assertRaises(ValidationFailed) as ctx:
            persist_outline(doc, outline, parsed["sections"], user_edited=True)
        self.assertEqual(ctx.exception.code, "EMPTY_SOURCE_TEXT")
        self.assertFalse(Module.objects.filter(chapter__document=doc).exists())

    def test_persist_outline_reconciles_existing_ids(self):
        doc = self._doc()
        parsed = fake_parse(None)
        persist_outline(doc, source_hierarchy_outline("b.pdf", parsed["sections"]), parsed["sections"])
        chapter = doc.chapters.get(order=1)
        module = chapter.modules.get(order=1)
        new_outline = {"document_title": "Renamed", "chapters": [
            {"id": str(chapter.id), "title": "Renamed Chapter", "source_heading_index": 0,
             "modules": [{"id": str(module.id), "title": "Renamed Module", "source_heading_index": 1},
                         {"title": "Brand new", "source_heading_index": 3}]}]}
        persist_outline(doc, new_outline, parsed["sections"], user_edited=True)
        module.refresh_from_db()
        self.assertEqual(module.title, "Renamed Module")
        self.assertEqual(module.chapter_id, chapter.id)
        self.assertFalse(Chapter.objects.filter(document=doc, title="Networks").exists())
        self.assertEqual(Module.objects.filter(chapter__document=doc).count(), 2)


@override_settings(MEDIA_ROOT=MEDIA)
@patch("documents.services.documents.parse_document", side_effect=fake_parse)
class DocumentLifecycleTests(TestCase):
    def setUp(self):
        self.admin = make_admin()
        self.faculty = make_faculty()
        self.other_faculty = make_faculty()
        self.student = make_student()
        self.subject = make_subject(code="OS")
        self.other_subject = make_subject(code="DB")
        assign(self.faculty, self.subject)
        assign(self.other_faculty, self.other_subject)
        enroll(self.student, self.subject)

    def upload(self, client=None, subject=None, **kw):
        client = client or client_for(self.faculty)
        return client.post("/api/faculty/documents/", {"subject_id": str((subject or self.subject).id), "file": pdf_upload(**kw)}, format="multipart")

    def test_student_cannot_upload(self, _):
        res = client_for(self.student).post("/api/faculty/documents/", {"subject_id": str(self.subject.id), "file": pdf_upload()}, format="multipart")
        self.assertEqual(res.status_code, 403)
        # Content routes live only under /api/faculty/ now; /api/admin/documents/ does not exist.
        res = client_for(self.student).post("/api/admin/documents/", {"subject_id": str(self.subject.id), "file": pdf_upload()}, format="multipart")
        self.assertEqual(res.status_code, 404)

    def test_faculty_cannot_upload_to_unassigned_subject(self, _):
        res = self.upload(subject=self.other_subject)
        self.assertEqual(res.status_code, 404)

    def test_upload_validates_type_and_content(self, _):
        self.assertEqual(self.upload(name="notes.txt", content=b"hello").status_code, 400)
        res = self.upload(name="fake.pdf", content=b"not a pdf at all")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["code"], "FILE_CONTENT_MISMATCH")

    def test_upload_stores_under_document_id_not_client_name(self, _):
        res = self.upload(name="../../evil.pdf")
        self.assertEqual(res.status_code, 201, res.content)
        doc = Document.objects.get(pk=res.data["id"])
        self.assertTrue(doc.file.name.startswith(f"documents/{doc.id}/original"))
        self.assertEqual(doc.uploaded_by, self.faculty)
        self.assertEqual(doc.status, DocumentStatus.UPLOADED)

    def _processed_doc(self):
        client = client_for(self.faculty)
        doc_id = self.upload(client).data["id"]
        res = client.post(f"/api/faculty/documents/{doc_id}/process/")
        self.assertEqual(res.status_code, 200, res.content)
        return client, Document.objects.get(pk=doc_id)

    def test_processing_creates_mapped_structure_and_review_state(self, _):
        client, doc = self._processed_doc()
        self.assertEqual(doc.status, DocumentStatus.UNDER_REVIEW)
        self.assertEqual(doc.outline_source, "source_hierarchy")  # AI disabled in tests
        self.assertEqual(doc.chapters.count(), 2)
        module = Module.objects.get(chapter__document=doc, title="Process Management")
        self.assertEqual(module.source_heading_index, 1)
        self.assertIn("Processes are programs", module.source_text)
        self.assertEqual(module.availability, "locked")
        self.assertTrue(AuditLog.objects.filter(action="document.processed", target_id=str(doc.id)).exists())

    def test_double_processing_is_rejected(self, _):
        client = client_for(self.faculty)
        doc_id = self.upload(client).data["id"]
        Document.objects.filter(pk=doc_id).update(status=DocumentStatus.PROCESSING)
        res = client.post(f"/api/faculty/documents/{doc_id}/process/")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["error"]["code"], "ALREADY_PROCESSING")

    def test_processing_failure_sets_error_state(self, parse):
        parse.side_effect = ValueError("Unreadable PDF")
        client = client_for(self.faculty)
        doc_id = self.upload(client).data["id"]
        res = client.post(f"/api/faculty/documents/{doc_id}/process/")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data["error"]["code"], "PROCESSING_FAILED")
        doc = Document.objects.get(pk=doc_id)
        self.assertEqual(doc.status, DocumentStatus.ERROR)
        self.assertIn("Unreadable", doc.error_message)

    def test_module_text_cannot_be_emptied_and_hidden_modules_do_not_block_publish(self, _):
        client, doc = self._processed_doc()
        module = Module.objects.filter(chapter__document=doc).first()
        res = client.patch(f"/api/faculty/modules/{module.id}/", {"source_text": "   "}, format="json")
        self.assertEqual(res.status_code, 400, res.content)
        self.assertEqual(res.data["error"]["code"], "EMPTY_SOURCE_TEXT")
        module.refresh_from_db()
        self.assertTrue(module.source_text.strip())
        # A textless module kept only because student work refers to it is
        # hidden from students and does not stop the book being published.
        module.source_text, module.source_missing = "", True
        module.save()
        res = client.post(f"/api/faculty/documents/{doc.id}/publish/")
        self.assertEqual(res.status_code, 200, res.content)
        tree = client_for(self.student).get(f"/api/student/documents/{doc.id}/").data
        visible = [m["id"] for c in tree["chapters"] for m in c["modules"]]
        self.assertNotIn(str(module.id), visible)
        self.assertEqual(client_for(self.student).get(f"/api/student/modules/{module.id}/").status_code, 404)

    def test_outline_put_preserves_ids(self, _):
        client, doc = self._processed_doc()
        outline = client.get(f"/api/faculty/documents/{doc.id}/outline/").data
        keep = outline["chapters"][0]
        res = client.put(f"/api/faculty/documents/{doc.id}/outline/", {"document_title": "New", "chapters": [
            {"id": keep["id"], "title": "Only chapter", "source_heading_index": keep["source_heading_index"],
             "modules": [{"id": keep["modules"][0]["id"], "title": keep["modules"][0]["title"], "source_heading_index": keep["modules"][0]["source_heading_index"]}]}]}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["chapter_count"], 1)
        self.assertEqual(res.data["outline_source"], "edited")
        pub = client.post(f"/api/faculty/documents/{doc.id}/publish/")
        self.assertEqual(pub.status_code, 200, pub.content)
        # Editing a live book is allowed; the guard that matters is the one on
        # modules with student work, covered separately below.
        # An outline that would leave the book with no module that has text
        # is refused whole, and the live book is untouched.
        res = client.put(f"/api/faculty/documents/{doc.id}/outline/", {"chapters": [{"title": "x", "modules": []}]}, format="json")
        self.assertEqual(res.status_code, 400, res.content)
        self.assertEqual(res.data["error"]["code"], "NO_SOURCE_TEXT")
        self.assertTrue(Module.objects.filter(chapter__document=doc).exists())

    def test_other_faculty_cannot_see_or_touch_document(self, _):
        client, doc = self._processed_doc()
        other = client_for(self.other_faculty)
        self.assertEqual(other.get(f"/api/faculty/documents/{doc.id}/").status_code, 404)
        self.assertEqual(other.post(f"/api/faculty/documents/{doc.id}/publish/").status_code, 404)
        module = Module.objects.filter(chapter__document=doc).first()
        self.assertEqual(other.post(f"/api/faculty/modules/{module.id}/availability/", {"availability": "open"}, format="json").status_code, 404)
        self.assertEqual(len(other.get("/api/faculty/documents/").data["results"]), 0)

    def test_admin_sees_all_documents(self, _):
        client, doc = self._processed_doc()
        # Administrators manage content through the same routes as faculty.
        res = client_for(self.admin).get("/api/faculty/documents/")
        self.assertEqual(len(res.data["results"]), 1)
        self.assertEqual(client_for(self.admin).post(f"/api/faculty/documents/{doc.id}/publish/").status_code, 200)

    @override_settings(LOCALMIND={**__import__("django.conf").conf.settings.LOCALMIND, "FACULTY_CAN_PUBLISH": False})
    def test_publish_can_be_restricted_to_admin(self, _):
        client, doc = self._processed_doc()
        res = client.post(f"/api/faculty/documents/{doc.id}/publish/")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "PUBLISH_ADMIN_ONLY")

    def test_unpublish_and_archive(self, _):
        client, doc = self._processed_doc()
        client.post(f"/api/faculty/documents/{doc.id}/publish/")
        self.assertEqual(client.post(f"/api/faculty/documents/{doc.id}/unpublish/").data["status"], "unpublished")
        self.assertEqual(client.post(f"/api/faculty/documents/{doc.id}/archive/").data["status"], "archived")
        self.assertEqual(client.post(f"/api/faculty/documents/{doc.id}/process/").status_code, 409)

    def test_the_same_book_cannot_be_uploaded_twice_to_one_subject(self, _):
        """Two copies would be parsed twice and give students two reading paths
        through identical content."""
        first = self.upload()
        self.assertEqual(first.status_code, 201, first.content)

        again = self.upload()

        self.assertEqual(again.status_code, 409, again.content)
        self.assertEqual(again.data["error"]["code"], "DUPLICATE_DOCUMENT")
        self.assertEqual(Document.objects.filter(subject=self.subject).count(), 1)

    def test_a_renamed_copy_of_the_same_book_is_still_a_duplicate(self, _):
        """Matching on content rather than filename is the whole point."""
        self.upload()
        again = self.upload(name="renamed-copy.pdf")
        self.assertEqual(again.status_code, 409, again.content)
        self.assertEqual(again.data["error"]["code"], "DUPLICATE_DOCUMENT")

    def test_the_same_book_may_be_uploaded_to_a_different_subject(self, _):
        """The rule is per subject; one book can legitimately be on two courses."""
        self.upload()
        other = make_subject(code="OTHER")
        assign(self.faculty, other)
        res = self.upload(subject=other)
        self.assertEqual(res.status_code, 201, res.content)

    def test_a_published_book_can_still_be_restructured(self, _):
        """Faculty edit live books; the change has to reach students rather
        than being refused."""
        from learning.models import Chapter, Module

        client, doc = self._processed_doc()
        client.post(f"/api/faculty/documents/{doc.id}/publish/")
        outline = client.get(f"/api/faculty/documents/{doc.id}/outline/").data
        chapter = outline["chapters"][0]
        self.assertGreater(len(chapter["modules"]), 1)

        # Drop the last module and rename the chapter.
        payload = {"chapters": [{
            "id": chapter["id"], "title": "Renamed chapter",
            "source_heading_index": chapter.get("source_heading_index"),
            "modules": [{"id": m["id"], "title": m["title"], "source_heading_index": m["source_heading_index"]}
                        for m in chapter["modules"][:-1]],
        }]}
        res = client.put(f"/api/faculty/documents/{doc.id}/outline/", payload, format="json")

        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["status"], "published", "the book stays live while it is edited")
        self.assertEqual(Chapter.objects.get(pk=chapter["id"]).title, "Renamed chapter")
        self.assertEqual(Module.objects.filter(chapter__document=doc).count(), len(chapter["modules"]) - 1)

    def test_a_module_with_student_progress_cannot_be_dropped(self, _):
        """The guard that protects student work has to hold even now that a
        published book is editable."""
        from learning.models import Module, ModuleProgress

        client, doc = self._processed_doc()
        client.post(f"/api/faculty/documents/{doc.id}/publish/")
        outline = client.get(f"/api/faculty/documents/{doc.id}/outline/").data
        chapter = outline["chapters"][0]
        doomed = chapter["modules"][-1]
        ModuleProgress.objects.create(module=Module.objects.get(pk=doomed["id"]), student=self.student)

        payload = {"chapters": [{
            "id": chapter["id"], "title": chapter["title"],
            "source_heading_index": chapter.get("source_heading_index"),
            "modules": [{"id": m["id"], "title": m["title"], "source_heading_index": m["source_heading_index"]}
                        for m in chapter["modules"][:-1]],
        }]}
        res = client.put(f"/api/faculty/documents/{doc.id}/outline/", payload, format="json")

        self.assertEqual(res.status_code, 409, res.content)
        self.assertEqual(res.data["error"]["code"], "MODULE_IN_USE")
        self.assertTrue(Module.objects.filter(pk=doomed["id"]).exists())

    def test_delete_removes_the_book_and_the_quizzes_built_from_it(self, _):
        """The workspace deletes books now, so the PROTECT chain from quizzes
        and assignments back to chapters has to be cleared first."""
        from assessments.models import Assessment, AssessmentKind
        from assignments.models import Assignment
        from learning.models import Chapter, Module

        client, doc = self._processed_doc()
        chapter = Chapter.objects.filter(document=doc).first()
        Assessment.objects.create(subject=doc.subject, chapter=chapter, kind=AssessmentKind.values[0], title="Quiz")
        Assignment.objects.create(subject=doc.subject, chapter=chapter, title="Assignment")

        res = client.delete(f"/api/faculty/documents/{doc.id}/")

        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(Document.objects.filter(pk=doc.pk).exists())
        self.assertFalse(Chapter.objects.filter(document_id=doc.pk).exists())
        self.assertFalse(Module.objects.filter(chapter__document_id=doc.pk).exists())
        self.assertFalse(Assessment.objects.exists())
        self.assertFalse(Assignment.objects.exists())
        self.assertTrue(AuditLog.objects.filter(action="document.deleted").exists())
        # The subject the book belonged to is untouched.
        self.assertTrue(type(doc.subject).objects.filter(pk=doc.subject_id).exists())

    def test_delete_is_refused_while_processing(self, _):
        from django.utils import timezone
        doc = Document.objects.get(pk=self.upload().data["id"])
        Document.objects.filter(pk=doc.pk).update(status=DocumentStatus.PROCESSING, processing_started_at=timezone.now())
        res = client_for(self.faculty).delete(f"/api/faculty/documents/{doc.id}/")
        self.assertEqual(res.status_code, 409)
        self.assertTrue(Document.objects.filter(pk=doc.pk).exists())

    def test_stuck_processing_is_reclaimable_after_stale_window(self, _):
        from datetime import timedelta
        from io import StringIO
        from django.core.management import call_command
        from django.utils import timezone
        doc = Document.objects.get(pk=self.upload().data["id"])
        Document.objects.filter(pk=doc.pk).update(status=DocumentStatus.PROCESSING, processing_started_at=timezone.now())
        res = client_for(self.faculty).post(f"/api/faculty/documents/{doc.id}/process/")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["error"]["code"], "ALREADY_PROCESSING")
        Document.objects.filter(pk=doc.pk).update(processing_started_at=timezone.now() - timedelta(hours=2))
        out = StringIO()
        call_command("requeue_stuck_documents", "--dry-run", stdout=out)
        self.assertIn(str(doc.id), out.getvalue())
        res = client_for(self.faculty).post(f"/api/faculty/documents/{doc.id}/process/")
        self.assertEqual(res.status_code, 200, res.content)
        doc.refresh_from_db()
        self.assertEqual(doc.status, DocumentStatus.UNDER_REVIEW)

    def test_requeue_command_reprocesses_stale_document(self, _):
        from datetime import timedelta
        from io import StringIO
        from django.core.management import call_command
        from django.utils import timezone
        doc = Document.objects.get(pk=self.upload().data["id"])
        Document.objects.filter(pk=doc.pk).update(status=DocumentStatus.PROCESSING, processing_started_at=timezone.now() - timedelta(hours=2))
        out = StringIO()
        call_command("requeue_stuck_documents", stdout=out)
        doc.refresh_from_db()
        self.assertEqual(doc.status, DocumentStatus.UNDER_REVIEW)
        self.assertIn("under_review", out.getvalue())


@override_settings(MEDIA_ROOT=MEDIA)
class StudentAccessTests(TestCase):
    def setUp(self):
        patcher = patch("documents.services.documents.parse_document", side_effect=fake_parse)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.faculty = make_faculty()
        self.student = make_student()
        self.outsider = make_student()
        self.subject = make_subject(code="OS")
        assign(self.faculty, self.subject)
        enroll(self.student, self.subject)
        self.fc = client_for(self.faculty)
        doc_id = self.fc.post("/api/faculty/documents/", {"subject_id": str(self.subject.id), "file": pdf_upload()}, format="multipart").data["id"]
        self.fc.post(f"/api/faculty/documents/{doc_id}/process/")
        self.doc = Document.objects.get(pk=doc_id)
        self.module = Module.objects.get(chapter__document=self.doc, title="Process Management")

    def test_unpublished_document_invisible_to_student(self):
        sc = client_for(self.student)
        self.assertEqual(sc.get(f"/api/student/subjects/{self.subject.id}/documents/").data, [])
        self.assertEqual(sc.get(f"/api/student/documents/{self.doc.id}/").status_code, 404)
        self.assertEqual(sc.get(f"/api/student/modules/{self.module.id}/").status_code, 404)

    def test_publish_opens_every_module_with_source(self):
        self.fc.post(f"/api/faculty/documents/{self.doc.id}/publish/")
        self.assertFalse(Module.objects.filter(chapter__document=self.doc, availability="locked").exists())
        self.assertTrue(AuditLog.objects.filter(action="module.opened_on_publish", target_id=str(self.doc.id)).exists())
        sc = client_for(self.student)
        listing = sc.get(f"/api/student/documents/{self.doc.id}/").data
        self.assertEqual(listing["chapters"][0]["modules"][0]["availability"], "open")
        # Locks applied afterwards survive an unpublish/re-publish cycle.
        self.fc.post(f"/api/faculty/modules/{self.module.id}/availability/", {"availability": "locked"}, format="json")
        self.fc.post(f"/api/faculty/documents/{self.doc.id}/unpublish/")
        self.fc.post(f"/api/faculty/documents/{self.doc.id}/publish/")
        self.module.refresh_from_db()
        self.assertEqual(self.module.availability, "locked")

    def test_locked_module_returns_module_locked(self):
        self.fc.post(f"/api/faculty/documents/{self.doc.id}/publish/")
        self.fc.post(f"/api/faculty/modules/{self.module.id}/availability/", {"availability": "locked"}, format="json")
        sc = client_for(self.student)
        listed = sc.get(f"/api/student/documents/{self.doc.id}/")
        self.assertEqual(listed.status_code, 200, listed.content)
        modules = {str(m["id"]): m for c in listed.data["chapters"] for m in c["modules"]}
        # A preserved chapter introduction can now precede this module.
        self.assertIn(str(self.module.id), modules)
        locked = modules[str(self.module.id)]
        self.assertEqual(locked["availability"], "locked")
        self.assertNotIn("source_text", locked)
        res = sc.get(f"/api/student/modules/{self.module.id}/")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "MODULE_LOCKED")

    def test_open_module_readable_and_marks_in_progress(self):
        self.fc.post(f"/api/faculty/documents/{self.doc.id}/publish/")
        self.fc.post(f"/api/faculty/modules/{self.module.id}/availability/", {"availability": "locked"}, format="json")
        opened = self.fc.post(f"/api/faculty/modules/{self.module.id}/availability/", {"availability": "open"}, format="json")
        self.assertEqual(opened.data["availability"], "open")
        sc = client_for(self.student)
        res = sc.get(f"/api/student/modules/{self.module.id}/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIn("Processes are programs", res.data["source_text"])
        self.assertEqual(res.data["progress"]["status"], "in_progress")
        doc_view = sc.get(f"/api/student/documents/{self.doc.id}/").data
        self.assertEqual(doc_view["chapters"][0]["status"], "in_progress")
        subj_docs = sc.get(f"/api/student/subjects/{self.subject.id}/documents/").data
        self.assertEqual(subj_docs[0]["open_module_count"], subj_docs[0]["module_count"])

    def test_chapter_level_open_and_lock(self):
        self.fc.post(f"/api/faculty/documents/{self.doc.id}/publish/")
        chapter = self.doc.chapters.first()
        res = self.fc.post(f"/api/faculty/chapters/{chapter.id}/availability/", {"availability": "open"}, format="json")
        self.assertTrue(all(m["availability"] == "open" for m in res.data))
        self.fc.post(f"/api/faculty/modules/{self.module.id}/availability/", {"availability": "locked"}, format="json")
        self.assertEqual(client_for(self.student).get(f"/api/student/modules/{self.module.id}/").status_code, 403)

    def test_student_cannot_change_availability(self):
        res = client_for(self.student).post(f"/api/faculty/modules/{self.module.id}/availability/", {"availability": "open"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_unenrolled_student_sees_nothing(self):
        self.fc.post(f"/api/faculty/documents/{self.doc.id}/publish/")
        self.fc.post(f"/api/faculty/modules/{self.module.id}/availability/", {"availability": "open"}, format="json")
        oc = client_for(self.outsider)
        self.assertEqual(oc.get(f"/api/student/modules/{self.module.id}/").status_code, 404)
        self.assertEqual(oc.get(f"/api/student/subjects/{self.subject.id}/documents/").status_code, 404)

    def test_discontinued_enrollment_removes_access(self):
        self.fc.post(f"/api/faculty/documents/{self.doc.id}/publish/")
        self.fc.post(f"/api/faculty/modules/{self.module.id}/availability/", {"availability": "open"}, format="json")
        self.fc.post(f"/api/faculty/subjects/{self.subject.id}/students/{self.student.id}/discontinue/")
        self.assertEqual(client_for(self.student).get(f"/api/student/modules/{self.module.id}/").status_code, 404)


class PdfParsingTests(TestCase):
    """The PDF path: text-layer probe, OCR fallback, heading inference, page
    groups, and a controlled error when nothing is extractable. Docling is
    mocked; pypdfium2 reads real PDFs."""

    def _pdf(self, pages):
        from reportlab.lib.pagesizes import letter
        from reportlab.pdfgen import canvas

        buf = BytesIO()
        c = canvas.Canvas(buf, pagesize=letter)
        for lines in pages:
            y = 740
            for line in lines:
                c.drawString(72, y, line)
                y -= 16
            c.showPage()
        c.save()
        tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
        tmp.write(buf.getvalue())
        tmp.close()
        self.addCleanup(lambda: __import__("os").unlink(tmp.name))
        from pathlib import Path

        return Path(tmp.name)

    def test_text_layer_probe_reads_real_pdf_with_page_breaks(self):
        from .services.parser import PAGE_BREAK_MARKER, _pdf_text_layer

        pdf = self._pdf([["Machine learning is the study of algorithms."] * 6, ["Second page content here."] * 6])
        markdown, chars = _pdf_text_layer(pdf)
        self.assertGreater(chars, 200)
        self.assertIn("Machine learning", markdown)
        self.assertEqual(markdown.count(PAGE_BREAK_MARKER), 1)

    def test_scanned_pdf_uses_full_page_ocr_and_ocr_text_reaches_sections(self):
        from .services import parser

        pdf = self._pdf([[]])  # image-only stand-in: no text layer at all
        calls = []

        def fake_convert(source, use_ocr, full_page_ocr=False):
            calls.append((use_ocr, full_page_ocr))
            body = "word " * 80
            return f"Introduction To Learning\n\n{body}\n\n<!-- page break -->\n\nModels And Training\n\n{body}"

        with patch.object(parser, "_convert_pdf", side_effect=fake_convert):
            markdown, mode = parser._parse_pdf(pdf, "scan.pdf")
        self.assertEqual(calls, [(True, True)], "no text layer: exactly one Docling pass, with full-page OCR")
        self.assertEqual(mode, "ocr_fallback+inferred")
        sections = parser.extract_sections_from_markdown(markdown)
        self.assertEqual([s["title"] for s in sections], ["Introduction To Learning", "Models And Training"])
        self.assertTrue(all(len(s["source_text"]) > 200 for s in sections))

    def test_text_pdf_runs_one_no_ocr_pass_and_keeps_docling_headings(self):
        from .services import parser

        pdf = self._pdf([["Selectable text about machine learning, repeated for size."] * 8])
        calls = []

        def fake_convert(source, use_ocr, full_page_ocr=False):
            calls.append((use_ocr, full_page_ocr))
            return "## Chapter One\n\n" + "text " * 100 + "\n\n## Chapter Two\n\n" + "more " * 100

        with patch.object(parser, "_convert_pdf", side_effect=fake_convert):
            markdown, mode = parser._parse_pdf(pdf, "book.pdf")
        self.assertEqual(calls, [(False, False)])
        self.assertEqual(mode, "fast_no_ocr")
        self.assertEqual(len(parser.extract_sections_from_markdown(markdown)), 2)

    def test_docling_dropping_text_falls_back_to_text_layer(self):
        from .services import parser

        pdf = self._pdf([["Selectable text about machine learning, repeated for size."] * 8])
        with patch.object(parser, "_convert_pdf", return_value="<!-- image -->\n\n<!-- image -->"):
            markdown, mode = parser._parse_pdf(pdf, "odd.pdf")
        self.assertEqual(mode, "text_layer")
        self.assertIn("machine learning", markdown)

    def test_no_text_anywhere_raises_controlled_error(self):
        from .services import parser

        pdf = self._pdf([[]])
        with patch.object(parser, "_convert_pdf", return_value="<!-- image -->\n\n<!-- page break -->\n\n<!-- image -->"):
            with self.assertRaises(parser.NoExtractableContent) as ctx:
                parser._parse_pdf(pdf, "blank.pdf")
        self.assertIn("OCR", str(ctx.exception))

    def test_headingless_pdf_text_becomes_page_group_sections(self):
        from .services.parser import PAGE_BREAK_MARKER, extract_sections_from_markdown

        page = ("lorem ipsum " * 60).strip()  # ~700 chars, no heading-like lines
        markdown = f"\n\n{PAGE_BREAK_MARKER}\n\n".join([page] * 20)
        sections = extract_sections_from_markdown(markdown)
        self.assertGreater(len(sections), 1)
        self.assertEqual(sections[0]["index"], 0)
        self.assertEqual(sections[0]["start_page"], 1)
        self.assertTrue(sections[0]["title"].startswith("Pages "))
        self.assertEqual(sections[-1]["end_page"], 20)
        # Deterministic: re-parsing the same markdown gives identical indices/titles.
        self.assertEqual([s["title"] for s in extract_sections_from_markdown(markdown)], [s["title"] for s in sections])

    def test_headingless_docx_markdown_keeps_single_section(self):
        from .services.parser import extract_sections_from_markdown

        sections = extract_sections_from_markdown("Just a paragraph.\n\nAnother paragraph without headings.")
        self.assertEqual(len(sections), 1)
        self.assertEqual(sections[0]["title"], "Document Content")

    def test_infer_headings_handles_numbered_keyword_and_caps(self):
        from .services.parser import infer_pdf_headings

        body = "sentence " * 30
        text = "\n\n".join([
            "Chapter 1 Introduction", body,
            "1.1 What is learning", body,
            "1.2 Kinds of learning", body,
            "SUPERVISED LEARNING", body,
            "Chapter 2 Regression", body,
        ])
        out, count = infer_pdf_headings(text)
        self.assertEqual(count, 5)
        self.assertIn("# Chapter 1 Introduction", out)
        self.assertIn("## 1.1 What is learning", out)
        self.assertIn("## SUPERVISED LEARNING", out)
        self.assertIn("# Chapter 2 Regression", out)

    def test_infer_headings_leaves_list_like_text_alone(self):
        from .services.parser import infer_pdf_headings

        text = "\n".join(f"Item Number {i}" for i in range(40))
        out, count = infer_pdf_headings(text)
        self.assertEqual(count, 0)
        self.assertEqual(out, text)

    def test_processing_releases_parser_models_before_outline(self):
        from .services import documents as doc_service

        faculty = make_faculty()
        subject = make_subject()
        assign(faculty, subject)
        document = Document.objects.create(subject=subject, uploaded_by=faculty, original_name="x.pdf", title="x", file_type="pdf", file_size=1)
        order = []

        def fake_parse(_document):
            order.append("parse")
            return {"markdown": "# A\ntext", "markdown_path": "", "headings": [{"index": 0, "level": 1, "title": "A", "start_page": None, "end_page": None}],
                    "sections": [{"index": 0, "level": 1, "title": "A", "source_text": "text", "start_page": None, "end_page": None}], "parse_mode": "fast_no_ocr"}

        def fake_release():
            order.append("release")

        def fake_outline(_document, sections, headings):
            order.append("outline")
            return {"document_title": "x", "chapters": [{"title": "A", "source_heading_index": 0, "modules": []}]}, "source_hierarchy"

        with patch.object(doc_service, "parse_document", side_effect=fake_parse), \
                patch.object(doc_service, "release_document_models", side_effect=fake_release), \
                patch.object(doc_service.outline_service, "build_proposed_outline", side_effect=fake_outline):
            doc_service.run_processing(document.id)
        self.assertEqual(order, ["parse", "release", "outline"])
        document.refresh_from_db()
        self.assertEqual(document.status, DocumentStatus.UNDER_REVIEW)

    def test_no_extractable_content_is_a_clear_document_error(self):
        from .services import documents as doc_service
        from .services.parser import NoExtractableContent

        faculty = make_faculty()
        subject = make_subject()
        assign(faculty, subject)
        document = Document.objects.create(subject=subject, uploaded_by=faculty, original_name="blank.pdf", title="b", file_type="pdf", file_size=1)
        with patch.object(doc_service, "parse_document", side_effect=NoExtractableContent("No readable text could be extracted, even after OCR.")), \
                patch.object(doc_service, "release_document_models"):
            doc_service.run_processing(document.id)
        document.refresh_from_db()
        self.assertEqual(document.status, DocumentStatus.ERROR)
        self.assertIn("even after OCR", document.error_message)
        self.assertTrue(AuditLog.objects.filter(action="document.processing_failed").exists())

    def test_docling_converter_is_cached_per_configuration_and_released(self):
        import sys
        import types

        from .services import parser

        built = []

        class OcrOptions:
            mode = "regions"

        class PdfPipelineOptions:
            def __init__(self, **kw):
                self.do_ocr = False
                self.do_table_structure = True
                self.ocr_options = OcrOptions()
                self.artifacts_path = kw.get("artifacts_path")

        class OcrMode:
            FULL_PAGE = "full_page"

        class DocumentConverter:
            def __init__(self, format_options=None):
                built.append(format_options)

        class PdfFormatOption:
            def __init__(self, pipeline_options=None):
                self.pipeline_options = pipeline_options

        class InputFormat:
            PDF = "pdf"

        pkg = types.ModuleType("docling"); dm = types.ModuleType("docling.datamodel")
        base = types.ModuleType("docling.datamodel.base_models"); base.InputFormat = InputFormat
        opts = types.ModuleType("docling.datamodel.pipeline_options"); opts.PdfPipelineOptions = PdfPipelineOptions; opts.OcrMode = OcrMode
        conv = types.ModuleType("docling.document_converter"); conv.DocumentConverter = DocumentConverter; conv.PdfFormatOption = PdfFormatOption
        fake = {"docling": pkg, "docling.datamodel": dm, "docling.datamodel.base_models": base,
                "docling.datamodel.pipeline_options": opts, "docling.document_converter": conv}
        parser.release_document_models()
        with patch.dict(sys.modules, fake):
            a = parser._get_converter(use_ocr=False)
            b = parser._get_converter(use_ocr=False)
            c = parser._get_converter(use_ocr=True, full_page_ocr=True)
            self.assertIs(a, b)
            self.assertIsNot(a, c)
            self.assertEqual(len(built), 2)
            ocr_opts = built[1][InputFormat.PDF].pipeline_options
            self.assertTrue(ocr_opts.do_ocr)
            # Table extraction is enabled for both PDF passes.
            self.assertTrue(ocr_opts.do_table_structure)
            self.assertTrue(built[0][InputFormat.PDF].pipeline_options.do_table_structure)
            self.assertEqual(ocr_opts.ocr_options.mode, "full_page")
            parser.release_document_models()
            d = parser._get_converter(use_ocr=False)
            self.assertIsNot(a, d)
            self.assertEqual(len(built), 3)
        parser.release_document_models()


class OutlineSaveVersionTests(TestCase):
    """Saving an outline that changes nothing students read keeps the content
    version, so cached lessons and tutor answers survive; a real change bumps it."""

    def setUp(self):
        from core.testing import assign, client_for, make_faculty, make_published_document, make_subject
        self.faculty = make_faculty()
        subject = make_subject(code="OSV")
        assign(self.faculty, subject)
        self.doc = make_published_document(subject)
        self.fc = client_for(self.faculty)

    def _outline(self):
        res = self.fc.get(f"/api/faculty/documents/{self.doc.id}/outline/")
        self.assertEqual(res.status_code, 200, res.content)
        return res.data

    def test_identical_save_keeps_version_and_a_rename_bumps_it(self):
        from documents.models import Document
        outline = self._outline()
        before = Document.objects.get(pk=self.doc.id).content_version
        res = self.fc.put(f"/api/faculty/documents/{self.doc.id}/outline/", outline, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(Document.objects.get(pk=self.doc.id).content_version, before)
        outline["chapters"][0]["modules"][0]["title"] = "Renamed module"
        res = self.fc.put(f"/api/faculty/documents/{self.doc.id}/outline/", outline, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(Document.objects.get(pk=self.doc.id).content_version, before + 1)

    def test_hand_edited_text_survives_the_next_outline_save(self):
        from learning.models import Module
        module = Module.objects.filter(chapter__document=self.doc).order_by("order").first()
        module.source_heading_index = 1
        module.save(update_fields=["source_heading_index"])
        res = self.fc.patch(f"/api/faculty/modules/{module.id}/", {"source_text": "Rewritten by faculty."}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        module.refresh_from_db()
        self.assertIsNone(module.source_heading_index)
        res = self.fc.put(f"/api/faculty/documents/{self.doc.id}/outline/", self._outline(), format="json")
        self.assertEqual(res.status_code, 200, res.content)
        module.refresh_from_db()
        self.assertEqual(module.source_text, "Rewritten by faculty.")


@override_settings(MEDIA_ROOT=MEDIA)
@patch("documents.services.documents.parse_document", side_effect=fake_parse)
class LegacyWordUploadTests(TestCase):
    DOC_BYTES = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 512

    def setUp(self):
        from core.testing import assign, client_for, make_faculty, make_subject
        self.faculty = make_faculty()
        self.subject = make_subject(code="LW")
        assign(self.faculty, self.subject)
        self.fc = client_for(self.faculty)

    def _upload(self):
        f = SimpleUploadedFile("old.doc", self.DOC_BYTES, content_type="application/msword")
        return self.fc.post("/api/faculty/documents/", {"subject_id": str(self.subject.id), "file": f}, format="multipart")

    def test_doc_refused_with_the_fix_when_the_server_cannot_convert(self, _):
        with patch("documents.services.parser.legacy_doc_support", return_value=(False, "LibreOffice is not installed")):
            res = self._upload()
        self.assertEqual(res.status_code, 400, res.content)
        self.assertEqual(res.data["error"]["code"], "LEGACY_WORD_UNSUPPORTED")
        self.assertIn(".docx", res.data["error"]["message"])

    def test_doc_accepted_when_the_server_can_convert(self, _):
        with patch("documents.services.parser.legacy_doc_support", return_value=(True, "")):
            res = self._upload()
        self.assertEqual(res.status_code, 201, res.content)

    def test_support_check_needs_libreoffice(self, _):
        from documents.services import parser
        with patch("shutil.which", return_value=None):
            ok, reason = parser.legacy_doc_support()
        self.assertFalse(ok)
        self.assertTrue(reason)


class ConcurrentProcessingTests(TransactionTestCase):
    """Several requests to process the same book at the same moment: exactly one may start it.

    The threads race on one SQLite file, which can also answer a writer with "database is locked"; that is
    another way of losing the race, so it counts as "did not claim". What must never happen is two winners.
    """
    reset_sequences = True

    def _race(self, doc, count=6):
        results, unexpected = [], []
        barrier = threading.Barrier(count)

        def claim():
            barrier.wait()
            try:
                results.append(documents_service.claim_for_processing(doc))
            except OperationalError:
                results.append(False)  # the database refused this writer: it did not claim the book
            except Exception as exc:  # recorded, not raised, so one thread cannot hide the others
                unexpected.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=claim) for _ in range(count)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        self.assertEqual(unexpected, [])
        return results

    def test_only_one_of_many_parallel_claims_wins(self):
        faculty = make_faculty()
        subject = make_subject()
        assign(faculty, subject)
        doc = Document.objects.create(subject=subject, title="Race", original_name="race.pdf", file_type="pdf", file_size=10,
                                      status=DocumentStatus.UPLOADED, uploaded_by=faculty)
        results = self._race(doc)
        self.assertEqual(results.count(True), 1, f"{results.count(True)} claims won: {results}")
        doc.refresh_from_db()
        self.assertEqual(doc.status, DocumentStatus.PROCESSING)

    def test_a_stale_run_is_reclaimed_once(self):
        faculty = make_faculty()
        subject = make_subject()
        assign(faculty, subject)
        doc = Document.objects.create(subject=subject, title="Stale", original_name="stale.pdf", file_type="pdf", file_size=10,
                                      status=DocumentStatus.PROCESSING, uploaded_by=faculty,
                                      processing_started_at=timezone.now() - timedelta(hours=4))
        results = self._race(doc, count=4)
        self.assertEqual(results.count(True), 1, f"{results.count(True)} reclaims won: {results}")

    def test_processing_again_is_allowed_once_the_first_run_finished(self):
        """A quick book can finish before a second request arrives; that request may legitimately start it again."""
        faculty = make_faculty()
        subject = make_subject()
        assign(faculty, subject)
        doc = Document.objects.create(subject=subject, title="Quick", original_name="quick.pdf", file_type="pdf", file_size=10,
                                      status=DocumentStatus.UPLOADED, uploaded_by=faculty)
        self.assertTrue(documents_service.claim_for_processing(doc))
        self.assertFalse(documents_service.claim_for_processing(doc))
        Document.objects.filter(pk=doc.pk).update(status=DocumentStatus.UNDER_REVIEW)
        doc.refresh_from_db()
        self.assertTrue(documents_service.claim_for_processing(doc))
