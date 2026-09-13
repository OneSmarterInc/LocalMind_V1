from pathlib import Path
from tempfile import TemporaryDirectory
from django.test import TestCase, override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from core.testing import make_admin, make_faculty, make_student, make_subject, assign, enroll, client_for, make_published_document
from .models import SharedBook
from .views import check_file
from core.exceptions import ValidationFailed

class SharedLibraryTests(TestCase):
    def setUp(self):
        self.tmp=TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        config=override_settings(PRIVATE_LIBRARY_ROOT=Path(self.tmp.name)/"books", MEDIA_ROOT=Path(self.tmp.name)/"media")
        config.enable(); self.addCleanup(config.disable)
        self.admin=make_admin(); self.faculty=make_faculty(); self.student=make_student(); self.subject=make_subject(code="LOCAL")
        assign(self.faculty,self.subject); enroll(self.student,self.subject)
        self.ac=client_for(self.admin); self.fc=client_for(self.faculty); self.sc=client_for(self.student)
    def upload(self, client=None, **extra):
        values={"title":"Private learning", "file":SimpleUploadedFile("book.txt",b"Plants use sunlight to produce glucose."), "share_confirmed":"true"}
        values.update(extra)
        return (client or self.ac).post("/api/faculty/private-library/",values,format="multipart")
    def test_admin_upload_is_simple_and_private(self):
        res=self.upload(); self.assertEqual(res.status_code,201,res.content)
        b=SharedBook.objects.get(pk=res.data["id"])
        self.assertTrue(Path(b.file.path).is_relative_to(Path(self.tmp.name)/"books"))
        with self.assertRaises(ValueError): _ = b.file.url
        self.assertEqual(b.sha256,res.data["sha256"])
        self.assertEqual(len(b.sha256),64)
        self.assertEqual(len(self.sc.get("/api/student/private-library/").data),1)
    def test_download_requires_student_and_permission(self):
        res=self.upload(subject_id=str(self.subject.id)); self.assertEqual(res.status_code,201,res.content)
        path=f"/api/student/private-library/shared/{res.data['id']}/download/"
        self.assertEqual(self.client.get(path).status_code,401)
        self.assertIn(self.fc.get(path).status_code,(403,404))
        self.assertEqual(client_for(make_student()).get(path).status_code,404)
        good=self.sc.get(path); self.assertEqual(good.status_code,200); self.assertEqual(good["Cache-Control"],"private, no-store")
        self.assertEqual(b"".join(good.streaming_content),b"Plants use sunlight to produce glucose.")
    def test_faculty_must_have_subject(self):
        self.assertEqual(self.upload(self.fc).status_code,400)
        other=make_subject(code="OTHER")
        self.assertEqual(self.upload(self.fc,subject_id=str(other.id)).status_code,404)
        self.assertEqual(self.upload(self.fc,subject_id=str(self.subject.id)).status_code,201)
    def test_students_cannot_share_or_toggle(self):
        self.assertEqual(self.upload(self.sc).status_code,403)
        b=self.upload().data
        self.assertEqual(self.sc.patch(f"/api/faculty/private-library/{b['id']}/",{"active":False},format="json").status_code,403)
    def test_toggle_revokes_new_downloads_not_personal_records(self):
        b=self.upload().data
        res=self.ac.patch(f"/api/faculty/private-library/{b['id']}/",{"active":False},format="json")
        self.assertEqual(res.status_code,200)
        self.assertEqual(self.sc.get("/api/student/private-library/").data,[])
        self.assertEqual(self.sc.get(f"/api/student/private-library/shared/{b['id']}/download/").status_code,404)
    def test_course_books_follow_enrollment_not_progression(self):
        doc=make_published_document(self.subject)
        doc.file.save("course.txt",SimpleUploadedFile("course.txt",b"Chapter one. This is the actual course book."))
        doc.original_name="course.txt"; doc.save()
        rows=self.sc.get("/api/student/private-library/").data
        self.assertEqual(rows[0]["kind"],"course")
        self.assertEqual(rows[0]["id"],str(doc.id))
        doc.status="unpublished"; doc.save()
        self.assertEqual(self.sc.get("/api/student/private-library/").data,[])
    def test_discontinued_subject_is_not_available(self):
        self.upload(subject_id=str(self.subject.id))
        self.subject.status="discontinued"; self.subject.save()
        self.assertEqual(self.sc.get("/api/student/private-library/").data,[])
    def test_no_consent_no_upload(self):
        self.assertEqual(self.upload(share_confirmed="false").status_code,400)
        self.assertFalse(SharedBook.objects.exists())
    def test_reject_disguised_files(self):
        for name,body in (("a.pdf",b"not a PDF"),("a.docx",b"not a zip"),("a.txt",b"\0data"),("a.exe",b"MZbinary")):
            with self.subTest(name=name):
                with self.assertRaises(ValidationFailed): check_file(SimpleUploadedFile(name,body))
