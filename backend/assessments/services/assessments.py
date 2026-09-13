"""AssessmentService: lifecycle, attempts, grading, scoping."""

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from academics.models import faculty_manages_subject
from audit import services as audit
from core.exceptions import Conflict, Forbidden, NotFound, ValidationFailed
from learning import services as learning
from learning.models import Chapter, Module

from ..models import Assessment, AssessmentAttempt, AssessmentKind, AssessmentStatus, AttemptStatus, Generator, ResultsRelease
from .evaluation import evaluate_subjective
from .generation import generate_questions, normalize_questions


# Fields a caller may set directly on create, generate or update.
RELEASE_FIELDS = ("instructions", "max_attempts", "time_limit_minutes", "available_from", "due_at",
                  "results_release", "results_release_at")


# ---------- scoping ----------

def manageable(user):
    from academics.models import Subject
    return Assessment.objects.filter(subject__in=Subject.objects.visible_to(user)).select_related("subject", "module", "chapter", "created_by")


def student_visible(student):
    """Published quizzes on open modules (or chapters with at least one open
    module) in published documents of active enrollments, inside their window."""
    now = timezone.now()
    open_modules = learning.student_module_queryset(student).filter(availability="open")
    qs = Assessment.objects.filter(status=AssessmentStatus.PUBLISHED).filter(
        models_q_module_or_chapter(open_modules)
    ).exclude(available_from__gt=now)
    # A selection quiz asks about every module it was written from, so one
    # locked module hides the whole quiz. Expressed as: drop any selection
    # that has a source module the student cannot open.
    incomplete = Assessment.objects.filter(
        kind=AssessmentKind.SELECTION,
        source_modules__in=Module.objects.exclude(pk__in=open_modules.values("pk")),
    ).values("pk")
    qs = qs.exclude(pk__in=incomplete)
    return qs.select_related("module", "chapter", "subject").distinct()


def models_q_module_or_chapter(open_modules):
    from django.db.models import Q
    return (Q(module__in=open_modules)
            | Q(module__isnull=True, chapter__modules__in=open_modules)
            | Q(kind=AssessmentKind.SELECTION, source_modules__in=open_modules))


def _require_manage(actor, subject):
    if not faculty_manages_subject(actor, subject):
        raise Forbidden("You do not manage this subject.", code="SUBJECT_NOT_ASSIGNED")


def _target(actor, module_id=None, chapter_id=None, module_ids=None):
    """Resolve what a quiz is written from.

    Three shapes, in the order they are checked: a set of chosen modules
    (`module_ids`), one module, or one chapter. A selection keeps `chapter`
    set when every chosen module shares one, so existing chapter-scoped
    queries and analytics still find it, and null when it spans chapters.

    Returns (subject, chapter, module, source_text, title, kind, modules).
    """
    from academics.models import Subject
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
            return m.chapter.document.subject, m.chapter, m, m.source_text, m.title, AssessmentKind.MODULE, [m]
        chapters = {m.chapter_id for m in modules}
        chapter = modules[0].chapter if len(chapters) == 1 else None
        text = "\n\n".join(m.source_text for m in modules if m.source_text)
        if not text.strip():
            raise ValidationFailed("None of the chosen modules has source text.", code="NO_SOURCE")
        title = chapter.title if chapter else f"{len(modules)} modules"
        return modules[0].chapter.document.subject, chapter, None, text, title, AssessmentKind.SELECTION, modules
    if module_id:
        try:
            module = Module.objects.select_related("chapter__document__subject").get(pk=module_id, chapter__document__subject__in=subjects)
        except (Module.DoesNotExist, ValueError):
            raise NotFound("Module not found.")
        return module.chapter.document.subject, module.chapter, module, module.source_text, module.title, AssessmentKind.MODULE, [module]
    if chapter_id:
        try:
            chapter = Chapter.objects.select_related("document__subject").prefetch_related("modules").get(pk=chapter_id, document__subject__in=subjects)
        except (Chapter.DoesNotExist, ValueError):
            raise NotFound("Chapter not found.")
        text = "\n\n".join(m.source_text for m in chapter.modules.all() if m.source_text) or chapter.source_text
        return chapter.document.subject, chapter, None, text, chapter.title, AssessmentKind.CHAPTER, list(chapter.modules.all())
    raise ValidationFailed("module_ids, module_id or chapter_id is required.", code="TARGET_REQUIRED")


def source_text_for(assessment):
    """The text a quiz was written from, for any kind (module, chapter or a
    selection that may span chapters). Public so the tutor's remediation uses
    the same rule as grading."""
    return _source_text(assessment)


def _source_text(assessment):
    if assessment.kind == AssessmentKind.SELECTION:
        chosen = assessment.source_modules.all().order_by("chapter__order", "order")
        text = "\n\n".join(m.source_text for m in chosen if m.source_text)
        if text.strip():
            return text
    if assessment.module:
        return assessment.module.source_text
    chapter = assessment.chapter
    if chapter is None:
        return ""
    return "\n\n".join(m.source_text for m in chapter.modules.all() if m.source_text) or chapter.source_text


# ---------- authoring ----------

@transaction.atomic
def create_manual(actor, *, module_id=None, chapter_id=None, module_ids=None, title=None, questions, pass_percentage=None, request=None, **options):
    subject, chapter, module, _, default_title, kind, modules = _target(actor, module_id, chapter_id, module_ids)
    _require_manage(actor, subject)
    assessment = Assessment.objects.create(
        subject=subject, chapter=chapter, module=module, kind=kind, title=(title or f"Quiz: {default_title}")[:300],
        questions=normalize_questions(questions), generator=Generator.MANUAL, created_by=actor,
        pass_percentage=pass_percentage or settings.LOCALMIND["DEFAULT_PASS_PERCENTAGE"],
        content_version_at_creation=(chapter or modules[0].chapter).document.content_version,
        **{k: v for k, v in options.items() if k in RELEASE_FIELDS},
    )
    if kind == AssessmentKind.SELECTION:
        assessment.source_modules.set(modules)
    audit.record(actor, "quiz.created", assessment, {"kind": kind, "questions": len(assessment.questions), "modules": len(modules)}, request)
    return assessment


def generate(actor, *, module_id=None, chapter_id=None, module_ids=None, num_mcqs=6, num_subjective=0, title=None, pass_percentage=None, request=None, **options):
    """The question-generation model call runs outside any transaction so the
    SQLite write lock is not held for the length of the call."""
    subject, chapter, module, source_text, default_title, kind, modules = _target(actor, module_id, chapter_id, module_ids)
    _require_manage(actor, subject)
    if num_mcqs + num_subjective <= 0 or num_mcqs > 30 or num_subjective > 10:
        raise ValidationFailed("Ask for 1-30 MCQs and 0-10 subjective questions.", code="INVALID_COUNTS")
    # Exclude what the last few quizzes on the same material already asked. A
    # selection is matched on its modules, so regenerating over the same set
    # does not repeat itself.
    if kind == AssessmentKind.SELECTION:
        recent = Assessment.objects.filter(source_modules__in=modules).distinct().order_by("-created_at")[:5]
    else:
        recent = Assessment.objects.filter(module=module, chapter=chapter).order_by("-created_at")[:5]
    previous = [q for a in recent for q in a.questions]
    # Questions are written from exactly the modules resolved above (the
    # chosen ones, the one module, or the chapter's modules), spread across
    # them. Nothing is created when no question could be written: there is no
    # placeholder draft any more (QuizGenerationFailed reaches the client).
    questions, error = generate_questions(modules, num_mcqs, num_subjective, previous)
    generator = Generator.AI
    with transaction.atomic():
        assessment = Assessment.objects.create(
            subject=subject, chapter=chapter, module=module, kind=kind, title=(title or f"Quiz: {default_title}")[:300],
            questions=questions, generator=generator, created_by=actor,
            pass_percentage=pass_percentage or settings.LOCALMIND["DEFAULT_PASS_PERCENTAGE"],
            content_version_at_creation=(chapter or modules[0].chapter).document.content_version,
            **{k: v for k, v in options.items() if k in RELEASE_FIELDS},
        )
        if kind == AssessmentKind.SELECTION:
            assessment.source_modules.set(modules)
        audit.record(actor, "quiz.generated", assessment, {"generator": generator, "ai_error": error[:200], "questions": len(questions)}, request)
    return assessment, error


CLEARABLE = ("max_attempts", "time_limit_minutes", "available_from", "due_at", "results_release_at")


@transaction.atomic
def update(actor, assessment, *, questions=None, request=None, **fields):
    _require_manage(actor, assessment.subject)
    if assessment.status in (AssessmentStatus.SUPERSEDED,):
        raise Conflict("This version has been superseded.", code="SUPERSEDED")
    changes = {}
    for key in ("title", "instructions", "pass_percentage", "max_attempts", "time_limit_minutes", "available_from", "due_at",
                "results_release", "results_release_at"):
        if key not in fields or fields[key] == getattr(assessment, key):
            continue
        # null clears the limits and dates that may be empty; the others keep their value.
        if fields[key] is None and key not in CLEARABLE:
            continue
        changes[key] = True
        setattr(assessment, key, fields[key])
    if questions is not None and normalize_questions(questions) == (assessment.questions or []):
        questions = None  # the same questions sent back with a settings change: nothing to version
    if questions is not None:
        new_questions = normalize_questions(questions)
        if assessment.attempts.exists():
            # Attempts exist: freeze this row, spawn a new version.
            # Settings changed in the same save apply to the old row's values before they are copied.
            old = Assessment.objects.get(pk=assessment.pk)
            sources = list(old.source_modules.all())
            anchor = old.chapter or (old.module.chapter if old.module_id else None) or (sources[0].chapter if sources else None)
            old.status = AssessmentStatus.SUPERSEDED
            old.save(update_fields=["status", "updated_at"])
            assessment = Assessment.objects.create(
                subject=old.subject, chapter=old.chapter, module=old.module, kind=old.kind, title=old.title,
                instructions=old.instructions, questions=new_questions, generator=Generator.MANUAL, status=AssessmentStatus.DRAFT,
                pass_percentage=old.pass_percentage, max_attempts=old.max_attempts, time_limit_minutes=old.time_limit_minutes,
                available_from=old.available_from, due_at=old.due_at, version=old.version + 1, supersedes=old,
                results_release=old.results_release, results_release_at=old.results_release_at,
                created_by=actor,
                content_version_at_creation=anchor.document.content_version if anchor else old.content_version_at_creation,
            )
            if sources:
                assessment.source_modules.set(sources)
            for key in changes:
                setattr(assessment, key, fields[key])
            assessment.save()
            audit.record(actor, "quiz.new_version", assessment, {"supersedes": str(old.id), "version": assessment.version}, request)
            return assessment
        assessment.questions = new_questions
        assessment.generator = Generator.MANUAL if assessment.generator != Generator.MANUAL else assessment.generator
        changes["questions"] = True
    if changes:
        assessment.save()
        audit.record(actor, "quiz.updated", assessment, changes, request)
    return assessment


@transaction.atomic
def set_status(actor, assessment, status, request=None):
    _require_manage(actor, assessment.subject)
    if status == AssessmentStatus.PUBLISHED:
        if assessment.status not in (AssessmentStatus.DRAFT, AssessmentStatus.CLOSED):
            raise Conflict("Only drafts or closed quizzes can be published.", code="INVALID_STATE")
        if not assessment.questions:
            raise Conflict("Add questions before publishing.", code="NO_QUESTIONS")
        if assessment.generator == Generator.FALLBACK and any("Placeholder distractor" in o["text"] for q in assessment.questions if q["type"] == "mcq" for o in q["options"]):
            raise Conflict("Fallback-generated questions contain placeholders; edit them before publishing.", code="PLACEHOLDER_QUESTIONS")
        assessment.status, assessment.published_at = status, timezone.now()
        # Publishing by hand is the review a held automatic quiz was waiting for.
        assessment.held_for_review, assessment.hold_reason = False, ""
        learning.open_target_modules(actor, assessment, "quiz.published", request)
    elif status == AssessmentStatus.CLOSED:
        if assessment.status != AssessmentStatus.PUBLISHED:
            raise Conflict("Only published quizzes can be closed.", code="INVALID_STATE")
        assessment.status, assessment.closed_at = status, timezone.now()
    else:
        raise ValidationFailed(details={"status": "Use 'published' or 'closed'."})
    assessment.save()
    audit.record(actor, f"quiz.{status}", assessment, {}, request)
    return assessment


@transaction.atomic
def delete(actor, assessment, request=None):
    """Permanently remove a quiz and every attempt made on it.

    Attempts point at the quiz with PROTECT, so they go first. A quiz that was
    superseded by a newer version is referenced by that version through a
    self-relation, which is SET_NULL and needs no special handling.
    """
    _require_manage(actor, assessment.subject)
    label = assessment.title
    attempts = AssessmentAttempt.objects.filter(assessment=assessment).count()
    AssessmentAttempt.objects.filter(assessment=assessment).delete()
    audit.record(actor, "quiz.deleted", assessment, {"title": label, "subject": assessment.subject.code, "attempts": attempts}, request)
    from .auto_quiz import dismiss_for
    dismiss_for(assessment)
    assessment.delete()
    return label


# ---------- attempts ----------

def _accessible_for_student(student, assessment_id):
    try:
        return student_visible(student).get(pk=assessment_id)
    except (Assessment.DoesNotExist, ValueError):
        raise NotFound("Quiz not found.")


@transaction.atomic
def start_attempt(student, assessment_id, request=None):
    assessment = _accessible_for_student(student, assessment_id)
    if assessment.module:
        learning.resolve_accessible_module(student, assessment.module_id)  # raises MODULE_LOCKED etc.
    now = timezone.now()
    if assessment.due_at and now > assessment.due_at:
        raise Conflict("This quiz is past its due date.", code="QUIZ_CLOSED")
    open_attempt = AssessmentAttempt.objects.filter(assessment=assessment, student=student, status=AttemptStatus.IN_PROGRESS).first()
    if open_attempt:
        return open_attempt, False
    used = AssessmentAttempt.objects.filter(assessment=assessment, student=student).count()
    if assessment.max_attempts and used >= assessment.max_attempts:
        raise Conflict("You have used all attempts for this quiz.", code="MAX_ATTEMPTS_REACHED")
    attempt = AssessmentAttempt.objects.create(assessment=assessment, student=student, attempt_number=used + 1,
                                               total_questions=len(assessment.questions))
    audit.record(student, "quiz.attempt_started", attempt, {"assessment": str(assessment.id), "attempt": attempt.attempt_number}, request)
    return attempt, True


def student_questions(assessment):
    out = []
    for q in assessment.questions:
        item = {"id": q["id"], "type": q["type"], "question": q["question"]}
        if q["type"] == "mcq":
            item["options"] = q["options"]
        out.append(item)
    return out


def _grade(assessment, submitted_answers):
    """Deterministic MCQ grading; subjective via evaluator. Returns (score, results, pending)."""
    source = _source_text(assessment)
    score, results, pending = 0.0, [], False
    for q in assessment.questions:
        qid = q["id"]
        answer = submitted_answers.get(qid, "")
        if q["type"] == "mcq":
            selected = str(answer or "").strip().upper()
            correct = selected == q["correct_answer"]
            score += 1.0 if correct else 0.0
            results.append({"question_id": qid, "type": "mcq", "question": q["question"], "selected_option": selected,
                            "correct_option": q["correct_answer"], "is_correct": correct, "score_awarded": 1.0 if correct else 0.0,
                            "explanation": q.get("explanation", ""), "source_reference": q.get("source_reference", "")})
        else:
            text = str(answer or "")
            ev, ok = evaluate_subjective(source, q["question"], q["expected_rubric"], text)
            row = {"question_id": qid, "type": "subjective", "question": q["question"], "student_answer": text,
                   "expected_rubric": q["expected_rubric"], "source_reference": q.get("source_reference", "")}
            if ok:
                row.update({"is_correct": ev["is_correct"], "score_awarded": ev["score_awarded"], "feedback": ev["feedback"],
                            "missing_points": ev["missing_points"], "evaluator": ev["evaluator"], "evaluation_status": "evaluated"})
                score += ev["score_awarded"]
            else:
                pending = True
                row.update({"is_correct": None, "score_awarded": None, "feedback": "", "missing_points": [],
                            "evaluation_status": "pending", "evaluation_error": ev.get("error", "")})
            results.append(row)
    return score, results, pending


def _finalize(attempt, score, results, pending, actor=None):
    assessment = attempt.assessment
    total = len(assessment.questions)
    attempt.score = round(score, 2)
    attempt.total_questions = total
    attempt.detailed_results = results
    if pending:
        attempt.status = AttemptStatus.PENDING_EVALUATION
        attempt.percentage, attempt.passed = None, None
    else:
        attempt.percentage = round(score / total * 100.0, 1) if total else 0.0
        attempt.passed = attempt.percentage >= assessment.pass_percentage
        attempt.status = AttemptStatus.EVALUATED
        attempt.evaluated_at = timezone.now()
        attempt.evaluated_by = actor
        apply_outcome(attempt, save=False)
    attempt.save()
    return attempt


def apply_outcome(attempt, save=True):
    """Write an evaluated attempt into ModuleProgress, but only once the student
    may see the result. Before this change progress was written at grading
    time, so a held quiz still turned the module to "needs review" and set the
    best percentage the student could read on the module page. Returns True
    when progress was written."""
    assessment = attempt.assessment
    if attempt.status != AttemptStatus.EVALUATED or not assessment.module_id or not attempt.results_visible:
        return False
    learning.record_quiz_outcome(attempt.student, assessment.module, attempt.percentage, attempt.passed,
                                 count_attempt=attempt.outcome_recorded_at is None)
    attempt.outcome_recorded_at = timezone.now()
    if save:
        attempt.save(update_fields=["outcome_recorded_at", "updated_at"])
    return True


def settle_released_outcomes(student=None, assessment=None):
    """Record every evaluated, now-visible attempt whose outcome has not been
    written yet: after a faculty release, or once a scheduled time passes."""
    from ..models import results_visible_q

    qs = AssessmentAttempt.objects.filter(status=AttemptStatus.EVALUATED, outcome_recorded_at__isnull=True,
                                          assessment__module__isnull=False)
    if student is not None:
        qs = qs.filter(student=student)
    if assessment is not None:
        qs = qs.filter(assessment=assessment)
    qs = qs.filter(results_visible_q()).select_related("assessment__module", "student").order_by("submitted_at")
    count = 0
    for attempt in qs:
        with transaction.atomic():
            count += apply_outcome(attempt)
    return count


def submit_attempt(student, attempt_id, submitted_answers, request=None):
    """Two short transactions with the grading step between them.

    The first records the answers and moves the attempt to SUBMITTED, which
    is what makes a duplicate submit fail with ALREADY_SUBMITTED. Grading may
    call the model once per subjective question, so it runs with no
    transaction open; the second transaction stores the result. If grading
    raises, the attempt stays SUBMITTED with its answers intact and can be
    re-evaluated by faculty.
    """
    if not isinstance(submitted_answers, dict):
        raise ValidationFailed(details={"submitted_answers": "Must be an object keyed by question id."})
    with transaction.atomic():
        try:
            attempt = AssessmentAttempt.objects.select_for_update(of=("self",)).select_related("assessment__module", "assessment__chapter").get(pk=attempt_id, student=student)
        except (AssessmentAttempt.DoesNotExist, ValueError):
            raise NotFound("Attempt not found.")
        if attempt.status != AttemptStatus.IN_PROGRESS:
            raise Conflict("This attempt has already been submitted.", code="ALREADY_SUBMITTED")
        now = timezone.now()
        elapsed = int((now - attempt.started_at).total_seconds())
        cap = settings.LOCALMIND["MAX_QUIZ_DURATION_HOURS"] * 3600
        attempt.submitted_at = now
        attempt.time_taken_seconds = max(0, min(elapsed, cap))
        attempt.submitted_answers = {str(k): (str(v) if v is not None else "") for k, v in submitted_answers.items()}
        limit = attempt.assessment.time_limit_minutes
        if limit and elapsed > limit * 60 + 60:
            attempt.evaluation_notes = {"late_by_seconds": elapsed - limit * 60}
        attempt.status = AttemptStatus.SUBMITTED
        attempt.save()
    score, results, pending = _grade(attempt.assessment, attempt.submitted_answers)
    with transaction.atomic():
        attempt = _finalize(attempt, score, results, pending)
        from activity.services import record_event
        record_event(student, "quiz", attempt.time_taken_seconds, subject=attempt.assessment.subject, module=attempt.assessment.module, reference_id=attempt.id)
        audit.record(student, "quiz.attempt_submitted", attempt, {"percentage": attempt.percentage, "status": attempt.status,
                                                                   "time_taken_seconds": attempt.time_taken_seconds}, request)
    return attempt


def withhold(attempt):
    """The student's view of their own attempt when results are not released.

    Grading is unchanged and the row keeps everything; this only decides what
    leaves the server. The student still learns the attempt was received and
    when, which is what stops them wondering whether it saved.
    """
    return {
        "id": str(attempt.id),
        "assessment_id": str(attempt.assessment_id),
        "attempt_number": attempt.attempt_number,
        "status": "submitted",
        "results_released": False,
        "submitted_at": attempt.submitted_at,
        "time_taken_seconds": attempt.time_taken_seconds,
        "score": None, "percentage": None, "passed": None, "detailed_results": [],
        "results_release": attempt.assessment.results_release,
        "results_release_at": attempt.assessment.results_release_at,
    }


@transaction.atomic
def release_results(actor, assessment, attempt_id=None, request=None):
    """Release held results, for the whole quiz or one attempt.

    Releasing is one-way. There is no un-release, because a student who has
    seen their score cannot unsee it, and a control that pretends otherwise
    would be a lie.
    """
    _require_manage(actor, assessment.subject)
    now = timezone.now()
    if attempt_id:
        try:
            attempt = assessment.attempts.get(pk=attempt_id)
        except (AssessmentAttempt.DoesNotExist, ValueError):
            raise NotFound("Attempt not found.")
        attempt.results_released_at = now
        attempt.save(update_fields=["results_released_at", "updated_at"])
        apply_outcome(attempt)
        audit.record(actor, "quiz.results_released", assessment, {"attempt": str(attempt.id)}, request)
        return 1
    count = assessment.attempts.filter(results_released_at__isnull=True).update(results_released_at=now)
    assessment.results_released_at = now
    assessment.results_released_by = actor
    assessment.save(update_fields=["results_released_at", "results_released_by", "updated_at"])
    settle_released_outcomes(assessment=assessment)
    audit.record(actor, "quiz.results_released", assessment, {"attempts": count, "scope": "all"}, request)
    return count


def with_list_counts(queryset):
    """Annotate what the quiz list shows for each quiz, so a page of quizzes
    is one query instead of two more per quiz."""
    from django.db.models import Count, Q
    return queryset.annotate(
        listed_attempt_count=Count("attempts", distinct=True),
        listed_unreleased_count=Count("attempts", distinct=True, filter=Q(attempts__results_released_at__isnull=True)
                                      & ~Q(attempts__status=AttemptStatus.IN_PROGRESS)),
    )


def pending_release_count(assessment):
    """Submitted attempts whose owner cannot yet see the outcome."""
    if assessment.results_release == ResultsRelease.IMMEDIATE or assessment.results_released_at:
        return 0
    if assessment.results_release == ResultsRelease.SCHEDULED and assessment.results_release_at and timezone.now() >= assessment.results_release_at:
        return 0
    counted = getattr(assessment, "listed_unreleased_count", None)
    if counted is not None:
        return counted
    return assessment.attempts.filter(results_released_at__isnull=True).exclude(status=AttemptStatus.IN_PROGRESS).count()


def re_evaluate(actor, attempt, overrides=None, request=None):
    """Faculty: re-run pending subjective items, or override scores per question.

    Model calls happen before the transaction opens (see submit_attempt)."""
    _require_manage(actor, attempt.assessment.subject)
    if attempt.status == AttemptStatus.IN_PROGRESS:
        raise Conflict("The attempt has not been submitted.", code="NOT_SUBMITTED")
    overrides = overrides or {}
    source = _source_text(attempt.assessment)
    score, pending = 0.0, False
    for row in attempt.detailed_results:
        qid = row["question_id"]
        if qid in overrides:
            awarded = float(overrides[qid].get("score_awarded", 0))
            row.update({"score_awarded": max(0.0, min(1.0, awarded)), "is_correct": awarded >= 1.0,
                        "feedback": overrides[qid].get("feedback", row.get("feedback", "")), "evaluator": f"faculty:{actor.email}",
                        "evaluation_status": "evaluated"})
        elif row["type"] == "subjective" and row.get("evaluation_status") == "pending":
            q = next(q for q in attempt.assessment.questions if q["id"] == qid)
            ev, ok = evaluate_subjective(source, q["question"], q["expected_rubric"], row.get("student_answer", ""))
            if ok:
                row.update({"is_correct": ev["is_correct"], "score_awarded": ev["score_awarded"], "feedback": ev["feedback"],
                            "missing_points": ev["missing_points"], "evaluator": ev["evaluator"], "evaluation_status": "evaluated"})
            else:
                pending = True
        score += row.get("score_awarded") or 0.0
    with transaction.atomic():
        attempt = _finalize(attempt, score, attempt.detailed_results, pending, actor=actor)
        audit.record(actor, "quiz.attempt_reevaluated", attempt, {"overrides": list(overrides.keys()), "status": attempt.status}, request)
    return attempt
