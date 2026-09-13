"""Automatic quizzes: one per module, written in the background, published
when the module is open to students.

Faculty upload a book; as soon as it is processed every module with text is
queued for a lesson (tutor/lessons.py) and for a quiz (here). The quiz is an
ordinary ``Assessment`` marked ``auto_generated``, created as a draft. The
moment its module is open in a published book (on publish, when faculty open
the module or its chapter, or straight after generation when the module is
already open) it is published, so enrolled students see the lesson and the
quiz together. Faculty can edit, close or delete it like any other quiz.

Job rules match lessons: ``AutoQuizJob.source_hash`` is the module text the
quiz belongs to, claims and completions are conditional on ``version``, a job
left "generating" by a stopped process is reclaimed after
``LESSON_STALE_MINUTES``, and the shared background worker waits while any
student-facing model call is running.

Nothing goes live unchecked. While the AI monitor is on, a new or rewritten
automatic quiz is checked by the monitor first and published only once that
check is done. A check that raises a high or critical incident holds the quiz
instead (``held_for_review``): it stays a draft until faculty publish it
themselves or mark the incident a false positive or close it. With the
monitor off, quizzes are published straight after generation as before.

Modules shorter than ``AUTO_QUIZ_MIN_CHARS`` (textbook boxes such as
"Questions" or a bare heading) get no automatic quiz; one question drawn from
three lines is noise in the student's quiz list.

When a module's text changes, its automatic quiz is written again only if no
student has attempted it yet; once students have attempts, the existing quiz
is kept (changing questions under their scores would make those scores
meaningless); faculty edit it in Quizzes instead, which creates a new version. A quiz faculty deleted is
not brought back.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Case, F, IntegerField, Q, Value, When
from django.utils import timezone

from ..models import Assessment, AssessmentKind, AssessmentStatus, AutoQuizJob, AutoQuizStatus, Generator

logger = logging.getLogger("localmind.auto_quiz")


def _cfg(name, default):
    return settings.AUTO_QUIZ.get(name, default)


def enabled() -> bool:
    return bool(_cfg("ENABLED", True))


def _text_of(module):
    from tutor.lessons import has_text, source_hash
    return has_text(module), (source_hash(module.source_text) if has_text(module) else "")


def min_chars() -> int:
    return max(0, int(_cfg("MIN_CHARS", 500) or 0))


def too_short(module) -> bool:
    return len((module.source_text or "").strip()) < min_chars()


HOLD_SEVERITIES = ("high", "critical")
HOLD_STATUSES = ("open", "confirmed", "needs_investigation", "escalated")


def monitor_gates() -> bool:
    """Whether automatic quizzes wait for the AI monitor before going live."""
    from ai_monitor import services as monitor
    return monitor.enabled()


# ----------------------------------------------------------------- requests --

def request_quizzes(modules, *, force: bool = False, reason: str = "") -> int:
    """Queue an automatic quiz for each module with text. Unchanged ready jobs
    are skipped unless ``force``; a dismissed job (faculty deleted the quiz)
    is only revived by ``force``. Starts the background worker."""
    now = timezone.now()
    queued = 0
    for module in modules:
        ok, digest = _text_of(module)
        if not ok or too_short(module):
            continue
        with transaction.atomic():
            job = AutoQuizJob.objects.select_for_update().filter(module=module).first()
            if job is None:
                AutoQuizJob.objects.create(module=module, status=AutoQuizStatus.PENDING, source_hash=digest, requested_at=now)
                queued += 1
                continue
            unchanged = job.source_hash == digest
            if job.status == AutoQuizStatus.DISMISSED and not force:
                continue
            if not force and unchanged and job.status in (AutoQuizStatus.READY, AutoQuizStatus.PENDING, AutoQuizStatus.GENERATING):
                continue
            job.status = AutoQuizStatus.PENDING
            job.source_hash = digest
            job.attempts = 0
            job.last_error = ""
            job.next_attempt_at = None
            job.claimed_at = None
            job.requested_at = now
            job.version = job.version + 1
            job.save()
            queued += 1
    if queued:
        logger.info("Queued %d automatic quiz(zes)%s", queued, f" ({reason})" if reason else "")
        from tutor.lessons import start_worker
        start_worker()
    return queued


def on_content_changed(modules, reason: str) -> int:
    if not enabled():
        return 0
    try:
        return request_quizzes(modules, reason=reason)
    except Exception:  # never allowed to break processing or an edit
        logger.exception("Could not queue automatic quizzes (%s)", reason)
        return 0


def dismiss_for(assessment) -> None:
    """Faculty deleted an automatic quiz: do not write it again."""
    if not assessment.auto_generated or not assessment.module_id:
        return
    AutoQuizJob.objects.filter(module_id=assessment.module_id).update(
        status=AutoQuizStatus.DISMISSED, assessment=None, version=F("version") + 1, updated_at=timezone.now())


# --------------------------------------------------------------- publishing --

def publish_ready_for(modules) -> int:
    """Publish the draft automatic quiz of every module that is open in a
    published book. Called when modules open, when a book is published and
    when a quiz finishes generating. Returns how many were published."""
    from documents.models import DocumentStatus
    from learning.models import ModuleAvailability

    ids = [m.pk for m in modules]
    if not ids:
        return 0
    quizzes = (Assessment.objects.filter(auto_generated=True, status=AssessmentStatus.DRAFT, module_id__in=ids,
                                         held_for_review=False,
                                         module__availability=ModuleAvailability.OPEN,
                                         module__chapter__document__status=DocumentStatus.PUBLISHED)
               .exclude(questions=[]))
    if monitor_gates():
        # Not until the monitor has checked these questions.
        quizzes = quizzes.filter(checked_at__isnull=False)
    now = timezone.now()
    count = 0
    for quiz in quizzes:
        # Direct update rather than the faculty publish action: that action
        # also opens the quiz's module, and an automatic quiz must never open
        # a module faculty have kept locked.
        count += Assessment.objects.filter(pk=quiz.pk, status=AssessmentStatus.DRAFT).update(
            status=AssessmentStatus.PUBLISHED, published_at=now, updated_at=now)
    if count:
        from audit import services as audit
        audit.record(None, "quiz.auto_published", None, {"count": count, "modules": [str(i) for i in ids][:50]})
        logger.info("Published %d automatic quiz(zes)", count)
    return count


def send_for_check(quiz) -> None:
    """Have the monitor check a new or rewritten automatic quiz; publishing
    follows in ``after_check``. Without the monitor, publish now."""
    if not monitor_gates():
        publish_ready_for([quiz.module])
        return
    from ai_monitor import services as monitor
    if monitor._cfg("MODE", "async") == "sync":
        monitor.evaluate_assessment(quiz)  # calls after_check when done
    else:
        monitor.enqueue_assessment(quiz)


def after_check(quiz, evaluation) -> str:
    """Called by the AI monitor when it has finished checking an automatic quiz.
    Holds the quiz when the check raised a high or critical incident, otherwise
    marks it checked and publishes it if its module is open. Returns
    "held", "published" or "checked"."""
    from ai_monitor.models import Incident

    if not quiz.auto_generated:
        return "checked"
    now = timezone.now()
    incident = (Incident.objects.filter(evaluation=evaluation, severity__in=HOLD_SEVERITIES, status__in=HOLD_STATUSES).first()
                if evaluation is not None else None)
    quiz.refresh_from_db()
    if incident is not None and not quiz.attempts.exists():
        quiz.checked_at = now
        quiz.held_for_review = True
        quiz.hold_reason = f"AI monitor: {incident.issue_type.replace('_', ' ')} ({incident.severity})"[:300]
        if quiz.status == AssessmentStatus.PUBLISHED:
            quiz.status = AssessmentStatus.DRAFT
        quiz.save(update_fields=["checked_at", "held_for_review", "hold_reason", "status", "updated_at"])
        from audit import services as audit
        audit.record(None, "quiz.auto_held", quiz, {"incident": str(incident.pk), "issue": incident.issue_type, "severity": incident.severity})
        logger.warning("Automatic quiz %s held for review (%s)", quiz.pk, quiz.hold_reason)
        return "held"
    Assessment.objects.filter(pk=quiz.pk).update(checked_at=now, updated_at=now)
    return "published" if quiz.module_id and publish_ready_for([quiz.module]) else "checked"


def release_after_review(incident) -> bool:
    """Faculty or an admin marked an incident a false positive or closed it: an
    automatic quiz held because of it is released (and published if its module
    is open). A confirmed incident keeps the hold; faculty fix the quiz and
    publish it themselves."""
    quiz = getattr(incident.evaluation, "assessment", None)
    if quiz is None or not quiz.auto_generated or not quiz.held_for_review or incident.status in HOLD_STATUSES:
        return False
    from ai_monitor.models import Incident
    still_flagged = Incident.objects.filter(evaluation__assessment=quiz, severity__in=HOLD_SEVERITIES,
                                            status__in=HOLD_STATUSES).exclude(pk=incident.pk).exists()
    if still_flagged:
        return False
    Assessment.objects.filter(pk=quiz.pk).update(held_for_review=False, hold_reason="", checked_at=quiz.checked_at or timezone.now(),
                                                 updated_at=timezone.now())
    if quiz.module_id:
        publish_ready_for([quiz.module])
    return True


def requeue_unchecked(older_than_minutes: int = 30) -> int:
    """Automatic quizzes still waiting for a check that never came (the monitor
    queue lives in memory and is lost on restart) are sent again."""
    if not monitor_gates():
        return 0
    cutoff = timezone.now() - timedelta(minutes=older_than_minutes)
    stale = list(Assessment.objects.filter(auto_generated=True, status=AssessmentStatus.DRAFT, checked_at__isnull=True,
                                           held_for_review=False, updated_at__lt=cutoff).exclude(questions=[])[:50])
    from ai_monitor import services as monitor
    for quiz in stale:
        monitor.enqueue_assessment(quiz)
    if stale:
        logger.info("Sent %d unchecked automatic quiz(zes) to the monitor again", len(stale))
    return len(stale)


def publish_after_commit(modules) -> None:
    modules = list(modules)
    transaction.on_commit(lambda: publish_ready_for(modules))


# ------------------------------------------------------------------- worker --

def _claimable(now):
    stale_before = now - timedelta(minutes=settings.LESSONS.get("STALE_MINUTES", 15))
    return (Q(status=AutoQuizStatus.PENDING)
            | Q(status=AutoQuizStatus.FAILED, next_attempt_at__isnull=False, next_attempt_at__lte=now)
            | Q(status=AutoQuizStatus.GENERATING, claimed_at__lt=stale_before))


def _ordered(queryset):
    from documents.models import DocumentStatus
    return (queryset
            .annotate(live=Case(When(module__chapter__document__status=DocumentStatus.PUBLISHED, then=Value(0)),
                                default=Value(1), output_field=IntegerField()),
                      retry=Case(When(status=AutoQuizStatus.FAILED, then=Value(1)), default=Value(0), output_field=IntegerField()))
            .order_by("retry", "live", "requested_at", "module__chapter__document__created_at",
                      "module__chapter__order", "module__order"))


def claim_next() -> AutoQuizJob | None:
    now = timezone.now()
    for pk, version in _ordered(AutoQuizJob.objects.filter(_claimable(now))).values_list("pk", "version")[:5]:
        won = AutoQuizJob.objects.filter(pk=pk, version=version).filter(_claimable(now)).update(
            status=AutoQuizStatus.GENERATING, claimed_at=now, version=F("version") + 1, updated_at=now)
        if won:
            return AutoQuizJob.objects.select_related("module__chapter__document__subject", "assessment").get(pk=pk)
    return None


def process_one(job: AutoQuizJob) -> str:
    from tutor.lessons import TRANSIENT_ERRORS, has_text, source_hash

    from .generation import QuizGenerationFailed, generate_questions

    claimed = job.version
    module = job.module
    if not has_text(module) or (too_short(module) and job.assessment_id is None):
        AutoQuizJob.objects.filter(pk=job.pk, version=claimed).delete()
        return "discarded"
    digest = source_hash(module.source_text)
    existing = job.assessment
    if existing is not None and existing.attempts.exists():
        # Students already have scores on this quiz; keep it as it is.
        AutoQuizJob.objects.filter(pk=job.pk, version=claimed).update(
            status=AutoQuizStatus.READY, source_hash=digest, claimed_at=None, version=F("version") + 1,
            note="Kept the existing quiz because students have attempted it; edit it in Quizzes to change it.",
            updated_at=timezone.now())
        return AutoQuizStatus.READY
    now = timezone.now()
    try:
        questions, note = generate_questions([module], int(_cfg("MCQS", 5)), int(_cfg("SUBJECTIVE", 0)), [], background=True)
        error_code, error = "", ""
    except QuizGenerationFailed as exc:
        questions, note = None, ""
        reasons = (exc.details or {}).get("reasons") or ["no usable questions"]
        error_code, error = reasons[0], ", ".join(reasons)
    except Exception as exc:  # a bug or a provider crash must not kill the worker
        logger.exception("Automatic quiz generation raised for module %s", module.pk)
        questions, note, error_code, error = None, "", "error", str(exc)[:200]

    live = AutoQuizJob.objects.filter(pk=job.pk, version=claimed)
    if questions:
        with transaction.atomic():
            if not live.exists():
                return "discarded"
            if existing is not None and existing.status != AssessmentStatus.SUPERSEDED:
                existing.questions = questions
                existing.generator = Generator.AI
                existing.content_version_at_creation = module.chapter.document.content_version
                # New questions need a new check, and whatever the last check
                # found was about the old ones.
                existing.checked_at = None
                existing.held_for_review = False
                existing.hold_reason = ""
                if monitor_gates() and existing.status == AssessmentStatus.PUBLISHED:
                    existing.status = AssessmentStatus.DRAFT
                existing.save(update_fields=["questions", "generator", "content_version_at_creation", "checked_at",
                                             "held_for_review", "hold_reason", "status", "updated_at"])
                quiz = existing
            else:
                quiz = Assessment.objects.create(
                    subject=module.chapter.document.subject, chapter=module.chapter, module=module, kind=AssessmentKind.MODULE,
                    title=f"Quiz: {module.title}"[:300], questions=questions, generator=Generator.AI, auto_generated=True,
                    pass_percentage=int(_cfg("PASS_PERCENTAGE", settings.LOCALMIND["DEFAULT_PASS_PERCENTAGE"])),
                    max_attempts=int(_cfg("MAX_ATTEMPTS", 3)) or None,
                    content_version_at_creation=module.chapter.document.content_version)
            live.update(status=AutoQuizStatus.READY, assessment=quiz, source_hash=digest, generated_at=now, note=note[:300],
                        last_error="", next_attempt_at=None, claimed_at=None, version=F("version") + 1, updated_at=now)
        logger.info("Automatic quiz ready for module %s (%d questions)", module.pk, len(questions))
        send_for_check(quiz)
        return AutoQuizStatus.READY

    transient = error_code in TRANSIENT_ERRORS
    attempts = job.attempts if transient else job.attempts + 1
    give_up = not transient and attempts >= settings.LESSONS.get("MAX_ATTEMPTS", 3)
    base = settings.LESSONS.get("RETRY_MINUTES", 10)
    retry_at = None if give_up else now + timedelta(minutes=base * min(6, 2 ** max(0, (1 if transient else attempts) - 1)))
    done = live.update(status=AutoQuizStatus.FAILED, attempts=attempts, last_error=f"{error_code}: {error}"[:300],
                       next_attempt_at=retry_at, claimed_at=None, version=F("version") + 1, updated_at=now)
    if done:
        logger.warning("Automatic quiz for module %s failed (%s)", module.pk, error_code)
        return AutoQuizStatus.FAILED
    return "discarded"


def run_pending(limit: int | None = None, *, wait_for_students: bool = True) -> dict:
    from tutor.lessons import _wait_for_students

    outcome = {"ready": 0, "failed": 0, "discarded": 0}
    done = 0
    while limit is None or done < limit:
        if not enabled():
            break
        if wait_for_students:
            _wait_for_students()
        job = claim_next()
        if job is None:
            if done == 0:
                requeue_unchecked()
            break
        status = process_one(job)
        outcome[status if status in outcome else "discarded"] += 1
        done += 1
    return outcome


def has_claimable() -> bool:
    return enabled() and AutoQuizJob.objects.filter(_claimable(timezone.now())).exists()


# ------------------------------------------------------------------ reading --

_UNSET = object()


def state_for(module, job=_UNSET) -> str:
    """ready | checking | held | pending | generating | failed | dismissed |
    short | none | off. Pass ``job`` (possibly None) when it is already loaded.

    checking: written, waiting for the AI monitor before it can go live.
    held: the monitor raised a serious incident; faculty must review it.
    short: the module is too short for an automatic quiz.
    """
    if not enabled():
        return "off"
    from tutor.lessons import has_text, source_hash
    if not has_text(module):
        return "none"
    if job is _UNSET:
        job = AutoQuizJob.objects.filter(module=module).select_related("assessment").first()
    if job is None or (job.assessment_id is None and job.status != AutoQuizStatus.DISMISSED and too_short(module)):
        return "short" if too_short(module) else "none"
    if job.status == AutoQuizStatus.READY and job.source_hash != source_hash(module.source_text):
        return AutoQuizStatus.PENDING
    quiz = job.assessment if job.assessment_id else None
    if job.status == AutoQuizStatus.READY and quiz is not None:
        if quiz.held_for_review:
            return "held"
        if quiz.status == AssessmentStatus.DRAFT and quiz.checked_at is None and monitor_gates():
            return "checking"
    return job.status


def summary_for_document(document) -> dict:
    from learning.models import Module

    counts = {"total": 0, "ready": 0, "checking": 0, "held": 0, "pending": 0, "generating": 0, "failed": 0, "dismissed": 0,
              "short": 0, "enabled": enabled(), "min_chars": min_chars()}
    if not enabled():
        return counts
    for m in Module.objects.filter(chapter__document=document).select_related("auto_quiz_job__assessment"):
        # A missing reverse one-to-one raises an AttributeError subclass.
        state = state_for(m, getattr(m, "auto_quiz_job", None))
        if state == "short":
            counts["short"] += 1
            continue
        if state in ("none", "off"):
            continue
        counts["total"] += 1
        counts[state if state in counts else "pending"] += 1
    return counts
