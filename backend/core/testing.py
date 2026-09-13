"""Shared test helpers: role users, authenticated clients, subjects."""
from django.conf import settings
from rest_framework.test import APIClient

from accounts.models import Role, User
from academics.models import Enrollment, FacultySubject, Subject

INITIAL = settings.LOCALMIND["INITIAL_USER_PASSWORD"]
STRONG = "Str0ng-Passw0rd-2026!"


def make_user(role, email=None, name=None, password=STRONG, must_change=False, status="active"):
    email = email or f"{role}-{User.objects.count() + 1}@example.edu"
    user = User.objects.create_user(
        email=email, password=password, role=role,
        full_name=name or f"{role.title()} User", must_change_password=must_change, status=status,
    )
    if role == Role.FACULTY:
        from accounts.models import FacultyProfile
        FacultyProfile.objects.create(user=user)
    if role == Role.STUDENT:
        from accounts.models import StudentProfile
        StudentProfile.objects.create(user=user)
    return user


def make_admin(**kw):
    return make_user(Role.ADMIN, **kw)


def make_faculty(**kw):
    return make_user(Role.FACULTY, **kw)


def make_student(**kw):
    return make_user(Role.STUDENT, **kw)


def make_subject(code="CS101", name="Operating Systems", created_by=None):
    return Subject.objects.create(code=code, name=name, created_by=created_by)


def assign(faculty, subject, by=None):
    return FacultySubject.objects.create(faculty=faculty, subject=subject, assigned_by=by)


def enroll(student, subject, by=None):
    return Enrollment.objects.create(student=student, subject=subject, created_by=by)


def client_for(user=None):
    client = APIClient()
    if user is not None:
        client.force_authenticate(user=user)
    return client


def login(client, role, email, password):
    return client.post(f"/api/auth/login/{role}/", {"email": email, "password": password}, format="json")


def bearer(client, access):
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    return client


def make_published_document(subject, title="Book", modules=(("Process Management", "Processes are programs in execution. The scheduler picks the next process to run on the CPU."),
                                                            ("Memory Management", "Paging divides memory into fixed-size frames. Segmentation uses variable-size segments."))):
    """A published document with one chapter and open modules, bypassing upload."""
    from documents.models import Document, DocumentStatus
    from learning.models import Chapter, Module
    from django.utils import timezone
    doc = Document.objects.create(subject=subject, original_name=f"{title}.pdf", title=title, file_type="pdf",
                                  status=DocumentStatus.PUBLISHED, published_at=timezone.now())
    chapter = Chapter.objects.create(document=doc, title="Chapter 1", order=1, source_heading_index=0)
    for order, (name, text) in enumerate(modules, start=1):
        Module.objects.create(chapter=chapter, title=name, order=order, source_heading_index=order, source_text=text, availability="open")
    return doc


MCQ = {"type": "mcq", "question": "What does the scheduler pick?", "options": [
    {"key": "A", "text": "The next process"}, {"key": "B", "text": "A file"}, {"key": "C", "text": "A frame"}, {"key": "D", "text": "A segment"}],
    "correct_answer": "A", "explanation": "From the source.", "source_reference": "The scheduler picks the next process"}
MCQ2 = {**MCQ, "question": "What is a process?", "correct_answer": "B", "options": [
    {"key": "A", "text": "A frame"}, {"key": "B", "text": "A program in execution"}, {"key": "C", "text": "A file"}, {"key": "D", "text": "A segment"}]}
SUBJ = {"type": "subjective", "question": "Explain what a process is.", "expected_rubric": "Must say a program in execution.", "source_reference": "Processes are programs in execution."}
