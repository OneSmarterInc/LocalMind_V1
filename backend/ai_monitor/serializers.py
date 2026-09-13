from rest_framework import serializers

from .models import Evaluation, Feedback, Incident, Policy


class _Person(serializers.Serializer):
    id = serializers.UUIDField()
    email = serializers.EmailField()
    full_name = serializers.CharField()
    role = serializers.CharField()


class _Subject(serializers.Serializer):
    id = serializers.UUIDField()
    code = serializers.CharField()
    name = serializers.CharField()


class FeedbackSerializer(serializers.ModelSerializer):
    reviewer = _Person(read_only=True)

    class Meta:
        model = Feedback
        fields = ["id", "label", "note", "reviewer", "created_at"]


class EvaluationSummarySerializer(serializers.ModelSerializer):
    """List shape: no excerpts, no evidence. Enough to filter and scan."""
    user = _Person(read_only=True)
    subject = _Subject(read_only=True)
    module_title = serializers.CharField(source="module.title", read_only=True, default="")
    has_incident = serializers.SerializerMethodField()

    class Meta:
        model = Evaluation
        fields = ["id", "interaction_kind", "interaction_id", "user", "subject", "module_title", "app_model_name", "verdict", "issue_type",
                  "severity", "confidence", "reason", "recommended_action", "judge_invoked", "judge_reason", "judge_model", "stage", "error",
                  "evaluator_version", "duration_ms", "has_incident", "created_at"]

    def get_has_incident(self, obj):
        return Incident.objects.filter(evaluation=obj).exists()


class EvaluationDetailSerializer(EvaluationSummarySerializer):
    """Detail shape: everything a reviewer needs to reproduce the verdict."""
    feedback = FeedbackSerializer(many=True, read_only=True)
    incident_id = serializers.SerializerMethodField()

    class Meta(EvaluationSummarySerializer.Meta):
        fields = EvaluationSummarySerializer.Meta.fields + ["prompt_excerpt", "response_excerpt", "evidence_json", "validators_json",
                                                              "judge_json", "judge_latency_ms", "judge_error", "feedback", "incident_id"]

    def get_incident_id(self, obj):
        row = Incident.objects.filter(evaluation=obj).only("id").first()
        return str(row.id) if row else None


class IncidentSerializer(serializers.ModelSerializer):
    evaluation = EvaluationSummarySerializer(read_only=True)
    user = _Person(read_only=True)
    subject = _Subject(read_only=True)
    assigned_to = _Person(read_only=True)
    resolved_by = _Person(read_only=True)

    class Meta:
        model = Incident
        fields = ["id", "issue_type", "severity", "status", "user", "subject", "assigned_to", "reviewer_note", "recurrence",
                  "resolved_by", "resolved_at", "evaluation", "created_at", "updated_at"]


class IncidentDetailSerializer(IncidentSerializer):
    evaluation = EvaluationDetailSerializer(read_only=True)


class PolicySerializer(serializers.ModelSerializer):
    updated_by = _Person(read_only=True)

    class Meta:
        model = Policy
        fields = ["id", "issue_type", "enabled", "min_confidence", "min_severity", "description", "version", "updated_by", "updated_at"]
