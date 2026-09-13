from django.apps import AppConfig


class AiMonitorConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "ai_monitor"
    verbose_name = "AI Monitoring & Guard"

    def ready(self):
        from . import signals  # noqa: F401  (connects the post-save hooks)
