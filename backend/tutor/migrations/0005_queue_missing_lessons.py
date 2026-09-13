# Split into four migrations so no migration mixes row changes with table
# changes: PostgreSQL refuses to alter a table that has pending trigger events
# from rows changed earlier in the same transaction.
import hashlib

from django.db import migrations
from django.utils import timezone


def _hash(text):
    # Must match tutor.lessons.source_hash.
    return hashlib.sha256((text or "").strip().encode("utf-8")).hexdigest()


def queue_missing_lessons(apps, schema_editor):
    """Runs after content_version is gone: every module with text and no lesson
    gets a pending row for the background worker."""
    Module = apps.get_model("learning", "Module")
    ModuleLesson = apps.get_model("tutor", "ModuleLesson")
    now = timezone.now()
    have = set(ModuleLesson.objects.values_list("module_id", flat=True))
    missing = Module.objects.exclude(pk__in=have).exclude(source_text="").exclude(source_missing=True)
    ModuleLesson.objects.bulk_create([
        ModuleLesson(module=m, status="pending", source_hash=_hash(m.source_text), requested_at=now)
        for m in missing if (m.source_text or "").strip()
    ])


class Migration(migrations.Migration):

    dependencies = [
        ('tutor', '0004_lesson_jobs_finish'),
    ]

    operations = [
        migrations.RunPython(queue_missing_lessons, migrations.RunPython.noop),
    ]
