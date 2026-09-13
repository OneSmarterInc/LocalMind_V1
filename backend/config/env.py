"""Small typed accessors for environment configuration.

All deployment configuration passes through here so nothing else in the
codebase reads os.environ directly.
"""
import os
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), _clean_value(value))


def _clean_value(raw: str) -> str:
    """``KEY=value   # note`` is how SETUP_README shows settings, and a pasted
    line used to keep the comment as part of the value (so
    ``AI_MONITOR_ENABLED=true  # master switch`` read as false). A ``#`` after
    whitespace starts a comment unless the value is quoted."""
    value = raw.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    for i, ch in enumerate(value):
        if ch == "#" and i > 0 and value[i - 1] in " \t":
            return value[:i].rstrip()
    return value


BASE_DIR = Path(__file__).resolve().parent.parent
_load_dotenv(BASE_DIR / ".env")


def env_str(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    try:
        return int(raw) if raw is not None else default
    except ValueError:
        return default


def env_list(name: str, default: str = "") -> list[str]:
    raw = os.environ.get(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]
