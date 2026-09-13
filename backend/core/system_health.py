"""Offline-readiness report for the admin console and the launcher.

Every component that LocalMind needs to run with the network unplugged is
checked here and reported as READY / ERROR / MISSING with a human-readable
reason, so an admin can tell at a glance whether the installation is
self-contained. Never raises; a component that cannot be checked is an
ERROR with the exception text.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

from django.conf import settings
from django.db import connection

from ai import gateway as ai_gateway

READY, ERROR, MISSING = "READY", "ERROR", "MISSING"


def _component(component: str, status: str, summary: str, **extra) -> dict:
    return {"component": component, "status": status, "summary": summary, **extra}


def check_database() -> dict:
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        engine = connection.vendor
        return _component("database", READY, f"{engine} reachable", engine=engine)
    except Exception as exc:
        return _component("database", ERROR, str(exc))


def check_storage() -> dict:
    root = Path(settings.MEDIA_ROOT)
    try:
        root.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=root, prefix=".healthcheck-", delete=True):
            pass
        return _component("storage", READY, f"media folder writable ({root})", path=str(root))
    except Exception as exc:
        return _component("storage", ERROR, f"{root}: {exc}", path=str(root))


def check_ai(force: bool = False) -> tuple[dict, dict]:
    """Returns (runtime component, model component)."""
    cfg = settings.AI
    if not cfg["ENABLED"]:
        msg = "AI disabled by configuration (AI_ENABLED=false); deterministic fallbacks in use"
        return _component("ai_runtime", ERROR, msg, provider=cfg["PROVIDER"]), _component("ai_model", ERROR, msg)
    status = ai_gateway.health(force=force)
    d = status.details or {}
    if cfg["PROVIDER"] == "llamacpp":
        rt = d.get("runtime", {})
        mf = d.get("model_file", {})
        runtime = _component("ai_runtime", READY if rt.get("ready") else ERROR,
                             "llama.cpp runtime loaded" if rt.get("ready") else rt.get("error", "llama.cpp runtime unavailable"),
                             provider="llama.cpp", library="llama-cpp-python", mode=d.get("mode", "embedded/offline"),
                             model_loaded=d.get("loaded", False), load_count=d.get("load_count", 0), busy=d.get("busy", False))
        if mf.get("valid"):
            model = _component("ai_model", READY, f"{d.get('display_name')} · {mf.get('size_mb')} MB · file valid",
                               name=d.get("display_name"), file=mf.get("name"), path=mf.get("path"), size_mb=mf.get("size_mb"), found=True, valid=True)
        else:
            model = _component("ai_model", MISSING if not mf.get("found") else ERROR, mf.get("error", "model file problem"),
                               name=d.get("display_name"), file=mf.get("name"), path=mf.get("path"), found=mf.get("found", False), valid=False)
        if d.get("load_error") and runtime["status"] == READY:
            message = d["load_error"]
            if d.get("load_error_transient"):
                message += " (transient; the load is retried automatically)"
            runtime = _component("ai_runtime", ERROR, message, provider="llama.cpp", transient=bool(d.get("load_error_transient")))
        return runtime, model
    # Ollama: an external daemon, so the runtime is "reachable" and the model is "pulled".
    runtime = _component("ai_runtime", READY if status.reachable else ERROR,
                         f"Ollama reachable at {status.base_url}" if status.reachable else f"Ollama unreachable at {status.base_url}: {status.error}",
                         provider="Ollama", base_url=status.base_url, external=True)
    missing = [m for m in {status.tutor_model, status.outline_model} if not status.model_present(m)]
    model = _component("ai_model", READY if status.reachable and not missing else MISSING,
                       f"{status.tutor_model} pulled" if not missing else f"not pulled: {', '.join(sorted(missing))} (ollama pull <model>)",
                       name=status.tutor_model, found=not missing, valid=not missing)
    return runtime, model


def check_document_processing() -> dict:
    try:
        import docling  # noqa: F401
    except Exception as exc:
        return _component("document_processing", ERROR, f"docling not importable: {exc}. DOCX still parses; PDF needs docling.")
    from documents.services.parser import docling_artifacts_dir

    folder = Path(settings.AI.get("DOCLING_ARTIFACTS") or Path(settings.BASE_DIR) / "models" / "docling")
    if docling_artifacts_dir() is None:
        return _component("document_processing", MISSING,
                          f"Docling layout models not found in {folder}; the first PDF would try to download them. Run `python manage.py fetch_model --docling`.",
                          artifacts=str(folder), local_artifacts=False)
    from documents.services.parser import legacy_doc_support
    doc_ok, doc_reason = legacy_doc_support()
    legacy = "legacy .doc uploads accepted" if doc_ok else f"legacy .doc uploads refused ({doc_reason})"
    if not (folder / "localmind-table-models.ready").is_file():
        return _component("document_processing", MISSING,
                          "This installation has not confirmed the table-model download. Run `python manage.py fetch_model --docling --skip-llm` once online, then restart.")
    return _component("document_processing", READY, f"docling installed, layout/table download recorded ({folder}); {legacy}",
                      artifacts=str(folder), local_artifacts=True, legacy_doc=doc_ok)


def check_web_client() -> dict:
    if settings.SERVE_WEB:
        return _component("web_client", READY, f"web build served from {settings.WEB_DIST}", path=str(settings.WEB_DIST))
    return _component("web_client", MISSING, f"no web build at {settings.WEB_DIST}; run `npm run export:web` (or serve the client separately)", path=str(settings.WEB_DIST))


def check_offline(components: list[dict]) -> dict:
    by = {c["component"]: c for c in components}
    blockers = []
    if settings.AI["ENABLED"] and settings.AI["PROVIDER"] != "llamacpp":
        blockers.append(f"AI provider is {settings.AI['PROVIDER']}, an external service rather than the embedded model")
    for name in ("ai_runtime", "ai_model", "document_processing"):
        if by.get(name, {}).get("status") != READY:
            blockers.append(f"{name.replace('_', ' ')}: {by.get(name, {}).get('summary', 'not checked')}")
    if os.environ.get("HF_HUB_OFFLINE") not in (None, "", "1"):
        blockers.append("HF_HUB_OFFLINE is set to a value other than 1")
    if blockers:
        return _component("offline_mode", ERROR, "; ".join(blockers), blockers=blockers)
    return _component("offline_mode", READY, "every runtime dependency is local; no network needed", blockers=[])


def check_ai_monitor() -> dict:
    """The independent evaluation layer: validators always run; the judge
    needs a usable model (its own or the application's)."""
    try:
        from ai_monitor import services as monitor
    except Exception as exc:  # pragma: no cover - app missing
        return _component("ai_monitor", ERROR, f"ai_monitor not importable: {exc}")
    if not monitor.enabled():
        return _component("ai_monitor", ERROR, "AI monitor disabled (AI_MONITOR_ENABLED=false or AI_MONITOR_MODE=off)", enabled=False)
    try:
        state = monitor.status()
    except Exception as exc:
        return _component("ai_monitor", ERROR, f"monitor status failed: {exc}")
    summary = f"monitor {state['mode']}; judge {'ready' if state['judge_ready'] else 'unavailable'}: {state['judge_detail']}; backlog {state['pending_backlog']}"
    return _component("ai_monitor", READY if state["judge_ready"] else ERROR, summary, **state)


def system_status(force: bool = False) -> dict:
    components = [_component("backend", READY, "LocalMind API responding"), check_database(), check_storage()]
    runtime, model = check_ai(force=force)
    components += [runtime, model, check_document_processing(), check_web_client(), check_ai_monitor()]
    components.append(check_offline(components))
    overall = READY if all(c["status"] == READY for c in components if c["component"] not in ("web_client", "ai_monitor")) else ERROR
    return {"status": overall, "components": components, "ai": ai_gateway.health().as_dict()}
