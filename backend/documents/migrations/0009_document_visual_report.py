from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("documents", "0008_document_outline_strategy")]
    operations = [migrations.AddField(model_name="document", name="visual_report",
                                     field=models.JSONField(default=dict, blank=True))]
