"""Apply the new review rule to automatic quizzes that already exist.

Separate from 0005 so no migration mixes table and row changes (PostgreSQL).

* An automatic quiz the AI monitor has already evaluated is marked checked.
* One whose evaluation raised a high or critical incident that is still open
  or confirmed, and that no student has attempted, is held: set back to draft
  with the reason recorded, so students stop seeing it until faculty review it.
* Quizzes nobody has evaluated yet stay unchecked; the application sends them
  for checking when it starts.
"""
from django.db import migrations
from django.utils import timezone

HOLD_SEVERITIES = ("high", "critical")
HOLD_STATUSES = ("open", "confirmed", "needs_investigation", "escalated")


def hold_flagged(apps, schema_editor):
    Assessment = apps.get_model("assessments", "Assessment")
    AssessmentAttempt = apps.get_model("assessments", "AssessmentAttempt")
    Evaluation = apps.get_model("ai_monitor", "Evaluation")
    Incident = apps.get_model("ai_monitor", "Incident")
    now = timezone.now()
    for quiz in Assessment.objects.filter(auto_generated=True).exclude(status="superseded"):
        evaluations = Evaluation.objects.filter(assessment=quiz)
        if not evaluations.exists():
            continue
        quiz.checked_at = evaluations.order_by("-updated_at").values_list("updated_at", flat=True).first() or now
        incident = (Incident.objects.filter(evaluation__in=evaluations, severity__in=HOLD_SEVERITIES, status__in=HOLD_STATUSES)
                    .order_by("-created_at").first())
        fields = ["checked_at"]
        if incident and not AssessmentAttempt.objects.filter(assessment=quiz).exists():
            quiz.held_for_review = True
            quiz.hold_reason = f"AI monitor: {incident.issue_type.replace('_', ' ')} ({incident.severity})"[:300]
            fields += ["held_for_review", "hold_reason"]
            if quiz.status == "published":
                quiz.status = "draft"
                fields.append("status")
        quiz.save(update_fields=fields)


class Migration(migrations.Migration):

    dependencies = [
        ("assessments", "0005_auto_quiz_review_hold"),
        ("ai_monitor", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(hold_flagged, migrations.RunPython.noop),
    ]
