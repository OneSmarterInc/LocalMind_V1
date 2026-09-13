"""Authored uploads preserve their headings and text. Explicit AI restructuring
can repair titles and fold boxes; existing books can be tidied on request."""
import shutil
import tempfile
from io import StringIO
from unittest.mock import patch

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings

from core.testing import assign, client_for, enroll, make_faculty, make_published_document, make_student, make_subject
from learning.models import Chapter, Module, ModuleProgress

from .services.outline import plan_merges, tidy_existing_document, tidy_heading_title
from .services.parser import _extract_headings, extract_sections_from_markdown

MEDIA = tempfile.mkdtemp(prefix="tidy-media-")
LONG = "Living organisms need energy to carry out life processes. " * 40
MID = "Autotrophs make their own food using simple inorganic substances. " * 30

NCERT_MD = f"""# Life Processes

## 5.1 WHA 5.1 WHAT ARE LIFE PROCESSES? T ARE LIFE PROCESSES?

{LONG}

## Q U E S T I O N S

1. Why is diffusion insufficient to meet the oxygen requirements of multi-cellular organisms?
2. What criteria do we use to decide whether something is alive?

## 5.2 NUTRITION 5.2 NUTRITION

When we walk or ride a bicycle, we are using up energy.

## 5.2.1 Autotrophic Nutrition

{MID}

## Activity 5.3 Activity 5.3

Take a potted plant with variegated leaves. Keep it in a dark room for three days.

## 5.2.2 Heterotrophic Nutrition

{MID.replace("Autotrophs make their own food", "Heterotrophs depend on others for food")}

## Do You Know?

Some plants like Cuscuta are parasites.
"""


def ncert_parse(document):
    sections = extract_sections_from_markdown(NCERT_MD)
    return {"markdown": NCERT_MD, "markdown_path": "", "headings": _extract_headings(sections), "sections": sections, "parse_mode": "test"}


class TitleRepairTests(TestCase):
    def test_the_three_garbled_shapes(self):
        self.assertEqual(tidy_heading_title("5.1 WHA 5.1 WHAT ARE LIFE PROCESSES? T ARE LIFE PROCESSES?"), "5.1 WHAT ARE LIFE PROCESSES?")
        self.assertEqual(tidy_heading_title("Q U E S T I O N S"), "QUESTIONS")
        self.assertEqual(tidy_heading_title("M O R E  T O  K N O W"), "MORE TO KNOW")
        self.assertEqual(tidy_heading_title("Activity 5.3 Activity 5.3"), "Activity 5.3")

    def test_normal_titles_are_untouched(self):
        for title in ("5.2.1 Autotrophic Nutrition", "A B", "How do living things get their food?", "Photosynthesis"):
            self.assertEqual(tidy_heading_title(title), title)


class PlanTests(TestCase):
    @staticmethod
    def items(rows):
        return [dict(key=i, chapter=c, title=t, text=x, locked=lock) for i, (c, t, x, lock) in enumerate(rows)]

    def names(self, rows, plan):
        return [(rows[s][1], mode, rows[d][1]) for s, d, mode in plan]

    def test_boxes_join_the_section_before_and_a_section_intro_joins_the_section_it_opens(self):
        rows = [(0, "5.1 What are life processes?", LONG, False), (0, "QUESTIONS", "q" * 300, False),
                (0, "5.2 NUTRITION", "n" * 60, False), (0, "5.2.1 Autotrophic Nutrition", MID, False),
                (0, "Activity 5.3", "a" * 700, False)]
        self.assertEqual(self.names(rows, plan_merges(self.items(rows), 500, 12000)), [
            ("QUESTIONS", "append", "5.1 What are life processes?"),
            ("Activity 5.3", "append", "5.2.1 Autotrophic Nutrition"),
            ("5.2 NUTRITION", "prepend", "5.2.1 Autotrophic Nutrition")])

    def test_a_chapter_made_only_of_a_box_joins_the_previous_chapter(self):
        rows = [(0, "Real section", LONG, False), (1, "Do You Know?", "d" * 100, False)]
        self.assertEqual(self.names(rows, plan_merges(self.items(rows), 500, 12000)), [("Do You Know?", "append", "Real section")])

    def test_a_box_opening_a_chapter_joins_the_next_section_of_that_chapter(self):
        rows = [(0, "Earlier chapter", LONG, False), (1, "Activity 6.1", "a" * 200, False), (1, "6.1 Real", LONG, False)]
        self.assertEqual(self.names(rows, plan_merges(self.items(rows), 500, 12000)), [("Activity 6.1", "prepend", "6.1 Real")])

    def test_size_limit_and_locked_modules(self):
        rows = [(0, "Big", "b" * 11900, False), (0, "Activity 5.5", "a" * 900, False), (0, "Do You Know?", "d" * 50, True),
                (0, "QUESTIONS", "q" * 300, False)]
        # 900 characters would push Big past the cap; a locked box is neither
        # folded nor a home for others; a few lines of questions always fit.
        self.assertEqual(self.names(rows, plan_merges(self.items(rows), 500, 12000)), [("QUESTIONS", "append", "Big")])


@override_settings(MEDIA_ROOT=MEDIA)
class NewUploadTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(MEDIA, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.faculty = make_faculty()
        self.subject = make_subject(code="NCERT")
        assign(self.faculty, self.subject)
        self.fc = client_for(self.faculty)

    def upload(self, strategy=None):
        from ai.gateway import AIResult
        from documents.tests import PDF_BYTES
        from documents.services.outline_policy import source_hierarchy_outline

        payload = {"subject_id": str(self.subject.id),
                   "file": SimpleUploadedFile("jesc105.pdf", PDF_BYTES, content_type="application/pdf")}
        if strategy is not None:
            payload["outline_strategy"] = strategy
        with patch("documents.services.documents.parse_document", side_effect=ncert_parse), \
                patch("documents.services.outline.gateway") as model:
            # A complete, valid model plan; validation and tidying still run.
            model.return_value.generate.return_value = AIResult(
                ok=True, model="test-only",
                data=source_hierarchy_outline("jesc105.pdf", extract_sections_from_markdown(NCERT_MD)),
            )
            res = self.fc.post("/api/faculty/documents/", payload, format="multipart")
            self.assertEqual(res.status_code, 201, res.content)
            if res.data["status"] != "under_review":
                processed = self.fc.post(f"/api/faculty/documents/{res.data['id']}/process/")
                self.assertIn(processed.status_code, (200, 202), processed.content)
            if strategy == "ai":
                model.return_value.generate.assert_called_once()
            else:
                model.assert_not_called()
        return res.data["id"]

    def test_boxes_are_folded_and_titles_repaired(self):
        doc_id = self.upload(strategy="ai")
        titles = list(Module.objects.filter(chapter__document_id=doc_id).order_by("chapter__order", "order").values_list("title", flat=True))
        self.assertEqual(titles, ["5.1 WHAT ARE LIFE PROCESSES?", "5.2.1 Autotrophic Nutrition", "5.2.2 Heterotrophic Nutrition"])
        first = Module.objects.get(chapter__document_id=doc_id, title="5.1 WHAT ARE LIFE PROCESSES?")
        self.assertIn("## QUESTIONS", first.source_text)
        self.assertIn("Why is diffusion insufficient", first.source_text)
        auto = Module.objects.get(chapter__document_id=doc_id, title="5.2.1 Autotrophic Nutrition")
        self.assertTrue(auto.source_text.startswith("## 5.2 NUTRITION"))
        self.assertIn("## Activity 5.3", auto.source_text)
        hetero = Module.objects.get(chapter__document_id=doc_id, title="5.2.2 Heterotrophic Nutrition")
        self.assertIn("Cuscuta", hetero.source_text)
        from audit.models import AuditLog
        summary = AuditLog.objects.filter(action="document.processed").latest("created_at").summary
        self.assertEqual(summary["fragments_merged"], 4)
        self.assertGreaterEqual(summary["titles_repaired"], 3)

    @override_settings(LOCALMIND={**settings.LOCALMIND, "OUTLINE_MERGE_SMALL": False})
    def test_switched_off_keeps_every_heading_as_its_own_module(self):
        doc_id = self.upload(strategy="ai")
        self.assertEqual(Module.objects.filter(chapter__document_id=doc_id).count(), 7)
        # Titles are still repaired.
        self.assertTrue(Module.objects.filter(chapter__document_id=doc_id, title="QUESTIONS").exists())


    @override_settings(LOCALMIND={**settings.LOCALMIND, "OUTLINE_MERGE_SMALL": True})
    def test_default_upload_preserves_authored_titles_and_text(self):
        doc_id = self.upload()
        expected = [(s["title"], s["source_text"]) for s in extract_sections_from_markdown(NCERT_MD) if s["level"] == 2]
        actual = list(Module.objects.filter(chapter__document_id=doc_id)
                      .order_by("chapter__order", "order").values_list("title", "source_text"))
        self.assertEqual(actual, expected)
        from audit.models import AuditLog
        summary = AuditLog.objects.filter(action="document.processed").latest("created_at").summary
        self.assertEqual(summary["fragments_merged"], 0)
        self.assertEqual(summary["titles_repaired"], 0)


class ExistingBookTests(TestCase):
    def setUp(self):
        self.faculty = make_faculty()
        self.student = make_student()
        self.subject = make_subject(code="OLD")
        assign(self.faculty, self.subject)
        enroll(self.student, self.subject)
        self.doc = make_published_document(self.subject, modules=(
            ("5.1 WHA 5.1 WHAT ARE LIFE PROCESSES? T ARE LIFE PROCESSES?", LONG),
            ("Q U E S T I O N S", "1. Why is diffusion insufficient? 2. What is alive?"),
            ("5.2.1 Autotrophic Nutrition", MID),
            ("Do You Know?", "Some plants like Cuscuta are parasites.")))
        self.chapter = Chapter.objects.get(document=self.doc)

    def test_dry_run_changes_nothing(self):
        before = list(Module.objects.values_list("title", "source_text"))
        report = tidy_existing_document(self.doc, dry_run=True)
        self.assertEqual(len(report["merged"]), 2)
        self.assertEqual(list(Module.objects.values_list("title", "source_text")), before)

    def test_merges_unreferenced_fragments_and_refreshes_their_lesson_and_quiz(self):
        from tutor.models import ModuleLesson
        from assessments.models import Assessment
        questions_box = Module.objects.get(title="Q U E S T I O N S")
        Assessment.objects.create(subject=self.subject, chapter=self.chapter, module=questions_box, kind="module", title="auto",
                                  auto_generated=True, questions=[])
        version = self.doc.content_version
        with self.captureOnCommitCallbacks(execute=True):
            report = tidy_existing_document(self.doc)
        self.assertEqual(len(report["merged"]), 2)
        titles = list(Module.objects.order_by("order").values_list("title", flat=True))
        self.assertEqual(titles, ["5.1 WHAT ARE LIFE PROCESSES?", "5.2.1 Autotrophic Nutrition"])
        self.assertFalse(Assessment.objects.filter(title="auto").exists())
        target = Module.objects.get(title="5.1 WHAT ARE LIFE PROCESSES?")
        self.assertIn("## QUESTIONS", target.source_text)
        self.doc.refresh_from_db()
        self.assertEqual(self.doc.content_version, version + 1)
        self.assertEqual(ModuleLesson.objects.get(module=target).status, "pending")

    def test_a_fragment_a_student_has_used_stays(self):
        box = Module.objects.get(title="Do You Know?")
        ModuleProgress.objects.create(student=self.student, module=box)
        report = tidy_existing_document(self.doc)
        self.assertTrue(Module.objects.filter(pk=box.pk).exists())
        self.assertIn("Do You Know?", report["kept_in_use"])
        self.assertEqual([m["title"] for m in report["merged"]], ["QUESTIONS"])

    def test_command(self):
        out = StringIO()
        call_command("tidy_book", "--document", str(self.doc.id), "--dry-run", stdout=out)
        self.assertIn("merge: 'QUESTIONS' into the end of", out.getvalue())
        self.assertEqual(Module.objects.count(), 4)
        call_command("tidy_book", "--document", str(self.doc.id), stdout=StringIO())
        self.assertEqual(Module.objects.count(), 2)


class RealTextbookTests(TestCase):
    """The headings Docling extracted from NCERT Class 10 Science chapter 5
    (jesc105.pdf) on a real install, with each section's text length."""

    @staticmethod
    def fixture():
        import json
        from pathlib import Path
        return json.loads((Path(__file__).parent / "test_data" / "jesc105_headings.json").read_text(encoding="utf-8"))["headings"]

    def test_every_overprinted_title_in_the_chapter_is_repaired(self):
        repaired = {h["title"]: tidy_heading_title(h["title"]) for h in self.fixture()}
        self.assertEqual(repaired["5.1  WHA 5.1  WHAT  ARE  LIFE  PROCESSES? T  ARE  LIFE  PROCESSES?"], "5.1 WHAT ARE LIFE PROCESSES?")
        self.assertEqual(repaired["5.3  RESPIR 5.3  RESPIRA ATION TION"], "5.3 RESPIRATION")
        self.assertEqual(repaired["5.4  TR 5.4  TRANSPORT ANSPORTA ATION TION"], "5.4 TRANSPORTATION")
        self.assertEqual(repaired["5.5  EX 5.5  EXCRETION CRETION"], "5.5 EXCRETION")
        self.assertEqual(repaired["E X E R C I S"], "EXERCISES")
        self.assertEqual(repaired["Blood  pressure"], "Blood pressure")
        self.assertEqual(tidy_heading_title("Bye Bye"), "Bye Bye", "short repeated words are left alone")

    def test_a_fresh_upload_of_the_chapter_gives_its_real_sections(self):
        from .services.outline import source_hierarchy_outline, tidy_outline
        sections = [{"index": h["index"], "level": h["level"], "title": h["title"], "source_text": "x" * h["text_chars"],
                     "own_text": "x" * h["text_chars"], "start_page": h["start_page"], "end_page": h["start_page"]}
                    for h in self.fixture()]
        outline, report = tidy_outline(source_hierarchy_outline("jesc105.pdf", sections), sections)
        lookup = {s["index"]: s for s in sections}

        def text(m):
            return m["source_text"] if m.get("source_heading_index") is None else lookup[m["source_heading_index"]]["source_text"]

        titles = [m["title"] for c in outline["chapters"] for m in c["modules"] if text(m).strip()]
        self.assertEqual(titles, [
            "5.1 WHAT ARE LIFE PROCESSES?", "How do living things get their food?", "5.2.1 Autotrophic Nutrition",
            "5.2.2 Heterotrophic Nutrition", "5.2.3 How do Organisms obtain their Nutrition?", "5.2.4 Nutrition in Human Beings",
            "5.3 RESPIRATION", "5.4.1 Transportation in Human Beings", "Our pump - the heart", "Oxygen enters the blood in the lungs",
            "Blood pressure", "Lymph", "5.4.2 Transportation in Plants", "Transport of water", "Transport of food and other substances",
            "5.5 EXCRETION", "5.5.1 Excretion in Human Beings", "Artificial kidney (Hemodialysis)", "5.5.2 Excretion in Plants",
            "Organ donation", "What you have learnt"])
        respiration = next(m for c in outline["chapters"] for m in c["modules"] if m["title"] == "5.3 RESPIRATION")
        for box in ("## Activity 5.5", "## Activity 5.6", "## More to Know!", "## Do You Know?", "## QUESTIONS"):
            self.assertIn(box, respiration["source_text"])
        self.assertNotIn("Activity 5.4", " ".join(m["title"] for c in outline["chapters"] for m in c["modules"]))


class AdoptMissingHeadingTests(TestCase):
    def setUp(self):
        self.faculty = make_faculty()
        self.subject = make_subject(code="ADOPT")
        assign(self.faculty, self.subject)
        self.doc = make_published_document(self.subject, modules=(
            ("5.2.4 Nutrition in Human Beings", MID), ("Activity 5.4 Activity 5.4", "Take some freshly prepared lime water. " * 10),
            ("Activity 5.5 Activity 5.5", "Take some fruit juice or sugar solution and add some yeast. " * 60),
            ("Do You Know?", "Smoking is injurious to health.")))
        # One chapter per heading, as a PDF with all headings at one level gives,
        # and the section heading "5.3 RESPIRATION" at index 1 had no text.
        headings = [{"index": 0, "level": 2, "title": "5.2.4 Nutrition in Human Beings"},
                    {"index": 1, "level": 2, "title": "5.3  RESPIR 5.3  RESPIRA ATION TION"},
                    {"index": 2, "level": 2, "title": "Activity  5.4 Activity  5.4"},
                    {"index": 3, "level": 2, "title": "Activity  5.5 Activity  5.5"},
                    {"index": 4, "level": 2, "title": "Do You Know?"}]
        self.doc.extracted_headings = headings
        self.doc.save(update_fields=["extracted_headings"])
        chapter = Chapter.objects.get(document=self.doc)
        for pos, module in enumerate(Module.objects.filter(chapter=chapter).order_by("order")):
            ch = chapter if pos == 0 else Chapter.objects.create(document=self.doc, title=module.title, order=pos + 1)
            module.chapter = ch
            module.source_heading_index = [0, 2, 3, 4][pos]
            module.save()

    def test_boxes_go_to_the_section_whose_heading_was_dropped(self):
        report = tidy_existing_document(self.doc)
        self.assertEqual(report["adopted"], [{"heading": "5.3 RESPIRATION", "module": "Activity 5.4 Activity 5.4"}])
        titles = list(Module.objects.filter(chapter__document=self.doc).order_by("chapter__order").values_list("title", flat=True))
        self.assertEqual(titles, ["5.2.4 Nutrition in Human Beings", "5.3 RESPIRATION"])
        home = Module.objects.get(title="5.3 RESPIRATION")
        self.assertTrue(home.source_text.startswith("## Activity 5.4"))
        self.assertIn("## Activity 5.5", home.source_text)
        self.assertIn("## Do You Know?", home.source_text)
        self.assertEqual(home.chapter.title, "5.3 RESPIRATION")
        self.assertNotIn("lime water", Module.objects.get(title="5.2.4 Nutrition in Human Beings").source_text)

    def test_command_labels_each_change(self):
        out = StringIO()
        call_command("tidy_book", "--document", str(self.doc.id), "--dry-run", stdout=out)
        text = out.getvalue()
        self.assertIn("new section home: 'Activity 5.4 Activity 5.4' becomes '5.3 RESPIRATION'", text)
        self.assertIn("rename chapter and module:", text)
        self.assertEqual(text.count("rename chapter and module: 'Activity 5.4 Activity 5.4'"), 1)

    def test_running_it_twice_changes_nothing_the_second_time(self):
        tidy_existing_document(self.doc)
        again = tidy_existing_document(self.doc, dry_run=True)
        self.assertEqual((again["merged"], again["renamed"], again["adopted"]), ([], [], []))
