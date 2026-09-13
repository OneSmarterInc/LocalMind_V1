"""UserService: the single implementation of user creation and lifecycle.

Manual creation (admin UI) and Excel import both call these functions so the
rules cannot drift apart.
"""
import secrets
from dataclasses import dataclass, field

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from audit import services as audit
from core.exceptions import Conflict, ValidationFailed

from ..models import AccountStatus, FacultyProfile, Role, StudentProfile, User

PROFILE_FIELDS = {
    Role.FACULTY: ("employee_id", "department", "designation", "phone"),
    Role.STUDENT: ("roll_number", "program", "batch", "phone"),
}


@dataclass
class NewUser:
    email: str
    full_name: str
    role: str
    profile: dict = field(default_factory=dict)
    subject_ids: list = field(default_factory=list)  # faculty only
    subject_codes: list = field(default_factory=list)  # faculty only, resolved by caller


def normalize_email(email):
    return (email or "").strip().lower()


def _validate_new_user(data: NewUser):
    errors = {}
    data.email = normalize_email(data.email)
    data.full_name = (data.full_name or "").strip()
    if not data.email or "@" not in data.email:
        errors["email"] = "A valid email address is required."
    if not data.full_name:
        errors["full_name"] = "Full name is required."
    if data.role not in (Role.FACULTY, Role.STUDENT, Role.ADMIN):
        errors["role"] = "Role must be admin, faculty or student."
    if errors:
        raise ValidationFailed(details=errors)


# No 0/O, 1/l/I: the password is read off a screen or a printed sheet.
_PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"


def initial_password_mode() -> str:
    mode = settings.LOCALMIND.get("INITIAL_PASSWORD_MODE", "shared")
    return mode if mode in ("unique", "shared") else "shared"


def generate_one_time_password(user=None) -> str:
    """Three groups of four from a 53-character alphabet (about 68 bits),
    checked against the configured password validators."""
    from django.contrib.auth import password_validation
    from django.core.exceptions import ValidationError as DjangoValidationError

    while True:
        groups = ["".join(secrets.choice(_PASSWORD_ALPHABET) for _ in range(4)) for _ in range(3)]
        candidate = "-".join(groups)
        try:
            password_validation.validate_password(candidate, user)
            return candidate
        except DjangoValidationError:
            continue


def initial_password(user=None):
    """The password a new or reset account starts on."""
    if initial_password_mode() == "unique":
        return generate_one_time_password(user)
    return settings.LOCALMIND["INITIAL_USER_PASSWORD"]


@transaction.atomic
def create_user(actor, data: NewUser, request=None):
    """Create a user with the onboarding password and must_change_password=True."""
    _validate_new_user(data)
    if User.objects.filter(email=data.email).exists():
        raise Conflict("A user with this email already exists.", code="USER_EXISTS", details={"email": data.email})

    password = initial_password()
    try:
        user = User.objects.create_user(
            email=data.email,
            password=password,
            role=data.role,
            full_name=data.full_name,
            must_change_password=True,
            created_by=actor if getattr(actor, "pk", None) else None,
        )
    except IntegrityError:
        raise Conflict("A user with this email already exists.", code="USER_EXISTS")
    # Held on the instance for this request only, so the caller can show it
    # once. It is never stored, logged or audited.
    user.issued_password = password if initial_password_mode() == "unique" else None

    _apply_profile(user, data.profile)

    if user.role == Role.FACULTY and data.subject_ids:
        from academics.services import assign_faculty_to_subjects
        assign_faculty_to_subjects(actor, user, data.subject_ids, request=request)

    audit.record(actor, "user.created", user, {"role": user.role, "email": user.email}, request)
    return user


def _apply_profile(user, profile):
    profile = profile or {}
    if user.role == Role.FACULTY:
        obj, _ = FacultyProfile.objects.get_or_create(user=user)
    elif user.role == Role.STUDENT:
        obj, _ = StudentProfile.objects.get_or_create(user=user)
    else:
        return
    for name in PROFILE_FIELDS[user.role]:
        if name in profile:
            setattr(obj, name, (profile.get(name) or "").strip())
    obj.save()


@transaction.atomic
def update_user(actor, user, full_name=None, profile=None, request=None):
    changes = {}
    if full_name is not None and full_name.strip() and full_name.strip() != user.full_name:
        changes["full_name"] = [user.full_name, full_name.strip()]
        user.full_name = full_name.strip()
        user.save(update_fields=["full_name", "updated_at"])
    if profile:
        _apply_profile(user, profile)
        changes["profile"] = list(profile.keys())
    if changes:
        audit.record(actor, "user.updated", user, changes, request)
    return user


@transaction.atomic
def discontinue_user(actor, user, reason="", request=None):
    if user.pk == getattr(actor, "pk", None):
        raise ValidationFailed("You cannot discontinue your own account.", code="SELF_DISCONTINUE")
    if user.status == AccountStatus.DISCONTINUED:
        raise Conflict("This account is already discontinued.", code="ALREADY_DISCONTINUED")
    user.status = AccountStatus.DISCONTINUED
    user.discontinued_at = timezone.now()
    user.save(update_fields=["status", "discontinued_at", "updated_at"])
    _revoke_all_tokens(user)
    audit.record(actor, "user.discontinued", user, {"reason": reason}, request)
    return user


@transaction.atomic
def delete_user(actor, user, reason="", request=None):
    """Permanently remove a student or faculty account.

    Everything owned by the account (profile, enrolments, subject links,
    attempts, submissions, conversations, progress, sessions) cascades away.
    Audit rows survive because their actor link is nulled rather than deleted,
    so the trail of what the account did before removal stays readable.
    """
    if user.pk == getattr(actor, "pk", None):
        raise ValidationFailed("You cannot delete your own account.", code="SELF_DELETE")
    if user.role == Role.ADMIN:
        raise ValidationFailed("Administrator accounts cannot be deleted here.", code="CANNOT_DELETE_ADMIN")
    label = f"{user.full_name} <{user.email}>"
    _revoke_all_tokens(user)
    audit.record(
        actor, "user.deleted", user,
        {"email": user.email, "full_name": user.full_name, "role": user.role, "reason": reason}, request,
    )
    user.delete()
    return label


@transaction.atomic
def reactivate_user(actor, user, request=None):
    if user.status == AccountStatus.ACTIVE:
        raise Conflict("This account is already active.", code="ALREADY_ACTIVE")
    user.status = AccountStatus.ACTIVE
    user.discontinued_at = None
    user.save(update_fields=["status", "discontinued_at", "updated_at"])
    audit.record(actor, "user.reactivated", user, {}, request)
    return user


@transaction.atomic
def reset_password_to_initial(actor, user, request=None):
    """Admin-triggered reset: a new onboarding password, forced change again.
    Returns the user with ``issued_password`` set in unique mode."""
    password = initial_password(user)
    user.set_password(password)
    user.issued_password = password if initial_password_mode() == "unique" else None
    user.must_change_password = True
    user.save(update_fields=["password", "must_change_password", "updated_at"])
    _revoke_all_tokens(user)
    audit.record(actor, "user.password_reset_by_admin", user, {}, request)
    return user


def _revoke_all_tokens(user):
    from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

    for token in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=token)
