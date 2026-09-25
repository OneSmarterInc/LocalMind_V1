"""The retired feature has no reachable API for any role."""
from django.test import TestCase
from core.testing import client_for, make_admin, make_faculty, make_student

class RetirementTests(TestCase):
    def test_retired_routes_are_not_mounted(self):
        resource = "00000000-0000-0000-0000-000000000001"
        paths = ["faculty/assignments/", "faculty/assignments/generate/",
                 f"faculty/assignments/{resource}/", f"faculty/assignments/{resource}/status/",
                 f"faculty/assignments/{resource}/submissions/", f"faculty/assignments/{resource}/release-results/",
                 f"faculty/assignment-submissions/{resource}/evaluate/", "student/assignments/",
                 f"student/assignments/{resource}/submissions/", "student/assignment-submissions/"]
        for user in [make_admin(), make_faculty(), make_student()]:
            client = client_for(user)
            for path in paths:
                for method in ["get", "post", "patch", "delete"]:
                    with self.subTest(role=user.role, path=path, method=method):
                        self.assertEqual(getattr(client, method)("/api/" + path).status_code, 404)

    def test_archive_models_have_no_default_permissions(self):
        from .models import Assignment, AssignmentSubmission
        from django.contrib.auth.models import Permission
        self.assertEqual(Assignment._meta.default_permissions, ())
        self.assertEqual(AssignmentSubmission._meta.default_permissions, ())
        self.assertFalse(Permission.objects.filter(content_type__app_label="assignments").exists())
