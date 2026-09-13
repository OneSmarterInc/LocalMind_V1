from pathlib import Path

from django.conf import settings
from django.db import models

from accounts.models import Role
from academics.models import AssignmentStatus, EnrollmentStatus
from core.models import TimeStampedUUIDModel


def document_upload_path(instance, filename):
    # The stored name never comes from the client; only the validated suffix does.
    suffix = Path(filename).suffix.lower()
    return f"documents/{instance.id}/original{suffix}"


class DocumentStatus(models.TextChoices):
    UPLOADED = "uploaded", "Uploaded"
    PROCESSING = "processing", "Processing"
    UNDER_REVIEW = "under_review", "Under review"
    READY = "ready", "Ready to publish"
    PUBLISHED = "published", "Published"
    UNPUBLISHED = "unpublished", "Unpublished"
    ARCHIVED = "archived", "Archived"
    ERROR = "error", "Error"


EDITABLE_STATUSES = {DocumentStatus.UNDER_REVIEW, DocumentStatus.READY, DocumentStatus.UNPUBLISHED, DocumentStatus.PUBLISHED}
REPROCESSABLE_STATUSES = {DocumentStatus.UPLOADED, DocumentStatus.ERROR, DocumentStatus.UNDER_REVIEW, DocumentStatus.READY, DocumentStatus.UNPUBLISHED}


class DocumentQuerySet(models.QuerySet):
    def visible_to(self, user):
        if user.role == Role.ADMIN:
            return self
        if user.role == Role.FACULTY:
            return self.filter(subject__faculty_links__faculty=user,
                               subject__faculty_links__status=AssignmentStatus.ACTIVE).distinct()
        if user.role == Role.STUDENT:
            return self.filter(status=DocumentStatus.PUBLISHED, subject__status="active",
                               subject__enrollments__student=user,
                               subject__enrollments__status=EnrollmentStatus.ACTIVE).distinct()
        return self.none()


class DocumentChunk(TimeStampedUUIDModel):
    """A retrieval unit: one slice of a module's source text.

    Built once by ``services.chunking`` when a module's content version
    changes, and read by ``services.retrieval`` on every tutor question, so no
    request ever splits text itself. Keyed by content version, which means an
    edit to the book leaves the old rows behind harmlessly and the next
    retrieval rebuilds against the new version.
    """

    document = models.ForeignKey("documents.Document", on_delete=models.CASCADE, related_name="chunks")
    module = models.ForeignKey("learning.Module", on_delete=models.CASCADE, related_name="chunks")
    content_version = models.PositiveIntegerField(db_index=True)
    order = models.PositiveIntegerField()
    text = models.TextField()
    char_count = models.PositiveIntegerField(default=0)
    page_start = models.PositiveIntegerField(null=True, blank=True)
    page_end = models.PositiveIntegerField(null=True, blank=True)
    heading = models.CharField(max_length=300, blank=True)
    terms = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "module_text_chunks"
        ordering = ["module", "order"]
        indexes = [models.Index(fields=["module", "content_version"], name="documents_d_module__f0d97f_idx")]
        constraints = [
            models.UniqueConstraint(fields=("module", "content_version", "order"), name="uniq_chunk_per_module_version"),
        ]

    def __str__(self):
        return f"{self.module_id} chunk {self.order} (v{self.content_version})"


class Document(TimeStampedUUIDModel):
    """A book or course document owned by a subject."""

    subject = models.ForeignKey("academics.Subject", on_delete=models.PROTECT, related_name="documents")
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="uploaded_documents")
    title = models.CharField(max_length=300, blank=True)
    original_name = models.CharField(max_length=300)
    file = models.FileField(upload_to=document_upload_path)
    file_type = models.CharField(max_length=10)
    file_size = models.PositiveBigIntegerField(default=0)
    # SHA-256 of the uploaded bytes. Identifies the same book across renames,
    # which a filename comparison cannot do. Blank on rows created before this
    # field existed, and those are simply skipped by the duplicate check.
    content_hash = models.CharField(max_length=64, blank=True, db_index=True)
    status = models.CharField(max_length=30, choices=DocumentStatus.choices, default=DocumentStatus.UPLOADED, db_index=True)

    processed_markdown_path = models.CharField(max_length=500, blank=True)
    extracted_headings = models.JSONField(default=list, blank=True)
    outline_strategy = models.CharField(
        max_length=20, choices=[("source", "Keep source headings"), ("ai", "Suggest with AI")], default="source")
    outline_source = models.CharField(max_length=30, blank=True)  # ai | source_hierarchy | edited
    parse_mode = models.CharField(max_length=30, blank=True)
    error_message = models.TextField(blank=True)

    # Live progress for the processing run. Written with queryset.update() from
    # the worker so the value is visible to the API while the job is still going,
    # rather than sitting inside an open transaction until the end.
    progress_step = models.PositiveSmallIntegerField(default=0)
    progress_total_steps = models.PositiveSmallIntegerField(default=0)
    progress_stage = models.CharField(max_length=40, blank=True)
    progress_detail = models.CharField(max_length=200, blank=True)

    processing_started_at = models.DateTimeField(null=True, blank=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    published_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    published_at = models.DateTimeField(null=True, blank=True)
    unpublished_at = models.DateTimeField(null=True, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)

    content_version = models.PositiveIntegerField(default=1)
    last_edited_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    last_edited_at = models.DateTimeField(null=True, blank=True)

    objects = DocumentQuerySet.as_manager()

    class Meta:
        db_table = "books"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["subject", "status"])]

    def __str__(self):
        return self.title or self.original_name

    @property
    def is_published(self):
        return self.status == DocumentStatus.PUBLISHED
