from rest_framework import serializers
from .models import Assessment, AssessmentAttempt


class AssessmentSerializer(serializers.ModelSerializer):
    """Faculty/admin view: includes answers."""
    subject_id = serializers.UUIDField(read_only=True)
    source_module_ids = serializers.SerializerMethodField()
    pending_release_count = serializers.SerializerMethodField()
    chapter_id = serializers.UUIDField(read_only=True)
    module_id = serializers.UUIDField(read_only=True)
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True, default="")
    question_count = serializers.IntegerField(read_only=True)
    attempt_count = serializers.SerializerMethodField()
    hold_incident_id = serializers.SerializerMethodField()
    hold_details = serializers.SerializerMethodField()

    class Meta:
        model = Assessment
        fields = ["id", "subject_id", "chapter_id", "module_id", "kind", "title", "instructions", "questions", "generator", "status",
                  "pass_percentage", "max_attempts", "time_limit_minutes", "available_from", "due_at", "version", "supersedes",
                  "created_by_name", "published_at", "closed_at", "question_count", "attempt_count", "created_at", "updated_at",
                  "source_module_ids", "results_release", "results_release_at", "results_released_at", "pending_release_count",
                  "auto_generated", "checked_at", "held_for_review", "hold_reason", "hold_incident_id", "hold_details"]

    def get_hold_details(self, a) -> dict | None:
        """What the monitor actually flagged on a held quiz: the question(s) its failing checks name, the
        findings, and the source passages it compared against.

        Quiz checks list the questions they flag by id (``"<id>: problem"``, or the bare id), falling back
        to ``q<n>`` for questions without an id. Only those references count, so a finding about one question
        never flags the others. ``question_ids`` is empty when no failing check names a question (for
        example a judge-only finding); the screen then says the question is not identified."""
        if not a.held_for_review:
            return None
        from ai_monitor.models import Evaluation
        ev = Evaluation.objects.filter(assessment=a).exclude(verdict="pass").order_by("-created_at").first()
        if ev is None:
            return {"question_ids": [], "evidence": [], "findings": []}
        failing = [v for v in (ev.validators_json or []) if v.get("passed") is False]
        labels = {}
        for n, q in enumerate(a.questions or [], start=1):
            if q.get("id"):
                labels[str(q["id"])] = q["id"]
            labels.setdefault(f"q{n}", q.get("id"))
        flagged = []
        for v in failing:
            for item in (v.get("evidence") or []):
                ref = str(item).split(":", 1)[0].strip()
                qid = labels.get(ref)
                if qid and qid not in flagged:
                    flagged.append(qid)
        return {
            "question_ids": flagged,
            "evidence": [{"ref": e.get("ref", ""), "text": e.get("text", "")} for e in (ev.evidence_json or [])][:5],
            "findings": [{"name": v.get("name", ""), "detail": v.get("detail", ""), "questions": [labels[r] for r in
                          (str(i).split(":", 1)[0].strip() for i in (v.get("evidence") or [])) if labels.get(r)]} for v in failing][:5],
            "reason": ev.reason or "",
        }

    def get_hold_incident_id(self, a) -> str | None:
        """The AI monitor incident a held automatic quiz is waiting on, so the
        quiz screen can release it as a false alarm. Only looked up for held
        quizzes."""
        if not a.held_for_review:
            return None
        from ai_monitor.models import Incident

        from .services.auto_quiz import HOLD_SEVERITIES, HOLD_STATUSES
        incident = (Incident.objects.filter(evaluation__assessment=a, severity__in=HOLD_SEVERITIES, status__in=HOLD_STATUSES)
                    .order_by("-created_at").values_list("id", flat=True).first())
        return str(incident) if incident else None

    def get_attempt_count(self, a) -> int:
        counted = getattr(a, "listed_attempt_count", None)
        return counted if counted is not None else a.attempts.count()

    def get_source_module_ids(self, a) -> list:
        return [str(m.id) for m in a.source_modules.all()]

    def get_pending_release_count(self, a) -> int:
        from .services import assessments as svc
        return svc.pending_release_count(a)


class AssessmentStudentSerializer(serializers.ModelSerializer):
    """Student view: no answers."""
    subject_id = serializers.UUIDField(read_only=True)
    module_id = serializers.UUIDField(read_only=True)
    chapter_id = serializers.UUIDField(read_only=True)
    question_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Assessment
        fields = ["id", "subject_id", "module_id", "chapter_id", "kind", "title", "instructions", "pass_percentage", "max_attempts",
                  "time_limit_minutes", "available_from", "due_at", "question_count", "version",
                  "results_release", "results_release_at", "auto_generated"]


class AttemptSerializer(serializers.ModelSerializer):
    assessment_id = serializers.UUIDField(read_only=True)
    assessment_title = serializers.CharField(source="assessment.title", read_only=True)
    student_id = serializers.UUIDField(read_only=True)
    student_email = serializers.EmailField(source="student.email", read_only=True)
    student_name = serializers.CharField(source="student.full_name", read_only=True, default="")

    class Meta:
        model = AssessmentAttempt
        fields = ["id", "assessment_id", "assessment_title", "student_id", "student_email", "student_name", "attempt_number", "status",
                  "started_at", "submitted_at", "time_taken_seconds", "score", "total_questions", "percentage", "passed",
                  "detailed_results", "evaluation_notes", "evaluated_at", "results_released_at"]


class QuestionInSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=["mcq", "subjective"], default="mcq")
    question = serializers.CharField()
    options = serializers.ListField(child=serializers.DictField(), required=False)
    correct_answer = serializers.CharField(required=False)
    explanation = serializers.CharField(required=False, allow_blank=True)
    expected_rubric = serializers.CharField(required=False, allow_blank=True)
    source_reference = serializers.CharField(required=False, allow_blank=True)


class _ReleaseMixin(serializers.Serializer):
    results_release = serializers.ChoiceField(choices=["immediate", "held", "scheduled"], required=False)
    results_release_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate(self, data):
        data = super().validate(data)
        if data.get("results_release") == "scheduled" and not data.get("results_release_at"):
            raise serializers.ValidationError({"results_release_at": "A release time is required when results are scheduled."})
        return data


class _OptionsMixin(_ReleaseMixin):
    title = serializers.CharField(max_length=300, required=False)
    instructions = serializers.CharField(required=False, allow_blank=True)
    pass_percentage = serializers.IntegerField(min_value=1, max_value=100, required=False)
    max_attempts = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    time_limit_minutes = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    available_from = serializers.DateTimeField(required=False, allow_null=True)
    due_at = serializers.DateTimeField(required=False, allow_null=True)


class CreateManualSerializer(_OptionsMixin):
    module_id = serializers.UUIDField(required=False)
    chapter_id = serializers.UUIDField(required=False)
    module_ids = serializers.ListField(child=serializers.UUIDField(), required=False, min_length=1, max_length=40)
    questions = QuestionInSerializer(many=True)


class GenerateSerializer(_OptionsMixin):
    module_id = serializers.UUIDField(required=False)
    chapter_id = serializers.UUIDField(required=False)
    module_ids = serializers.ListField(child=serializers.UUIDField(), required=False, min_length=1, max_length=40)
    num_mcqs = serializers.IntegerField(min_value=0, max_value=30, default=6)
    num_subjective = serializers.IntegerField(min_value=0, max_value=10, default=0)


class UpdateSerializer(_OptionsMixin):
    questions = QuestionInSerializer(many=True, required=False)


class StatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["published", "closed"])


class SubmitSerializer(serializers.Serializer):
    submitted_answers = serializers.DictField(child=serializers.CharField(allow_blank=True))


class ReEvaluateSerializer(serializers.Serializer):
    overrides = serializers.DictField(child=serializers.DictField(), required=False)


class ReleaseResultsSerializer(serializers.Serializer):
    """Release every held attempt, or one named attempt."""

    attempt_id = serializers.UUIDField(required=False)
