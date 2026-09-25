import re
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.test import TestCase
from django.utils import timezone

from core.testing import client_for, make_admin, make_faculty

from .categories import CATEGORIES, category_of, is_failure
from .models import AuditLog
from .services import record


def _log(actor, action, label="", when=None, **summary):
    entry = AuditLog.objects.create(
        actor=actor, actor_email=getattr(actor, "email", "") or "", actor_role=getattr(actor, "role", "") or "",
        action=action, target_type="Document", target_id="t-1", target_label=label, summary=summary,
    )
    if when is not None:
        AuditLog.objects.filter(pk=entry.pk).update(created_at=when)
    return entry


class AuditScreenTests(TestCase):
    def setUp(self):
        self.admin = make_admin(email="admin@example.edu", name="Vikram Sethi")
        self.faculty = make_faculty(email="priya@example.edu", name="Priya Shah")
        self.client = client_for(self.admin)
        _log(self.faculty, "document.published", "Operations Management")
        _log(self.faculty, "quiz.results_released", "Module 4 quiz")
        _log(None, "document.processing_failed", "Scan.pdf")
        _log(None, "auth.login_locked", "student24@example.edu")
        _log(self.faculty, "module.locked", "Module 2")
        _log(self.admin, "user.updated", "Neha Joshi", role=["student", "faculty"])
        _log(self.faculty, "quiz.created", "Old quiz", when=timezone.now() - timedelta(days=10))

    def get(self, path, **params):
        res = self.client.get(path, params)
        self.assertEqual(res.status_code, 200, getattr(res, "content", b""))
        return res

    def test_rows_carry_name_category_and_failure(self):
        rows = self.get("/api/admin/audit-logs/").data["results"]
        published = next(r for r in rows if r["action"] == "document.published")
        self.assertEqual(published["actor_name"], "Priya Shah")
        self.assertEqual(published["category"], "content")
        self.assertFalse(published["failed"])
        locked = next(r for r in rows if r["action"] == "auth.login_locked")
        self.assertIsNone(locked["actor_name"])
        self.assertTrue(locked["failed"])
        self.assertIn("ip_address", published)

    def test_category_and_failure_filters(self):
        quiz = self.get("/api/admin/audit-logs/", category="quiz").data
        self.assertEqual({r["action"] for r in quiz["results"]}, {"quiz.results_released", "quiz.created"})
        fails = self.get("/api/admin/audit-logs/", category="failures").data
        self.assertEqual({r["action"] for r in fails["results"]}, {"document.processing_failed", "auth.login_locked"})

    def test_search_matches_name_email_and_item(self):
        by_name = self.get("/api/admin/audit-logs/", q="priya").data["count"]
        self.assertEqual(by_name, 4)
        by_item = self.get("/api/admin/audit-logs/", q="operations").data["results"]
        self.assertEqual([r["action"] for r in by_item], ["document.published"])

    def test_role_filter_including_system(self):
        system = self.get("/api/admin/audit-logs/", role="system").data["results"]
        self.assertEqual({r["action"] for r in system}, {"document.processing_failed", "auth.login_locked"})
        admins = self.get("/api/admin/audit-logs/", role="admin").data["results"]
        self.assertEqual([r["action"] for r in admins], ["user.updated"])

    def test_summary_counts_follow_filters_but_not_the_chip(self):
        since = (timezone.now() - timedelta(days=7)).isoformat()
        data = self.get("/api/admin/audit-logs/summary/", since=since, category="quiz").data
        self.assertEqual(data["events_today"], 6)
        self.assertEqual(data["people_today"], 2)
        self.assertEqual(data["published_week"], 1)
        self.assertEqual(data["failures_week"], 2)
        self.assertEqual(data["total"], 6)
        self.assertEqual(data["categories"]["quiz"], 1)
        self.assertEqual(data["categories"]["content"], 3)
        self.assertEqual(data["categories"]["people"], 1)
        self.assertEqual(sum(data["categories"].values()), data["total"])

    def test_csv_export_respects_filters(self):
        data = self.get("/api/admin/audit-logs/export/", category="failures").data
        self.assertTrue(data["filename"].endswith(".csv"))
        self.assertEqual(data["count"], 2)
        self.assertFalse(data["truncated"])
        body = data["csv"]
        lines = body.strip().splitlines()
        self.assertTrue(lines[0].startswith("time_utc,actor_name"))
        self.assertEqual(len(lines), 3)
        self.assertIn("auth.login_locked", body)

    def test_new_endpoints_are_admin_only(self):
        faculty = client_for(self.faculty)
        for path in ("/api/admin/audit-logs/summary/", "/api/admin/audit-logs/export/"):
            self.assertEqual(faculty.get(path).status_code, 403)

    def test_module_locked_is_not_a_failure(self):
        self.assertFalse(is_failure("module.locked"))
        self.assertTrue(is_failure("auth.login_locked"))
        self.assertTrue(is_failure("tutor.ask_failed"))


class CategoryContractTests(TestCase):
    """Every action the code records must land in a named category, so the
    admin screen never files a real event under "Other" by accident."""

    ACTION = re.compile(r"""record\(\s*[^,]+,\s*f?["']([a-z_]+)\.""")

    def test_every_recorded_entity_has_a_category(self):
        root = Path(settings.BASE_DIR)
        entities = set()
        for path in root.rglob("*.py"):
            if "migrations" in path.parts or path.name.startswith("test"):
                continue
            entities.update(self.ACTION.findall(path.read_text(encoding="utf-8", errors="ignore")))
        self.assertTrue(entities, "no audit.record calls found; the pattern needs updating")
        unclaimed = sorted(e for e in entities if category_of(f"{e}.x") == "other")
        self.assertEqual(unclaimed, [], f"add these entities to audit/categories.py: {unclaimed}")

    def test_frontend_mapping_matches_backend(self):
        tsx = Path(settings.BASE_DIR).parent / "frontend" / "app" / "admin" / "audit.tsx"
        text = tsx.read_text(encoding="utf-8")
        for name, entities in CATEGORIES.items():
            for entity in entities:
                found = re.search(rf"\b{entity}:\s*\"{name}\"", text)
                self.assertIsNotNone(found, f"{entity} -> {name} missing from CATEGORY_OF in audit.tsx")

    def test_record_helper_still_writes(self):
        admin = make_admin(email="a2@example.edu")
        entry = record(admin, "subject.created")
        self.assertEqual(category_of(entry.action), "class")
