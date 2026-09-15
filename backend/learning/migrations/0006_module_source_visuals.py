from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("learning", "0005_moduleprogress_lesson_viewed_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="module",
            name="source_visuals",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
