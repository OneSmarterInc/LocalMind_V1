# Split into four migrations so no migration mixes row changes with table
# changes: PostgreSQL refuses to alter a table that has pending trigger events
# from rows changed earlier in the same transaction.
import hashlib

from django.db import migrations


def _hash(text):
    # Must match tutor.lessons.source_hash.
    return hashlib.sha256((text or "").strip().encode("utf-8")).hexdigest()


def carry_over_lessons(apps, schema_editor):
    """Lessons used to be cached per (module, document content version) and
    generated when a student first pressed Lesson. Keep the one lesson per
    module that still matches its book's current version, drop the rest, and
    then (in queue_missing_lessons) queue every other module that has text so
    the background worker builds its lesson without anyone waiting."""
    ModuleLesson = apps.get_model("tutor", "ModuleLesson")
    kept = set()
    for row in ModuleLesson.objects.select_related("module__chapter__document").order_by("-updated_at"):
        module = row.module
        current = module.chapter.document.content_version
        if module.pk in kept or row.generator != "ai" or row.content_version != current or not (module.source_text or "").strip():
            row.delete()
            continue
        row.status = "ready"
        row.source_hash = _hash(module.source_text)
        row.generated_at = row.updated_at
        row.save(update_fields=["status", "source_hash", "generated_at"])
        kept.add(module.pk)


class Migration(migrations.Migration):

    dependencies = [
        ('tutor', '0002_lesson_jobs'),
    ]

    operations = [
        migrations.RunPython(carry_over_lessons, migrations.RunPython.noop),
    ]
