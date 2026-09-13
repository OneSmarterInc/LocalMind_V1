"""Lessons are generated in the background and read from the database.

A student pressing Lesson used to start a model call and wait for it, often a
minute on a laptop CPU. Now a lesson is generated as soon as its module has
text: when a book finishes processing, when an outline edit adds or changes a
module, and when a module's text is edited. Students read what is stored.

The ``ModuleLesson`` row is the job. Its life:

    request_lessons()  ->  PENDING  --worker claims-->  GENERATING  -->  READY
                                                              \\-->  FAILED (retried later)

Rules that keep this correct under edits, restarts and several processes:

* ``source_hash`` is the text the lesson belongs to. A READY row whose hash no
  longer matches the module's text is never shown; the edit that changed the
  text already queued a new one.
* Every state change bumps ``version``. The worker records the version it
  claimed and finishes with ``UPDATE ... WHERE version = claimed``, so if the
  module was edited while its lesson was being generated, the stale result is
  discarded instead of overwriting the new request.
* Claims are conditional updates too, so two gunicorn workers never generate
  the same lesson. A GENERATING row older than ``STALE_MINUTES`` (a process
  died mid-generation) is claimable again.
* Students come first. The worker waits while any interactive model call (a
  tutor question, quiz generation, grading) is in flight and while a book is
  being parsed, so a long queue of lessons does not make a student's question
  time out behind it.
"""
from __future__ import annotations

import hashlib
import logging
import threading
import time
from datetime import timedelta

from django.conf import settings
from django.db import close_old_connections, transaction
from django.db.models import Case, F, IntegerField, Q, Value, When
from django.utils import timezone

from ai.config import task_config
from ai.gateway import foreground_busy, gateway, trim_source

from .models import LessonStatus, ModuleLesson

logger = logging.getLogger("localmind.lessons")

LESSON_SCHEMA = {"type": "object", "properties": {
    "title": {"type": "string"},
    "learning_objectives": {"type": "array", "minItems": 2, "maxItems": 6, "items": {"type": "string"}},
    "sections": {"type": "array", "minItems": 2, "maxItems": 8, "items": {"type": "object", "properties": {
        "heading": {"type": "string"}, "explanation": {"type": "string"}, "source_reference": {"type": "string"}},
        "required": ["heading", "explanation", "source_reference"]}},
    "key_terms": {"type": "array", "items": {"type": "object", "properties": {"term": {"type": "string"}, "definition": {"type": "string"}}, "required": ["term", "definition"]}},
    "summary": {"type": "string"}},
    "required": ["title", "learning_objectives", "sections", "key_terms", "summary"]}

GROUNDING = (
    "You are a tutor for one module of a textbook. Follow every rule.\n"
    "1. Use only the SOURCE TEXT. Do not add facts, dates, names or examples that are not in it.\n"
    "2. When the source does not cover something, say so plainly instead of guessing.\n"
    "3. Every source_reference is a short phrase copied from the SOURCE TEXT.\n"
    "4. Write in plain, simple English for a first-time learner.\n"
    "5. Output JSON only.\n"
)
LESSON_TASK = ("TASK: Turn the source into a lesson with two to six learning_objectives, two to eight sections "
               "(each with a heading, a clear explanation and a source_reference), the key_terms defined in the "
               "source, and a short summary.")

# Error codes that say nothing about this module's text: the model is off,
# missing or busy. These are retried on a timer without using up attempts.
TRANSIENT_ERRORS = {"disabled", "unavailable", "timeout"}


def _cfg(name, default):
    return settings.LESSONS.get(name, default)


def source_hash(text: str) -> str:
    """The text a lesson belongs to. Whitespace at the ends does not count."""
    return hashlib.sha256((text or "").strip().encode("utf-8")).hexdigest()


def has_text(module) -> bool:
    return bool((module.source_text or "").strip()) and not module.source_missing


# ----------------------------------------------------------------- requests --

def request_lessons(modules, *, force: bool = False, reason: str = "") -> int:
    """Queue lessons for these modules. Modules without text are skipped.

    A module whose READY lesson already matches its text is left alone unless
    ``force``. Anything else (no row, different text, failed, or forced) goes
    back to PENDING with its attempt count reset. Returns how many were queued.
    Starts the background worker when there is something to do.
    """
    now = timezone.now()
    queued = 0
    for module in modules:
        if not has_text(module):
            continue
        digest = source_hash(module.source_text)
        with transaction.atomic():
            row = ModuleLesson.objects.select_for_update().filter(module=module).first()
            if row is None:
                ModuleLesson.objects.create(module=module, status=LessonStatus.PENDING, source_hash=digest, requested_at=now)
                queued += 1
                continue
            unchanged = row.source_hash == digest
            if not force and unchanged and row.status in (LessonStatus.READY, LessonStatus.PENDING, LessonStatus.GENERATING):
                continue
            row.status = LessonStatus.PENDING
            if not unchanged:
                # The stored lesson describes text that no longer exists.
                row.lesson = None
                row.model_name = ""
                row.generated_at = None
            row.source_hash = digest
            row.attempts = 0
            row.last_error = ""
            row.next_attempt_at = None
            row.claimed_at = None
            row.requested_at = now
            row.version = row.version + 1
            row.save()
            queued += 1
    if queued:
        logger.info("Queued %d lesson(s)%s", queued, f" ({reason})" if reason else "")
        start_worker()
    return queued


def request_for_document(document, *, force: bool = False, reason: str = "") -> int:
    from learning.models import Module

    modules = Module.objects.filter(chapter__document=document).select_related("chapter__document")
    return request_lessons(list(modules), force=force, reason=reason)


def auto_generate_enabled() -> bool:
    return bool(_cfg("AUTO_GENERATE", True))


def on_content_changed(modules, reason: str) -> int:
    """Called after processing and edits. Honours LESSON_AUTO_GENERATE."""
    if not auto_generate_enabled():
        return 0
    try:
        return request_lessons(modules, reason=reason)
    except Exception:  # generation is never allowed to break an edit
        logger.exception("Could not queue lessons (%s)", reason)
        return 0


# ------------------------------------------------------------------- reading --

_UNSET = object()


def state_for(module, row=_UNSET) -> str:
    """What a reader should make of this module's lesson right now:
    ready | pending | generating | failed | none (no text, nothing to make).
    Pass ``row`` (possibly None) when it is already loaded."""
    if not has_text(module):
        return "none"
    if row is _UNSET:
        row = ModuleLesson.objects.filter(module=module).first()
    if row is None:
        return LessonStatus.PENDING if auto_generate_enabled() else "none"
    if row.source_hash != source_hash(module.source_text):
        return LessonStatus.PENDING
    return row.status


def fallback_lesson(module) -> dict:
    """A plain lesson made from the source text, for when no AI lesson exists."""
    paragraphs = [p.strip() for p in (module.source_text or "").split("\n\n") if p.strip()] or [(module.source_text or "").strip()]
    sections = [{"heading": f"Part {i}", "explanation": p[:1500], "source_reference": p[:120]} for i, p in enumerate(paragraphs[:8], start=1)]
    if len(sections) < 2:
        text = sections[0]["explanation"]
        half = len(text) // 2
        sections = [{"heading": "Part 1", "explanation": text[:half], "source_reference": text[:120]},
                    {"heading": "Part 2", "explanation": text[half:], "source_reference": text[half:half + 120]}]
    return {"title": module.title, "learning_objectives": [f"Read and understand '{module.title}'", "Identify the key ideas in the source text"],
            "sections": sections, "key_terms": [], "summary": "This is a plain summary of the source text; the tutor's full lesson is not available."}


def lesson_for_student(module) -> dict:
    """What the Lesson tab shows. Never calls the model.

    ready       the stored lesson
    preparing   queued or being generated; nothing to show yet
    unavailable generation failed or AI is off; a plain lesson from the text
    """
    row = ModuleLesson.objects.filter(module=module).first()
    state = state_for(module, row)
    base = {"module_id": str(module.id), "state": state}
    if state == LessonStatus.READY and row and row.lesson:
        return {**base, "status": "ready", "lesson": row.lesson, "generator": "ai", "cached": True,
                "model": row.model_name, "generated_at": row.generated_at}
    ai_on = bool(settings.AI.get("ENABLED"))
    if state in (LessonStatus.PENDING, LessonStatus.GENERATING) and ai_on:
        start_worker()
        return {**base, "status": "preparing", "lesson": None, "generator": None, "cached": False,
                "queue_position": queue_position(row) if row else None}
    reason = "ai_disabled" if not ai_on else (row.last_error if row else "not_generated")
    return {**base, "status": "unavailable", "lesson": fallback_lesson(module), "generator": "fallback", "cached": False,
            "ai_error": reason, "retry_scheduled": bool(row and row.next_attempt_at)}


def queue_position(row: ModuleLesson) -> int | None:
    """1 for the next lesson the worker will take, 0 while generating, None
    when not queued. Uses the worker's own ordering, so it is what will happen."""
    if row.status == LessonStatus.GENERATING:
        return 0
    if row.status != LessonStatus.PENDING:
        return None
    order = list(_ordered(ModuleLesson.objects.filter(status=LessonStatus.PENDING)).values_list("pk", flat=True)[:2000])
    return order.index(row.pk) + 1 if row.pk in order else None


def summary_for_document(document) -> dict:
    """Counts for the faculty screen: every module with text is in exactly one bucket."""
    from learning.models import Module

    modules = list(Module.objects.filter(chapter__document=document).select_related("lesson"))
    counts = {"total": 0, "ready": 0, "pending": 0, "generating": 0, "failed": 0}
    for m in modules:
        # A missing reverse one-to-one raises an AttributeError subclass.
        state = state_for(m, getattr(m, "lesson", None))
        if state == "none":
            continue
        counts["total"] += 1
        counts[state if state in counts else "pending"] += 1
    counts["auto_generate"] = auto_generate_enabled()
    return counts


def detail_for_faculty(module) -> dict:
    row = ModuleLesson.objects.filter(module=module).first()
    state = state_for(module, row)
    return {"module_id": str(module.id), "status": state,
            "lesson": row.lesson if (row and state == LessonStatus.READY) else None,
            "model": row.model_name if row else "", "generated_at": row.generated_at if row else None,
            "attempts": row.attempts if row else 0, "last_error": row.last_error if row else "",
            "next_attempt_at": row.next_attempt_at if row else None,
            "queue_position": queue_position(row) if row else None,
            "auto_generate": auto_generate_enabled()}


# -------------------------------------------------------------------- worker --

def _claimable(now):
    stale_before = now - timedelta(minutes=_cfg("STALE_MINUTES", 15))
    return (Q(status=LessonStatus.PENDING)
            | Q(status=LessonStatus.FAILED, next_attempt_at__isnull=False, next_attempt_at__lte=now)
            | Q(status=LessonStatus.GENERATING, claimed_at__lt=stale_before))


def _ordered(queryset):
    """Retries after fresh requests; published books first (students may be
    waiting); then oldest request, then book, chapter and module order."""
    from documents.models import DocumentStatus

    return (queryset
            .annotate(live=Case(When(module__chapter__document__status=DocumentStatus.PUBLISHED, then=Value(0)),
                                default=Value(1), output_field=IntegerField()),
                      retry=Case(When(status=LessonStatus.FAILED, then=Value(1)), default=Value(0), output_field=IntegerField()))
            .order_by("retry", "live", "requested_at", "module__chapter__document__created_at",
                      "module__chapter__order", "module__order"))


def claim_next() -> ModuleLesson | None:
    """Take the next job in ``_ordered`` order. The conditional update is the lock."""
    now = timezone.now()
    candidates = _ordered(ModuleLesson.objects.filter(_claimable(now))).values_list("pk", "version")[:5]
    for pk, version in candidates:
        won = ModuleLesson.objects.filter(pk=pk, version=version).filter(_claimable(now)).update(
            status=LessonStatus.GENERATING, claimed_at=now, version=F("version") + 1, updated_at=now)
        if won:
            return ModuleLesson.objects.select_related("module__chapter__document").get(pk=pk)
    return None


def _generate(module):
    from documents.services import retrieval

    budget = task_config("lesson")
    source, chunk_count = retrieval.coverage_sample(module, budget.source_chars)
    if not source:
        source = trim_source(module.source_text, budget.source_chars)
    return gateway().generate(task="lesson", system_prompt=GROUNDING + LESSON_TASK,
                              user_prompt=f"MODULE: {module.title}\n\nSOURCE TEXT:\n\"\"\"{source}\"\"\"",
                              schema=LESSON_SCHEMA, source_chars=len(source), retrieved_chunks=chunk_count, background=True)


def _backoff(attempts: int) -> timedelta:
    minutes = _cfg("RETRY_MINUTES", 10)
    return timedelta(minutes=minutes * min(6, 2 ** max(0, attempts - 1)))


def process_one(row: ModuleLesson) -> str:
    """Generate the claimed lesson and record the outcome. Returns the new status
    (or "discarded" when the module changed or vanished meanwhile)."""
    claimed_version = row.version
    module = row.module
    if not has_text(module):
        ModuleLesson.objects.filter(pk=row.pk, version=claimed_version).delete()
        return "discarded"
    digest = source_hash(module.source_text)
    if digest != row.source_hash:
        # Text changed after the request and nothing re-queued it (a direct
        # database edit, say). Generate for the current text.
        ModuleLesson.objects.filter(pk=row.pk, version=claimed_version).update(source_hash=digest)
    try:
        result = _generate(module)
    except Exception as exc:  # a bug or a provider crash must not kill the worker
        logger.exception("Lesson generation raised for module %s", module.pk)
        from ai.gateway import AIResult
        result = AIResult(ok=False, error_code="error", error=str(exc)[:200])
    now = timezone.now()
    live = ModuleLesson.objects.filter(pk=row.pk, version=claimed_version, source_hash=digest)
    if result.ok:
        done = live.update(status=LessonStatus.READY, lesson=result.data, generator="ai", model_name=result.model or "",
                           generated_at=now, last_error="", next_attempt_at=None, claimed_at=None,
                           version=F("version") + 1, updated_at=now)
        if done:
            logger.info("Lesson ready for module %s (%s)", module.pk, module.title[:60])
            return LessonStatus.READY
        return "discarded"
    transient = result.error_code in TRANSIENT_ERRORS
    # The model being off or busy says nothing about this module, so it does
    # not use up attempts and is retried every RETRY_MINUTES. A reply the model
    # could not shape into a lesson counts, backs off, and stops at MAX_ATTEMPTS
    # until faculty ask again.
    attempts = row.attempts if transient else row.attempts + 1
    give_up = not transient and attempts >= _cfg("MAX_ATTEMPTS", 3)
    retry_at = None if give_up else now + _backoff(1 if transient else attempts)
    done = live.update(status=LessonStatus.FAILED, attempts=attempts, last_error=f"{result.error_code}: {result.error}"[:300],
                       next_attempt_at=retry_at, claimed_at=None, version=F("version") + 1, updated_at=now)
    if done:
        logger.warning("Lesson for module %s failed (%s)%s", module.pk, result.error_code,
                       "; giving up until someone asks again" if give_up else f"; retrying at {retry_at:%H:%M}")
        return LessonStatus.FAILED
    return "discarded"


def _wait_for_students(max_wait: float | None = None) -> None:
    """Hold off while an interactive model call or a book parse is running."""
    from documents.services.documents import _processing_lock

    started = time.monotonic()
    while foreground_busy() or _processing_lock.locked():
        if max_wait is not None and time.monotonic() - started > max_wait:
            return
        time.sleep(_cfg("YIELD_SECONDS", 1.0))


def run_pending(limit: int | None = None, *, wait_for_students: bool = True) -> dict:
    """Work through the queue in this thread. Used by the background worker,
    the ``generate_lessons`` command and the tests."""
    outcome = {"ready": 0, "failed": 0, "discarded": 0}
    done = 0
    while limit is None or done < limit:
        if wait_for_students:
            _wait_for_students()
        row = claim_next()
        if row is None:
            break
        status = process_one(row)
        outcome[status if status in outcome else "discarded"] += 1
        done += 1
    return outcome


_worker: threading.Thread | None = None
_worker_lock = threading.Lock()


def _worker_loop():
    """One background worker per process for lessons and automatic quizzes.
    It alternates between the two queues, one job at a time, so a module's
    lesson and quiz both make progress rather than every lesson in the
    library finishing before the first quiz starts."""
    global _worker
    from assessments.services import auto_quiz

    idle_since = time.monotonic()
    try:
        while True:
            close_old_connections()
            outcome = {"ready": 0, "failed": 0, "discarded": 0}
            for runner, label in ((run_pending, "lesson"), (auto_quiz.run_pending, "quiz")):
                try:
                    for key, value in runner(limit=1).items():
                        outcome[key] = outcome.get(key, 0) + value
                except Exception:
                    logger.exception("Background %s job failed", label)
                    time.sleep(5)
            if sum(outcome.values()):
                idle_since = time.monotonic()
                continue
            # Nothing claimable now. Failed jobs may become due later, so the
            # worker lingers briefly, then exits; the next request, a student
            # read or the startup hook starts it again.
            if time.monotonic() - idle_since > _cfg("IDLE_EXIT_SECONDS", 30):
                return
            time.sleep(2)
    finally:
        from django.db import connection
        connection.close()
        with _worker_lock:
            _worker = None


def start_worker() -> bool:
    """Start this process's lesson worker if it is not running. Never runs
    under the test runner (tests call ``run_pending`` directly) or with AI off."""
    global _worker
    if settings.TESTING or not settings.AI.get("ENABLED"):
        return False
    with _worker_lock:
        if _worker is not None and _worker.is_alive():
            return False
        _worker = threading.Thread(target=_worker_loop, name="lesson-worker", daemon=True)
        _worker.start()
        return True


def resume_on_startup(delay: float = 5.0) -> None:
    """Called once when the web process starts: pick up jobs left by a restart.
    Waits a moment so the server is accepting requests first."""
    if settings.TESTING or not settings.AI.get("ENABLED"):
        return

    def later():
        time.sleep(delay)
        try:
            close_old_connections()
            from assessments.services import auto_quiz
            if ModuleLesson.objects.filter(_claimable(timezone.now())).exists() or auto_quiz.has_claimable():
                start_worker()
        except Exception:  # database not migrated yet, for instance
            logger.warning("Lesson worker did not resume at startup", exc_info=True)
        finally:
            from django.db import connection
            connection.close()

    threading.Thread(target=later, name="lesson-resume", daemon=True).start()
