"""Apply the module completion rule to progress written before it existed.

A module is complete once the student has read it, opened its lesson when it
has one ready, and submitted its quiz (pass or fail) when it has a published
module quiz. Before this, only a passed quiz completed a module, so modules
with no quiz stayed "in progress" and failed quizzes stayed "needs review".
Only moves rows forward to completed; reversing is a no-op.
"""
from django.db import migrations
from django.utils import timezone

SUBMITTED = ("submitted", "pending_evaluation", "evaluated")


def forwards(apps, schema_editor):
    ModuleProgress = apps.get_model("learning", "ModuleProgress")
    ModuleLesson = apps.get_model("tutor", "ModuleLesson")
    Assessment = apps.get_model("assessments", "Assessment")
    AssessmentAttempt = apps.get_model("assessments", "AssessmentAttempt")

    rows = list(ModuleProgress.objects.filter(last_viewed_at__isnull=False)
                .exclude(status="completed").values("id", "student_id", "module_id", "lesson_viewed_at", "status"))
    if not rows:
        return
    module_ids = {r["module_id"] for r in rows}
    now = timezone.now()
    with_lesson = set(ModuleLesson.objects.filter(module_id__in=module_ids, status="ready", lesson__isnull=False)
                      .values_list("module_id", flat=True))
    with_quiz = set(Assessment.objects.filter(module_id__in=module_ids, status="published")
                    .exclude(available_from__gt=now).values_list("module_id", flat=True))
    submitted = set(AssessmentAttempt.objects.filter(assessment__module_id__in=module_ids, status__in=SUBMITTED)
                    .values_list("student_id", "assessment__module_id"))
    done = []
    for r in rows:
        if r["module_id"] in with_lesson and r["lesson_viewed_at"] is None:
            continue
        if r["module_id"] in with_quiz and (r["student_id"], r["module_id"]) not in submitted:
            continue
        done.append(r["id"])
    for i in range(0, len(done), 500):
        ModuleProgress.objects.filter(pk__in=done[i:i + 500]).exclude(status="completed").update(
            status="completed", completed_at=now, updated_at=now)


class Migration(migrations.Migration):

    dependencies = [
        ("learning", "0005_moduleprogress_lesson_viewed_at"),
        ("tutor", "0006_short_table_names"),
        ("assessments", "0007_short_table_names"),
    ]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
