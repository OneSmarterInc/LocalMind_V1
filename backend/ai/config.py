"""One place for every AI performance number.

The provider used to apply the same context window and 4096-token output cap
to every call, whether the caller wanted a 100-word answer or a ten-question
quiz. This module turns ``AI_PERFORMANCE_MODE`` (fast / balanced / quality)
into a base profile and lets any single value be overridden by its own
environment variable, so nothing downstream carries a literal number.

Callers ask for the task they are performing::

    from ai.config import task_config
    cfg = task_config("tutor")
    cfg.max_tokens, cfg.temperature, cfg.top_p, cfg.source_chars

and the gateway passes those to the provider. Adding a task means adding a
row to ``TASKS`` below, nowhere else.
"""
from __future__ import annotations

from dataclasses import dataclass

from django.conf import settings

MODES = ("fast", "balanced", "quality")

# Per-mode base values. ``source_chars`` is the character budget for source
# text placed in a prompt; ``history`` the number of recent conversation
# messages the tutor sees; ``num_ctx`` the model context window.
_PROFILES = {
    "fast": {
        "num_ctx": 8192,
        "source_chars": 8000,
        "history": 4,
        "max_tokens": {"tutor": 512, "quiz": 1400, "lesson": 1000, "remediation": 800, "outline": 800,
                       "evaluate": 400, "assignment": 700, "monitor": 600},
    },
    "balanced": {
        "num_ctx": 12288,
        "source_chars": 11000,
        "history": 6,
        "max_tokens": {"tutor": 768, "quiz": 2000, "lesson": 1500, "remediation": 1100, "outline": 1200,
                       "evaluate": 500, "assignment": 900, "monitor": 700},
    },
    "quality": {
        "num_ctx": 16384,
        "source_chars": 14000,
        "history": 8,
        "max_tokens": {"tutor": 1024, "quiz": 3000, "lesson": 2500, "remediation": 1600, "outline": 2000,
                       "evaluate": 600, "assignment": 1200, "monitor": 800},
    },
}

# Sampling defaults per task. Temperature 0 makes the provider use a narrow
# top_p, which is what structured JSON wants; creative tasks get a little
# room so two quizzes on the same module differ.
_SAMPLING = {
    "tutor": (0.2, 0.9),
    "quiz": (0.7, 0.9),
    "lesson": (0.3, 0.9),
    "remediation": (0.2, 0.9),
    "outline": (0.0, 0.1),
    "evaluate": (0.0, 0.1),
    "assignment": (0.5, 0.9),
    # The monitoring judge: deterministic, narrow sampling, JSON verdict.
    "monitor": (0.0, 0.1),
}

# Retrieval budgets: how many chunks the tutor sends, and the quiz's source
# cap as a share of the mode's source budget (a quiz wants coverage of the
# whole module, the tutor wants the passages that answer one question).
_RETRIEVAL = {"tutor_chunks": 3, "tutor_chunks_max": 4}

# Environment names, so the override list is visible in one place.
ENV_MAX_TOKENS = {
    "tutor": "AI_TUTOR_MAX_TOKENS", "quiz": "AI_QUIZ_MAX_TOKENS", "lesson": "AI_LESSON_MAX_TOKENS",
    "remediation": "AI_REMEDIATION_MAX_TOKENS", "outline": "AI_OUTLINE_MAX_TOKENS",
    "evaluate": "AI_EVALUATE_MAX_TOKENS", "assignment": "AI_ASSIGNMENT_MAX_TOKENS",
    "monitor": "AI_MONITOR_MAX_TOKENS",
}
TASKS = tuple(ENV_MAX_TOKENS)


@dataclass(frozen=True)
class TaskConfig:
    task: str
    mode: str
    num_ctx: int
    max_tokens: int
    temperature: float
    top_p: float
    source_chars: int
    history_messages: int
    retrieval_chunks: int

    def as_dict(self) -> dict:
        return {"task": self.task, "mode": self.mode, "num_ctx": self.num_ctx, "max_tokens": self.max_tokens,
                "temperature": self.temperature, "top_p": self.top_p, "source_chars": self.source_chars,
                "history_messages": self.history_messages, "retrieval_chunks": self.retrieval_chunks}


def _ai(name: str, default=None):
    return settings.AI.get(name, default)


def performance_mode() -> str:
    mode = str(_ai("PERFORMANCE_MODE", "fast") or "fast").lower()
    return mode if mode in MODES else "fast"


def _profile() -> dict:
    return _PROFILES[performance_mode()]


def _override(name: str, fallback):
    """A per-value env override wins over the mode profile when it is set
    (settings store None for unset overrides)."""
    value = _ai(name)
    return fallback if value in (None, "", 0) else value


def num_ctx() -> int:
    return int(_override("NUM_CTX", _profile()["num_ctx"]))


def source_chars() -> int:
    return int(_override("MAX_SOURCE_CHARS", _profile()["source_chars"]))


def history_messages() -> int:
    return int(_override("MAX_CONVERSATION_MESSAGES", _profile()["history"]))


def max_tokens_for(task: str) -> int:
    profile = _profile()["max_tokens"]
    base = profile.get(task, profile["tutor"])
    return int(_override(f"MAX_TOKENS_{task.upper()}", base))


def task_config(task: str) -> TaskConfig:
    task = task if task in TASKS else "tutor"
    temperature, top_p = _SAMPLING[task]
    return TaskConfig(
        task=task, mode=performance_mode(), num_ctx=num_ctx(), max_tokens=max_tokens_for(task),
        temperature=temperature, top_p=top_p, source_chars=source_chars(),
        history_messages=history_messages(),
        retrieval_chunks=int(_override("RETRIEVAL_CHUNKS", _RETRIEVAL["tutor_chunks"])),
    )


def describe() -> dict:
    """Snapshot for logs, the health screen and the benchmark command."""
    return {"mode": performance_mode(), "num_ctx": num_ctx(), "source_chars": source_chars(),
            "history_messages": history_messages(), "max_tokens": {t: max_tokens_for(t) for t in TASKS}}
