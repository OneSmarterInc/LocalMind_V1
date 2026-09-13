from .models import AuditLog

SENSITIVE_KEYS = {"password", "new_password", "old_password", "current_password", "initial_password", "token", "refresh", "access"}


def _scrub(data):
    if isinstance(data, dict):
        return {k: ("***" if k.lower() in SENSITIVE_KEYS else _scrub(v)) for k, v in data.items()}
    if isinstance(data, list):
        return [_scrub(v) for v in data]
    return data


def record(actor, action, target=None, summary=None, request=None):
    """Write one audit row. `target` is any model instance or None."""
    from core.utils import client_ip

    entry = AuditLog(
        actor=actor if getattr(actor, "pk", None) else None,
        actor_email=getattr(actor, "email", "") or "",
        actor_role=getattr(actor, "role", "") or "",
        action=action,
        summary=_scrub(summary or {}),
        ip_address=client_ip(request) if request is not None else None,
    )
    if target is not None:
        entry.target_type = target.__class__.__name__
        entry.target_id = str(target.pk)
        entry.target_label = str(target)[:300]
    entry.save()
    return entry
