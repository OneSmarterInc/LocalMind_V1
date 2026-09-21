"""What the institution already holds for a module, whoever put it there.

Device-generated quizzes are stored as ordinary (non-automatic) quizzes and
device lessons as ``ModuleLesson`` rows. Faculty on other devices need to see
both, with who synchronized them, so they do not generate the same content
again. Every function here is read-only and batched per chapter so the book
detail endpoint does not issue one query per module.
"""
from django.db.models import Q


def _name(user):
    if user is None:
        return None
    return (getattr(user, "full_name", "") or "").strip() or getattr(user, "email", None)


def institution_quizzes(chapter_ids):
    """``{module_id: {"id", "status", "by"}}`` for the newest non-automatic,
    non-superseded quiz on each module of the given chapters."""
    from assessments.models import Assessment, AssessmentStatus

    found = {}
    rows = (Assessment.objects.filter(module__chapter_id__in=list(chapter_ids), auto_generated=False)
            .exclude(status=AssessmentStatus.SUPERSEDED)
            .select_related("created_by").order_by("-created_at"))
    for quiz in rows:
        found.setdefault(str(quiz.module_id), {"id": str(quiz.pk), "status": quiz.status, "by": _name(quiz.created_by)})
    return found


def lesson_authors(module_ids):
    """``{module_id: name}`` of whoever last synchronized a device lesson."""
    from audit.models import AuditLog

    ids = [str(i) for i in module_ids]
    if not ids:
        return {}
    found = {}
    rows = (AuditLog.objects.filter(Q(action="authoring.device_received"), target_type="Module", target_id__in=ids,
                                    summary__kind="lesson")
            .select_related("actor").order_by("-created_at"))
    for entry in rows:
        found.setdefault(entry.target_id, _name(entry.actor) or entry.actor_email or None)
    return found


def for_module(module):
    quiz = institution_quizzes([module.chapter_id]).get(str(module.pk))
    lesson_by = lesson_authors([module.pk]).get(str(module.pk))
    return quiz, lesson_by
