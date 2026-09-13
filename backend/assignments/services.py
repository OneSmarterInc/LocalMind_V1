from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from academics.models import Subject, faculty_manages_subject
from ai.gateway import gateway, trim_source
from audit import services as audit
from core.exceptions import Conflict, Forbidden, NotFound, ValidationFailed
from learning import services as learning
from learning.models import Chapter, Module

from .models import Assignment, AssignmentStatus, AssignmentSubmission, SubmissionStatus

GEN_SCHEMA = {"type": "object", "properties": {
    "title": {"type": "string"}, "description": {"type": "string"}, "instructions": {"type": "string"},
    "rubric": {"type": "array", "minItems": 2, "maxItems": 6, "items": {"type": "object", "properties": {
        "criterion": {"type": "string"}, "points": {"type": "integer"}}, "required": ["criterion", "points"]}}},
    "required": ["title", "description", "instructions", "rubric"]}


def manageable(user):
    return Assignment.objects.filter(subject__in=Subject.objects.visible_to(user)).select_related("subject", "module", "chapter", "created_by")


def student_visible(student):
    now = timezone.now()
    open_modules = learning.student_module_queryset(student).filter(availability="open")
    return (Assignment.objects.filter(status=AssignmentStatus.PUBLISHED)
            .filter(Q(module__in=open_modules) | Q(module__isnull=True, chapter__modules__in=open_modules)
                    | Q(source_modules__in=open_modules)
                    | Q(module__isnull=True, chapter__isnull=True, subject__in=Subject.objects.visible_to(student)))
            .exclude(available_from__gt=now).select_related("subject", "module", "chapter").distinct())


OPTION_FIELDS = ("available_from", "due_at", "allow_late", "allow_resubmission", "max_attempts", "results_release", "results_release_at")


def _require_manage(actor, subject):
    if not faculty_manages_subject(actor, subject):
        raise Forbidden("You do not manage this subject.", code="SUBJECT_NOT_ASSIGNED")


def _target(actor, subject_id=None, module_id=None, chapter_id=None, module_ids=None):
    """Resolve what an assignment is drafted from.

    Mirrors the quiz resolver: a chosen set of modules first, then one module,
    one chapter, or a whole subject. Returns
    (subject, chapter, module, source_text, title, modules).
    """
    subjects = Subject.objects.visible_to(actor)
    if module_ids:
        ids = list(dict.fromkeys(module_ids))
        modules = list(Module.objects.select_related("chapter__document__subject")
                       .filter(pk__in=ids, chapter__document__subject__in=subjects))
        if len(modules) != len(ids):
            raise NotFound("Module not found.")
        if len({m.chapter.document.subject_id for m in modules}) != 1:
            raise ValidationFailed("Every module must belong to the same subject.", code="INVALID_SELECTION")
        modules.sort(key=lambda m: (m.chapter.order, m.order))
        if len(modules) == 1:
            m = modules[0]
            return m.chapter.document.subject, m.chapter, m, m.source_text, m.title, [m]
        chapters = {m.chapter_id for m in modules}
        chapter = modules[0].chapter if len(chapters) == 1 else None
        text = "\n\n".join(m.source_text for m in modules if m.source_text)
        title = chapter.title if chapter else f"{len(modules)} modules"
        return modules[0].chapter.document.subject, chapter, None, text, title, modules
    if module_id:
        try:
            m = Module.objects.select_related("chapter__document__subject").get(pk=module_id, chapter__document__subject__in=subjects)
        except (Module.DoesNotExist, ValueError):
            raise NotFound("Module not found.")
        return m.chapter.document.subject, m.chapter, m, m.source_text, m.title, [m]
    if chapter_id:
        try:
            c = Chapter.objects.select_related("document__subject").prefetch_related("modules").get(pk=chapter_id, document__subject__in=subjects)
        except (Chapter.DoesNotExist, ValueError):
            raise NotFound("Chapter not found.")
        return c.document.subject, c, None, "\n\n".join(m.source_text for m in c.modules.all()), c.title, list(c.modules.all())
    if subject_id:
        try:
            s = subjects.get(pk=subject_id)
        except (Subject.DoesNotExist, ValueError):
            raise NotFound("Subject not found.")
        return s, None, None, "", s.name, []
    raise ValidationFailed("module_ids, subject_id, chapter_id or module_id is required.", code="TARGET_REQUIRED")


def _normalize_rubric(rubric, max_score):
    rubric = rubric or []
    out = []
    for r in rubric:
        crit = str(r.get("criterion") or "").strip()
        try:
            pts = int(r.get("points"))
        except (TypeError, ValueError):
            raise ValidationFailed(details={"rubric": "points must be integers"})
        if not crit or pts < 0:
            raise ValidationFailed(details={"rubric": "each criterion needs text and non-negative points"})
        out.append({"criterion": crit, "points": pts})
    if out and sum(r["points"] for r in out) != max_score:
        raise ValidationFailed(details={"rubric": f"rubric points must total max_score ({max_score})"})
    return out


@transaction.atomic
def create(actor, *, subject_id=None, module_id=None, chapter_id=None, module_ids=None, request=None, **fields):
    subject, chapter, module, _, _, modules = _target(actor, subject_id, module_id, chapter_id, module_ids)
    _require_manage(actor, subject)
    max_score = fields.get("max_score") or 100
    a = Assignment.objects.create(subject=subject, chapter=chapter, module=module, created_by=actor,
                                  title=fields["title"][:300], description=fields.get("description", ""),
                                  instructions=fields.get("instructions", ""), max_score=max_score,
                                  rubric=_normalize_rubric(fields.get("rubric"), max_score),
                                  **{k: v for k, v in fields.items() if k in OPTION_FIELDS})
    if module_ids and len(modules) > 1:
        a.source_modules.set(modules)
    audit.record(actor, "assignment.created", a, {"modules": len(modules)}, request)
    return a


def generate(actor, *, module_id=None, chapter_id=None, module_ids=None, focus="", request=None, **fields):
    """The model call runs outside any transaction (see tutor.teach); only the
    final insert is atomic."""
    subject, chapter, module, source, name, modules = _target(actor, None, module_id, chapter_id, module_ids)
    _require_manage(actor, subject)
    if not source.strip():
        raise ValidationFailed("Cannot generate an assignment without source text.", code="NO_SOURCE")
    max_score = fields.get("max_score") or 100
    system = (
        "You design one written assignment from a textbook excerpt. Follow every rule.\n"
        "1. Everything must be answerable from the SOURCE TEXT alone.\n"
        "2. title is short. description is one paragraph for the student. instructions say exactly what to write and roughly how long.\n"
        f"3. rubric has two to six criteria; the integer points must add up to exactly {max_score}.\n"
        "4. Output JSON only."
    )
    user = f"TOPIC: {name}\nTOTAL POINTS: {max_score}\nFOCUS: {focus or 'general understanding'}\n\nSOURCE TEXT:\n\"\"\"{trim_source(source)}\"\"\""
    result = gateway().generate(task="assignment", system_prompt=system, user_prompt=user, schema=GEN_SCHEMA)
    generator, warning = "ai", ""
    if result.ok and sum(r["points"] for r in result.data["rubric"]) == max_score:
        data = result.data
    else:
        generator = "fallback"
        warning = f"{result.error_code}: {result.error}" if result.failed else "rubric points did not sum to max_score"
        first = source.strip().split(".")[0][:200]
        data = {"title": f"Assignment: {name}", "description": f"A written exercise on {name}.",
                "instructions": f"In 400-600 words, explain the ideas in '{name}'. Start from: \"{first}\". Use only the module material.",
                "rubric": [{"criterion": "Accuracy against the source", "points": max_score // 2},
                           {"criterion": "Clarity and structure", "points": max_score - max_score // 2}]}
    with transaction.atomic():
        a = Assignment.objects.create(subject=subject, chapter=chapter, module=module, created_by=actor, generator=generator,
                                      title=data["title"][:300], description=data["description"], instructions=data["instructions"],
                                      rubric=_normalize_rubric(data["rubric"], max_score), max_score=max_score,
                                      **{k: v for k, v in fields.items() if k in OPTION_FIELDS})
        if module_ids and len(modules) > 1:
            a.source_modules.set(modules)
        audit.record(actor, "assignment.generated", a, {"generator": generator, "warning": warning[:200]}, request)
    return a, warning


@transaction.atomic
def update(actor, a, request=None, **fields):
    _require_manage(actor, a.subject)
    changes = {}
    max_score = fields.get("max_score", a.max_score)
    for key in ("title", "description", "instructions", "max_score", "available_from", "due_at", "allow_late",
                "allow_resubmission", "results_release", "results_release_at"):
        if key not in fields or fields[key] == getattr(a, key):
            continue
        if fields[key] is None and key not in ("available_from", "due_at", "results_release_at"):
            continue  # null clears dates; other fields keep their value
        setattr(a, key, fields[key]); changes[key] = True
    if "max_attempts" in fields and fields["max_attempts"] != a.max_attempts:
        a.max_attempts = fields["max_attempts"]; changes["max_attempts"] = True
    if "rubric" in fields and fields["rubric"] is not None:
        a.rubric = _normalize_rubric(fields["rubric"], max_score); changes["rubric"] = True
    if changes:
        a.save()
        audit.record(actor, "assignment.updated", a, changes, request)
    return a


@transaction.atomic
def set_status(actor, a, status, request=None):
    _require_manage(actor, a.subject)
    if status == AssignmentStatus.PUBLISHED:
        if a.status == AssignmentStatus.PUBLISHED:
            raise Conflict("Already published.", code="INVALID_STATE")
        a.status, a.published_at = status, timezone.now()
        learning.open_target_modules(actor, a, "assignment.published", request)
    elif status == AssignmentStatus.CLOSED:
        if a.status != AssignmentStatus.PUBLISHED:
            raise Conflict("Only published assignments can be closed.", code="INVALID_STATE")
        a.status, a.closed_at = status, timezone.now()
    else:
        raise ValidationFailed(details={"status": "Use 'published' or 'closed'."})
    a.save()
    audit.record(actor, f"assignment.{status}", a, {}, request)
    return a


@transaction.atomic
def delete(actor, a, request=None):
    """Permanently remove an assignment and every submission made against it.

    Submissions point at the assignment with PROTECT, so they are cleared
    first; the evaluations attached to them go with them.
    """
    _require_manage(actor, a.subject)
    label = a.title
    submissions = AssignmentSubmission.objects.filter(assignment=a).count()
    AssignmentSubmission.objects.filter(assignment=a).delete()
    audit.record(actor, "assignment.deleted", a, {"title": label, "subject": a.subject.code, "submissions": submissions}, request)
    a.delete()
    return label


@transaction.atomic
def submit(student, assignment_id, content, time_spent_seconds=0, request=None):
    try:
        a = student_visible(student).get(pk=assignment_id)
    except (Assignment.DoesNotExist, ValueError):
        raise NotFound("Assignment not found.")
    if a.module_id:
        learning.resolve_accessible_module(student, a.module_id)
    if not (content or "").strip():
        raise ValidationFailed(details={"content": "Submission content is required."})
    now = timezone.now()
    late = bool(a.due_at and now > a.due_at)
    if late and not a.allow_late:
        raise Conflict("The due date has passed and late submissions are not accepted.", code="PAST_DUE")
    existing = AssignmentSubmission.objects.filter(assignment=a, student=student).count()
    if existing and not a.allow_resubmission:
        raise Conflict("You have already submitted this assignment.", code="ALREADY_SUBMITTED")
    if existing and a.max_attempts and existing >= a.max_attempts:
        raise Conflict(f"You have used all {a.max_attempts} submissions for this assignment.", code="ATTEMPT_LIMIT")
    cap = settings.LOCALMIND["MAX_QUIZ_DURATION_HOURS"] * 3600
    sub = AssignmentSubmission.objects.create(assignment=a, student=student, attempt_number=existing + 1, content=content,
                                              is_late=late, time_spent_seconds=max(0, min(int(time_spent_seconds or 0), cap)))
    from activity.services import record_event
    record_event(student, "assignment", sub.time_spent_seconds, subject=a.subject, module=a.module, reference_id=sub.id)
    audit.record(student, "assignment.submitted", sub, {"assignment": str(a.id), "late": late}, request)
    return sub


@transaction.atomic
def evaluate(actor, sub, score=None, feedback="", rubric_scores=None, status=SubmissionStatus.EVALUATED, request=None):
    _require_manage(actor, sub.assignment.subject)
    if rubric_scores:
        total = 0.0
        for row in rubric_scores:
            total += float(row.get("points_awarded", 0))
        score = total if score is None else score
        sub.rubric_scores = rubric_scores
    if status == SubmissionStatus.EVALUATED:
        if score is None:
            raise ValidationFailed(details={"score": "A score is required to mark as evaluated."})
        if score < 0 or score > sub.assignment.max_score:
            raise ValidationFailed(details={"score": f"Score must be between 0 and {sub.assignment.max_score}."})
        sub.score = float(score)
    sub.feedback = feedback or sub.feedback
    sub.status = status
    sub.evaluated_by, sub.evaluated_at = actor, timezone.now()
    sub.save()
    audit.record(actor, "assignment.evaluated", sub, {"score": sub.score, "status": status}, request)
    return sub


def withhold_submission(sub):
    """What the student sees while results on their submission are held."""
    return {
        "id": str(sub.id),
        "assignment_id": str(sub.assignment_id),
        "attempt_number": sub.attempt_number,
        "status": "submitted",
        "results_released": False,
        "submitted_at": sub.submitted_at,
        "is_late": sub.is_late,
        "content": sub.content,
        "score": None, "feedback": "", "rubric_scores": [],
        "results_release": sub.assignment.results_release,
        "results_release_at": sub.assignment.results_release_at,
    }


@transaction.atomic
def release_results(actor, assignment, submission_id=None, request=None):
    """Release held marks, for the whole assignment or one submission."""
    _require_manage(actor, assignment.subject)
    now = timezone.now()
    if submission_id:
        try:
            sub = assignment.submissions.get(pk=submission_id)
        except (AssignmentSubmission.DoesNotExist, ValueError):
            raise NotFound("Submission not found.")
        sub.results_released_at = now
        sub.save(update_fields=["results_released_at", "updated_at"])
        audit.record(actor, "assignment.results_released", assignment, {"submission": str(sub.id)}, request)
        return 1
    count = assignment.submissions.filter(results_released_at__isnull=True).update(results_released_at=now)
    assignment.results_released_at = now
    assignment.results_released_by = actor
    assignment.save(update_fields=["results_released_at", "results_released_by", "updated_at"])
    audit.record(actor, "assignment.results_released", assignment, {"submissions": count, "scope": "all"}, request)
    return count


def pending_release_count(assignment):
    """Marked submissions whose owner cannot yet see the score."""
    from assessments.models import ResultsRelease

    if assignment.results_release == ResultsRelease.IMMEDIATE or assignment.results_released_at:
        return 0
    if (assignment.results_release == ResultsRelease.SCHEDULED and assignment.results_release_at
            and timezone.now() >= assignment.results_release_at):
        return 0
    return assignment.submissions.filter(results_released_at__isnull=True).count()
