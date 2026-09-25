from django.conf import settings
from django.db import models

from core.models import TimeStampedUUIDModel


class Chapter(TimeStampedUUIDModel):
    document = models.ForeignKey("documents.Document", on_delete=models.CASCADE, related_name="chapters")
    title = models.CharField(max_length=300)
    order = models.PositiveIntegerField()
    source_heading_index = models.PositiveIntegerField(null=True, blank=True)
    source_text = models.TextField(blank=True)
    start_page = models.PositiveIntegerField(null=True, blank=True)
    end_page = models.PositiveIntegerField(null=True, blank=True)
    is_user_edited = models.BooleanField(default=False)

    class Meta:
        db_table = "chapters"
        ordering = ["order"]
        constraints = [models.UniqueConstraint(fields=["document", "order"], name="uniq_chapter_order_per_document")]

    def __str__(self):
        return self.title


class ModuleAvailability(models.TextChoices):
    LOCKED = "locked", "Locked"
    OPEN = "open", "Open"


class Module(TimeStampedUUIDModel):
    """The unit students learn, are tutored on, and are assessed on.

    Availability (faculty-controlled) is separate from any student's progress,
    which lives in ModuleProgress.
    """

    chapter = models.ForeignKey(Chapter, on_delete=models.CASCADE, related_name="modules")
    title = models.CharField(max_length=300)
    order = models.PositiveIntegerField()
    source_heading_index = models.PositiveIntegerField(null=True, blank=True)
    source_text = models.TextField(blank=True)
    source_missing = models.BooleanField(default=False, db_index=True)
    start_page = models.PositiveIntegerField(null=True, blank=True)
    end_page = models.PositiveIntegerField(null=True, blank=True)
    is_user_edited = models.BooleanField(default=False)

    availability = models.CharField(max_length=10, choices=ModuleAvailability.choices, default=ModuleAvailability.LOCKED, db_index=True)
    opened_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    opened_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "modules"
        ordering = ["chapter__order", "order"]
        constraints = [models.UniqueConstraint(fields=["chapter", "order"], name="uniq_module_order_per_chapter")]

    def __str__(self):
        return self.title

    @property
    def document(self):
        return self.chapter.document

    @property
    def is_open(self):
        return self.availability == ModuleAvailability.OPEN


class ProgressStatus(models.TextChoices):
    NOT_STARTED = "not_started", "Not started"
    IN_PROGRESS = "in_progress", "In progress"
    COMPLETED = "completed", "Completed"
    NEEDS_REVIEW = "needs_review", "Needs review"


class ModuleProgress(TimeStampedUUIDModel):
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="module_progress")
    module = models.ForeignKey(Module, on_delete=models.CASCADE, related_name="progress")
    status = models.CharField(max_length=20, choices=ProgressStatus.choices, default=ProgressStatus.NOT_STARTED, db_index=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    last_viewed_at = models.DateTimeField(null=True, blank=True)
    lesson_viewed_at = models.DateTimeField(null=True, blank=True)
    best_quiz_percentage = models.FloatField(null=True, blank=True)
    quiz_attempts = models.PositiveIntegerField(default=0)
    learning_seconds = models.PositiveIntegerField(default=0)
    overridden_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "module_progress"
        constraints = [models.UniqueConstraint(fields=["student", "module"], name="uniq_progress_per_student_module")]
        indexes = [models.Index(fields=["student", "status"])]

    def __str__(self):
        return f"{self.student.email} / {self.module.title}: {self.status}"


class CourseSyncReceipt(TimeStampedUUIDModel):
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='course_sync_receipts')
    event_id = models.UUIDField()
    payload_hash = models.CharField(max_length=64)
    response = models.JSONField(default=dict)
    attempt = models.ForeignKey('assessments.AssessmentAttempt', null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['student', 'event_id'], name='unique_student_sync_event')]
