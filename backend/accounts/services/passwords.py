from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction

from audit import services as audit
from core.exceptions import ValidationFailed


@transaction.atomic
def change_password(user, current_password, new_password, request=None):
    if not user.check_password(current_password):
        raise ValidationFailed("Current password is incorrect.", code="INVALID_CURRENT_PASSWORD")
    if current_password == new_password:
        raise ValidationFailed("New password must differ from the current password.", code="PASSWORD_REUSED")
    try:
        password_validation.validate_password(new_password, user)
    except DjangoValidationError as exc:
        raise ValidationFailed("Password does not meet the policy.", details={"new_password": exc.messages})
    user.set_password(new_password)
    user.mark_password_changed()
    user.save(update_fields=["password", "must_change_password", "password_changed_at", "updated_at"])
    # Sign out every other session: whoever knew the old password (the
    # onboarding one, or a leaked one) keeps nothing. The caller issues a fresh
    # token pair for this session straight after.
    from .users import _revoke_all_tokens
    _revoke_all_tokens(user)
    audit.record(user, "user.password_changed", user, {}, request)
    return user
