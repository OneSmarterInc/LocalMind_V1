from django.conf import settings
from django.db import models

from core.models import TimeStampedUUIDModel


class LessonStatus(models.TextChoices):
    PENDING = "pending", "Waiting to be generated"
    GENERATING = "generating", "Being generated"
    READY = "ready", "Ready"
    FAILED = "failed", "Generation failed"


class ModuleLesson(TimeStampedUUIDModel):
    """The structured lesson for one module, generated in the background.

    One row per module. Lessons are generated when a book is processed and
    whenever a module's text changes, then read by students, who never wait
    for the model. The row doubles as the job: ``status`` says where it is,
    ``source_hash`` says which text it was (or is being) generated from, and
    ``version`` is bumped on every state change so a worker that finishes
    generating for text that has since been edited cannot overwrite the newer
    request. Shared across students because it depends only on the source text.
    """

    module = models.OneToOneField("learning.Module", on_delete=models.CASCADE, related_name="lesson")
    status = models.CharField(max_length=12, choices=LessonStatus.choices, default=LessonStatus.PENDING, db_index=True)
    source_hash = models.CharField(max_length=64, blank=True)
    lesson = models.JSONField(null=True, blank=True)
    generator = models.CharField(max_length=10, default="ai")
    model_name = models.CharField(max_length=100, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    last_error = models.CharField(max_length=300, blank=True)
    requested_at = models.DateTimeField(null=True, blank=True)
    claimed_at = models.DateTimeField(null=True, blank=True)
    generated_at = models.DateTimeField(null=True, blank=True)
    next_attempt_at = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "module_lessons"
        indexes = [models.Index(fields=["status", "next_attempt_at"], name="tutor_lesson_queue_idx")]

    def __str__(self):
        return f"lesson for {self.module_id} ({self.status})"


class Conversation(TimeStampedUUIDModel):
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="conversations")
    module = models.ForeignKey("learning.Module", on_delete=models.CASCADE, related_name="conversations")
    title = models.CharField(max_length=200, blank=True)
    last_message_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "tutor_conversations"
        ordering = ["-updated_at"]
        indexes = [models.Index(fields=["student", "module"])]


class Message(TimeStampedUUIDModel):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    role = models.CharField(max_length=10)  # user | assistant | system
    content = models.TextField()
    grounded = models.BooleanField(default=True)
    source_reference = models.TextField(blank=True)
    model_name = models.CharField(max_length=100, blank=True)
    latency_ms = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        db_table = "tutor_messages"
        ordering = ["created_at"]
