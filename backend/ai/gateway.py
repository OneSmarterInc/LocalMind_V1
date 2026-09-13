"""AI gateway: the only place that talks to a language model.

Callers describe *what* they want (system prompt, user prompt, JSON schema,
which model class) and get back an AIResult. They never see HTTP, provider
payloads, or raw strings. Two providers implement AIProvider: the embedded
llama.cpp provider in llamacpp.py (AI_PROVIDER=llamacpp, the offline default,
one shared GGUF instance per process) and OllamaProvider below
(AI_PROVIDER=ollama). The configured provider is never swapped for another at
run time: if the embedded model cannot load, the result is `unavailable` and
the callers use their deterministic fallbacks.

The production model is qwen3 1.7B. Two things about a model that small shape
this module:

* It must be given an explicit context window (``num_ctx``). Ollama's default
  is 4096 tokens, which silently truncates the 12-14k character source
  prompts this application sends, and the model then answers from a partial
  text without any error.
* It sometimes returns JSON that parses but misses the schema, or wraps the
  JSON in a ``<think>`` block or a markdown fence. The gateway strips the
  wrappers, validates against the schema, and retries once at temperature 0
  before giving up. Timeouts and connection errors are never retried.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from django.conf import settings

logger = logging.getLogger("localmind.ai")

# Error codes, in the order a caller is likely to meet them:
#   disabled       AI_ENABLED is false (or the test runner is active)
#   unavailable    provider not usable: embedded model missing/failed to load, Ollama unreachable, model not pulled, HTTP >= 400
#   timeout        the request exceeded TIMEOUT_SECONDS
#   empty          the model returned no content
#   truncated      the model hit NUM_PREDICT before closing the JSON
#   malformed      content was not valid JSON after cleanup
#   invalid_schema JSON parsed but did not satisfy the schema
RETRYABLE = {"empty", "truncated", "malformed", "invalid_schema"}

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)
_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


def _ai_setting(name: str, default: Any) -> Any:
    """Read an AI setting with a default so partial override_settings in tests keep working."""
    return settings.AI.get(name, default)


def clean_model_output(content: str) -> str:
    """Strip reasoning blocks and markdown fences that small models add around JSON."""
    text = _THINK_RE.sub("", content or "")
    # An unterminated <think> (cut off by num_predict) leaves nothing useful.
    if "<think>" in text and "</think>" not in text:
        text = text.split("<think>", 1)[0]
    text = text.strip()
    text = _FENCE_RE.sub("", text).strip()
    # Tolerate a stray sentence before the JSON object/array.
    if text and text[0] not in "{[":
        for opener in ("{", "["):
            pos = text.find(opener)
            if pos != -1:
                text = text[pos:]
                break
    return text


def trim_source(text: str, limit: int | None = None) -> str:
    """Cut source text to the configured character budget on a paragraph or
    sentence boundary so the model never sees a half-word at the end."""
    text = text or ""
    if limit is None:
        from ai.config import source_chars
        limit = source_chars()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    for sep in ("\n\n", "\n", ". "):
        pos = cut.rfind(sep)
        if pos > limit // 2:
            return cut[: pos + (len(sep) if sep == ". " else 0)].rstrip()
    return cut


@dataclass
class AIResult:
    ok: bool
    data: dict | None = None
    error_code: str = ""  # see RETRYABLE and the list above
    error: str = ""
    provider: str = ""
    model: str = ""
    raw: str = field(default="", repr=False)
    attempts: int = 1
    latency_ms: int = 0
    # Token usage when the provider reports it (llama.cpp and Ollama both do);
    # 0 when unknown. The benchmark command derives tokens/sec from these.
    prompt_tokens: int = 0
    completion_tokens: int = 0

    @property
    def failed(self):
        return not self.ok

    @property
    def tokens_per_sec(self) -> float:
        if not self.completion_tokens or not self.latency_ms:
            return 0.0
        return round(self.completion_tokens * 1000.0 / self.latency_ms, 1)


@dataclass
class AIHealth:
    enabled: bool
    provider: str
    base_url: str
    reachable: bool
    models: list[str] = field(default_factory=list)
    tutor_model: str = ""
    outline_model: str = ""
    error: str = ""
    checked_at: float = 0.0
    details: dict = field(default_factory=dict)  # provider-specific (runtime, model file) for the health screen

    def model_present(self, name: str) -> bool:
        """Ollama lists 'qwen3:1.7b'; a bare 'qwen3' request matches 'qwen3:latest'."""
        if not self.reachable:
            return False
        wanted = name if ":" in name else f"{name}:latest"
        return wanted in self.models

    @property
    def ready(self) -> bool:
        return self.enabled and self.reachable and self.model_present(self.tutor_model) and self.model_present(self.outline_model)

    def as_dict(self) -> dict:
        return {
            "enabled": self.enabled,
            "provider": self.provider,
            "reachable": self.reachable,
            "ready": self.ready,
            "tutor_model": {"name": self.tutor_model, "present": self.model_present(self.tutor_model)},
            "outline_model": {"name": self.outline_model, "present": self.model_present(self.outline_model)},
            "error": self.error,
            "runtime": "llama.cpp" if self.provider == "llamacpp" else ("Ollama" if self.provider == "ollama" else self.provider),
            "details": self.details,
        }


class AIProvider(Protocol):
    name: str

    def generate_structured(self, *, model: str, messages: list[dict], schema: dict,
                            temperature: float, timeout: int, budget=None) -> AIResult: ...

    def list_models(self, timeout: int = 3) -> tuple[bool, list[str], str]: ...


class OllamaProvider:
    name = "ollama"

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def _options(self, temperature: float, budget=None) -> dict:
        return {
            "temperature": temperature,
            "top_p": (budget.top_p if budget else (0.1 if temperature == 0 else 0.9)),
            "num_ctx": budget.num_ctx if budget else _ai_setting("NUM_CTX", 16384),
            # A per-task cap: a 100-word answer and a ten-question quiz used to
            # share one 4096-token ceiling, so every short call paid for the
            # longest one.
            "num_predict": budget.max_tokens if budget else _ai_setting("NUM_PREDICT", 4096),
            # Fewer degenerate repetitions from small models on long lists.
            "repeat_penalty": 1.1,
        }

    def generate_structured(self, *, model, messages, schema, temperature, timeout, budget=None):
        import requests

        started = time.monotonic()
        try:
            response = requests.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": model,
                    "messages": messages,
                    "format": schema,
                    "stream": False,
                    # qwen3 is a reasoning model; with structured output the
                    # reasoning tokens only cost latency. Requires Ollama >= 0.9.
                    "think": False,
                    "options": self._options(temperature, budget),
                    "keep_alive": _ai_setting("KEEP_ALIVE", "30m"),
                },
                timeout=timeout,
            )
        except requests.Timeout:
            return AIResult(ok=False, error_code="timeout", error=f"Model request exceeded {timeout}s.", provider=self.name, model=model,
                            latency_ms=int((time.monotonic() - started) * 1000))
        except requests.RequestException as exc:
            return AIResult(ok=False, error_code="unavailable", error=str(exc), provider=self.name, model=model)
        latency = int((time.monotonic() - started) * 1000)

        if response.status_code == 404:
            return AIResult(ok=False, error_code="unavailable", error=f"Model {model} is not available; run `ollama pull {model}`.",
                            provider=self.name, model=model, latency_ms=latency)
        if response.status_code >= 400:
            detail = ""
            try:
                detail = response.json().get("error", "")
            except ValueError:
                pass
            return AIResult(ok=False, error_code="unavailable", error=f"Provider returned {response.status_code}. {detail}".strip(),
                            provider=self.name, model=model, latency_ms=latency)

        try:
            payload = response.json()
            content = payload["message"]["content"]
        except (ValueError, KeyError, TypeError):
            return AIResult(ok=False, error_code="malformed", error="Provider response had no message content.", provider=self.name, model=model, latency_ms=latency)

        content = clean_model_output(content)
        if not content:
            return AIResult(ok=False, error_code="empty", error="Model returned no content.", provider=self.name, model=model, latency_ms=latency)
        if payload.get("done_reason") == "length":
            return AIResult(ok=False, error_code="truncated", error="Model output hit the token limit before completing.",
                            provider=self.name, model=model, raw=content[:2000], latency_ms=latency)
        try:
            data = json.loads(content)
        except json.JSONDecodeError:
            return AIResult(ok=False, error_code="malformed", error="Model output was not valid JSON.", provider=self.name, model=model, raw=content[:2000], latency_ms=latency)
        return AIResult(ok=True, data=data, provider=self.name, model=model, raw=content, latency_ms=latency,
                        prompt_tokens=int(payload.get("prompt_eval_count") or 0), completion_tokens=int(payload.get("eval_count") or 0))

    def list_models(self, timeout: int = 3) -> tuple[bool, list[str], str]:
        import requests

        try:
            response = requests.get(f"{self.base_url}/api/tags", timeout=timeout)
        except requests.RequestException as exc:
            return False, [], str(exc)
        if response.status_code >= 400:
            return False, [], f"Provider returned {response.status_code}."
        try:
            names = [m.get("name", "") for m in response.json().get("models", [])]
        except (ValueError, AttributeError):
            return False, [], "Unexpected response from /api/tags."
        return True, [n for n in names if n], ""

    def pull_model(self, model: str, timeout: int = 1800) -> tuple[bool, str]:
        """Blocking pull used by the check_ai management command, never by request handlers."""
        import requests

        try:
            response = requests.post(f"{self.base_url}/api/pull", json={"model": model, "stream": False}, timeout=timeout)
        except requests.RequestException as exc:
            return False, str(exc)
        if response.status_code >= 400:
            return False, f"Provider returned {response.status_code}."
        try:
            status = response.json().get("status", "")
        except ValueError:
            status = ""
        return status == "success", status or "unknown"


class DisabledProvider:
    name = "disabled"

    def generate_structured(self, **kwargs):
        return AIResult(ok=False, error_code="disabled", error="AI is disabled by configuration.", provider=self.name, model=kwargs.get("model", ""))

    def list_models(self, timeout: int = 3):
        return False, [], "AI is disabled by configuration."


_provider_cache: dict[str, AIProvider] = {}


def get_provider() -> AIProvider:
    cfg = settings.AI
    if not cfg["ENABLED"]:
        return DisabledProvider()
    key = f'{cfg["PROVIDER"]}:{cfg["OLLAMA_BASE_URL"]}:{cfg.get("MODEL_PATH", "")}'
    if key not in _provider_cache:
        if cfg["PROVIDER"] == "ollama":
            _provider_cache[key] = OllamaProvider(cfg["OLLAMA_BASE_URL"])
        elif cfg["PROVIDER"] == "llamacpp":
            # Embedded, in-process model: no Ollama, no daemon, fully offline.
            from .llamacpp import LlamaCppProvider

            _provider_cache[key] = LlamaCppProvider()
        else:
            raise RuntimeError(f"Unknown AI provider {cfg['PROVIDER']}")
    return _provider_cache[key]


def model_for(kind: str) -> str:
    cfg = settings.AI
    return cfg["OUTLINE_MODEL"] if kind == "outline" else cfg["TUTOR_MODEL"]


# ---- minimal schema validation (subset of JSON Schema we actually use) ----

def _validate(instance, schema, path="$"):
    errors = []
    expected = schema.get("type")
    if expected == "object":
        if not isinstance(instance, dict):
            return [f"{path}: expected object"]
        for key in schema.get("required", []):
            if key not in instance:
                errors.append(f"{path}.{key}: missing")
        for key, sub in schema.get("properties", {}).items():
            if key in instance:
                errors += _validate(instance[key], sub, f"{path}.{key}")
    elif expected == "array":
        if not isinstance(instance, list):
            return [f"{path}: expected array"]
        if "minItems" in schema and len(instance) < schema["minItems"]:
            errors.append(f"{path}: expected at least {schema['minItems']} items")
        if "maxItems" in schema and len(instance) > schema["maxItems"]:
            errors.append(f"{path}: expected at most {schema['maxItems']} items")
        items = schema.get("items")
        if items:
            for idx, item in enumerate(instance):
                errors += _validate(item, items, f"{path}[{idx}]")
    elif expected == "string":
        if not isinstance(instance, str):
            errors.append(f"{path}: expected string")
        elif "enum" in schema and instance not in schema["enum"]:
            errors.append(f"{path}: not one of {schema['enum']}")
    elif expected == "integer":
        if not isinstance(instance, int) or isinstance(instance, bool):
            errors.append(f"{path}: expected integer")
    elif expected == "number":
        if not isinstance(instance, (int, float)) or isinstance(instance, bool):
            errors.append(f"{path}: expected number")
    elif expected == "boolean":
        if not isinstance(instance, bool):
            errors.append(f"{path}: expected boolean")
    return errors


def validate_against_schema(instance, schema) -> list[str]:
    return _validate(instance, schema)


# Interactive model calls in flight in this process (a tutor question, quiz
# generation, grading). Background work such as lesson generation checks this
# between jobs and waits, so a student's request is never stuck behind a queue
# of lessons for longer than the one already running.
_foreground_lock = threading.Lock()
_foreground_calls = 0


def foreground_busy() -> bool:
    return _foreground_calls > 0


class AIGateway:
    def __init__(self, provider: AIProvider | None = None):
        self.provider = provider or get_provider()

    def generate(self, *, task: str, system_prompt: str, user_prompt: str, schema: dict,
                 model_kind: str | None = None, temperature: float | None = None, timeout: int | None = None,
                 source_chars: int = 0, retrieved_chunks: int = 0, model: str | None = None,
                 background: bool = False, max_tokens: int | None = None,
                 retry_codes: set | frozenset | None = None) -> AIResult:
        """Run one model call for a named task.

        The task decides the token ceiling, the context window and the sampling
        temperature, all read from ai.config, so no caller carries a literal
        number. `source_chars` and `retrieved_chunks` are recorded for the log
        and the benchmark: they say how much text the caller decided to send,
        which is the number that matters when a call is slow. `model` names
        a specific model (Ollama tag) and overrides the kind lookup; the
        AI monitor uses it to run its judge on a different model than the
        tutor. `background=True` marks work nobody is waiting on; everything
        else counts as interactive for `foreground_busy()`. `max_tokens` sets
        this call's output ceiling (capped by NUM_PREDICT);
        `retry_codes` narrows which failures are retried (a caller that splits
        a truncated request itself does not want the same request repeated).
        """
        global _foreground_calls
        if background:
            return self._generate(task=task, system_prompt=system_prompt, user_prompt=user_prompt, schema=schema,
                                  model_kind=model_kind, temperature=temperature, timeout=timeout,
                                  source_chars=source_chars, retrieved_chunks=retrieved_chunks, model=model,
                                  max_tokens=max_tokens, retry_codes=retry_codes)
        with _foreground_lock:
            _foreground_calls += 1
        try:
            return self._generate(task=task, system_prompt=system_prompt, user_prompt=user_prompt, schema=schema,
                                  model_kind=model_kind, temperature=temperature, timeout=timeout,
                                  source_chars=source_chars, retrieved_chunks=retrieved_chunks, model=model,
                                  max_tokens=max_tokens, retry_codes=retry_codes)
        finally:
            with _foreground_lock:
                _foreground_calls -= 1

    def _generate(self, *, task, system_prompt, user_prompt, schema, model_kind, temperature, timeout,
                  source_chars, retrieved_chunks, model, max_tokens=None, retry_codes=None) -> AIResult:
        from dataclasses import replace

        from ai.config import task_config

        cfg = settings.AI
        budget = task_config(task)
        if max_tokens:
            # A caller may ask for more than the task's profile (a tutor answer
            # that was cut off gets one longer try), never beyond NUM_PREDICT.
            ceiling = int(_ai_setting("NUM_PREDICT", 4096) or 4096)
            budget = replace(budget, max_tokens=max(32, min(int(max_tokens), ceiling)))
        retryable = RETRYABLE if retry_codes is None else set(retry_codes)
        model = model or model_for(model_kind or ("outline" if task == "outline" else "tutor"))
        temperature = budget.temperature if temperature is None else temperature
        timeout = timeout or cfg["TIMEOUT_SECONDS"]
        max_attempts = 1 + max(0, int(_ai_setting("MAX_RETRIES", 1)))
        messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}]

        result: AIResult | None = None
        for attempt in range(1, max_attempts + 1):
            attempt_temperature = temperature if attempt == 1 else 0.0
            attempt_messages = messages
            if attempt > 1 and result is not None:
                # Tell the model precisely what was wrong; small models fix
                # concrete complaints far better than generic "try again".
                hint = f"Your previous reply was rejected ({result.error_code}: {result.error}). " \
                       "Reply with one JSON value that exactly matches the required schema and nothing else."
                attempt_messages = messages + [{"role": "user", "content": hint}]
            result = self.provider.generate_structured(
                model=model, messages=attempt_messages, schema=schema, temperature=attempt_temperature,
                timeout=timeout, budget=budget)
            result.attempts = attempt
            if result.ok:
                problems = validate_against_schema(result.data, schema)
                if problems:
                    result = AIResult(ok=False, error_code="invalid_schema", error="; ".join(problems[:5]),
                                      provider=result.provider, model=result.model, raw=result.raw,
                                      attempts=attempt, latency_ms=result.latency_ms)
            if result.ok:
                logger.info("AI %s ok model=%s attempt=%d latency_ms=%d source_chars=%d chunks=%d max_tokens=%d tokens=%d/%d tok_s=%s",
                            task, model, attempt, result.latency_ms, source_chars, retrieved_chunks, budget.max_tokens,
                            result.prompt_tokens, result.completion_tokens, result.tokens_per_sec or "?")
                return result
            if result.error_code not in retryable:
                break
            logger.warning("AI %s attempt %d/%d rejected: %s (%s)", task, attempt, max_attempts, result.error_code, result.error)

        logger.warning("AI call for %s failed after %d attempt(s): %s (%s)", task, result.attempts, result.error_code, result.error)
        return result


def gateway() -> AIGateway:
    return AIGateway()


# ---- health -----------------------------------------------------------------

_health_lock = threading.Lock()
_health_cache: AIHealth | None = None


def health(force: bool = False, timeout: int = 3) -> AIHealth:
    """Readiness of the configured provider: library plus validated model file
    for llamacpp, /api/tags for Ollama. Never loads the embedded model.

    Cached for HEALTH_CACHE_SECONDS so /api/health/ polling never turns into a
    load on the model host. Never raises.
    """
    global _health_cache
    cfg = settings.AI
    ttl = _ai_setting("HEALTH_CACHE_SECONDS", 30)
    with _health_lock:
        if not force and _health_cache and time.monotonic() - _health_cache.checked_at < ttl:
            return _health_cache
        provider = get_provider() if cfg["ENABLED"] else DisabledProvider()
        if isinstance(provider, DisabledProvider):
            reachable, models, error = False, [], "AI is disabled by configuration."
        else:
            reachable, models, error = provider.list_models(timeout=timeout)
        _health_cache = AIHealth(
            enabled=bool(cfg["ENABLED"]), provider=cfg["PROVIDER"], base_url=cfg["OLLAMA_BASE_URL"],
            reachable=reachable, models=models, tutor_model=cfg["TUTOR_MODEL"], outline_model=cfg["OUTLINE_MODEL"],
            error=error, checked_at=time.monotonic(),
            details=provider.describe() if hasattr(provider, "describe") else {})
        if cfg["ENABLED"] and not _health_cache.ready:
            logger.warning("AI not ready (%s): reachable=%s models=%s error=%s", cfg["PROVIDER"], reachable, models, error)
        elif cfg["ENABLED"] and force and hasattr(provider, "status_line"):
            logger.info(provider.status_line())
        return _health_cache


def reset_health_cache() -> None:
    global _health_cache
    with _health_lock:
        _health_cache = None