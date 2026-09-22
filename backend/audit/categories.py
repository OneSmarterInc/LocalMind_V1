"""How audit actions group into the categories the admin screen filters by.

Every action is named "<entity>.<verb>", so the entity decides the category.
Keep this in step with CATEGORY_OF in frontend/app/admin/audit.tsx; the
contract test in audit/tests.py fails if an entity is missing here.
"""
import re

from django.db.models import Q

CATEGORIES = {
    "content": ("document", "chapter", "module", "lesson", "lessons", "authoring"),
    "quiz": ("quiz", "auto_quiz"),
    "people": ("user", "users"),
    "class": ("subject", "faculty", "student"),
    "auth": ("auth",),
    "ai": ("tutor", "ai_monitor"),
}

# Outcomes worth an administrator's attention. Any verb ending in "failed" is
# caught without editing this file; a sign-in lockout is listed by name because
# "module.locked" (a faculty closing a module) ends the same way and is routine.
FAILURE_REGEX = r"(failed$|^auth\.login_locked$)"


def category_of(action):
    entity = action.split(".", 1)[0]
    for name, entities in CATEGORIES.items():
        if entity in entities:
            return name
    return "other"


def is_failure(action):
    return re.search(FAILURE_REGEX, action) is not None


def category_q(name):
    """A filter for one category. "other" is everything no category claims."""
    if name == "other":
        claimed = Q()
        for entities in CATEGORIES.values():
            for entity in entities:
                claimed |= Q(action__startswith=f"{entity}.")
        return ~claimed
    q = Q(pk__in=[])
    for entity in CATEGORIES.get(name, ()):
        q |= Q(action__startswith=f"{entity}.")
    return q


def failure_q():
    return Q(action__regex=FAILURE_REGEX)
