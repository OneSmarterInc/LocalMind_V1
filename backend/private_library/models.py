"""Book distribution only. Private learner activity is not stored in Django."""
from django.conf import settings
from django.db import models
from core.models import TimeStampedUUIDModel
from .storage import private_storage, upload_path

class SharedBook(TimeStampedUUIDModel):
    title = models.CharField(max_length=300)
    subject = models.ForeignKey("academics.Subject", null=True, blank=True, on_delete=models.PROTECT)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    file = models.FileField(storage=private_storage, upload_to=upload_path)
    original_name = models.CharField(max_length=300)
    sha256 = models.CharField(max_length=64)
    file_size = models.PositiveBigIntegerField()
    active = models.BooleanField(default=True)
    class Meta:
        db_table = "private_shared_books"
        ordering = ["-created_at", "id"]
