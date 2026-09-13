# Split into four migrations so no migration mixes row changes with table
# changes: PostgreSQL refuses to alter a table that has pending trigger events
# from rows changed earlier in the same transaction.
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('tutor', '0003_lesson_jobs_carry_over'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='modulelesson',
            name='content_version',
        ),
        migrations.AlterField(
            model_name='modulelesson',
            name='module',
            field=models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='lesson', to='learning.module'),
        ),
        migrations.AddIndex(
            model_name='modulelesson',
            index=models.Index(fields=['status', 'next_attempt_at'], name='tutor_lesson_queue_idx'),
        ),
    ]
