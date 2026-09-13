"""Authoring/publication records. No student, score or learner-profile relation."""
from django.conf import settings
from django.db import models
from core.models import TimeStampedUUIDModel


class AuthoringState(TimeStampedUUIDModel):
    document = models.OneToOneField("documents.Document", on_delete=models.CASCADE, related_name="study_authoring")
    source_digest = models.CharField(max_length=64, blank=True)
    policy = models.JSONField(default=dict)
    policy_proposal = models.JSONField(default=dict, blank=True)


class ContentBlock(TimeStampedUUIDModel):
    module = models.ForeignKey("learning.Module", on_delete=models.PROTECT, related_name="study_blocks")
    position = models.PositiveIntegerField()
    current_revision = models.PositiveIntegerField(default=1)
    active = models.BooleanField(default=True)
    origin = models.CharField(max_length=16, default="imported")
    class Meta:
        ordering = ["module_id", "position", "id"]


class BlockRevision(TimeStampedUUIDModel):
    block = models.ForeignKey(ContentBlock, on_delete=models.PROTECT, related_name="revisions")
    revision = models.PositiveIntegerField()
    kind = models.CharField(max_length=20, choices=[(k, k) for k in ("prose", "table", "figure", "worked_example", "callout")])
    title = models.CharField(max_length=300)
    text = models.TextField()
    data = models.JSONField(default=dict)
    digest = models.CharField(max_length=64)
    class Meta:
        constraints = [models.UniqueConstraint(fields=["block", "revision"], name="study_unique_block_revision")]


class TeachingAid(TimeStampedUUIDModel):
    block = models.OneToOneField(ContentBlock, on_delete=models.CASCADE, related_name="teaching_aid")
    block_revision = models.PositiveIntegerField()
    simpler_text = models.TextField(blank=True)
    example_ids = models.JSONField(default=list)
    diagnostic_ids = models.JSONField(default=list)
    prerequisite_ids = models.JSONField(default=list)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")


class StudyQuestion(TimeStampedUUIDModel):
    document = models.ForeignKey("documents.Document", on_delete=models.PROTECT, related_name="study_questions")
    body = models.JSONField()
    references = models.JSONField()
    generator = models.CharField(max_length=30, default="manual")
    model_name = models.CharField(max_length=300, blank=True)
    review = models.JSONField(default=dict)
    approved_digest = models.CharField(max_length=64, blank=True)
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")


class StudyAsset(TimeStampedUUIDModel):
    document = models.ForeignKey("documents.Document", on_delete=models.PROTECT, related_name="study_assets")
    digest = models.CharField(max_length=64)
    file = models.FileField(upload_to="study-assets/")
    source_location = models.CharField(max_length=300, blank=True)
    caption = models.CharField(max_length=500, blank=True)
    class Meta:
        constraints = [models.UniqueConstraint(fields=["document", "digest"], name="study_unique_asset")]


class StudyPackage(TimeStampedUUIDModel):
    document = models.ForeignKey("documents.Document", on_delete=models.PROTECT, related_name="study_packages")
    version = models.PositiveIntegerField()
    digest = models.CharField(max_length=64)
    envelope = models.TextField()
    published_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    class Meta:
        constraints = [models.UniqueConstraint(fields=["document", "version"], name="study_unique_package_version")]
        ordering = ["-version"]


class Observation(TimeStampedUUIDModel):
    # The id is an independent event id for retry deduplication, NOT an installation/user id.
    package = models.ForeignKey(StudyPackage, on_delete=models.PROTECT, related_name="observations")
    block_id = models.UUIDField()
    block_revision = models.PositiveIntegerField()
    question_id = models.UUIDField(null=True)
    state = models.CharField(max_length=30)
    move = models.CharField(max_length=30)
    outcome = models.CharField(max_length=30)
