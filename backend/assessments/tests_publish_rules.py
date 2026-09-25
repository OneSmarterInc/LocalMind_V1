from django.test import TestCase
from core.testing import MCQ, assign, client_for, make_faculty, make_published_document, make_subject
from assessments.models import Assessment
from audit.models import AuditLog


class PublishRulesTests(TestCase):
    def setUp(self):
        self.faculty = make_faculty()
        self.subject = make_subject()
        assign(self.faculty, self.subject)
        self.doc = make_published_document(self.subject)
        self.chapter = self.doc.chapters.first()
        self.modules = list(self.chapter.modules.all())
        self.client = client_for(self.faculty)

    def quiz(self, kind):
        q = Assessment.objects.create(subject=self.subject, title="Quiz", kind=kind,
            module=self.modules[0] if kind == "module" else None,
            chapter=self.chapter if kind == "chapter" else None,
            questions=[MCQ], created_by=self.faculty)
        if kind == "selection":
            q.source_modules.set(self.modules)
        return q

    def publish(self, q):
        return self.client.post(f"/api/faculty/quizzes/{q.pk}/status/", {"status": "published"}, format="json")

    def test_book_status_matrix(self):
        for kind in ("module", "chapter", "selection"):
            for status in ("ready", "under_review", "unpublished", "archived", "published"):
                with self.subTest(kind=kind, status=status):
                    self.doc.status = status
                    self.doc.save()
                    q = self.quiz(kind)
                    response = self.publish(q)
                    self.assertEqual(response.status_code, 200 if status == "published" else 409, response.data)
                    q.refresh_from_db()
                    self.assertEqual(q.status, "published" if status == "published" else "draft")
                    if status != "published":
                        self.assertEqual(response.data["error"]["code"], "BOOK_NOT_PUBLISHED")

    def test_locked_and_partly_open_matrix(self):
        for kind in ("module", "chapter", "selection"):
            for availability in (("locked", "locked"), ("locked", "open"), ("open", "open")):
                with self.subTest(kind=kind, availability=availability):
                    for m, value in zip(self.modules, availability):
                        m.availability = value
                        m.save()
                    expected = any(a == "open" for a in availability) if kind == "chapter" else availability[0] == "open" if kind == "module" else all(a == "open" for a in availability)
                    response = self.publish(self.quiz(kind))
                    self.assertEqual(response.status_code, 200 if expected else 409, response.data)
                    if not expected:
                        self.assertEqual(response.data["error"]["code"], "MODULE_LOCKED_FOR_QUIZ")
                        self.assertIn(self.modules[0].title, response.data["error"]["details"]["modules"])
                    for m, value in zip(self.modules, availability):
                        m.refresh_from_db()
                        self.assertEqual(m.availability, value)
        self.assertFalse(AuditLog.objects.filter(action="module.opened_on_publish").exists())

    def test_selection_checks_every_book(self):
        other = make_published_document(self.subject, title="Other")
        other.status = "unpublished"
        other.save()
        q = self.quiz("selection")
        q.source_modules.add(other.chapters.first().modules.first())
        self.assertEqual(self.publish(q).data["error"]["code"], "BOOK_NOT_PUBLISHED")

    def test_subject_only_quiz_unaffected(self):
        q = Assessment.objects.create(subject=self.subject, title="Subject only", questions=[MCQ], created_by=self.faculty)
        self.assertEqual(self.publish(q).status_code, 200)

    def test_failed_publish_preserves_hold_and_dates(self):
        q = self.quiz("module")
        q.held_for_review = True
        q.hold_reason = "Review needed"
        q.save()
        self.doc.status = "unpublished"
        self.doc.save()
        self.assertEqual(self.publish(q).status_code, 409)
        q.refresh_from_db()
        self.assertTrue(q.held_for_review)
        self.assertIsNone(q.published_at)
