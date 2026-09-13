from io import BytesIO

from django.test import TestCase
from openpyxl import Workbook

from academics.models import FacultySubject, Subject
from audit.models import AuditLog
from core.testing import (
    INITIAL, STRONG, bearer, client_for, login, make_admin, make_faculty, make_student, make_subject,
)

from .models import Role, User


class AuthenticationTests(TestCase):
    def setUp(self):
        self.admin = make_admin(email="admin@example.edu")
        self.faculty = make_faculty(email="prof@example.edu")
        self.student = make_student(email="stu@example.edu")

    def test_each_role_can_log_in_on_its_own_endpoint(self):
        for role, user in (("admin", self.admin), ("faculty", self.faculty), ("student", self.student)):
            res = login(client_for(), role, user.email, STRONG)
            self.assertEqual(res.status_code, 200, res.content)
            self.assertIn("access", res.data)
            self.assertEqual(res.data["user"]["role"], role)
            self.assertFalse(res.data["must_change_password"])

    def test_wrong_role_endpoint_is_rejected_like_bad_password(self):
        res = login(client_for(), "admin", self.student.email, STRONG)
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.data["error"]["code"], "INVALID_CREDENTIALS")

    def test_invalid_password(self):
        res = login(client_for(), "student", self.student.email, "nope")
        self.assertEqual(res.status_code, 401)
        self.assertTrue(AuditLog.objects.filter(action="auth.login_failed").exists())

    def test_inactive_user_cannot_log_in(self):
        self.student.status = "discontinued"
        self.student.save()
        res = login(client_for(), "student", self.student.email, STRONG)
        self.assertEqual(res.status_code, 401)

    def test_unauthenticated_request_gets_structured_error(self):
        res = client_for().get("/api/auth/me/")
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.data["error"]["code"], "AUTHENTICATION_REQUIRED")

    def test_token_round_trip_and_refresh_rotation(self):
        res = login(client_for(), "faculty", self.faculty.email, STRONG)
        client = bearer(client_for(), res.data["access"])
        self.assertEqual(client.get("/api/auth/me/").status_code, 200)
        refreshed = client_for().post("/api/auth/refresh/", {"refresh": res.data["refresh"]}, format="json")
        self.assertEqual(refreshed.status_code, 200)
        reused = client_for().post("/api/auth/refresh/", {"refresh": res.data["refresh"]}, format="json")
        self.assertEqual(reused.status_code, 401)

    def test_login_opens_application_session_and_logout_closes_it(self):
        res = login(client_for(), "student", self.student.email, STRONG)
        session_id = res.data["session_id"]
        client = bearer(client_for(), res.data["access"])
        out = client.post("/api/auth/logout/", {"refresh": res.data["refresh"], "session_id": session_id}, format="json")
        self.assertEqual(out.status_code, 204)
        from activity.models import ApplicationSession
        session = ApplicationSession.objects.get(pk=session_id)
        self.assertIsNotNone(session.logout_at)
        self.assertEqual(session.ended_by, "logout")


class MandatoryPasswordResetTests(TestCase):
    def setUp(self):
        self.student = make_student(email="new@example.edu", password=INITIAL, must_change=True)

    def test_flagged_user_is_blocked_everywhere_except_password_change(self):
        res = login(client_for(), "student", self.student.email, INITIAL)
        self.assertTrue(res.data["must_change_password"])
        client = bearer(client_for(), res.data["access"])
        blocked = client.get("/api/student/subjects/")
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.data["error"]["code"], "PASSWORD_CHANGE_REQUIRED")
        self.assertEqual(client.get("/api/auth/me/").status_code, 200)

    def test_password_change_lifts_block_and_is_audited(self):
        res = login(client_for(), "student", self.student.email, INITIAL)
        client = bearer(client_for(), res.data["access"])
        weak = client.post("/api/auth/password/change/", {"current_password": INITIAL, "new_password": "short"}, format="json")
        self.assertEqual(weak.status_code, 400)
        changed = client.post("/api/auth/password/change/", {"current_password": INITIAL, "new_password": STRONG}, format="json")
        self.assertEqual(changed.status_code, 200, changed.content)
        self.assertFalse(changed.data["must_change_password"])
        client = bearer(client_for(), changed.data["access"])
        self.assertEqual(client.get("/api/student/subjects/").status_code, 200)
        self.student.refresh_from_db()
        self.assertFalse(self.student.must_change_password)
        self.assertTrue(AuditLog.objects.filter(action="user.password_changed", target_id=str(self.student.id)).exists())

    def test_wrong_current_password_rejected(self):
        res = login(client_for(), "student", self.student.email, INITIAL)
        client = bearer(client_for(), res.data["access"])
        bad = client.post("/api/auth/password/change/", {"current_password": "wrong", "new_password": STRONG}, format="json")
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(bad.data["error"]["code"], "INVALID_CURRENT_PASSWORD")


class RoleIsolationTests(TestCase):
    def setUp(self):
        self.admin = make_admin()
        self.faculty = make_faculty()
        self.student = make_student()

    def test_student_cannot_call_admin_apis(self):
        res = client_for(self.student).get("/api/admin/students/")
        self.assertEqual(res.status_code, 403)
        res = client_for(self.student).post("/api/admin/subjects/", {"name": "X", "code": "X1"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_faculty_cannot_call_admin_apis(self):
        self.assertEqual(client_for(self.faculty).get("/api/admin/faculty/").status_code, 403)
        self.assertEqual(client_for(self.faculty).get("/api/admin/audit-logs/").status_code, 403)

    def test_student_cannot_call_faculty_apis(self):
        self.assertEqual(client_for(self.student).get("/api/faculty/subjects/").status_code, 403)

    def test_faculty_cannot_call_student_apis(self):
        self.assertEqual(client_for(self.faculty).get("/api/student/subjects/").status_code, 403)


class AdminUserManagementTests(TestCase):
    def setUp(self):
        self.admin = make_admin()
        self.client = client_for(self.admin)
        self.subject = make_subject()

    def test_manual_faculty_creation_sets_initial_password_and_subjects(self):
        res = self.client.post("/api/admin/faculty/", {
            "email": "New.Prof@Example.edu", "full_name": "New Prof",
            "profile": {"employee_id": "E9", "department": "CS"},
            "subject_ids": [str(self.subject.id)],
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        user = User.objects.get(email="new.prof@example.edu")
        self.assertEqual(user.role, Role.FACULTY)
        self.assertTrue(user.must_change_password)
        self.assertTrue(user.check_password(INITIAL))
        self.assertEqual(user.faculty_profile.employee_id, "E9")
        self.assertTrue(FacultySubject.objects.filter(faculty=user, subject=self.subject, status="active").exists())
        self.assertTrue(AuditLog.objects.filter(action="user.created", target_id=str(user.id)).exists())

    def test_duplicate_email_conflicts(self):
        self.client.post("/api/admin/students/", {"email": "s@example.edu", "full_name": "S"}, format="json")
        res = self.client.post("/api/admin/students/", {"email": "S@example.edu", "full_name": "S2"}, format="json")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["error"]["code"], "USER_EXISTS")

    def test_students_endpoint_only_creates_students(self):
        res = self.client.post("/api/admin/students/", {"email": "s@example.edu", "full_name": "S", "profile": {"roll_number": "R1"}}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["role"], "student")
        self.assertEqual(res.data["profile"]["roll_number"], "R1")

    def test_discontinue_reactivate_and_history_preserved(self):
        student = make_student()
        make_subject(code="CS102")
        res = self.client.post(f"/api/admin/students/{student.id}/discontinue/", {"reason": "left"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "discontinued")
        self.assertTrue(User.objects.filter(pk=student.pk).exists())
        self.assertEqual(self.client.post(f"/api/admin/students/{student.id}/discontinue/", {}, format="json").status_code, 409)
        res = self.client.post(f"/api/admin/students/{student.id}/reactivate/", {}, format="json")
        self.assertEqual(res.data["status"], "active")

    def test_delete_student_removes_the_account_and_its_records(self):
        """The People screen deletes accounts now, so the row and everything
        hanging off it must go while the audit trail survives."""
        from academics.models import Enrollment

        student = make_student()
        subject = make_subject(code="CS103")
        Enrollment.objects.create(student=student, subject=subject)

        res = self.client.delete(f"/api/admin/students/{student.id}/", {"reason": "left the programme"}, format="json")

        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(User.objects.filter(pk=student.pk).exists())
        self.assertFalse(Enrollment.objects.filter(student_id=student.pk).exists())
        entry = AuditLog.objects.get(action="user.deleted")
        self.assertEqual(entry.summary["reason"], "left the programme")

    def test_delete_faculty_releases_its_subject_assignments(self):
        faculty = make_faculty()
        subject = make_subject(code="CS104")
        FacultySubject.objects.create(faculty=faculty, subject=subject)
        res = self.client.delete(f"/api/admin/faculty/{faculty.id}/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(User.objects.filter(pk=faculty.pk).exists())
        self.assertFalse(FacultySubject.objects.filter(faculty_id=faculty.pk).exists())
        self.assertTrue(Subject.objects.filter(pk=subject.pk).exists())

    def test_cannot_delete_own_account(self):
        admin = make_admin(email="second-admin@example.edu")
        res = client_for(admin).delete(f"/api/admin/faculty/{admin.id}/")
        self.assertEqual(res.status_code, 404)  # an admin is not inside the faculty scope
        self.assertTrue(User.objects.filter(pk=admin.pk).exists())

    def test_cannot_discontinue_self(self):
        res = self.client.post(f"/api/admin/faculty/{self.admin.id}/discontinue/", {}, format="json")
        self.assertEqual(res.status_code, 404)  # admin is not in the faculty scope

    def test_unknown_id_is_404_not_latest(self):
        make_student()
        res = self.client.get("/api/admin/students/00000000-0000-0000-0000-000000000000/")
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.data["error"]["code"], "NOT_FOUND")

    def test_admin_password_reset_forces_change(self):
        student = make_student()
        res = self.client.post(f"/api/admin/students/{student.id}/reset-password/", {}, format="json")
        self.assertEqual(res.status_code, 200)
        student.refresh_from_db()
        self.assertTrue(student.must_change_password)
        self.assertTrue(student.check_password(INITIAL))


def _workbook(headers, rows):
    wb = Workbook()
    ws = wb.active
    ws.append(headers)
    for row in rows:
        ws.append(row)
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    buf.name = "users.xlsx"
    return buf


class ExcelImportTests(TestCase):
    def setUp(self):
        self.admin = make_admin()
        self.client = client_for(self.admin)
        make_student(email="exists@example.edu")
        self.subject = make_subject(code="CS101")

    def test_student_import_reports_created_existing_and_invalid(self):
        wb = _workbook(["Name", "Email", "Roll Number"], [
            ["Alice", "alice@example.edu", "R1"],
            ["Bob", "exists@example.edu", "R2"],
            ["", "noname@example.edu", "R3"],
            ["Dana", "not-an-email", "R4"],
            ["Eve", "alice@example.edu", "R5"],
            ["Frank", "frank@example.edu", "R6"],
        ])
        res = self.client.post("/api/admin/students/import/", {"file": wb}, format="multipart")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["total_rows"], 6)
        self.assertEqual(res.data["created"], 2)
        self.assertEqual(res.data["already_existing"], 1)
        self.assertEqual(res.data["invalid"], 3)
        rows_with_errors = {e["row"] for e in res.data["errors"]}
        self.assertEqual(rows_with_errors, {3, 4, 5, 6})
        alice = User.objects.get(email="alice@example.edu")
        self.assertTrue(alice.must_change_password)
        self.assertEqual(alice.student_profile.roll_number, "R1")

    def test_faculty_import_resolves_subject_codes(self):
        wb = _workbook(["name", "email", "subject_codes", "department"], [
            ["Prof A", "a@example.edu", "cs101", "CS"],
            ["Prof B", "b@example.edu", "CS101, NOPE", "CS"],
        ])
        res = self.client.post("/api/admin/faculty/import/", {"file": wb}, format="multipart")
        self.assertEqual(res.data["created"], 1)
        self.assertEqual(res.data["invalid"], 1)
        a = User.objects.get(email="a@example.edu")
        self.assertTrue(FacultySubject.objects.filter(faculty=a, subject=self.subject).exists())
        self.assertFalse(User.objects.filter(email="b@example.edu").exists())

    def test_missing_headers_rejected(self):
        wb = _workbook(["Name", "Phone"], [["X", "1"]])
        res = self.client.post("/api/admin/students/import/", {"file": wb}, format="multipart")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["code"], "MISSING_HEADERS")

    def test_non_xlsx_rejected(self):
        buf = BytesIO(b"name,email\n")
        buf.name = "users.csv"
        res = self.client.post("/api/admin/students/import/", {"file": buf}, format="multipart")
        self.assertEqual(res.status_code, 400)


class ImportHeaderNormalisationTests(TestCase):
    def test_documented_header_variants_are_accepted(self):
        from accounts.services.excel_import import _normalize_header
        cases = {"Full Name": "name", "E-mail": "email", "E-mail Address": "email", "Email": "email",
                 "Roll No": "roll_number", "Roll No.": "roll_number", "Roll Number": "roll_number",
                 "Employee ID": "employee_id", "Subjects": "subject_codes", "Subject Codes": "subject_codes",
                 "Batch": "batch", "Phone": "phone", "Department": "department"}
        for raw, expected in cases.items():
            self.assertEqual(_normalize_header(raw), expected, raw)


class ImportTemplateTests(TestCase):
    """The screen, the template and the parser must describe one sheet."""

    def setUp(self):
        self.client = client_for(make_admin())

    def test_template_headers_match_what_the_parser_accepts(self):
        import base64
        from io import BytesIO

        from openpyxl import load_workbook

        from accounts.services.excel_import import OPTIONAL_HEADERS, REQUIRED_HEADERS

        res = self.client.get("/api/admin/students/import/template/")
        self.assertEqual(res.status_code, 200, res.content)
        names = [c["name"] for c in res.data["columns"]]
        self.assertEqual(set(names), REQUIRED_HEADERS | OPTIONAL_HEADERS[Role.STUDENT])
        self.assertTrue(all(c["required"] for c in res.data["columns"] if c["name"] in REQUIRED_HEADERS))

        book = load_workbook(BytesIO(base64.b64decode(res.data["content_base64"])))
        header = [c.value for c in book.active[1]]
        self.assertEqual(header, names)
        self.assertGreaterEqual(book.active.max_row, 2, "the template carries example rows")

    def test_the_template_it_serves_imports_cleanly(self):
        import base64
        from io import BytesIO

        res = self.client.get("/api/admin/students/import/template/")
        payload = BytesIO(base64.b64decode(res.data["content_base64"]))
        payload.name = "template.xlsx"

        imported = self.client.post("/api/admin/students/import/", {"file": payload}, format="multipart")

        self.assertEqual(imported.status_code, 200, imported.content)
        self.assertEqual(imported.data["invalid"], 0, imported.data["errors"])
        self.assertEqual(imported.data["created"], 2)

    def test_faculty_template_covers_subject_codes(self):
        res = self.client.get("/api/admin/faculty/import/template/")
        self.assertIn("subject_codes", [c["name"] for c in res.data["columns"]])
        aliases = {c["name"]: c["aliases"] for c in res.data["columns"]}
        self.assertIn("full_name", aliases["name"])


class ImportIgnoresUnknownColumnsTests(TestCase):
    """A real institutional sheet carries columns this platform knows nothing
    about. Those must be read past, not rejected."""

    def setUp(self):
        self.client = client_for(make_admin())

    def _sheet(self, headers, rows):
        from io import BytesIO

        from openpyxl import Workbook

        wb = Workbook()
        ws = wb.active
        ws.append(headers)
        for r in rows:
            ws.append(r)
        buf = BytesIO()
        wb.save(buf)
        buf.seek(0)
        buf.name = "people.xlsx"
        return buf

    def test_columns_the_system_does_not_know_are_ignored(self):
        from accounts.models import User

        sheet = self._sheet(
            ["Sr No", "name", "Guardian Name", "email", "Fees Paid", "roll_no", "Remarks"],
            [[1, "Priya Kulkarni", "R Kulkarni", "priya@example.edu", "12000", "CS4750", "hostel"]],
        )
        res = self.client.post("/api/admin/students/import/", {"file": sheet}, format="multipart")

        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["created"], 1, res.data["errors"])
        self.assertEqual(res.data["invalid"], 0)
        user = User.objects.get(email="priya@example.edu")
        self.assertEqual(user.full_name, "Priya Kulkarni")
        # The alias was honoured and nothing from the unknown columns leaked in.
        self.assertEqual(user.student_profile.roll_number, "CS4750")
        self.assertNotIn("guardian_name", user.student_profile.__dict__)

    def test_a_column_belonging_to_the_other_role_is_ignored_too(self):
        from accounts.models import User

        sheet = self._sheet(
            ["name", "email", "department", "batch"],
            [["Nisha Rao", "nisha@example.edu", "Physics", "2027"]],
        )
        res = self.client.post("/api/admin/students/import/", {"file": sheet}, format="multipart")

        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["created"], 1, res.data["errors"])
        # department belongs to faculty; batch is the student column that counts.
        self.assertEqual(User.objects.get(email="nisha@example.edu").student_profile.batch, "2027")

    def test_a_sheet_without_the_required_columns_is_refused_clearly(self):
        sheet = self._sheet(["Sr No", "Guardian Name"], [[1, "R Kulkarni"]])
        res = self.client.post("/api/admin/students/import/", {"file": sheet}, format="multipart")

        self.assertEqual(res.status_code, 400, res.content)
        self.assertEqual(res.data["error"]["code"], "MISSING_HEADERS")
        self.assertEqual(sorted(res.data["error"]["details"]["missing"]), ["email", "name"])


from django.core.cache import cache
from django.test import RequestFactory, override_settings


def _localmind(**overrides):
    from django.conf import settings
    return {**settings.LOCALMIND, **overrides}


@override_settings(LOCALMIND=_localmind(INITIAL_PASSWORD_MODE="unique"))
class UniqueInitialPasswordTests(TestCase):
    """Unique mode: no two accounts share an onboarding password, and the
    shared INITIAL_USER_PASSWORD opens nothing."""

    def setUp(self):
        cache.clear()
        self.admin = make_admin(email="admin@example.edu")
        self.ac = client_for(self.admin)

    def test_created_account_gets_its_own_one_time_password(self):
        a = self.ac.post("/api/admin/students/", {"email": "a@example.edu", "full_name": "A"}, format="json")
        b = self.ac.post("/api/admin/students/", {"email": "b@example.edu", "full_name": "B"}, format="json")
        self.assertEqual(a.status_code, 201, a.content)
        self.assertEqual(a.data["initial_password_mode"], "unique")
        self.assertTrue(a.data["initial_password"])
        self.assertNotEqual(a.data["initial_password"], b.data["initial_password"])
        self.assertEqual(login(client_for(), "student", "a@example.edu", INITIAL).status_code, 401)
        ok = login(client_for(), "student", "a@example.edu", a.data["initial_password"])
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertTrue(ok.data["must_change_password"])
        # The password is never written to the audit log.
        self.assertFalse(AuditLog.objects.filter(summary__icontains=a.data["initial_password"]).exists())

    def test_import_returns_each_password_once(self):
        wb = _workbook(["name", "email"], [["One", "one@example.edu"], ["Two", "two@example.edu"]])
        res = self.ac.post("/api/admin/students/import/", {"file": wb}, format="multipart")
        self.assertEqual(res.status_code, 200, res.content)
        rows = res.data["created_users"]
        self.assertEqual(len(rows), 2)
        self.assertEqual(len({r["initial_password"] for r in rows}), 2)
        for r in rows:
            self.assertEqual(login(client_for(), "student", r["email"], r["initial_password"]).status_code, 200)

    def test_reset_issues_a_new_one_time_password(self):
        stu = make_student(email="s@example.edu")
        res = self.ac.post(f"/api/admin/students/{stu.id}/reset-password/", {}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data["initial_password"])
        self.assertEqual(login(client_for(), "student", stu.email, STRONG).status_code, 401)
        self.assertEqual(login(client_for(), "student", stu.email, res.data["initial_password"]).status_code, 200)


class SharedInitialPasswordStillWorksTests(TestCase):
    def test_shared_mode_returns_no_password(self):
        admin = make_admin(email="admin@example.edu")
        res = client_for(admin).post("/api/admin/students/", {"email": "c@example.edu", "full_name": "C"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertIsNone(res.data["initial_password"])
        self.assertEqual(res.data["initial_password_mode"], "shared")


@override_settings(LOCALMIND=_localmind(LOGIN_MAX_FAILURES=3, LOGIN_LOCKOUT_MINUTES=15))
class LoginLockoutTests(TestCase):
    def setUp(self):
        cache.clear()
        self.student = make_student(email="stu@example.edu")

    def test_account_locks_after_repeated_failures_even_with_the_right_password(self):
        for _ in range(3):
            self.assertEqual(login(client_for(), "student", self.student.email, "wrong-password").status_code, 401)
        res = login(client_for(), "student", self.student.email, STRONG)
        self.assertEqual(res.status_code, 429, res.content)
        self.assertEqual(res.data["error"]["code"], "TOO_MANY_ATTEMPTS")

    def test_lockout_is_keyed_by_email_not_by_existence(self):
        for _ in range(3):
            login(client_for(), "student", "nobody@example.edu", "x")
        res = login(client_for(), "student", "nobody@example.edu", "x")
        self.assertEqual(res.status_code, 429)
        # Another account is unaffected.
        self.assertEqual(login(client_for(), "student", self.student.email, STRONG).status_code, 200)

    def test_a_successful_login_resets_the_count(self):
        for _ in range(2):
            login(client_for(), "student", self.student.email, "wrong-password")
        self.assertEqual(login(client_for(), "student", self.student.email, STRONG).status_code, 200)
        for _ in range(2):
            login(client_for(), "student", self.student.email, "wrong-password")
        self.assertEqual(login(client_for(), "student", self.student.email, STRONG).status_code, 200)

    def test_rotating_x_forwarded_for_does_not_escape_the_lock(self):
        for i in range(3):
            client_for().post("/api/auth/login/student/", {"email": self.student.email, "password": "bad"},
                              format="json", HTTP_X_FORWARDED_FOR=f"10.0.0.{i}")
        res = client_for().post("/api/auth/login/student/", {"email": self.student.email, "password": STRONG},
                                format="json", HTTP_X_FORWARDED_FOR="10.9.9.9")
        self.assertEqual(res.status_code, 429)


class ClientAddressTests(TestCase):
    def _request(self, xff=None, remote="192.0.2.10"):
        meta = {"REMOTE_ADDR": remote}
        if xff is not None:
            meta["HTTP_X_FORWARDED_FOR"] = xff
        return RequestFactory().get("/", **meta)

    def test_without_a_proxy_the_header_is_ignored(self):
        from core.utils import client_ip
        with override_settings(REST_FRAMEWORK={**__import__("django.conf").conf.settings.REST_FRAMEWORK, "NUM_PROXIES": 0}):
            self.assertEqual(client_ip(self._request("203.0.113.5")), "192.0.2.10")
            self.assertEqual(client_ip(self._request("not-an-ip")), "192.0.2.10")

    def test_behind_one_proxy_the_last_hop_is_the_client(self):
        from core.utils import client_ip
        with override_settings(REST_FRAMEWORK={**__import__("django.conf").conf.settings.REST_FRAMEWORK, "NUM_PROXIES": 1}):
            # A client-written first entry is not believed.
            self.assertEqual(client_ip(self._request("6.6.6.6, 198.51.100.7")), "198.51.100.7")
            self.assertEqual(client_ip(self._request("garbage")), "192.0.2.10")

    def test_default_setting_does_not_trust_forwarded_for(self):
        from django.conf import settings
        self.assertEqual(settings.REST_FRAMEWORK["NUM_PROXIES"], 0)


class PasswordChangeRevokesOtherSessionsTests(TestCase):
    def test_refresh_token_from_before_the_change_stops_working(self):
        cache.clear()
        stu = make_student(email="stu@example.edu")
        old = login(client_for(), "student", stu.email, STRONG).data
        other = login(client_for(), "student", stu.email, STRONG).data
        c = bearer(client_for(), other["access"])
        res = c.post("/api/auth/password/change/", {"current_password": STRONG, "new_password": "An0ther-Str0ng-Pass!"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(client_for().post("/api/auth/refresh/", {"refresh": old["refresh"]}, format="json").status_code, 401)
        # The session that changed the password carries on with its new pair.
        self.assertEqual(client_for().post("/api/auth/refresh/", {"refresh": res.data["refresh"]}, format="json").status_code, 200)


class SharedPasswordIsTheDefaultTests(TestCase):
    def test_default_mode_is_shared_everywhere(self):
        from accounts.services.users import initial_password_mode
        self.assertEqual(initial_password_mode(), "shared")
        admin = make_admin(email="admin2@example.edu")
        ac = client_for(admin)
        created = ac.post("/api/admin/students/", {"email": "new@example.edu", "full_name": "New"}, format="json")
        self.assertIsNone(created.data["initial_password"])
        self.assertEqual(login(client_for(), "student", "new@example.edu", INITIAL).status_code, 200)
        wb = _workbook(["name", "email"], [["Imported", "imp@example.edu"]])
        ac.post("/api/admin/students/import/", {"file": wb}, format="multipart")
        self.assertEqual(login(client_for(), "student", "imp@example.edu", INITIAL).status_code, 200)
        stu = make_student(email="chosen@example.edu")
        reset = ac.post(f"/api/admin/students/{stu.id}/reset-password/", {}, format="json")
        self.assertIsNone(reset.data["initial_password"])
        self.assertEqual(login(client_for(), "student", stu.email, INITIAL).status_code, 200)


class ResetOnboardingPasswordsCommandTests(TestCase):
    def test_only_accounts_still_on_an_onboarding_password_are_reset(self):
        from io import StringIO

        from django.core.management import call_command

        stuck = make_student(email="stuck@example.edu", password="xY7-unknown-one-time", must_change=True)
        chosen = make_student(email="chosen@example.edu")  # has its own password
        on_shared = make_student(email="shared@example.edu", password=INITIAL, must_change=True)
        out = StringIO()
        call_command("reset_onboarding_passwords", "--dry-run", stdout=out)
        self.assertIn("would reset: stuck@example.edu", out.getvalue())
        self.assertEqual(login(client_for(), "student", stuck.email, INITIAL).status_code, 401)
        call_command("reset_onboarding_passwords", stdout=StringIO())
        self.assertEqual(login(client_for(), "student", stuck.email, INITIAL).status_code, 200)
        self.assertEqual(login(client_for(), "student", chosen.email, STRONG).status_code, 200)
        self.assertEqual(login(client_for(), "student", on_shared.email, INITIAL).status_code, 200)
        self.assertTrue(AuditLog.objects.filter(action="user.password_reset_to_shared", target_id=str(stuck.id)).exists())
