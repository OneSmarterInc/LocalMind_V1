import logging

from django.apps import AppConfig
from django.conf import settings

logger = logging.getLogger("localmind.ai")


class AiConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "ai"

    def ready(self):
        """Log which provider this process will use. Cheap (a stat of the
        model file at most); the model itself is loaded lazily on first use
        or by `check_ai`, never here."""
        cfg = settings.AI
        if not cfg.get("ENABLED"):
            logger.info("AI provider: disabled | Mode: fallbacks only")
            return
        provider = cfg.get("PROVIDER")
        if provider == "llamacpp":
            from .llamacpp import LlamaCppProvider

            logger.info(LlamaCppProvider().status_line())
        elif provider == "ollama":
            logger.info("AI provider: ollama | Host: %s | Models: %s, %s | Mode: local daemon",
                        cfg.get("OLLAMA_BASE_URL"), cfg.get("TUTOR_MODEL"), cfg.get("OUTLINE_MODEL"))
        else:
            logger.warning("AI provider: %s (unknown; AI calls will fail)", provider)
