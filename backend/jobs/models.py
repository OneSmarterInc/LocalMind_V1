"""Persistent jobs; lease tokens fence stale workers and duplicate completion."""
from django.db import models
from django.utils import timezone
from core.models import TimeStampedUUIDModel

class Job(TimeStampedUUIDModel):
    kind = models.CharField(max_length=30)
    target = models.CharField(max_length=100)
    dedupe_key = models.CharField(max_length=64, unique=True)
    payload = models.JSONField(default=dict)
    status = models.CharField(max_length=16, default="pending", db_index=True)
    available_at = models.DateTimeField(default=timezone.now, db_index=True)
    lease_token = models.UUIDField(null=True)
    lease_until = models.DateTimeField(null=True)
    attempts = models.PositiveIntegerField(default=0)
    max_attempts = models.PositiveIntegerField(default=3)
    error = models.TextField(blank=True)
    result = models.JSONField(default=dict)
    finished_at = models.DateTimeField(null=True)
    class Meta:
        ordering = ["available_at", "created_at", "id"]
        indexes = [models.Index(fields=["status", "available_at"], name="jobs_claimable")]
