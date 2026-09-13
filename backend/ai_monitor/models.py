"""AI Monitoring & Guard data model.

Four tables, kept apart from the interaction tables they judge so the
evaluation history is auditable on its own and can be purged on its own
schedule:

* ``Evaluation``  one verdict per monitored interaction (tutor answer or
                  AI-generated quiz) per evaluator version. Stores the
                  bounded prompt/response excerpts, the reference evidence
                  the verdict was made against, every validator result and
                  the judge output, so a reviewer can reproduce the decision.
* ``Incident``    a human-reviewable record created only when the policy
                  thresholds are met. Carries the review lifecycle.
* ``Policy``      per-issue-type thresholds and routing, editable by admins,
                  so business rules are not hardcoded.
* ``Feedback``    reviewer labels (correct / false positive / needs
                  investigation) used to measure evaluator precision.
"""
from django.conf import settings
from django.db import models

from core.models import TimeStampedUUIDModel


class InteractionKind(models.TextChoices):
    TUTOR_ANSWER = "tutor_answer", "Tutor answer"
    QUIZ = "quiz", "AI-generated quiz"


class Verdict(models.TextChoices):
    PASS = "pass", "No issue found"
    ISSUE = "issue", "Issue found"
    ABSTAIN = "abstain", "Insufficient evidence"


class IssueType(models.TextChoices):
    NONE = "none", "None"
    HALLUCINATION = "hallucination", "Hallucination"
    FACTUAL_ERROR = "factual_error", "Factual error"
    UNSUPPORTED_CLAIM = "unsupported_claim", "Unsupported claim"
    INSTRUCTION_VIOLATION = "instruction_violation", "Instruction violation"
    QUIZ_ERROR = "quiz_error", "Quiz error"
    SAFETY = "safety", "Safety"
    IRRELEVANT = "irrelevant", "Irrelevant response"
    OTHER = "other", "Other"


# Issue types faculty may review: they concern academic content rather than
# platform behaviour.
ACADEMIC_ISSUE_TYPES = (IssueType.HALLUCINATION, IssueType.FACTUAL_ERROR, IssueType.UNSUPPORTED_CLAIM, IssueType.QUIZ_ERROR)


class Severity(models.TextChoices):
    LOW = "low", "Low"
    MEDIUM = "medium", "Medium"
    HIGH = "high", "High"
    CRITICAL = "critical", "Critical"


SEVERITY_RANK = {Severity.LOW: 1, Severity.MEDIUM: 2, Severity.HIGH: 3, Severity.CRITICAL: 4}


class EvaluationStage(models.TextChoices):
    PENDING = "pending", "Queued"
    DONE = "done", "Evaluated"
    FAILED = "failed", "Evaluator failed"


class RecommendedAction(models.TextChoices):
    REVIEW = "review", "Review"
    CORRECT_CONTENT = "correct_content", "Correct content"
    RETRAIN = "retrain/evaluate", "Retrain or re-evaluate model"
    NO_ACTION = "no_action", "No action"


class IncidentStatus(models.TextChoices):
    OPEN = "open", "Open"
    CONFIRMED = "confirmed", "Confirmed"
    FALSE_POSITIVE = "false_positive", "False positive"
    NEEDS_INVESTIGATION = "needs_investigation", "Needs investigation"
    ESCALATED = "escalated", "Escalated"
    CLOSED = "closed", "Closed"


class FeedbackLabel(models.TextChoices):
    CORRECT = "correct", "Verdict was correct"
    FALSE_POSITIVE = "false_positive", "False positive"
    NEEDS_INVESTIGATION = "needs_investigation", "Needs investigation"


class Evaluation(TimeStampedUUIDModel):
    interaction_kind = models.CharField(max_length=20, choices=InteractionKind.choices, db_index=True)
    interaction_id = models.UUIDField(db_index=True)
    # Soft links to the source rows. SET_NULL so deleting a conversation or a
    # quiz never erases the monitoring history.
    message = models.ForeignKey("tutor.Message", null=True, blank=True, on_delete=models.SET_NULL, related_name="monitor_evaluations")
    assessment = models.ForeignKey("assessments.Assessment", null=True, blank=True, on_delete=models.SET_NULL, related_name="monitor_evaluations")
    # The person the interaction concerns: the student who asked, or the
    # faculty member who generated the quiz.
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="monitor_evaluations")
    subject = models.ForeignKey("academics.Subject", null=True, blank=True, on_delete=models.SET_NULL, related_name="monitor_evaluations")
    module = models.ForeignKey("learning.Module", null=True, blank=True, on_delete=models.SET_NULL, related_name="monitor_evaluations")
    app_model_name = models.CharField(max_length=100, blank=True, db_index=True)

    # Bounded copies of what was judged (data minimisation, FR-01).
    prompt_excerpt = models.TextField(blank=True)
    response_excerpt = models.TextField(blank=True)
    # [{"kind": "chunk"|"source_text"|"answer_key", "ref": "...", "text": "..."}]
    evidence_json = models.JSONField(default=list, blank=True)
    # [{"name", "passed", "issue_type", "severity", "confidence", "detail", "evidence": [...]}]
    validators_json = models.JSONField(default=list, blank=True)

    judge_invoked = models.BooleanField(default=False)
    judge_reason = models.CharField(max_length=60, blank=True)  # suspicious | undecided | sampled | forced | ""
    judge_json = models.JSONField(default=dict, blank=True)
    judge_model = models.CharField(max_length=120, blank=True)
    judge_latency_ms = models.PositiveIntegerField(null=True, blank=True)
    judge_error = models.CharField(max_length=300, blank=True)

    verdict = models.CharField(max_length=10, choices=Verdict.choices, default=Verdict.PASS, db_index=True)
    issue_type = models.CharField(max_length=30, choices=IssueType.choices, default=IssueType.NONE, db_index=True)
    severity = models.CharField(max_length=10, choices=Severity.choices, default=Severity.LOW, db_index=True)
    confidence = models.FloatField(default=0.0)
    reason = models.TextField(blank=True)
    recommended_action = models.CharField(max_length=20, choices=RecommendedAction.choices, default=RecommendedAction.NO_ACTION)
    evaluator_version = models.CharField(max_length=20, db_index=True)
    stage = models.CharField(max_length=10, choices=EvaluationStage.choices, default=EvaluationStage.DONE, db_index=True)
    error = models.CharField(max_length=300, blank=True)
    duration_ms = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "ai_checks"
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["interaction_kind", "interaction_id", "evaluator_version"], name="uniq_evaluation_per_interaction_version")]
        indexes = [
            models.Index(fields=["verdict", "severity"]),
            models.Index(fields=["subject", "created_at"]),
            models.Index(fields=["app_model_name", "created_at"]),
        ]

    def __str__(self):
        return f"{self.interaction_kind} {self.interaction_id}: {self.verdict}/{self.issue_type}"

    @property
    def has_incident(self):
        return hasattr(self, "incident")


class Incident(TimeStampedUUIDModel):
    evaluation = models.OneToOneField(Evaluation, on_delete=models.CASCADE, related_name="incident")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="monitor_incidents")
    subject = models.ForeignKey("academics.Subject", null=True, blank=True, on_delete=models.SET_NULL, related_name="monitor_incidents")
    issue_type = models.CharField(max_length=30, choices=IssueType.choices, db_index=True)
    severity = models.CharField(max_length=10, choices=Severity.choices, db_index=True)
    status = models.CharField(max_length=25, choices=IncidentStatus.choices, default=IncidentStatus.OPEN, db_index=True)
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="assigned_monitor_incidents")
    reviewer_note = models.TextField(blank=True)
    # How many other incidents with the same issue type and module existed in
    # the recurrence window when this one was created; feeds severity (FR-07).
    recurrence = models.PositiveIntegerField(default=0)
    resolved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "ai_incidents"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["status", "severity"]), models.Index(fields=["subject", "status"])]

    def __str__(self):
        return f"{self.severity} {self.issue_type} ({self.status})"

    @property
    def is_resolved(self):
        return self.status in (IncidentStatus.CONFIRMED, IncidentStatus.FALSE_POSITIVE, IncidentStatus.CLOSED)


DEFAULT_POLICIES = {
    # issue_type: (enabled, min_confidence, min_severity, description)
    IssueType.HALLUCINATION: (True, 0.70, Severity.MEDIUM, "Claims contradicted by the reference material."),
    IssueType.FACTUAL_ERROR: (True, 0.70, Severity.MEDIUM, "Numbers, names or facts that disagree with the source."),
    IssueType.UNSUPPORTED_CLAIM: (True, 0.75, Severity.MEDIUM, "Answers marked grounded whose content the source does not support."),
    IssueType.INSTRUCTION_VIOLATION: (True, 0.80, Severity.LOW, "Wrong format, leaked schema fields, empty or truncated output."),
    IssueType.QUIZ_ERROR: (True, 0.70, Severity.MEDIUM, "Invalid options, placeholder distractors, unverifiable answer keys."),
    IssueType.SAFETY: (True, 0.50, Severity.LOW, "Content that should never reach a student."),
    IssueType.IRRELEVANT: (True, 0.80, Severity.LOW, "Answers that do not address the question asked."),
    IssueType.OTHER: (True, 0.85, Severity.MEDIUM, "Anything the judge could not classify."),
}


class Policy(TimeStampedUUIDModel):
    """When a verdict becomes an incident. One row per issue type."""

    issue_type = models.CharField(max_length=30, choices=IssueType.choices, unique=True)
    enabled = models.BooleanField(default=True)
    min_confidence = models.FloatField(default=0.7)
    min_severity = models.CharField(max_length=10, choices=Severity.choices, default=Severity.MEDIUM)
    description = models.CharField(max_length=300, blank=True)
    version = models.PositiveIntegerField(default=1)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        db_table = "ai_incident_rules"
        ordering = ["issue_type"]
        verbose_name_plural = "policies"

    def __str__(self):
        return f"{self.issue_type}: >= {self.min_confidence:.2f} confidence, >= {self.min_severity}"

    def admits(self, severity: str, confidence: float) -> bool:
        return self.enabled and confidence >= self.min_confidence and SEVERITY_RANK.get(severity, 0) >= SEVERITY_RANK.get(self.min_severity, 0)


class Feedback(TimeStampedUUIDModel):
    evaluation = models.ForeignKey(Evaluation, on_delete=models.CASCADE, related_name="feedback")
    incident = models.ForeignKey(Incident, null=True, blank=True, on_delete=models.SET_NULL, related_name="feedback")
    reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="monitor_feedback")
    label = models.CharField(max_length=25, choices=FeedbackLabel.choices, db_index=True)
    note = models.TextField(blank=True)

    class Meta:
        db_table = "ai_check_feedback"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.label} by {self.reviewer_id}"
