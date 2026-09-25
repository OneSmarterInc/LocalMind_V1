"""Institution book generation defaults to the user's device, including legacy books."""
from django.conf import settings
from core.exceptions import Conflict


def device_authoring_only():
    return getattr(settings, 'DEVICE_AUTHORING_ONLY', True)


def require_server_authoring():
    if device_authoring_only():
        raise Conflict('Generate and review this content on your device, then synchronize it with your institution.', code='LOCAL_AUTHORING_REQUIRED')
