from django.contrib import admin

from .models import Evaluation, Feedback, Incident, Policy


@admin.register(Evaluation)
class EvaluationAdmin(admin.ModelAdmin):
    list_display = ("interaction_kind", "verdict", "issue_type", "severity", "confidence", "judge_invoked", "created_at")
    list_filter = ("interaction_kind", "verdict", "issue_type", "severity", "stage")
    readonly_fields = [f.name for f in Evaluation._meta.fields]


@admin.register(Incident)
class IncidentAdmin(admin.ModelAdmin):
    list_display = ("severity", "issue_type", "status", "user", "subject", "created_at")
    list_filter = ("severity", "issue_type", "status")


@admin.register(Policy)
class PolicyAdmin(admin.ModelAdmin):
    list_display = ("issue_type", "enabled", "min_confidence", "min_severity", "version")


@admin.register(Feedback)
class FeedbackAdmin(admin.ModelAdmin):
    list_display = ("label", "reviewer", "created_at")
