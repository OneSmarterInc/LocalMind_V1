"""Shared field checks for account data."""
import re

from core.exceptions import ValidationFailed

PHONE_ALLOWED = re.compile(r"^[0-9+()\-.\s]+$")
# The national number, with any country code taken off the front. Ten digits is
# what India and the US use and what the institution asks for; a number written
# with +91 or +1 in front still has to have ten after it.
PHONE_DIGITS = 10
MAX_COUNTRY_CODE_DIGITS = 3


def national_digits(raw):
    """The digits of the number itself, after removing a leading country code.
    Only a number written with a leading + has one to remove: bare digits are
    read as a national number, so 9876543210 keeps all ten."""
    digits = re.sub(r"\D", "", raw)
    if not raw.strip().startswith("+"):
        return digits
    for code in range(1, MAX_COUNTRY_CODE_DIGITS + 1):
        if len(digits) - code == PHONE_DIGITS:
            return digits[code:]
    return digits


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
    national = national_digits(raw)
    if len(national) == PHONE_DIGITS:
        return None
    if len(national) < PHONE_DIGITS:
        return f"A phone number needs {PHONE_DIGITS} digits, not counting the country code."
    return f"A phone number is {PHONE_DIGITS} digits, not counting the country code."


def clean_phone(value, field="phone"):
    """``value`` stripped, or a ValidationFailed naming the field."""
    problem = phone_problem(value)
    if problem:
        raise ValidationFailed(problem, details={field: [problem]})
    return (value or "").strip()
