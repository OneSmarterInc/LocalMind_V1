"""Shared field checks for account data."""
import re

from core.exceptions import ValidationFailed

# LocalMind is used wherever the institution is, so a strict national format
# would reject correct numbers. What a check can honestly catch is a typo or
# the wrong field: stray letters, too few digits to dial, more digits than any
# country uses. E.164 allows at most 15 digits; the shortest usable national
# numbers run to 7.
PHONE_ALLOWED = re.compile(r"^[0-9+()\-.\s]+$")
PHONE_MIN_DIGITS = 7
PHONE_MAX_DIGITS = 15


def phone_problem(value):
    """The complaint about ``value``, or None when it looks usable. Blank is
    fine: a phone number is optional everywhere it is asked for."""
    raw = (value or "").strip()
    if not raw:
        return None
    if not PHONE_ALLOWED.match(raw):
        return "Use digits, spaces, brackets, hyphens and an optional leading +."
    if "+" in raw and not raw.startswith("+"):
        return "A country code goes at the start, as +91."
    digits = re.sub(r"\D", "", raw)
    if len(digits) < PHONE_MIN_DIGITS:
        return f"A phone number needs at least {PHONE_MIN_DIGITS} digits."
    if len(digits) > PHONE_MAX_DIGITS:
        return f"A phone number has at most {PHONE_MAX_DIGITS} digits, including the country code."
    return None


def clean_phone(value, field="phone"):
    """``value`` stripped, or a ValidationFailed naming the field."""
    problem = phone_problem(value)
    if problem:
        raise ValidationFailed(problem, details={field: [problem]})
    return (value or "").strip()
