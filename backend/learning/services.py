"""Student-side content access and progress."""
import contextvars
import logging
from contextlib import contextmanager

from django.db import transaction
from django.utils import timezone

from academics.models import EnrollmentStatus
from core.exceptions import Conflict, Forbidden, NotFound
from documents.models import Document, DocumentStatus

from .models import Module, ModuleAvailability, ModuleProgress, ProgressStatus

logger = logging.getLogger("localmind.learning")


def student_documents(student, subject=None):
    qs = Document.objects.visible_to(student).select_related("subject")
    if subject is not None:
        qs = qs.filter(subject=subject)
    return qs


def student_module_queryset(student):
    """Modules in published documents of subjects the student is actively
    enrolled in. A module without source text is never part of a student's
    world (the only such modules left are kept for records and hidden)."""
    return Module.objects.filter(
        source_missing=False,
        chapter__document__status=DocumentStatus.PUBLISHED,
        chapter__document__subject__status="active",
        chapter__document__subject__enrollments__student=student,
        chapter__document__subject__enrollments__status=EnrollmentStatus.ACTIVE,
    ).distinct()


def resolve_accessible_module(student, module_id):
    """Every rule from the access policy in one place. Raises NotFound when the
    module is outside the student's world, MODULE_LOCKED when it is inside but
    not yet opened."""
    try:
        module = student_module_queryset(student).select_related("chapter__document__subject").get(pk=module_id)
    except (Module.DoesNotExist, ValueError, TypeError):
        raise NotFound("Module not found.")
    if not (module.source_text or "").strip():
        raise Conflict("This module has no stored source text. Ask faculty to correct it.", code="MODULE_SOURCE_MISSING")
    if module.availability != ModuleAvailability.OPEN:
        raise Forbidden("This module has not been opened by faculty.", code="MODULE_LOCKED")
    return module


@transaction.atomic
def record_module_view(student, module):
    progress, _ = ModuleProgress.objects.select_for_update().get_or_create(student=student, module=module)
    now = timezone.now()
    progress.last_viewed_at = now
    # Remember which version of the text was read, so a later edit can put the
    # module back in progress (refresh_completion).
    from tutor.lessons import source_hash
    progress.read_source_hash = source_hash(module.source_text)
    if progress.status == ProgressStatus.NOT_STARTED:
        progress.status = ProgressStatus.IN_PROGRESS
        progress.started_at = now
    progress.save()
    refresh_completion(student, [module])
    progress.refresh_from_db()
    return progress


@transaction.atomic
def record_lesson_view(student, module):
    """The student opened the module's lesson. Counts as reading the module too."""
    progress = record_module_view(student, module)
    progress.lesson_viewed_at = timezone.now()
    progress.save(update_fields=["lesson_viewed_at", "updated_at"])
    refresh_completion(student, [module])
    progress.refresh_from_db()
    return progress


# ---------- completion ----------
#
# A module is complete once the student has done every step it actually has:
#   read    they opened the module (always a step; taking the quiz alone is not reading);
#   lesson  they opened its lesson, when the module has a lesson ready for students;
#   quiz    they submitted its quiz, when it has a published module quiz.
# The quiz counts once it is submitted, pass or fail. A module that has no
# lesson or quiz (too little text, front matter, generation skipped) is complete
# as soon as it is read. Passing the module's quiz still completes it on its own.
#
# A completed module goes back to in progress, with a label for the student,
# when something new appears after they finished:
#   new_quiz  a module quiz is published and they have submitted none for this
#             module. A new version of a quiz they already took does not count.
#   updated   the module text changed since they read it, or its lesson was
#             written again after they finished and they have not opened it since.
# Doing the new step (take the quiz, read the text, open the lesson) completes
# it again and clears the label. A completion faculty set by hand is never reopened.

_SUBMITTED = ("submitted", "pending_evaluation", "evaluated")


def below_pass_mark(progress_qs):
    """Progress rows whose best released quiz score is under the module quiz's
    pass mark, plus rows still carrying the old "needs review" status. Faculty
    screens call these students "Needs review"; the students themselves see the
    module as completed. ``best_quiz_percentage`` only holds released results,
    so this never exposes a held score."""
    from django.db.models import F, OuterRef, Q, Subquery
    from assessments.models import Assessment, AssessmentStatus

    pass_mark = Subquery(Assessment.objects.filter(module=OuterRef("module"), status__in=[AssessmentStatus.PUBLISHED, AssessmentStatus.CLOSED])
                         .order_by("-published_at", "-version").values("pass_percentage")[:1])
    return (progress_qs.annotate(_pass_mark=pass_mark)
            .filter(Q(status=ProgressStatus.NEEDS_REVIEW)
                    | Q(best_quiz_percentage__isnull=False, _pass_mark__isnull=False, best_quiz_percentage__lt=F("_pass_mark"))))


def module_steps(modules):
    """{module_id: {"lesson": bool, "quiz": bool, "lesson_at": datetime|None, "text": str}}:
    which steps each module has, when its ready lesson was written and the hash
    of its current text. Three queries whatever the number of modules."""
    from assessments.models import Assessment, AssessmentStatus
    from tutor.lessons import source_hash
    from tutor.models import LessonStatus, ModuleLesson

    ids = [m.id if hasattr(m, "id") else m for m in modules]
    if not ids:
        return {}
    lessons = dict(ModuleLesson.objects.filter(module_id__in=ids, status=LessonStatus.READY, lesson__isnull=False)
                   .values_list("module_id", "generated_at"))
    now = timezone.now()
    with_quiz = set(Assessment.objects.filter(module_id__in=ids, status=AssessmentStatus.PUBLISHED)
                    .exclude(available_from__gt=now).values_list("module_id", flat=True))
    texts = {mid: source_hash(text) for mid, text in Module.objects.filter(id__in=ids).values_list("id", "source_text")}
    return {mid: {"lesson": mid in lessons, "lesson_at": lessons.get(mid), "quiz": mid in with_quiz, "text": texts.get(mid, "")}
            for mid in ids}


def _text_changed(row, need):
    return bool(row.read_source_hash) and bool(need["text"]) and row.read_source_hash != need["text"]


def _lesson_missing(row, need):
    """The ready lesson has not been opened since it was (last) written."""
    if not need["lesson"]:
        return False
    if row.lesson_viewed_at is None:
        return True
    return bool(need["lesson_at"]) and need["lesson_at"] > row.lesson_viewed_at


def _reopen_reason(row, need, quiz_done):
    """Why a completed module should be in progress again, or ""."""
    if need["quiz"] and row.module_id not in quiz_done:
        return "new_quiz"
    if _text_changed(row, need):
        return "updated"
    # Only a lesson written after they finished: a module completed before its
    # lesson existed, or by passing the quiz, is not reopened for that alone.
    if need["lesson"] and row.completed_at and need["lesson_at"] and need["lesson_at"] > row.completed_at \
            and (row.lesson_viewed_at is None or need["lesson_at"] > row.lesson_viewed_at):
        return "updated"
    return ""


def refresh_completion(student, modules):
    """Complete every started module whose steps are all done, and put back in
    progress any completed module with a new quiz or updated content (see the
    rules above). Returns the number of modules newly completed. Safe to call
    repeatedly."""
    from assessments.models import AssessmentAttempt

    ids = [m.id if hasattr(m, "id") else m for m in modules]
    if not ids:
        return 0
    # "Read" means the module itself was opened (last_viewed_at). started_at is
    # also set by a quiz result, which alone does not count as reading.
    rows = list(ModuleProgress.objects.filter(student=student, module_id__in=ids, last_viewed_at__isnull=False))
    if not rows:
        return 0
    touched = [r.module_id for r in rows]
    steps = module_steps(touched)
    quiz_done = set(AssessmentAttempt.objects.filter(student=student, assessment__module_id__in=touched, status__in=_SUBMITTED)
                    .values_list("assessment__module_id", flat=True))
    now = timezone.now()
    done, reopen = [], {}
    for row in rows:
        need = steps.get(row.module_id, {"lesson": False, "lesson_at": None, "quiz": False, "text": ""})
        if row.status == ProgressStatus.COMPLETED:
            if row.overridden_by_id is None:
                reason = _reopen_reason(row, need, quiz_done)
                if reason:
                    reopen.setdefault(reason, []).append(row.pk)
            continue
        if _lesson_missing(row, need) or _text_changed(row, need):
            continue
        if need["quiz"] and row.module_id not in quiz_done:
            continue
        done.append(row.pk)
    for reason, pks in reopen.items():
        ModuleProgress.objects.filter(pk__in=pks, status=ProgressStatus.COMPLETED).update(
            status=ProgressStatus.IN_PROGRESS, reopened_reason=reason, completed_at=None, updated_at=now)
    if done:
        ModuleProgress.objects.filter(pk__in=done).exclude(status=ProgressStatus.COMPLETED).update(
            status=ProgressStatus.COMPLETED, completed_at=now, reopened_reason="", updated_at=now)
    return len(done)


@transaction.atomic
def record_quiz_outcome(student, module, percentage, passed, count_attempt=True):
    """Write one quiz result into the student's progress for a module.

    Callers only do this once the result is visible to the student (see
    ``assessments.services.assessments.apply_outcome``). ``count_attempt`` is
    False when the same attempt was recorded before and is being re-graded."""
    progress, _ = ModuleProgress.objects.select_for_update().get_or_create(student=student, module=module)
    now = timezone.now()
    if count_attempt:
        progress.quiz_attempts += 1
    progress.best_quiz_percentage = max(progress.best_quiz_percentage or 0.0, percentage)
    if progress.started_at is None:
        progress.started_at = now
    if passed:
        if progress.status != ProgressStatus.COMPLETED:
            progress.completed_at = now
        progress.status = ProgressStatus.COMPLETED
        progress.reopened_reason = ""
    elif progress.status != ProgressStatus.COMPLETED:
        # A failed quiz no longer parks the module in "needs review": the
        # module completes once its other steps are done (see refresh_completion).
        # Faculty still see who is below the pass mark through analytics.
        progress.status = ProgressStatus.IN_PROGRESS
    progress.save()
    refresh_completion(student, [module])
    progress.refresh_from_db()
    return progress


_settled_in_this_pass = contextvars.ContextVar("settled_in_this_pass", default=None)


@contextmanager
def settle_once():
    """Within this block each student's results are settled at most once.
    The offline download runs dozens of student views in one request, and each
    used to settle again."""
    token = _settled_in_this_pass.set(set())
    try:
        yield
    finally:
        _settled_in_this_pass.reset(token)


def settle_student_results(student):
    """Record quiz outcomes whose scheduled release time has passed. Scheduled
    release has no scheduler, so every student-facing progress read settles
    first. One indexed query when there is nothing to do."""
    done = _settled_in_this_pass.get()
    if done is not None:
        if student.pk in done:
            return 0
        done.add(student.pk)
    from assessments.services.assessments import settle_released_outcomes
    return settle_released_outcomes(student)


def progress_map(student, modules):
    settle_student_results(student)
    # Brings rows written before the completion rule up to date the first time
    # the student's progress is read again, and catches a lesson or quiz that
    # was withdrawn after the student finished everything else.
    refresh_completion(student, modules)
    return {p.module_id: p for p in ModuleProgress.objects.filter(student=student, module__in=modules)}


def chapter_status(progress_rows, modules):
    if not modules:
        return ProgressStatus.NOT_STARTED
    statuses = [progress_rows.get(m.id).status if progress_rows.get(m.id) else ProgressStatus.NOT_STARTED for m in modules]
    if all(s == ProgressStatus.COMPLETED for s in statuses):
        return ProgressStatus.COMPLETED
    if all(s == ProgressStatus.NOT_STARTED for s in statuses):
        return ProgressStatus.NOT_STARTED
    if any(s == ProgressStatus.NEEDS_REVIEW for s in statuses):
        return ProgressStatus.NEEDS_REVIEW
    return ProgressStatus.IN_PROGRESS


# ---------- opening modules on publish ----------

def open_modules_for_publish(actor, modules, reason, target=None, request=None):
    """Open every locked module in `modules` that has source text, in one
    query, and write a single audit row naming the reason ("document.published",
    "quiz.published", "assignment.published"). Publishing is an explicit act by
    faculty or an administrator; students should see the result immediately
    rather than after a second, separate "open module" step. Faculty can still
    lock individual modules or chapters afterwards. Returns the number opened."""
    from audit import services as audit

    module_ids = [m.id for m in modules if m.availability != ModuleAvailability.OPEN and not m.source_missing]
    if not module_ids:
        return 0
    now = timezone.now()
    opened = Module.objects.filter(pk__in=module_ids).update(
        availability=ModuleAvailability.OPEN, opened_by=actor, opened_at=now, updated_at=now,
    )
    for m in modules:
        if m.id in module_ids:
            m.availability, m.opened_by, m.opened_at = ModuleAvailability.OPEN, actor, now
    if target is None:
        target = modules[0].chapter.document
    audit.record(actor, "module.opened_on_publish", target,
                 {"reason": reason, "count": opened, "modules": [str(i) for i in module_ids]}, request)
    # Lessons are already queued when the book is processed and whenever a
    # module's text changes (tutor/lessons.py). Opening a module publishes its
    # automatic quiz once that quiz is ready.
    from assessments.services import auto_quiz
    auto_quiz.publish_after_commit([m for m in modules if m.id in module_ids])
    return opened


def open_target_modules(actor, obj, reason, request=None):
    """For a quiz or assignment about to be published: open its module, or every
    module in its chapter when none of them is open, so the published item is
    actually visible to students. Subject-level items have nothing to open."""
    if getattr(obj, "module_id", None):
        module = Module.objects.select_related("chapter__document").get(pk=obj.module_id)
        return open_modules_for_publish(actor, [module], reason, target=obj, request=request)
    if getattr(obj, "chapter_id", None):
        modules = list(Module.objects.filter(chapter_id=obj.chapter_id).select_related("chapter__document"))
        if modules and not any(m.availability == ModuleAvailability.OPEN for m in modules):
            return open_modules_for_publish(actor, modules, reason, target=obj, request=request)
    return 0
