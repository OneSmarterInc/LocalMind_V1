from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from accounts.models import AccountStatus, Role, User
from audit import services as audit
from core.exceptions import Conflict, Forbidden, ValidationFailed

from .models import (
    AssignmentStatus, Enrollment, EnrollmentStatus, FacultySubject, Subject, SubjectStatus,
    faculty_manages_subject,
)


# ---------- Subjects ----------

@transaction.atomic
def create_subject(actor, name, code, description="", request=None):
    code = (code or "").strip().upper()
    if not code:
        raise ValidationFailed(details={"code": "Subject code is required."})
    if not (name or "").strip():
        raise ValidationFailed(details={"name": "Subject name is required."})
    if Subject.objects.filter(code=code).exists():
        raise Conflict("A subject with this code already exists.", code="SUBJECT_CODE_EXISTS")
    subject = Subject.objects.create(name=name.strip(), code=code, description=description or "", created_by=actor)
    audit.record(actor, "subject.created", subject, {"code": code}, request)
    return subject


@transaction.atomic
def update_subject(actor, subject, name=None, description=None, request=None):
    changes = {}
    if name is not None and name.strip() and name.strip() != subject.name:
        changes["name"] = [subject.name, name.strip()]
        subject.name = name.strip()
    if description is not None and description != subject.description:
        changes["description"] = True
        subject.description = description
    if changes:
        subject.save()
        audit.record(actor, "subject.updated", subject, changes, request)
    return subject


@transaction.atomic
def set_subject_status(actor, subject, status, request=None):
    if status not in SubjectStatus.values:
        raise ValidationFailed(details={"status": "Invalid subject status."})
    if subject.status == status:
        raise Conflict(f"Subject is already {status}.", code="STATUS_UNCHANGED")
    if subject.status == SubjectStatus.ARCHIVED and status != SubjectStatus.ARCHIVED:
        raise Conflict("Archived subjects cannot be reactivated.", code="SUBJECT_ARCHIVED")
    subject.status = status
    now = timezone.now()
    if status == SubjectStatus.DISCONTINUED:
        subject.discontinued_at = now
    elif status == SubjectStatus.ARCHIVED:
        subject.archived_at = now
    elif status == SubjectStatus.ACTIVE:
        subject.discontinued_at = None
    subject.save()
    audit.record(actor, f"subject.{status}", subject, {}, request)
    return subject


def _discard_document_files(document):
    """Best effort removal of the uploaded file and its processed markdown."""
    from pathlib import Path

    try:
        if document.file:
            document.file.delete(save=False)
    except Exception:  # storage problems must not block the delete
        pass
    if document.processed_markdown_path:
        try:
            Path(document.processed_markdown_path).unlink(missing_ok=True)
        except Exception:
            pass


@transaction.atomic
def delete_subject(actor, subject, request=None):
    """Permanently remove a subject and everything that hangs off it.

    Documents, quizzes and assignments point at Subject with PROTECT, so the
    dependants are cleared in dependency order before the subject row goes.
    Chapters, modules, lessons, conversations, progress and enrolments all
    cascade on their own once their parent is gone.
    """
    from assessments.models import Assessment, AssessmentAttempt
    from assignments.models import Assignment, AssignmentSubmission
    from documents.models import Document

    label = f"{subject.code} {subject.name}"
    scope = (
        Q(subject=subject)
        | Q(chapter__document__subject=subject)
        | Q(module__chapter__document__subject=subject)
    )

    assignments = Assignment.objects.filter(scope)
    AssignmentSubmission.objects.filter(assignment__in=assignments).delete()
    assignments.delete()

    assessments = Assessment.objects.filter(scope)
    AssessmentAttempt.objects.filter(assessment__in=assessments).delete()
    assessments.delete()

    documents = list(Document.objects.filter(subject=subject))
    for document in documents:
        _discard_document_files(document)
    Document.objects.filter(subject=subject).delete()

    audit.record(
        actor, "subject.deleted", subject,
        {"code": subject.code, "name": subject.name, "documents": len(documents)}, request,
    )
    subject.delete()
    return label


# ---------- Faculty assignment ----------

@transaction.atomic
def assign_faculty_to_subjects(actor, faculty, subject_ids, request=None):
    if faculty.role != Role.FACULTY:
        raise ValidationFailed("Only faculty accounts can be assigned to subjects.", code="NOT_FACULTY")
    subjects = list(Subject.objects.filter(id__in=subject_ids))
    if len(subjects) != len(set(map(str, subject_ids))):
        raise ValidationFailed("One or more subject ids are invalid.", code="INVALID_SUBJECT")
    links = []
    for subject in subjects:
        link, created = FacultySubject.objects.get_or_create(
            faculty=faculty, subject=subject, defaults={"assigned_by": actor}
        )
        if not created and link.status != AssignmentStatus.ACTIVE:
            link.status = AssignmentStatus.ACTIVE
            link.discontinued_at = None
            link.assigned_by = actor
            link.save()
        links.append(link)
        audit.record(actor, "faculty.assigned_subject", link, {"faculty": faculty.email, "subject": subject.code}, request)
    return links


@transaction.atomic
def unassign_faculty_from_subject(actor, faculty, subject, request=None):
    try:
        link = FacultySubject.objects.get(faculty=faculty, subject=subject)
    except FacultySubject.DoesNotExist:
        raise Conflict("This faculty is not assigned to the subject.", code="NOT_ASSIGNED")
    if link.status == AssignmentStatus.DISCONTINUED:
        raise Conflict("This assignment is already discontinued.", code="ALREADY_DISCONTINUED")
    link.status = AssignmentStatus.DISCONTINUED
    link.discontinued_at = timezone.now()
    link.save()
    audit.record(actor, "faculty.unassigned_subject", link, {"faculty": faculty.email, "subject": subject.code}, request)
    return link


# ---------- Enrollment ----------

def _require_manage(actor, subject):
    if not faculty_manages_subject(actor, subject):
        raise Forbidden("You do not manage this subject.", code="SUBJECT_NOT_ASSIGNED")


@transaction.atomic
def enroll_students(actor, subject, student_ids, request=None):
    _require_manage(actor, subject)
    if subject.status != SubjectStatus.ACTIVE:
        raise Conflict("Students can only be enrolled in active subjects.", code="SUBJECT_INACTIVE")
    students = list(User.objects.filter(id__in=student_ids, role=Role.STUDENT))
    if len(students) != len(set(map(str, student_ids))):
        raise ValidationFailed("One or more student ids are invalid or not students.", code="INVALID_STUDENT")
    results = []
    for student in students:
        if student.status != AccountStatus.ACTIVE:
            results.append({"student_id": str(student.id), "status": "skipped", "reason": "account_inactive"})
            continue
        enrollment, created = Enrollment.objects.get_or_create(
            student=student, subject=subject, defaults={"created_by": actor}
        )
        if created:
            outcome = "enrolled"
        elif enrollment.status == EnrollmentStatus.ACTIVE:
            outcome = "already_enrolled"
        else:
            enrollment.status = EnrollmentStatus.ACTIVE
            enrollment.discontinued_at = None
            enrollment.completed_at = None
            enrollment.save()
            outcome = "re_enrolled"
        if outcome != "already_enrolled":
            audit.record(actor, "student.enrolled", enrollment, {"student": student.email, "subject": subject.code, "outcome": outcome}, request)
        results.append({"student_id": str(student.id), "enrollment_id": str(enrollment.id), "status": outcome})
    return results


@transaction.atomic
def discontinue_enrollment(actor, subject, student, request=None):
    _require_manage(actor, subject)
    try:
        enrollment = Enrollment.objects.get(student=student, subject=subject)
    except Enrollment.DoesNotExist:
        raise Conflict("This student is not enrolled in the subject.", code="NOT_ENROLLED")
    if enrollment.status == EnrollmentStatus.DISCONTINUED:
        raise Conflict("This enrollment is already discontinued.", code="ALREADY_DISCONTINUED")
    enrollment.status = EnrollmentStatus.DISCONTINUED
    enrollment.discontinued_at = timezone.now()
    enrollment.save()
    audit.record(actor, "student.enrollment_discontinued", enrollment, {"student": student.email, "subject": subject.code}, request)
    return enrollment
