from django.conf import settings
from django.db import models

from core.models import TimeStampedUUIDModel


class AuditLog(TimeStampedUUIDModel):
    """Answers WHO did WHAT to WHICH object WHEN. Never stores secrets."""

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="audit_entries",
    )
    actor_email = models.CharField(max_length=254, blank=True)
    actor_role = models.CharField(max_length=20, blank=True)
    action = models.CharField(max_length=64, db_index=True)
    target_type = models.CharField(max_length=64, blank=True, db_index=True)
    target_id = models.CharField(max_length=64, blank=True, db_index=True)
    target_label = models.CharField(max_length=300, blank=True)
    summary = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        db_table = "audit_log"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["target_type", "target_id"])]

    def __str__(self):
        return f"{self.actor_email or 'system'} {self.action} {self.target_type}:{self.target_id}"
