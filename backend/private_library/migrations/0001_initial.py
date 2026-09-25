import uuid
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
import private_library.storage

class Migration(migrations.Migration):
    initial = True
    dependencies = [migrations.swappable_dependency(settings.AUTH_USER_MODEL), ("academics", "0003_short_table_names")]
    operations = [migrations.CreateModel(name="SharedBook", fields=[
        ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
        ("created_at", models.DateTimeField(auto_now_add=True)),
        ("updated_at", models.DateTimeField(auto_now=True)),
        ("title", models.CharField(max_length=300)),
        ("file", models.FileField(storage=private_library.storage.private_storage, upload_to=private_library.storage.upload_path)),
        ("original_name", models.CharField(max_length=300)),
        ("sha256", models.CharField(max_length=64)),
        ("file_size", models.PositiveBigIntegerField()),
        ("active", models.BooleanField(default=True)),
        ("subject", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, to="academics.subject")),
        ("uploaded_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
    ], options={"db_table":"private_shared_books", "ordering":["-created_at", "id"]})]
