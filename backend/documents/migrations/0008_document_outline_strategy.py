from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("documents", "0007_short_table_names")]
    operations = [migrations.AddField(
        model_name="document", name="outline_strategy",
        field=models.CharField(max_length=20, default="source", choices=[
            ("source", "Keep source headings"), ("ai", "Suggest with AI")]),
    )]
