# Split into four migrations so no migration mixes row changes with table
# changes: PostgreSQL refuses to alter a table that has pending trigger events
# from rows changed earlier in the same transaction.
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('learning', '0001_initial'),
        ('tutor', '0001_initial'),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name='modulelesson',
            name='uniq_lesson_per_module_version',
        ),
        migrations.AddField(
            model_name='modulelesson',
            name='attempts',
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='modulelesson',
            name='claimed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='modulelesson',
            name='generated_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='modulelesson',
            name='last_error',
            field=models.CharField(blank=True, max_length=300),
        ),
        migrations.AddField(
            model_name='modulelesson',
            name='next_attempt_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='modulelesson',
            name='requested_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='modulelesson',
            name='source_hash',
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name='modulelesson',
            name='status',
            field=models.CharField(choices=[('pending', 'Waiting to be generated'), ('generating', 'Being generated'), ('ready', 'Ready'), ('failed', 'Generation failed')], db_index=True, default='pending', max_length=12),
        ),
        migrations.AddField(
            model_name='modulelesson',
            name='version',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AlterField(
            model_name='modulelesson',
            name='lesson',
            field=models.JSONField(blank=True, null=True),
        ),
    ]
