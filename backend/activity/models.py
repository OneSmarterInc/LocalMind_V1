from django.conf import settings
from django.db import models

from core.models import TimeStampedUUIDModel


class ApplicationSession(TimeStampedUUIDModel):
    """One login. Closed by explicit logout or by heartbeat timeout.

    duration_seconds is computed server-side from login_at and the later of
    logout_at / last_heartbeat_at, never trusted from the client.
    """

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="app_sessions")
    login_at = models.DateTimeField(auto_now_add=True)
    last_heartbeat_at = models.DateTimeField(auto_now_add=True)
    logout_at = models.DateTimeField(null=True, blank=True)
    ended_by = models.CharField(max_length=20, blank=True)  # logout | timeout | relogin
    duration_seconds = models.PositiveIntegerField(default=0)
    user_agent = models.CharField(max_length=300, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        db_table = "login_sessions"
        ordering = ["-login_at"]
        indexes = [models.Index(fields=["user", "logout_at"])]

    @property
    def is_open(self):
        return self.logout_at is None


class ActivityEvent(TimeStampedUUIDModel):
    """Fine-grained time on task. Learning time is client-reported per module
    and clamped; quiz and assignment time are server-derived and stored here
    for uniform aggregation."""

    KINDS = (("learning", "Learning"), ("quiz", "Quiz"), ("assignment", "Assignment"), ("tutor", "Tutor"))

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="activity_events")
    kind = models.CharField(max_length=12, choices=KINDS, db_index=True)
    subject = models.ForeignKey("academics.Subject", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    module = models.ForeignKey("learning.Module", null=True, blank=True, on_delete=models.SET_NULL, related_name="activity_events")
    reference_id = models.CharField(max_length=64, blank=True)  # attempt / submission / conversation id
    seconds = models.PositiveIntegerField(default=0)
    occurred_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "time_spent"
        indexes = [models.Index(fields=["user", "kind", "occurred_at"])]
