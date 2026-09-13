"""Keep "the source text" out of what students read.

Prompts give the model a block of textbook text, and small models then talk
about that block: "According to the source text, ...", "The passage says ...".
Students never see a "source text"; they see a module. These helpers repair
that phrasing in model output. Quiz generation drops a question that still
depends on the block after repair; tutor answers, which cannot be dropped,
have leftover references reworded to "this module".
"""
import re

DOC_WORDS = r"(?:source\s+text|source\s+material|textbook\s+section|source|text|passage|excerpt|paragraph|module)"
DOC_REF = rf"(?:the|this|that|given|above|provided|following)\s+(?:(?:given|above|provided|following|study)\s+)?{DOC_WORDS}"

# "According to the source text, ..." at the start of a sentence.
LEAD_IN = re.compile(rf"^\s*(?:according\s+to|based\s+on|as\s+(?:stated|described|mentioned|explained|given|shown)\s+in|in|from|per)\s+{DOC_REF}\s*[,:-]?\s*", re.I)
# "The passage says that ..." / "The text explains ..."
SAYS = re.compile(rf"\b{DOC_REF}\s+(?:says|states|mentions|explains|describes|notes|tells\s+us|shows)(?:\s+that)?\s*", re.I)
# "..., as mentioned in the text" anywhere.
INLINE = re.compile(rf"\s*,?\s*(?:(?:as\s+)?(?:stated|described|mentioned|explained|given|shown|discussed|defined|listed)\s+)?(?:in|by|from|within|according\s+to|as\s+per|based\s+on)\s+{DOC_REF}\b", re.I)
# Anything still pointing at the block after repair.
META = re.compile(rf"\b(?:source\s+text|source\s+material|{DOC_REF}|the\s+author|the\s+writer)\b", re.I)

_SENTENCE = re.compile(r"(?<=[.!?])\s+")


def tidy(text: str) -> str:
    text = " ".join(str(text or "").split())
    text = re.sub(r"\s+([?.!,;:])", r"\1", text)
    text = re.sub(r"^[,;:\-\s]+", "", text)
    return text[:1].upper() + text[1:] if text else text


def repair(text: str) -> str:
    """Remove lead-ins, "the text says" and inline references, sentence by sentence."""
    out = []
    for sentence in _SENTENCE.split(str(text or "")):
        s = LEAD_IN.sub("", sentence)
        s = SAYS.sub("", s)
        s = INLINE.sub("", s)
        s = tidy(s)
        if s:
            out.append(s)
    return " ".join(out)


def mentions_material(text: str) -> bool:
    return bool(META.search(str(text or "")))


def for_students(text: str) -> str:
    """Repair, then word any remaining reference as "this module"."""
    repaired = repair(text)
    repaired = re.sub(rf"\b(?:source\s+text|source\s+material|{DOC_REF})\b", "this module", repaired, flags=re.I)
    return tidy(repaired)
