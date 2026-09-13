"""Verify the configured AI provider before serving traffic.

    python manage.py check_ai            # provider readiness + model presence
    python manage.py check_ai --smoke    # also load the model and run structured generations
    python manage.py check_ai --pull     # Ollama only: pull any missing model first

AI_PROVIDER=llamacpp (the offline default): checks that llama-cpp-python
imports and the local GGUF exists and is valid, loads it into this process,
and with --smoke runs two structured generations so the log shows one
"Model loaded" and one "Reusing loaded GGUF model". Nothing here touches the
network and Ollama is never consulted.

AI_PROVIDER=ollama: checks that the daemon answers /api/tags, that the
configured models are pulled (--pull fetches missing ones, blocking for
minutes), and with --smoke runs one generation.

Exits non-zero on any failure so a deploy script, systemd ExecStartPre or the
launcher can gate on it. Never run this from a request handler.
"""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from ai.gateway import AIGateway, get_provider, health, reset_health_cache

SMOKE_SCHEMA = {"type": "object", "properties": {"greeting": {"type": "string"}, "number": {"type": "integer"}},
                "required": ["greeting", "number"]}


class Command(BaseCommand):
    help = "Check that the configured AI provider (embedded llama.cpp GGUF or Ollama) and its required models are available."

    def add_arguments(self, parser):
        parser.add_argument("--pull", action="store_true",
                            help="Ollama provider only: pull missing models (blocking). Ignored for llamacpp, which uses `manage.py fetch_model`.")
        parser.add_argument("--smoke", action="store_true",
                            help="Run structured generations through the gateway (two for llamacpp, to prove the model is reused).")
        parser.add_argument("--timeout", type=int, default=5, help="Seconds for the readiness probe.")

    def handle(self, *args, **options):
        cfg = settings.AI
        if not cfg["ENABLED"]:
            raise CommandError("AI_ENABLED is false; nothing to check. Set AI_ENABLED=true to use the tutor.")

        provider_name = cfg["PROVIDER"]
        self.stdout.write(f"AI provider: {provider_name}")
        status = health(force=True, timeout=options["timeout"])

        if provider_name == "llamacpp":
            self._check_llamacpp(status, options)
        elif provider_name == "ollama":
            self._check_ollama(status, options)
        else:
            raise CommandError(f"Unknown AI_PROVIDER '{provider_name}'. Use 'llamacpp' (embedded, offline) or 'ollama'.")

        self.stdout.write(self.style.SUCCESS("AI ready."))

    # ---- llamacpp ------------------------------------------------------------

    def _check_llamacpp(self, status, options):
        from ai.llamacpp import model_path

        provider = get_provider()
        path = model_path()
        self.stdout.write(f"Model: {path.name}")
        self.stdout.write(f"Mode: embedded/offline (path {path})")
        self.stdout.write(f"Model file: {'present' if status.reachable else 'NOT READY'}")
        if options["pull"]:
            self.stdout.write("  --pull does nothing for llamacpp; the GGUF is fetched once with `python manage.py fetch_model`.")
        if not status.reachable:
            raise CommandError(f"Embedded GGUF model unavailable: {status.error} (install: pip install llama-cpp-python "
                               "--extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu ; model: python manage.py fetch_model)")

        self.stdout.write("Loading embedded GGUF model into memory (first load takes a few seconds)...")
        ok, err = provider.warm_up()
        if not ok:
            raise CommandError(f"Embedded GGUF model unavailable: {err}")
        detail = provider.describe()
        self.stdout.write(self.style.SUCCESS(f"  loaded in {detail.get('load_ms', 0)} ms"))

        if options["smoke"]:
            self._smoke("smoke")
            self._smoke("smoke-reuse")
            detail = provider.describe()
            if detail.get("load_count") != 1:
                raise CommandError(f"Model was loaded {detail.get('load_count')} times in this process; expected exactly once.")
            self.stdout.write(self.style.SUCCESS("  model instance reused across calls (loaded once in this process)"))
        self.stdout.write("Status: ready")

    # ---- ollama --------------------------------------------------------------

    def _check_ollama(self, status, options):
        cfg = settings.AI
        self.stdout.write(f"Ollama at {status.base_url}: {'reachable' if status.reachable else 'UNREACHABLE'}")
        if not status.reachable:
            raise CommandError(f"Cannot reach Ollama: {status.error}. Start it with `ollama serve` or fix OLLAMA_BASE_URL.")

        wanted = sorted({cfg["TUTOR_MODEL"], cfg["OUTLINE_MODEL"]})
        missing = [m for m in wanted if not status.model_present(m)]
        for m in wanted:
            self.stdout.write(f"  model {m}: {'present' if m not in missing else 'MISSING'}")

        if missing and options["pull"]:
            provider = get_provider()
            for m in missing:
                self.stdout.write(f"Pulling {m} (this can take several minutes)...")
                ok, detail = provider.pull_model(m)
                if not ok:
                    raise CommandError(f"Pull of {m} failed: {detail}")
                self.stdout.write(self.style.SUCCESS(f"  pulled {m}"))
            reset_health_cache()
            status = health(force=True, timeout=options["timeout"])
            missing = [m for m in wanted if not status.model_present(m)]

        if missing:
            raise CommandError("Missing models: " + ", ".join(missing) + ". Run `ollama pull <model>` or re-run with --pull.")

        if options["smoke"]:
            self._smoke("smoke")

    # ---- shared --------------------------------------------------------------

    def _smoke(self, purpose):
        self.stdout.write(f"Running {purpose} generation...")
        result = AIGateway().generate(
            task="tutor", system_prompt="Reply with JSON only.",
            user_prompt='Return {"greeting": "hello", "number": 7}.', schema=SMOKE_SCHEMA, temperature=0.0)
        if result.failed:
            raise CommandError(f"{purpose} generation failed: {result.error_code}: {result.error}")
        self.stdout.write(self.style.SUCCESS(
            f"  ok in {result.latency_ms} ms after {result.attempts} attempt(s): {result.data}"))
