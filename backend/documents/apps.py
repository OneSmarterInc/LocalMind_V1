from django.apps import AppConfig


class DocumentsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "documents"

    def ready(self):
        # Register the post-processing source-visual synchronizer.
        from . import signals  # noqa: F401
