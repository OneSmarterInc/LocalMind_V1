from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from core.utils import client_ip
from .models import ApplicationSession


def _timeout():
    return timedelta(minutes=settings.LOCALMIND["SESSION_HEARTBEAT_TIMEOUT_MINUTES"])


def _finalize(session, ended_at, ended_by):
    session.logout_at = ended_at
    session.ended_by = ended_by
    session.duration_seconds = max(0, int((ended_at - session.login_at).total_seconds()))
    session.save(update_fields=["logout_at", "ended_by", "duration_seconds", "updated_at"])


def close_stale_sessions(user):
    """Any open session without a heartbeat inside the timeout window ends at
    its last heartbeat. Called on login and heartbeat so no cron is required."""
    cutoff = timezone.now() - _timeout()
    for session in ApplicationSession.objects.filter(user=user, logout_at__isnull=True, last_heartbeat_at__lt=cutoff):
        _finalize(session, session.last_heartbeat_at, "timeout")


@transaction.atomic
def open_session(user, request=None):
    close_stale_sessions(user)
    # A fresh login while another session is open closes the older one at its
    # last heartbeat so overlapping sessions never double count.
    now = timezone.now()
    for session in ApplicationSession.objects.filter(user=user, logout_at__isnull=True):
        _finalize(session, min(session.last_heartbeat_at + _timeout(), now), "relogin")
    return ApplicationSession.objects.create(
        user=user,
        user_agent=(request.META.get("HTTP_USER_AGENT", "")[:300] if request else ""),
        ip_address=client_ip(request) if request else None,
    )


def heartbeat(user, session_id=None):
    close_stale_sessions(user)
    qs = ApplicationSession.objects.filter(user=user, logout_at__isnull=True)
    session = qs.filter(pk=session_id).first() if session_id else qs.order_by("-login_at").first()
    if session is None:
        session = ApplicationSession.objects.create(user=user)
    session.last_heartbeat_at = timezone.now()
    session.save(update_fields=["last_heartbeat_at", "updated_at"])
    return session


def close_session(user, session_id=None):
    qs = ApplicationSession.objects.filter(user=user, logout_at__isnull=True)
    session = qs.filter(pk=session_id).first() if session_id else qs.order_by("-login_at").first()
    if session is not None:
        _finalize(session, timezone.now(), "logout")
    return session


MAX_LEARNING_CHUNK_SECONDS = 15 * 60


def record_learning_time(student, module, seconds):
    """Client reports elapsed reading time in small chunks; each chunk is
    clamped so a stuck tab cannot inflate totals."""
    from learning.models import ModuleProgress
    from .models import ActivityEvent

    seconds = max(0, min(int(seconds or 0), MAX_LEARNING_CHUNK_SECONDS))
    if seconds == 0:
        return 0
    with transaction.atomic():
        progress, _ = ModuleProgress.objects.select_for_update().get_or_create(student=student, module=module)
        progress.learning_seconds += seconds
        progress.last_viewed_at = timezone.now()
        if progress.status == "not_started":
            progress.status, progress.started_at = "in_progress", timezone.now()
        progress.save()
        ActivityEvent.objects.create(user=student, kind="learning", module=module, subject=module.chapter.document.subject, seconds=seconds)
    return progress.learning_seconds


def record_event(user, kind, seconds, subject=None, module=None, reference_id=""):
    from .models import ActivityEvent
    return ActivityEvent.objects.create(user=user, kind=kind, seconds=max(0, int(seconds or 0)), subject=subject, module=module, reference_id=str(reference_id or ""))
