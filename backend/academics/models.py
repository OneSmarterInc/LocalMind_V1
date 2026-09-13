from django.conf import settings
from django.db import models

from accounts.models import Role
from core.models import TimeStampedUUIDModel


class SubjectStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    DISCONTINUED = "discontinued", "Discontinued"
    ARCHIVED = "archived", "Archived"


class AssignmentStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    DISCONTINUED = "discontinued", "Discontinued"


class EnrollmentStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    DISCONTINUED = "discontinued", "Discontinued"
    COMPLETED = "completed", "Completed"


class SubjectQuerySet(models.QuerySet):
    def visible_to(self, user):
        """Admin: all. Faculty: actively assigned. Student: actively enrolled."""
        if user.role == Role.ADMIN:
            return self
        if user.role == Role.FACULTY:
            return self.filter(
                faculty_links__faculty=user, faculty_links__status=AssignmentStatus.ACTIVE
            ).distinct()
        if user.role == Role.STUDENT:
            return self.filter(
                enrollments__student=user, enrollments__status=EnrollmentStatus.ACTIVE
            ).distinct()
        return self.none()

    def active(self):
        return self.filter(status=SubjectStatus.ACTIVE)


class Subject(TimeStampedUUIDModel):
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=32, unique=True)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=SubjectStatus.choices, default=SubjectStatus.ACTIVE, db_index=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    discontinued_at = models.DateTimeField(null=True, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    organization_key = models.CharField(max_length=64, blank=True, db_index=True)

    objects = SubjectQuerySet.as_manager()

    class Meta:
        db_table = "subjects"
        ordering = ["code"]

    def __str__(self):
        return f"{self.code} {self.name}"

    def save(self, *args, **kwargs):
        self.code = (self.code or "").strip().upper()
        super().save(*args, **kwargs)


class FacultySubject(TimeStampedUUIDModel):
    """Explicit many-to-many between faculty and subjects with lifecycle."""

    faculty = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="subject_links",
                                limit_choices_to={"role": Role.FACULTY})
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, related_name="faculty_links")
    status = models.CharField(max_length=20, choices=AssignmentStatus.choices, default=AssignmentStatus.ACTIVE, db_index=True)
    assigned_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    assigned_at = models.DateTimeField(auto_now_add=True)
    discontinued_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "faculty_subjects"
        constraints = [models.UniqueConstraint(fields=["faculty", "subject"], name="uniq_faculty_subject")]
        ordering = ["subject__code"]

    def __str__(self):
        return f"{self.faculty.email} -> {self.subject.code} ({self.status})"


class Enrollment(TimeStampedUUIDModel):
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="enrollments",
                                limit_choices_to={"role": Role.STUDENT})
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, related_name="enrollments")
    status = models.CharField(max_length=20, choices=EnrollmentStatus.choices, default=EnrollmentStatus.ACTIVE, db_index=True)
    enrolled_at = models.DateTimeField(auto_now_add=True)
    discontinued_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "student_enrollments"
        constraints = [models.UniqueConstraint(fields=["student", "subject"], name="uniq_student_subject")]
        ordering = ["subject__code", "student__full_name"]

    def __str__(self):
        return f"{self.student.email} in {self.subject.code} ({self.status})"


def faculty_manages_subject(user, subject) -> bool:
    if user.role == Role.ADMIN:
        return True
    if user.role != Role.FACULTY:
        return False
    return FacultySubject.objects.filter(faculty=user, subject=subject, status=AssignmentStatus.ACTIVE).exists()


def student_enrolled_in_subject(user, subject) -> bool:
    return Enrollment.objects.filter(student=user, subject=subject, status=EnrollmentStatus.ACTIVE).exists()
