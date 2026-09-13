"""Deterministic validators: failures that can be proven without a judge model.

Every validator is a pure function of (prompt, response, evidence, metadata)
that returns a ``Check``. ``passed`` is True when the check proves nothing is
wrong, False when it found a problem, and None when it could not decide (no
evidence, not applicable). The decision engine in ``services`` treats a None
as a reason to consult the judge and a False as a candidate issue.

The checks are cheap (token overlap, regexes, structural rules) and run on
every monitored interaction, which is what keeps judge calls rare. They are
also the part of the system that is easiest to reason about: an incident
raised by ``source_reference_present`` says exactly which phrase was not in
the source, and a reviewer can confirm that by reading.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from documents.services.chunking import tokenize

from .models import IssueType, Severity

# Lower bound on the share of an answer's content words that must appear in
# the reference passages before a "grounded" answer is believed. Prose that
# paraphrases the source still shares most of its nouns and verbs with it;
# below this the answer is talking about something else.
GROUNDING_MIN_OVERLAP = 0.35
# Share of a quoted source_reference's tokens that must be in the source.
REFERENCE_MIN_OVERLAP = 0.7
# Numbers shorter than this (page-ish, list-ish) are not treated as claims.
NUMBER_RE = re.compile(r"(?<![\w.])(\d{2,}(?:[.,]\d+)?%?)(?![\w.])")
LEAKED_FIELD_RE = re.compile(r"\b(grounded|source_reference|follow_up_suggestions)\s*[=:]", re.IGNORECASE)
PLACEHOLDER_RE = re.compile(r"\[placeholder|placeholder distractor|edit before publishing|lorem ipsum", re.IGNORECASE)
INJECTION_RE = re.compile(r"ignore (all |any )?(previous|prior|above) (instructions|rules)|you are now|system prompt|disregard (the|your) (rules|instructions)|jailbreak", re.IGNORECASE)
MIN_ANSWER_CHARS = 20


@dataclass
class Check:
    name: str
    passed: bool | None
    issue_type: str = IssueType.NONE
    severity: str = Severity.LOW
    confidence: float = 0.0
    detail: str = ""
    evidence: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"name": self.name, "passed": self.passed, "issue_type": self.issue_type, "severity": self.severity,
                "confidence": round(self.confidence, 2), "detail": self.detail, "evidence": self.evidence[:4]}


@dataclass
class Evidence:
    """Reference material the response is judged against."""
    passages: list[dict]  # [{"kind", "ref", "text"}]

    @property
    def text(self) -> str:
        return "\n\n".join(p.get("text", "") for p in self.passages)

    @property
    def tokens(self) -> set[str]:
        """Stemmed content words of every passage."""
        if not hasattr(self, "_tokens"):
            self._tokens = set(stems(self.text))
        return self._tokens

    @property
    def empty(self) -> bool:
        return not self.text.strip()


def stem(token: str) -> str:
    """Crude suffix stripping so 'programs' matches 'program' and 'executing'
    matches 'execution'-ish roots. Deliberately conservative: the overlap
    measures are heuristics and a false match only makes them more lenient."""
    t = token
    for suffix in ("ations", "ation", "ing", "ies", "ers", "es", "ed", "ly", "s"):
        if t.endswith(suffix) and len(t) - len(suffix) >= 3:
            t = t[: -len(suffix)]
            if suffix == "ies":
                t += "y"
            break
    return t


def stems(text: str) -> list[str]:
    return [stem(t) for t in tokenize(text)]


def _overlap(words: list[str], reference: set[str]) -> float:
    if not words:
        return 1.0
    return sum(1 for w in words if w in reference) / len(words)


def _excerpt(text: str, limit: int = 160) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "\u2026"


# ---------------------------------------------------------------- tutor -----

def check_response_shape(response: str) -> Check:
    text = (response or "").strip()
    if len(text) < MIN_ANSWER_CHARS:
        return Check("response_shape", False, IssueType.INSTRUCTION_VIOLATION, Severity.MEDIUM, 0.9,
                     f"Response is {len(text)} characters; a tutor answer should be at least {MIN_ANSWER_CHARS}.")
    if text.lstrip().startswith("{") or text.rstrip().endswith("}"):
        return Check("response_shape", False, IssueType.INSTRUCTION_VIOLATION, Severity.MEDIUM, 0.85,
                     "Response looks like raw JSON rather than prose for a student.", [_excerpt(text)])
    return Check("response_shape", True, detail="Length and shape are those of a prose answer.")


def check_leaked_fields(response: str) -> Check:
    hit = LEAKED_FIELD_RE.search(response or "")
    if hit:
        return Check("leaked_fields", False, IssueType.INSTRUCTION_VIOLATION, Severity.LOW, 0.95,
                     f"Schema field '{hit.group(1)}' leaked into the answer text.", [_excerpt(response[max(0, hit.start() - 40): hit.end() + 40])])
    return Check("leaked_fields", True, detail="No schema fields in the prose.")


def check_grounding_overlap(response: str, evidence: Evidence, claimed_grounded: bool) -> Check:
    """How much of the answer's vocabulary the reference passages contain."""
    if evidence.empty:
        return Check("grounding_overlap", None, detail="No reference passages available; left to the judge.")
    raw = tokenize(response)
    words = [stem(w) for w in raw]
    if len(words) < 6:
        return Check("grounding_overlap", None, detail="Answer too short to measure overlap.")
    share = _overlap(words, evidence.tokens)
    missing = [w for w, st in dict(zip(raw, words)).items() if st not in evidence.tokens][:8]
    if claimed_grounded and share < GROUNDING_MIN_OVERLAP:
        # The further below the bar, the more confident the flag. Capped
        # below the "proven" bar: lexical overlap is a heuristic and the
        # judge gets the final word on it.
        confidence = min(0.85, 0.55 + (GROUNDING_MIN_OVERLAP - share) * 1.5)
        severity = Severity.HIGH if share < 0.15 else Severity.MEDIUM
        return Check("grounding_overlap", False, IssueType.UNSUPPORTED_CLAIM, severity, confidence,
                     f"Only {share:.0%} of the answer's content words appear in the reference passages although the answer is marked grounded.",
                     [f"Not in source: {', '.join(missing)}"] if missing else [])
    if share < 0.5:
        # Not a proven problem, but worth a second opinion.
        return Check("grounding_overlap", None, detail=f"{share:.0%} of content words are in the source; borderline, left to the judge.")
    return Check("grounding_overlap", True, detail=f"{share:.0%} of the answer's content words appear in the reference passages.")


def check_source_reference(source_reference: str, evidence: Evidence, claimed_grounded: bool) -> Check:
    """A source_reference must be a phrase copied from the source text."""
    ref = (source_reference or "").strip()
    if not claimed_grounded:
        return Check("source_reference_present", True, detail="Answer is not marked grounded; no reference expected.")
    if not ref:
        return Check("source_reference_present", False, IssueType.INSTRUCTION_VIOLATION, Severity.LOW, 0.8,
                     "Answer is marked grounded but carries no source_reference.")
    if evidence.empty:
        return Check("source_reference_present", None, detail="No reference passages to check the citation against.")
    # Exact substring first (cheap and decisive), then token overlap for
    # references the model lightly reworded.
    norm = " ".join(ref.lower().split())
    if norm and norm in " ".join(evidence.text.lower().split()):
        return Check("source_reference_present", True, detail="Cited phrase found verbatim in the source.", evidence=[_excerpt(ref)])
    words = stems(ref)
    share = _overlap(words, evidence.tokens) if words else 0.0
    if share >= REFERENCE_MIN_OVERLAP:
        return Check("source_reference_present", True, detail=f"Cited phrase is {share:.0%} present in the source (reworded).", evidence=[_excerpt(ref)])
    return Check("source_reference_present", False, IssueType.UNSUPPORTED_CLAIM, Severity.MEDIUM, 0.85,
                 f"The cited source phrase is not in the reference material ({share:.0%} of its words match).", [f"Cited: {_excerpt(ref)}"])


def check_numeric_claims(response: str, evidence: Evidence) -> Check:
    """Numbers, years and percentages in the answer must appear in the source."""
    if evidence.empty:
        return Check("numeric_claims", None, detail="No reference passages; numbers cannot be verified.")
    numbers = [n for n in NUMBER_RE.findall(response or "")]
    if not numbers:
        return Check("numeric_claims", True, detail="No numeric claims in the answer.")
    source = evidence.text
    unsupported = [n for n in dict.fromkeys(numbers) if n not in source and n.rstrip("%") not in source]
    if not unsupported:
        return Check("numeric_claims", True, detail=f"All {len(set(numbers))} numeric value(s) appear in the source.", evidence=numbers[:4])
    share = len(unsupported) / len(set(numbers))
    return Check("numeric_claims", False, IssueType.FACTUAL_ERROR, Severity.MEDIUM if share < 1 else Severity.HIGH,
                 min(0.85, 0.5 + 0.35 * share),
                 f"{len(unsupported)} numeric value(s) in the answer do not occur in the source.",
                 [f"Not in source: {', '.join(unsupported[:6])}"])


def check_relevance(prompt: str, response: str, claimed_grounded: bool) -> Check:
    q = set(stems(prompt))
    a = set(stems(response))
    if not q:
        # Nothing to compare against ("hi", "?"); nothing can be proven wrong.
        return Check("relevance", True, detail="Question has no content words to compare.")
    shared = q & a
    if shared:
        return Check("relevance", True, detail=f"Answer shares {len(shared)} term(s) with the question.", evidence=sorted(shared)[:5])
    if not claimed_grounded:
        return Check("relevance", True, detail="Off-topic question was declined, as intended.")
    return Check("relevance", False, IssueType.IRRELEVANT, Severity.LOW, 0.55,
                 "The answer shares no content words with the question; it may not address what was asked.")


def check_prompt_injection(prompt: str) -> Check:
    """Not an issue with the AI: a note that the student prompt tried to steer
    it. Recorded so the judge treats the prompt as data, not instruction."""
    hit = INJECTION_RE.search(prompt or "")
    if hit:
        return Check("prompt_injection_marker", None, detail=f"Prompt contains steering language ('{hit.group(0)}'); treated as untrusted input.")
    return Check("prompt_injection_marker", True, detail="No steering language in the prompt.")


def run_tutor_checks(*, prompt: str, response: str, source_reference: str, claimed_grounded: bool, evidence: Evidence) -> list[Check]:
    return [
        check_response_shape(response),
        check_leaked_fields(response),
        check_source_reference(source_reference, evidence, claimed_grounded),
        check_grounding_overlap(response, evidence, claimed_grounded),
        check_numeric_claims(response, evidence),
        check_relevance(prompt, response, claimed_grounded),
        check_prompt_injection(prompt),
    ]


# ----------------------------------------------------------------- quiz -----

MCQ_KEYS = ["A", "B", "C", "D"]


def check_quiz_structure(questions: list[dict]) -> Check:
    problems = []
    for idx, q in enumerate(questions or [], start=1):
        label = q.get("id") or f"q{idx}"
        if not str(q.get("question") or "").strip():
            problems.append(f"{label}: empty question text")
        if (q.get("type") or "mcq") == "mcq":
            opts = q.get("options") or []
            keys = [str(o.get("key", "")).upper() for o in opts]
            if len(opts) != 4 or sorted(keys) != MCQ_KEYS:
                problems.append(f"{label}: expected options A-D, got {keys or 'none'}")
            texts = [str(o.get("text") or "").strip() for o in opts]
            if any(not t for t in texts):
                problems.append(f"{label}: an option has no text")
            if len({t.casefold() for t in texts}) != len(texts):
                problems.append(f"{label}: duplicate option texts")
            if str(q.get("correct_answer", "")).upper() not in keys:
                problems.append(f"{label}: correct_answer '{q.get('correct_answer')}' is not an option key")
            if not str(q.get("explanation") or "").strip():
                problems.append(f"{label}: missing explanation")
        elif q.get("type") == "subjective":
            if not str(q.get("expected_rubric") or "").strip():
                problems.append(f"{label}: subjective question has no rubric")
        else:
            problems.append(f"{label}: unknown type {q.get('type')}")
    if not questions:
        problems.append("quiz has no questions")
    if problems:
        return Check("quiz_structure", False, IssueType.QUIZ_ERROR, Severity.HIGH, 0.95,
                     f"{len(problems)} structural problem(s) in the question set.", problems)
    return Check("quiz_structure", True, detail=f"{len(questions)} question(s) are well-formed.")


def check_quiz_placeholders(questions: list[dict]) -> Check:
    hits = []
    for idx, q in enumerate(questions or [], start=1):
        label = q.get("id") or f"q{idx}"
        texts = [q.get("question", ""), q.get("explanation", "")] + [o.get("text", "") for o in (q.get("options") or [])]
        if any(PLACEHOLDER_RE.search(str(t)) for t in texts):
            hits.append(f"{label}: placeholder text")
    if hits:
        return Check("quiz_placeholders", False, IssueType.QUIZ_ERROR, Severity.HIGH, 0.95,
                     "Placeholder text left in the question set; it must be edited before students see it.", hits)
    return Check("quiz_placeholders", True, detail="No placeholder text.")


def check_quiz_duplicates(questions: list[dict]) -> Check:
    seen, dupes = set(), []
    for idx, q in enumerate(questions or [], start=1):
        key = " ".join(str(q.get("question", "")).split()).casefold()
        if key in seen:
            dupes.append(q.get("id") or f"q{idx}")
        seen.add(key)
    if dupes:
        return Check("quiz_duplicates", False, IssueType.QUIZ_ERROR, Severity.MEDIUM, 0.9, "Repeated questions in one quiz.", dupes)
    return Check("quiz_duplicates", True, detail="Every question is distinct.")


def check_quiz_source_references(questions: list[dict], evidence: Evidence) -> Check:
    if evidence.empty:
        return Check("quiz_source_references", None, detail="No source text to verify references against.")
    source = " ".join(evidence.text.lower().split())
    missing = []
    for idx, q in enumerate(questions or [], start=1):
        ref = " ".join(str(q.get("source_reference") or "").lower().split())
        if not ref:
            missing.append(f"{q.get('id') or f'q{idx}'}: no source_reference")
            continue
        if ref in source:
            continue
        words = stems(ref)
        if words and _overlap(words, evidence.tokens) >= REFERENCE_MIN_OVERLAP:
            continue
        missing.append(f"{q.get('id') or f'q{idx}'}: '{_excerpt(ref, 80)}' not in source")
    if not missing:
        return Check("quiz_source_references", True, detail="Every question cites a phrase found in the source.")
    share = len(missing) / max(1, len(questions))
    return Check("quiz_source_references", False, IssueType.UNSUPPORTED_CLAIM,
                 Severity.HIGH if share > 0.5 else Severity.MEDIUM, min(0.9, 0.6 + 0.3 * share),
                 f"{len(missing)} of {len(questions)} question(s) cite text that is not in the source.", missing)


def check_quiz_answer_grounding(questions: list[dict], evidence: Evidence) -> Check:
    """The correct option (and the explanation) should be made of words the
    source uses; a correct answer the source never mentions is the classic
    hallucinated answer key."""
    if evidence.empty:
        return Check("quiz_answer_grounding", None, detail="No source text to check answer keys against.")
    weak = []
    for idx, q in enumerate(questions or [], start=1):
        if (q.get("type") or "mcq") != "mcq":
            continue
        key = str(q.get("correct_answer", "")).upper()
        correct = next((o.get("text", "") for o in (q.get("options") or []) if str(o.get("key", "")).upper() == key), "")
        words = stems(f"{correct} {q.get('explanation', '')}")
        if len(words) < 3:
            continue
        share = _overlap(words, evidence.tokens)
        if share < GROUNDING_MIN_OVERLAP:
            weak.append(f"{q.get('id') or f'q{idx}'}: answer '{_excerpt(correct, 60)}' is {share:.0%} in source")
    if not weak:
        return Check("quiz_answer_grounding", True, detail="Answer keys use the source's vocabulary.")
    share = len(weak) / max(1, len(questions))
    return Check("quiz_answer_grounding", False, IssueType.HALLUCINATION,
                 Severity.HIGH if share > 0.5 else Severity.MEDIUM, min(0.85, 0.55 + 0.3 * share),
                 f"{len(weak)} answer key(s) are not supported by the source text.", weak)


def run_quiz_checks(*, questions: list[dict], evidence: Evidence) -> list[Check]:
    return [
        check_quiz_structure(questions),
        check_quiz_placeholders(questions),
        check_quiz_duplicates(questions),
        check_quiz_source_references(questions, evidence),
        check_quiz_answer_grounding(questions, evidence),
    ]
