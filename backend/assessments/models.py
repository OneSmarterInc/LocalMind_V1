from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

from core.models import TimeStampedUUIDModel


class AssessmentKind(models.TextChoices):
    MODULE = "module", "Module quiz"
    CHAPTER = "chapter", "Chapter quiz"
    SELECTION = "selection", "Several chosen modules"


class ResultsRelease(models.TextChoices):
    """When a student may see the outcome of their own attempt.

    IMMEDIATE keeps the original behaviour: the result is part of the submit
    response. HELD shows the student only that the attempt was received until
    faculty release it. SCHEDULED releases without anyone pressing anything,
    the first time the student loads the page after the chosen moment, which
    needs no scheduler in a deployment that may have none.
    """

    IMMEDIATE = "immediate", "Shown on submission"
    HELD = "held", "Held until released"
    SCHEDULED = "scheduled", "Released at a set time"


class AssessmentStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    PUBLISHED = "published", "Published"
    CLOSED = "closed", "Closed"
    SUPERSEDED = "superseded", "Superseded by a newer version"


class Generator(models.TextChoices):
    AI = "ai", "AI generated"
    FALLBACK = "fallback", "Fallback generator"
    MANUAL = "manual", "Manually authored"


class Assessment(TimeStampedUUIDModel):
    """A quiz. Questions (with answers) are immutable once any attempt exists;
    editing then creates a new version row that supersedes this one."""

    subject = models.ForeignKey("academics.Subject", on_delete=models.PROTECT, related_name="assessments")
    chapter = models.ForeignKey("learning.Chapter", null=True, blank=True, on_delete=models.PROTECT, related_name="assessments")
    module = models.ForeignKey("learning.Module", null=True, blank=True, on_delete=models.PROTECT, related_name="assessments")
    # A quiz drawn from several chosen modules keeps `chapter` set to the
    # chapter they share (null when they span chapters) and lists every module
    # it was written from here. Module and chapter quizzes leave it empty.
    source_modules = models.ManyToManyField("learning.Module", blank=True, related_name="sourced_assessments", db_table="quiz_modules")
    # Written automatically for its module when the book was processed (see
    # assessments/services/auto_quiz.py), and published automatically when the
    # module is open to students. Faculty can edit, close or delete it like any
    # other quiz; deleting it stops it being generated again for that module.
    auto_generated = models.BooleanField(default=False, db_index=True)
    # Automatic quizzes are published without anyone reading them first, so
    # the AI monitor checks them before they go live. ``checked_at`` is when
    # the monitor last finished checking these questions (null: not yet).
    # ``held_for_review`` is set when that check raised a high-severity
    # incident; a held quiz stays a draft until faculty publish it themselves
    # or mark the incident a false positive.
    checked_at = models.DateTimeField(null=True, blank=True)
    held_for_review = models.BooleanField(default=False, db_index=True)
    hold_reason = models.CharField(max_length=300, blank=True)
    kind = models.CharField(max_length=12, choices=AssessmentKind.choices)
    title = models.CharField(max_length=300)
    instructions = models.TextField(blank=True)
    questions = models.JSONField(default=list)  # private: includes correct answers and rubrics
    generator = models.CharField(max_length=10, choices=Generator.choices, default=Generator.MANUAL)
    status = models.CharField(max_length=12, choices=AssessmentStatus.choices, default=AssessmentStatus.DRAFT, db_index=True)
    pass_percentage = models.PositiveSmallIntegerField(default=65)
    max_attempts = models.PositiveSmallIntegerField(null=True, blank=True)  # null = unlimited
    time_limit_minutes = models.PositiveSmallIntegerField(null=True, blank=True)
    available_from = models.DateTimeField(null=True, blank=True)
    due_at = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    supersedes = models.OneToOneField("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="superseded_by")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    published_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    content_version_at_creation = models.PositiveIntegerField(default=1)
    results_release = models.CharField(max_length=12, choices=ResultsRelease.choices, default=ResultsRelease.IMMEDIATE)
    results_release_at = models.DateTimeField(null=True, blank=True)   # used by SCHEDULED
    results_released_at = models.DateTimeField(null=True, blank=True)  # set when faculty release the whole quiz
    results_released_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "quizzes"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["subject", "status"]), models.Index(fields=["module", "status"])]

    def __str__(self):
        return f"{self.title} v{self.version}"

    @property
    def question_count(self):
        return len(self.questions or [])


def results_visible_q(prefix: str = "", now=None) -> Q:
    """Query form of ``AssessmentAttempt.results_visible``.

    ``prefix`` is the path from the queried model to the attempt ("" when
    querying attempts directly). Every student-facing aggregate filters with
    this, so a held score cannot reach a student through an average, a count
    or a progress row when the attempt screen itself withholds it.
    """
    now = now or timezone.now()
    a = f"{prefix}assessment__"
    return (Q(**{f"{a}results_release": ResultsRelease.IMMEDIATE})
            | Q(**{f"{prefix}results_released_at__isnull": False})
            | Q(**{f"{a}results_released_at__isnull": False})
            | Q(**{f"{a}results_release": ResultsRelease.SCHEDULED, f"{a}results_release_at__lte": now}))


class AttemptStatus(models.TextChoices):
    IN_PROGRESS = "in_progress", "In progress"
    SUBMITTED = "submitted", "Submitted"
    PENDING_EVALUATION = "pending_evaluation", "Pending subjective evaluation"
    EVALUATED = "evaluated", "Evaluated"


class AssessmentAttempt(TimeStampedUUIDModel):
    """Immutable historical record of one student sitting one assessment version."""

    assessment = models.ForeignKey(Assessment, on_delete=models.PROTECT, related_name="attempts")
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="assessment_attempts")
    attempt_number = models.PositiveSmallIntegerField()
    status = models.CharField(max_length=20, choices=AttemptStatus.choices, default=AttemptStatus.IN_PROGRESS, db_index=True)
    started_at = models.DateTimeField(auto_now_add=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    time_taken_seconds = models.PositiveIntegerField(null=True, blank=True)
    submitted_answers = models.JSONField(default=dict)
    score = models.FloatField(null=True, blank=True)
    total_questions = models.PositiveSmallIntegerField(default=0)
    percentage = models.FloatField(null=True, blank=True)
    passed = models.BooleanField(null=True, blank=True)
    detailed_results = models.JSONField(default=list)
    evaluation_notes = models.JSONField(default=dict, blank=True)
    evaluated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    evaluated_at = models.DateTimeField(null=True, blank=True)
    # Set when this one attempt is released ahead of the rest.
    results_released_at = models.DateTimeField(null=True, blank=True)
    # When this attempt's outcome was written to the student's ModuleProgress.
    # Progress is only written once the result is visible to the student
    # (otherwise "needs review" and the best percentage would reveal a held
    # score), and only counted once, so a faculty re-evaluation of an attempt
    # that was already recorded updates the progress row without inflating
    # quiz_attempts.
    outcome_recorded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "quiz_attempts"
        ordering = ["-started_at"]
        constraints = [models.UniqueConstraint(fields=["assessment", "student", "attempt_number"], name="uniq_attempt_number")]
        indexes = [models.Index(fields=["student", "status"])]

    def __str__(self):
        return f"{self.student.email} attempt {self.attempt_number} on {self.assessment.title}"

    @property
    def results_visible(self):
        """Whether the student who owns this attempt may see its outcome."""
        mode = self.assessment.results_release
        if mode == ResultsRelease.IMMEDIATE:
            return True
        if self.results_released_at or self.assessment.results_released_at:
            return True
        if mode == ResultsRelease.SCHEDULED and self.assessment.results_release_at:
            return timezone.now() >= self.assessment.results_release_at
        return False


class AutoQuizStatus(models.TextChoices):
    PENDING = "pending", "Waiting to be generated"
    GENERATING = "generating", "Being generated"
    READY = "ready", "Ready"
    FAILED = "failed", "Generation failed"
    DISMISSED = "dismissed", "Deleted by faculty; not generated again"


class AutoQuizJob(TimeStampedUUIDModel):
    """One per module: the background job that writes the module's automatic
    quiz. Same contract as tutor.ModuleLesson: ``source_hash`` is the text the
    quiz belongs to, ``version`` is bumped on every state change and claims and
    completions are conditional on it, so edits during generation win and two
    processes never write the same quiz."""

    module = models.OneToOneField("learning.Module", on_delete=models.CASCADE, related_name="auto_quiz_job")
    assessment = models.ForeignKey(Assessment, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    status = models.CharField(max_length=12, choices=AutoQuizStatus.choices, default=AutoQuizStatus.PENDING, db_index=True)
    source_hash = models.CharField(max_length=64, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    last_error = models.CharField(max_length=300, blank=True)
    note = models.CharField(max_length=300, blank=True)
    requested_at = models.DateTimeField(null=True, blank=True)
    claimed_at = models.DateTimeField(null=True, blank=True)
    generated_at = models.DateTimeField(null=True, blank=True)
    next_attempt_at = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "auto_quiz_jobs"
        indexes = [models.Index(fields=["status", "next_attempt_at"], name="assess_autoquiz_queue_idx")]

