"""What a person may change about their own account.

Deliberately narrow. Full name and phone number are the person's own facts and
they are the ones who know when they change. Everything the institution issues
— email, role, employee ID, roll number, department, designation, programme,
batch — stays with the administrator, because those are how the institution
identifies someone and a student editing their own roll number would break
enrollment and result reporting.

To let a role edit one more of its own fields, add the field name to
SELF_EDITABLE for that role. Nothing else needs to change.
"""
from django.db import transaction

from audit import services as audit
from core.exceptions import ValidationFailed

from ..models import FacultyProfile, Role, StudentProfile

SELF_EDITABLE = {Role.FACULTY: ("phone",), Role.STUDENT: ("phone",), Role.ADMIN: ()}
PROFILE_MODEL = {Role.FACULTY: (FacultyProfile, "faculty_profile"), Role.STUDENT: (StudentProfile, "student_profile")}


@transaction.atomic
def update_own_profile(user, full_name=None, profile=None, request=None):
    """Apply a person's own edits and return the user. Unknown fields are refused
    rather than ignored, so a typo in a field name is visible instead of silently
    doing nothing."""
    changed = []
    if full_name is not None:
        name = full_name.strip()
        if not name:
            raise ValidationFailed("Your name cannot be empty.", details={"full_name": ["Enter your name."]})
        if name != user.full_name:
            user.full_name = name
            user.save(update_fields=["full_name", "updated_at"])
            changed.append("full_name")

    fields = profile or {}
    allowed = SELF_EDITABLE.get(user.role, ())
    refused = sorted(set(fields) - set(allowed))
    if refused:
        raise ValidationFailed(
            "Your administrator manages those details.",
            code="NOT_SELF_EDITABLE",
            details={"fields": refused},
        )
    if fields and user.role in PROFILE_MODEL:
        model, related = PROFILE_MODEL[user.role]
        row, _ = model.objects.get_or_create(user=user)
        touched = [f for f in allowed if f in fields and getattr(row, f) != (fields[f] or "").strip()]
        for f in touched:
            setattr(row, f, (fields[f] or "").strip())
        if touched:
            row.save(update_fields=touched)
            changed.extend(touched)
        # Keep the cached relation in step so the response serializes the new values.
        setattr(user, related, row)

    if changed:
        audit.record(user, "user.profile_updated", user, {"fields": changed}, request)
    return user
