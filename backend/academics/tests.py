from django.test import TestCase

from audit.models import AuditLog
from core.testing import assign, client_for, enroll, make_admin, make_faculty, make_student, make_subject

from .models import Enrollment, FacultySubject, Subject


class SubjectTests(TestCase):
    def setUp(self):
        self.admin = make_admin()
        self.client = client_for(self.admin)

    def test_create_subject_uppercases_code_and_rejects_duplicates(self):
        res = self.client.post("/api/admin/subjects/", {"name": "DBMS", "code": "cs201", "description": "d"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["code"], "CS201")
        dup = self.client.post("/api/admin/subjects/", {"name": "Other", "code": "CS201"}, format="json")
        self.assertEqual(dup.status_code, 409)

    def test_status_transitions(self):
        subject = make_subject()
        url = f"/api/admin/subjects/{subject.id}/status/"
        self.assertEqual(self.client.post(url, {"status": "discontinued"}, format="json").data["status"], "discontinued")
        self.assertEqual(self.client.post(url, {"status": "active"}, format="json").data["status"], "active")
        self.assertEqual(self.client.post(url, {"status": "archived"}, format="json").data["status"], "archived")
        self.assertEqual(self.client.post(url, {"status": "active"}, format="json").status_code, 409)

    def test_delete_subject_removes_it_and_everything_it_owns(self):
        """The admin console deletes subjects outright, so the PROTECT chain
        from documents, quizzes and assignments has to be cleared first."""
        from assessments.models import Assessment, AssessmentKind
        from assignments.models import Assignment
        from documents.models import Document
        from learning.models import Chapter

        subject = make_subject()
        student = make_student()
        enroll(student, subject)
        document = Document.objects.create(subject=subject, original_name="book.pdf", title="Book", file_type="pdf")
        chapter = Chapter.objects.create(document=document, title="Chapter one", order=1)
        Assessment.objects.create(subject=subject, chapter=chapter, kind=AssessmentKind.values[0], title="Quiz one")
        Assignment.objects.create(subject=subject, chapter=chapter, title="Assignment one")

        res = self.client.delete(f"/api/admin/subjects/{subject.id}/")

        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(Subject.objects.filter(pk=subject.pk).exists())
        self.assertFalse(Document.objects.filter(pk=document.pk).exists())
        self.assertFalse(Chapter.objects.filter(pk=chapter.pk).exists())
        self.assertFalse(Assessment.objects.exists())
        self.assertFalse(Assignment.objects.exists())
        self.assertFalse(Enrollment.objects.exists())
        self.assertTrue(AuditLog.objects.filter(action="subject.deleted").exists())

    def test_delete_subject_keeps_shared_books_and_only_drops_the_label(self):
        """A shared book is study material a student may already hold. Deleting
        the subject that labelled it used to raise a five hundred; it must free
        the label and leave the file alone."""
        from private_library.models import SharedBook

        subject = make_subject()
        book = SharedBook.objects.create(
            title="Physics Part I", subject=subject, uploaded_by=self.admin,
            file="shared/book.pdf", original_name="book.pdf", sha256="a" * 64, file_size=1024,
        )

        res = self.client.delete(f"/api/admin/subjects/{subject.id}/")

        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(Subject.objects.filter(pk=subject.pk).exists())
        book.refresh_from_db()
        self.assertIsNone(book.subject_id)
        self.assertTrue(book.active)
        entry = AuditLog.objects.get(action="subject.deleted")
        self.assertEqual(entry.summary.get("shared_books_detached"), 1)

    def test_delete_subject_refuses_readably_when_something_still_holds_it(self):
        """A refusal names what is blocking it. A five hundred names nothing."""
        from unittest.mock import patch

        from django.db.models.deletion import ProtectedError

        from assessments.models import Assessment

        subject = make_subject()
        blocker = Assessment(subject=subject, title="Quiz")
        with patch.object(Subject, "delete", side_effect=ProtectedError("protected", {blocker})):
            res = self.client.delete(f"/api/admin/subjects/{subject.id}/")

        self.assertEqual(res.status_code, 409, res.content)
        self.assertEqual(res.data["error"]["code"], "SUBJECT_IN_USE")
        self.assertIn("Assessments", res.data["error"]["message"])

    def test_delete_subject_needs_admin(self):
        subject = make_subject()
        res = client_for(make_faculty()).delete(f"/api/admin/subjects/{subject.id}/")
        self.assertIn(res.status_code, (401, 403))
        self.assertTrue(Subject.objects.filter(pk=subject.pk).exists())

    def test_a_student_can_be_enrolled_on_several_subjects(self):
        """The unique constraint is on the student and subject pair, not on the
        student, so one person can sit on as many courses as they are given."""
        student = make_student()
        maths = make_subject(code="MA101", name="Mathematics")
        physics = make_subject(code="PH101", name="Physics")
        chemistry = make_subject(code="CH101", name="Chemistry")

        for subject in (maths, physics, chemistry):
            res = self.client.post(f"/api/admin/subjects/{subject.id}/students/",
                                   {"student_ids": [str(student.id)]}, format="json")
            self.assertEqual(res.status_code, 201, res.content)
            self.assertEqual(res.data["results"][0]["status"], "enrolled")

        active = Enrollment.objects.filter(student=student, status="active")
        self.assertEqual(active.count(), 3)
        self.assertEqual(sorted(e.subject.code for e in active), ["CH101", "MA101", "PH101"])

        # The student portal shows every one of them.
        subjects = client_for(student).get("/api/student/subjects/").data
        codes = sorted(s["code"] for s in (subjects if isinstance(subjects, list) else subjects["results"]))
        self.assertEqual(codes, ["CH101", "MA101", "PH101"])

    def test_the_enrol_picker_only_hides_a_student_from_the_subject_they_are_on(self):
        """Excluding the already-enrolled must be per subject: a student on one
        course has to stay available for every other."""
        student = make_student()
        maths = make_subject(code="MA102")
        physics = make_subject(code="PH102")
        enroll(student, maths)

        on_maths = self.client.get(f"/api/admin/students/search/?subject={maths.id}").data
        on_physics = self.client.get(f"/api/admin/students/search/?subject={physics.id}").data

        self.assertNotIn(str(student.id), [s["id"] for s in on_maths["results"]])
        self.assertIn(str(student.id), [s["id"] for s in on_physics["results"]])

    def test_student_search_can_exclude_those_already_enrolled(self):
        """The enrol picker asks for candidates for one subject, so anyone
        already on it must not come back."""
        subject = make_subject()
        already = make_student(name="Already Enrolled")
        available = make_student(name="Not Yet Enrolled")
        enroll(already, subject)

        everyone = self.client.get("/api/admin/students/search/").data
        self.assertIn(str(already.id), [s["id"] for s in everyone["results"]])

        candidates = self.client.get(f"/api/admin/students/search/?subject={subject.id}").data
        ids = [s["id"] for s in candidates["results"]]
        self.assertEqual(candidates["already_enrolled"], 1)
        self.assertNotIn(str(already.id), ids)
        self.assertIn(str(available.id), ids)

    def test_search_says_why_nobody_can_be_enrolled(self):
        """An empty picker used to claim everyone was already enrolled, whatever
        the real reason. Enrolling looked broken when no student account existed
        at all, or when every match was locked."""
        from accounts.models import AccountStatus

        subject = make_subject(code="EN101")
        nothing = self.client.get(f"/api/admin/students/search/?subject={subject.id}").data
        self.assertEqual([nothing["results"], nothing["student_accounts"]], [[], 0])

        locked = make_student(name="Locked Account")
        locked.status = AccountStatus.LOCKED
        locked.save()
        only_locked = self.client.get(f"/api/admin/students/search/?subject={subject.id}").data
        self.assertEqual(only_locked["results"], [])
        self.assertEqual([only_locked["student_accounts"], only_locked["not_active"]], [1, 1])

    def test_enrolling_a_locked_account_reports_the_skip(self):
        """A locked account is skipped rather than refused, so the outcome has
        to reach the caller; silence about it reads as a failed enrolment."""
        from accounts.models import AccountStatus

        subject = make_subject(code="EN102")
        active = make_student(name="Active One")
        locked = make_student(name="Locked One", email="locked-two@example.edu")
        locked.status = AccountStatus.LOCKED
        locked.save()

        res = self.client.post(f"/api/admin/subjects/{subject.id}/students/",
                               {"student_ids": [str(active.id), str(locked.id)]}, format="json")

        self.assertEqual(res.status_code, 201, res.content)
        outcomes = {r["student_id"]: r for r in res.data["results"]}
        self.assertEqual(outcomes[str(active.id)]["status"], "enrolled")
        self.assertEqual(outcomes[str(locked.id)]["status"], "skipped")
        self.assertEqual(outcomes[str(locked.id)]["reason"], "account_inactive")
        self.assertEqual(Enrollment.objects.filter(subject=subject).count(), 1)

    def test_faculty_search_matches_the_admin_shape(self):
        """Both portals share one picker, so both endpoints answer alike."""
        subject = make_subject(code="EN103")
        faculty = make_faculty()
        assign(faculty, subject)
        make_student(name="Pickable")

        data = client_for(faculty).get(f"/api/faculty/students/search/?subject={subject.id}").data

        self.assertEqual(set(data), {"results", "student_accounts", "matching", "already_enrolled", "not_active"})
        self.assertEqual(len(data["results"]), 1)
        self.assertEqual(set(data["results"][0]), {"id", "email", "full_name", "roll_number"})

    def test_assign_and_unassign_faculty(self):
        subject = make_subject()
        faculty = make_faculty()
        res = self.client.post(f"/api/admin/subjects/{subject.id}/faculty/", {"faculty_ids": [str(faculty.id)]}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertTrue(FacultySubject.objects.filter(faculty=faculty, subject=subject, status="active").exists())
        res = self.client.delete(f"/api/admin/subjects/{subject.id}/faculty/{faculty.id}/")
        self.assertEqual(res.status_code, 200)
        link = FacultySubject.objects.get(faculty=faculty, subject=subject)
        self.assertEqual(link.status, "discontinued")
        self.assertIsNotNone(link.discontinued_at)
        # Reassignment reuses the row
        self.client.post(f"/api/admin/faculty/{faculty.id}/subjects/", {"subject_ids": [str(subject.id)]}, format="json")
        self.assertEqual(FacultySubject.objects.filter(faculty=faculty, subject=subject).count(), 1)
        self.assertEqual(FacultySubject.objects.get(faculty=faculty, subject=subject).status, "active")

    def test_cannot_assign_student_as_faculty(self):
        subject = make_subject()
        student = make_student()
        res = self.client.post(f"/api/admin/subjects/{subject.id}/faculty/", {"faculty_ids": [str(student.id)]}, format="json")
        self.assertEqual(res.status_code, 404)

    def test_subject_detail_statistics(self):
        subject = make_subject()
        faculty = make_faculty()
        assign(faculty, subject)
        enroll(make_student(), subject)
        res = self.client.get(f"/api/admin/subjects/{subject.id}/")
        self.assertEqual(res.data["statistics"]["active_students"], 1)
        self.assertEqual(res.data["statistics"]["active_faculty"], 1)


class EnrollmentTests(TestCase):
    def setUp(self):
        self.admin = make_admin()
        self.faculty = make_faculty()
        self.other_faculty = make_faculty()
        self.subject = make_subject(code="OS")
        self.other_subject = make_subject(code="DB")
        assign(self.faculty, self.subject)
        assign(self.other_faculty, self.other_subject)
        self.student = make_student()

    def test_faculty_enrolls_student_in_own_subject(self):
        res = client_for(self.faculty).post(f"/api/faculty/subjects/{self.subject.id}/students/", {"student_ids": [str(self.student.id)]}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["results"][0]["status"], "enrolled")
        self.assertTrue(Enrollment.objects.filter(student=self.student, subject=self.subject, status="active").exists())
        self.assertTrue(AuditLog.objects.filter(action="student.enrolled").exists())

    def test_faculty_cannot_enroll_into_unassigned_subject(self):
        res = client_for(self.faculty).post(f"/api/faculty/subjects/{self.other_subject.id}/students/", {"student_ids": [str(self.student.id)]}, format="json")
        self.assertEqual(res.status_code, 404)  # not visible, so indistinguishable from missing

    def test_faculty_cannot_list_students_of_other_faculty_subject(self):
        self.assertEqual(client_for(self.faculty).get(f"/api/faculty/subjects/{self.other_subject.id}/students/").status_code, 404)

    def test_student_cannot_enroll_self(self):
        res = client_for(self.student).post(f"/api/faculty/subjects/{self.subject.id}/students/", {"student_ids": [str(self.student.id)]}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_discontinue_enrollment_keeps_account_and_other_subjects(self):
        enroll(self.student, self.subject)
        enroll(self.student, self.other_subject)
        res = client_for(self.faculty).post(f"/api/faculty/subjects/{self.subject.id}/students/{self.student.id}/discontinue/", {}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "discontinued")
        self.student.refresh_from_db()
        self.assertEqual(self.student.status, "active")
        self.assertEqual(Enrollment.objects.get(student=self.student, subject=self.other_subject).status, "active")
        # Row is preserved, not deleted
        self.assertEqual(Enrollment.objects.filter(student=self.student, subject=self.subject).count(), 1)

    def test_re_enrollment_reuses_row(self):
        enroll(self.student, self.subject)
        client_for(self.faculty).post(f"/api/faculty/subjects/{self.subject.id}/students/{self.student.id}/discontinue/", {}, format="json")
        res = client_for(self.faculty).post(f"/api/faculty/subjects/{self.subject.id}/students/", {"student_ids": [str(self.student.id)]}, format="json")
        self.assertEqual(res.data["results"][0]["status"], "re_enrolled")
        self.assertEqual(Enrollment.objects.filter(student=self.student, subject=self.subject).count(), 1)

    def test_admin_can_enroll_anywhere(self):
        res = client_for(self.admin).post(f"/api/admin/subjects/{self.other_subject.id}/students/", {"student_ids": [str(self.student.id)]}, format="json")
        self.assertEqual(res.status_code, 201)

    def test_student_sees_only_active_enrollments_in_active_subjects(self):
        enroll(self.student, self.subject)
        e2 = enroll(self.student, self.other_subject)
        e2.status = "discontinued"
        e2.save()
        res = client_for(self.student).get("/api/student/subjects/")
        self.assertEqual([s["code"] for s in res.data], ["OS"])

    def test_faculty_subject_list_scoped(self):
        res = client_for(self.faculty).get("/api/faculty/subjects/")
        self.assertEqual([s["code"] for s in res.data], ["OS"])

    def test_scoped_queryset_helpers(self):
        self.assertEqual(list(Subject.objects.visible_to(self.faculty)), [self.subject])
        enroll(self.student, self.other_subject)
        self.assertEqual(list(Subject.objects.visible_to(self.student)), [self.other_subject])
        self.assertEqual(Subject.objects.visible_to(self.admin).count(), 2)


class PortalSeparationTests(TestCase):
    def test_prefix_binds_role(self):
        from core.testing import assign, client_for, enroll, make_admin, make_faculty, make_student, make_subject
        admin, faculty, student, subject = make_admin(), make_faculty(), make_student(), make_subject(code="PS")
        assign(faculty, subject); enroll(student, subject)
        fc, ac, sc = client_for(faculty), client_for(admin), client_for(student)
        self.assertEqual(fc.get("/api/faculty/documents/").status_code, 200)
        self.assertEqual(fc.get("/api/admin/documents/").status_code, 404)
        self.assertEqual(ac.get("/api/faculty/documents/").status_code, 200)
        self.assertEqual(ac.get("/api/faculty/documents/").status_code, 200)
        self.assertEqual(ac.get("/api/student/subjects/").status_code, 403)
        self.assertEqual(sc.get("/api/student/subjects/").status_code, 200)
        self.assertEqual(sc.get("/api/faculty/subjects/").status_code, 403)
