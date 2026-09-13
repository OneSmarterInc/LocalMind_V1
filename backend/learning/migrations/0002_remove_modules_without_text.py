"""Remove modules that have no source text, and chapters left with none.

Until now a module whose text did not resolve was kept with ``source_missing``
set, shown to faculty with a warning, and blocked publishing until someone
removed it by hand. The system now never keeps such a module. This migration
applies the rule to existing books. A module that a quiz, an assignment,
student progress or a tutor conversation refers to is kept (still flagged, and
hidden from students) because deleting it would break that record.
"""
from django.db import migrations
from django.db.models import Q


def remove_empty_modules(apps, schema_editor):
    Module = apps.get_model("learning", "Module")
    Chapter = apps.get_model("learning", "Chapter")
    ModuleProgress = apps.get_model("learning", "ModuleProgress")
    Assessment = apps.get_model("assessments", "Assessment")
    Assignment = apps.get_model("assignments", "Assignment")
    Conversation = apps.get_model("tutor", "Conversation")

    empty = Module.objects.filter(Q(source_missing=True) | Q(source_text=""))
    for module in empty:
        if (module.source_text or "").strip():
            continue
        referenced = (ModuleProgress.objects.filter(module=module).exists()
                      or Assessment.objects.filter(Q(module=module) | Q(source_modules=module)).exists()
                      or Assignment.objects.filter(Q(module=module) | Q(source_modules=module)).exists()
                      or Conversation.objects.filter(module=module).exists())
        if referenced:
            if not module.source_missing:
                module.source_missing = True
                module.save(update_fields=["source_missing"])
            continue
        module.delete()

    for chapter in Chapter.objects.filter(modules__isnull=True):
        if Assessment.objects.filter(chapter=chapter).exists() or Assignment.objects.filter(chapter=chapter).exists():
            continue
        chapter.delete()


class Migration(migrations.Migration):

    dependencies = [
        ("learning", "0001_initial"),
        ("assessments", "0003_attempt_outcome_recorded_at"),
        ("assignments", "0002_assignment_results_release_and_more"),
        ("tutor", "0005_queue_missing_lessons"),
    ]

    operations = [
        migrations.RunPython(remove_empty_modules, migrations.RunPython.noop),
    ]
