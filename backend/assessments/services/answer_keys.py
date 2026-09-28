"""Pure, shared answer validation. No model calls and no first-letter guessing."""
from __future__ import annotations

import re
import unicodedata

KEYS = ("A", "B", "C", "D")
# Hand-written questions may have two to six options (A-F); AI questions keep four.
ALL_KEYS = ("A", "B", "C", "D", "E", "F")
MIN_OPTIONS, MAX_OPTIONS = 2, len(ALL_KEYS)
_DECORATED = re.compile(r"^(?:(?:option|answer|choice)\s*[:\-]?\s*)?[\[(]?\s*([a-f])\s*[\])]?\s*[.:]?\s*$", re.I)


def comparable(value) -> str:
    return " ".join(unicodedata.normalize("NFKC", str(value or "")).split()).casefold()


def normalize_correct_answer(raw, options: list[dict]) -> str:
    """Accept a bare/decorated option key (A-F) or exactly one option's full text.

    An input that identifies two different options is refused, not guessed.
    The returned key always refers to the supplied option labels, not positions.
    """
    if (not isinstance(options, list) or not MIN_OPTIONS <= len(options) <= MAX_OPTIONS
            or any(not isinstance(o, dict) for o in options)):
        raise ValueError(f"A multiple-choice question needs {MIN_OPTIONS} to {MAX_OPTIONS} option objects.")
    expected = list(ALL_KEYS[:len(options)])
    if sorted(str(o.get("key", "")).upper() for o in options) != expected:
        raise ValueError(f"Options must have exactly the keys {', '.join(expected)}.")
    text = comparable(raw)
    if not text:
        raise ValueError("The correct answer is missing.")
    candidates = set()
    keys = {str(o["key"]).upper() for o in options}
    match = _DECORATED.fullmatch(text)
    # A letter only counts if that option exists: "D" on a three-option question is refused.
    if match and match.group(1).upper() in keys:
        candidates.add(match.group(1).upper())
    candidates.update(str(o["key"]).upper() for o in options if comparable(o.get("text")) == text)
    if len(candidates) != 1:
        raise ValueError("The correct answer is ambiguous or does not match an option key or any complete option text.")
    return candidates.pop()


def require_question_counts(questions: list[dict], mcqs: int, subjective: int) -> None:
    """All-or-nothing generation: a partial bank is not the requested bank."""
    for count in (mcqs, subjective):
        if not isinstance(count, int) or isinstance(count, bool) or count < 0:
            raise ValueError("Question counts must be nonnegative integers.")
    actual = {"mcq": 0, "subjective": 0}
    for question in questions:
        kind = question.get("type")
        if kind not in actual:
            raise ValueError("Unexpected question type.")
        actual[kind] += 1
    if actual != {"mcq": mcqs, "subjective": subjective}:
        raise ValueError(f"Requested {mcqs} multiple-choice and {subjective} written questions; "
                         f"received {actual['mcq']} and {actual['subjective']}. No quiz was saved.")
