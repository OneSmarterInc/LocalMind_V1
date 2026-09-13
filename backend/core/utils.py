
from .exceptions import NotFound


def get_or_404(queryset, **kwargs):
    """Scoped lookup: a record outside the caller's scope is indistinguishable
    from one that does not exist, which avoids leaking existence."""
    try:
        return queryset.get(**kwargs)
    except (queryset.model.DoesNotExist, ValueError, TypeError):
        raise NotFound(f"{queryset.model.__name__} not found.")


def client_ip(request):
    """The client address, trusting X-Forwarded-For only as far as the
    configured number of proxies (TRUSTED_PROXY_COUNT, the same setting DRF's
    throttles use). The first entry of that header is whatever the client
    wrote, so it was never safe to record as the client's address, and a
    non-address value in it would fail to save on PostgreSQL."""
    import ipaddress

    from django.conf import settings

    remote = request.META.get("REMOTE_ADDR")
    proxies = int(settings.REST_FRAMEWORK.get("NUM_PROXIES") or 0)
    candidate = remote
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if proxies > 0 and forwarded:
        hops = [h.strip() for h in forwarded.split(",") if h.strip()]
        if hops:
            candidate = hops[-min(proxies, len(hops))]
    try:
        return str(ipaddress.ip_address(candidate)) if candidate else None
    except ValueError:
        return remote if remote else None
