"""Embedded AI provider: runs the model inside the Django process with
llama.cpp (via llama-cpp-python) and a GGUF file shipped with the app.

Nothing else has to be installed on the host: no Ollama, no daemon, no
network. The model file lives under ``backend/models/`` (or wherever
``AI_MODEL_PATH`` points) and is fetched once, at packaging time, with
``python manage.py fetch_model``. After that the whole application works with
the network cable unplugged.

Model lifecycle (one GGUF instance per Django process):

* The loaded ``Llama`` object lives in a process-wide registry keyed by the
  resolved model path (``_SharedModel``). Every ``LlamaCppProvider`` that
  points at the same file shares the same instance, so the tutor, the outline
  builder, ``check_ai`` and the health probe never hold separate copies.
* Loading is lazy (first request or an explicit ``warm_up``) and guarded by a
  lock, so two simultaneous first requests cannot both construct a model.
  Nothing is loaded at import time.
* llama.cpp is not thread-safe per model instance, so the same lock also
  serialises generation. The request timeout bounds *waiting for that lock*;
  ``max_tokens`` (NUM_PREDICT) bounds the generation itself, because llama.cpp
  cannot be interrupted mid-generation.
* A failed load is remembered so a missing file does not get re-tried on every
  request, but allocation failures (``MemoryError``, "Unable to allocate") are
  treated as transient and re-tried after ``AI_LOAD_RETRY_SECONDS``: the
  usual cause is the document parser's PyTorch models holding RAM at the same
  moment, and once they are released the load succeeds.
* The model is closed explicitly at interpreter exit (``atexit``). Without
  that, llama-cpp-python's destructors run during module teardown, after the
  ``llama_cpp`` globals they call have been set to ``None``, which is the
  ``TypeError: 'NoneType' object is not callable`` seen in the deallocator.
* Structured output uses llama.cpp's JSON-schema grammar, so the model is
  physically unable to emit anything but JSON matching the schema. qwen3 GGUFs
  default to reasoning mode; inside a grammar the reasoning tokens are
  unreachable anyway, but ``/no_think`` is still appended to the system prompt
  so the chat template does not waste context on it.
* gunicorn/uvicorn workers are separate processes and each holds its own copy;
  keep the worker count small on a laptop (see docs/OFFLINE.md).
"""
from __future__ import annotations

import atexit
import json
import logging
import os
import re
import threading
import time
from pathlib import Path
from typing import Any

from django.conf import settings

from .gateway import AIResult, clean_model_output

logger = logging.getLogger("localmind.ai")


def _cfg(name: str, default: Any) -> Any:
    return settings.AI.get(name, default)


def model_path() -> Path:
    raw = _cfg("MODEL_PATH", "")
    if raw:
        return Path(raw).expanduser().resolve()
    return (Path(settings.BASE_DIR) / "models" / _cfg("MODEL_FILE", "Qwen3-1.7B-Q4_K_M.gguf")).resolve()


GGUF_MAGIC = b"GGUF"
MIN_MODEL_BYTES = 50 * (1 << 20)


def validate_model_file(path: Path | None = None) -> tuple[bool, str]:
    """Cheap sanity check before handing a file to llama.cpp: it exists, is
    not a half-finished download, and carries the GGUF magic header."""
    path = path or model_path()
    if not path.exists():
        return False, f"Model file not found at {path}. Run `python manage.py fetch_model` (needs internet once) or copy the .gguf there."
    if path.with_suffix(".part").exists():
        return False, f"A partial download {path.with_suffix('.part').name} sits next to the model; the fetch did not finish. Re-run fetch_model."
    size = path.stat().st_size
    if size < MIN_MODEL_BYTES:
        return False, f"Model file is only {size // (1 << 20)} MB; that is not a complete GGUF model. Re-run fetch_model --force."
    try:
        with open(path, "rb") as fh:
            magic = fh.read(4)
    except OSError as exc:
        return False, f"Model file is not readable: {exc}"
    if magic != GGUF_MAGIC:
        return False, f"{path.name} is not a GGUF file (bad header). Download a .gguf quantisation of the model."
    return True, ""


def library_available() -> tuple[bool, str]:
    try:
        import llama_cpp  # noqa: F401
    except Exception as exc:  # ImportError or a broken native wheel
        return False, f"llama-cpp-python is not installed or failed to load: {exc}"
    return True, ""


def _display_name(filename: str) -> str:
    """'Qwen3-1.7B-Q4_K_M.gguf' -> 'Qwen3 1.7B (Q4_K_M)'."""
    stem = filename[:-5] if filename.lower().endswith(".gguf") else filename
    parts = stem.split("-")
    quant = parts[-1] if len(parts) > 1 and re.match(r"^(I?Q\d|F16|F32|BF16)", parts[-1].upper()) else ""
    base = " ".join(parts[:-1] if quant else parts)
    return f"{base} ({quant})" if quant else base


_TRANSIENT_LOAD_MARKERS = ("unable to allocate", "cannot allocate", "out of memory", "not enough memory", "bad_alloc", "failed to allocate")


def _is_transient_load_error(exc: BaseException) -> bool:
    if isinstance(exc, MemoryError):
        return True
    text = str(exc).lower()
    return any(marker in text for marker in _TRANSIENT_LOAD_MARKERS)


# ---- process-wide shared model -------------------------------------------

class _SharedModel:
    """The single llama.cpp instance for one GGUF path in this process."""

    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.RLock()
        self.llm = None
        self.load_error = ""
        self.load_error_transient = False
        self.load_failed_at = 0.0
        self.load_count = 0
        self.load_ms = 0

    # The caller must hold ``self.lock``.
    def _should_retry(self) -> bool:
        if not self.load_error:
            return True
        if not self.load_error_transient:
            return False
        return time.monotonic() - self.load_failed_at >= float(_cfg("LOAD_RETRY_SECONDS", 60))

    def get(self):
        """Return the loaded model, loading it on first use. Must be called
        with ``self.lock`` held."""
        if self.llm is not None:
            logger.info("Reusing loaded GGUF model.")
            return self.llm
        if not self._should_retry():
            return None
        ok, err = library_available()
        if not ok:
            self._remember_failure(err, transient=False)
            return None
        valid, err = validate_model_file(self.path)
        if not valid:
            # A missing or corrupt file is cheap to re-check and may be fixed
            # by copying the file in, so never make it permanent.
            self._remember_failure(err, transient=True)
            return None
        from llama_cpp import Llama

        from ai.config import num_ctx as profile_num_ctx

        threads = int(_cfg("THREADS", 0)) or max(1, (os.cpu_count() or 4) - 1)
        # The context window comes from the performance profile unless
        # OLLAMA_NUM_CTX overrides it. Reading the raw setting here used to
        # hand llama.cpp n_ctx=0 when the variable was unset, which llama.cpp
        # treats as "the model's full training context" (40k for Qwen3): a
        # multi-GB cache and a much slower generation for nothing.
        n_ctx = int(profile_num_ctx() or 8192)
        n_batch = max(32, min(int(_cfg("BATCH", 256)), n_ctx))
        logger.info("Loading embedded GGUF model... (%s, n_ctx=%d, n_batch=%d, threads=%d)", self.path.name, n_ctx, n_batch, threads)
        started = time.monotonic()
        try:
            llm = Llama(
                model_path=str(self.path),
                n_ctx=n_ctx,
                n_batch=n_batch,
                n_threads=threads,
                n_gpu_layers=int(_cfg("GPU_LAYERS", 0)),
                use_mmap=True,
                use_mlock=False,
                verbose=False,
            )
        except BaseException as exc:  # MemoryError is not an Exception subclass in every path we care about
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                raise
            transient = _is_transient_load_error(exc)
            self._remember_failure(f"Could not load {self.path.name}: {exc}", transient=transient)
            if transient:
                logger.error("Embedded GGUF model unavailable: %s (will retry in %ss; free RAM by finishing document processing first)",
                             self.load_error, _cfg("LOAD_RETRY_SECONDS", 60))
            else:
                logger.error("Embedded GGUF model unavailable: %s", self.load_error)
            return None
        self.llm = llm
        self.load_error = ""
        self.load_error_transient = False
        self.load_count += 1
        self.load_ms = int((time.monotonic() - started) * 1000)
        _register_atexit()
        logger.info("Model loaded: %s in %d ms (load #%d in this process)", self.path.name, self.load_ms, self.load_count)
        return self.llm

    def _remember_failure(self, message: str, *, transient: bool) -> None:
        self.load_error = message
        self.load_error_transient = transient
        self.load_failed_at = time.monotonic()

    def close(self) -> None:
        with self.lock:
            llm, self.llm = self.llm, None
        if llm is None:
            return
        try:
            close = getattr(llm, "close", None)
            if callable(close):
                close()
        except Exception as exc:  # pragma: no cover - depends on the native library
            logger.debug("Closing embedded model raised %s", exc)
        logger.info("Embedded GGUF model released.")


_registry_lock = threading.Lock()
_models: dict[Path, _SharedModel] = {}
_atexit_registered = False


def shared_model(path: Path) -> _SharedModel:
    """One ``_SharedModel`` per resolved path per process."""
    with _registry_lock:
        entry = _models.get(path)
        if entry is None:
            entry = _SharedModel(path)
            _models[path] = entry
        return entry


def _register_atexit() -> None:
    global _atexit_registered
    if _atexit_registered:
        return
    _atexit_registered = True
    atexit.register(close_all_models)


def close_all_models() -> None:
    """Free every loaded model. Registered with ``atexit`` on first load so
    the native handles are released before the ``llama_cpp`` module is torn
    down; also usable from tests."""
    with _registry_lock:
        entries = list(_models.values())
    for entry in entries:
        entry.close()


def loaded_model_count() -> int:
    with _registry_lock:
        return sum(1 for m in _models.values() if m.llm is not None)


# ---- provider --------------------------------------------------------------

class LlamaCppProvider:
    name = "llamacpp"
    mode = "embedded/offline"

    def __init__(self, path: Path | None = None):
        self.path = path or model_path()
        self._shared = shared_model(self.path)

    # Compatibility with the previous single-instance layout (tests, health).
    @property
    def _llm(self):
        return self._shared.llm

    @_llm.setter
    def _llm(self, value):
        self._shared.llm = value

    @property
    def _load_error(self) -> str:
        return self._shared.load_error

    @_load_error.setter
    def _load_error(self, value: str):
        self._shared.load_error = value

    @property
    def _lock(self):
        return self._shared.lock

    def _load(self):
        """Load lazily on first use; the caller must hold ``self._lock``."""
        return self._shared.get()

    # ---- AIProvider --------------------------------------------------------

    def generate_structured(self, *, model, messages, schema, temperature, timeout, budget=None):
        started = time.monotonic()
        if not self._lock.acquire(timeout=timeout):
            return AIResult(ok=False, error_code="timeout", error=f"Embedded model was busy for more than {timeout}s.",
                            provider=self.name, model=model, latency_ms=int((time.monotonic() - started) * 1000))
        try:
            llm = self._load()
            if llm is None:
                return AIResult(ok=False, error_code="unavailable", error=self._load_error, provider=self.name, model=model)
            prompt_messages = [dict(m) for m in messages]
            if prompt_messages and prompt_messages[0].get("role") == "system":
                prompt_messages[0]["content"] = f"{prompt_messages[0]['content']}\n/no_think"
            try:
                completion = llm.create_chat_completion(
                    messages=prompt_messages,
                    response_format={"type": "json_object", "schema": schema},
                    temperature=temperature,
                    top_p=(budget.top_p if budget else (0.1 if temperature == 0 else 0.9)),
                    repeat_penalty=1.1,
                    # Per-task ceiling: a short answer no longer reserves the
                    # same output budget as a ten-question quiz.
                    max_tokens=int(budget.max_tokens if budget else _cfg("NUM_PREDICT", 4096)),
                )
            except Exception as exc:
                logger.exception("Embedded generation failed")
                return AIResult(ok=False, error_code="unavailable", error=f"Embedded model error: {exc}", provider=self.name, model=model,
                                latency_ms=int((time.monotonic() - started) * 1000))
        finally:
            self._lock.release()

        latency = int((time.monotonic() - started) * 1000)
        usage = completion.get("usage") or {} if isinstance(completion, dict) else {}
        prompt_tokens, completion_tokens = int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0)
        try:
            choice = completion["choices"][0]
            content = choice["message"]["content"]
            finish = choice.get("finish_reason")
        except (KeyError, IndexError, TypeError):
            return AIResult(ok=False, error_code="malformed", error="Embedded model returned no message content.", provider=self.name, model=model, latency_ms=latency)
        content = clean_model_output(content)
        if not content:
            return AIResult(ok=False, error_code="empty", error="Model returned no content.", provider=self.name, model=model, latency_ms=latency)
        if finish == "length":
            return AIResult(ok=False, error_code="truncated", error="Model output hit the token limit before completing.",
                            provider=self.name, model=model, raw=content[:2000], latency_ms=latency,
                            prompt_tokens=prompt_tokens, completion_tokens=completion_tokens)
        try:
            data = json.loads(content)
        except json.JSONDecodeError:
            return AIResult(ok=False, error_code="malformed", error="Model output was not valid JSON.", provider=self.name, model=model, raw=content[:2000], latency_ms=latency)
        return AIResult(ok=True, data=data, provider=self.name, model=model, raw=content, latency_ms=latency,
                        prompt_tokens=prompt_tokens, completion_tokens=completion_tokens)

    def list_models(self, timeout: int = 3) -> tuple[bool, list[str], str]:
        """Health contract: 'reachable' means the library imports and the
        file exists. The configured tutor/outline names are reported as
        present because the single embedded file serves both roles."""
        ok, err = library_available()
        if not ok:
            return False, [], err
        valid, err = validate_model_file(self.path)
        if not valid:
            return False, [], err
        if self._llm is None and self._load_error and not self._shared.load_error_transient:
            return False, [], self._load_error
        names = sorted({_cfg("TUTOR_MODEL", ""), _cfg("OUTLINE_MODEL", ""), self.path.name})
        return True, [n for n in names if n], ""

    def describe(self) -> dict:
        """Component-level detail for the system health screen."""
        lib_ok, lib_err = library_available()
        valid, file_err = validate_model_file(self.path)
        shared = self._shared
        return {
            "runtime": {"name": "llama.cpp (llama-cpp-python)", "ready": lib_ok, "error": lib_err},
            "model_file": {"path": str(self.path), "name": self.path.name, "found": self.path.exists(), "valid": valid,
                           "size_mb": self.path.stat().st_size // (1 << 20) if self.path.exists() else 0, "error": file_err},
            "mode": self.mode,
            "loaded": shared.llm is not None,
            "load_count": shared.load_count,
            "load_ms": shared.load_ms,
            "load_error": shared.load_error,
            "load_error_transient": shared.load_error_transient,
            "busy": self._busy(),
            "display_name": _display_name(self.path.name),
        }

    def _busy(self) -> bool:
        # RLock has no ``locked()``; a non-blocking acquire answers the question.
        if self._lock.acquire(blocking=False):
            self._lock.release()
            return False
        return True

    def status_line(self) -> str:
        """One-line summary for logs: provider, model, mode, status."""
        shared = self._shared
        if shared.llm is not None:
            status = "ready (loaded)"
        elif shared.load_error:
            status = f"unavailable: {shared.load_error}"
        else:
            valid, err = validate_model_file(self.path)
            status = "ready (not loaded yet)" if valid else f"unavailable: {err}"
        return f"AI provider: {self.name} | Model: {self.path.name} | Mode: {self.mode} | Status: {status}"

    def pull_model(self, model: str, timeout: int = 1800) -> tuple[bool, str]:
        return False, "The embedded provider does not pull; run `python manage.py fetch_model` once with internet access."

    def warm_up(self) -> tuple[bool, str]:
        """Load the model now (used by check_ai and the launcher) so the first
        student question does not pay the load time."""
        with self._lock:
            llm = self._load()
        return (llm is not None), self._load_error

    def release(self) -> None:
        """Free the model explicitly (tests, shutdown hooks). Never called per request."""
        self._shared.close()