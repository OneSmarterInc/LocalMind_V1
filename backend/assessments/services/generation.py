"""Quiz question generation.

Questions are written by the tutor model from the modules a quiz is built on,
and only from those modules. Nothing here ever produces placeholder
questions: when the model cannot write enough, the quiz gets the questions
that did pass every check and the caller is told how many are missing, and
when it writes none the caller gets an error instead of a draft full of
"edit before publishing" options.

How a request becomes questions
-------------------------------
1. Allocation. The requested counts are spread across the chosen modules in
   proportion to how much text each has, and no module is asked for more
   questions than its text can carry (a 300-character "Questions" box
   supports one, not five). If the modules together cannot carry the
   request, fewer are generated and the reason is reported.
2. Batches. Each module's questions are asked for a few at a time, each
   batch reading its own slice of that module's text. A small model writing
   ten questions in one reply runs out of output room and the whole reply is
   lost; three at a time finishes, and different slices keep the questions
   from clustering on the first paragraph.
3. Truncation. A batch cut off at the token limit is split in half and asked
   again, instead of repeating the identical request that was just cut off.
4. Checks. Every question must read like a printed exam question: no "source
   text", "the passage" or "according to the text"; four real, distinct
   options with no "Option A", "All of the above" or bracketed filler. Wording
   that can be repaired is repaired; anything else is dropped. Options are
   shuffled so the correct letter is not always the model's favourite.
5. Top-up. Modules that came back short get one more round.
"""
import hashlib
import logging
import math
import random
import re

from ai.config import task_config
from ai.gateway import gateway
from core.exceptions import APIError, ValidationFailed

logger = logging.getLogger("localmind.assessments")

MCQ_KEYS = ["A", "B", "C", "D"]

# Questions per model call. Three multiple-choice questions fit comfortably in
# a small model's output budget on a CPU; open-ended ones are shorter.
MCQ_BATCH = 3
SUBJECTIVE_BATCH = 2
# Output tokens to allow per question, plus room for the JSON around them.
TOKENS_PER_MCQ = 190
TOKENS_PER_SUBJECTIVE = 170
TOKENS_OVERHEAD = 60
# How much text one question needs, so a short module is not asked for more
# questions than it can support without repeating itself.
CHARS_PER_MCQ = 250
CHARS_PER_SUBJECTIVE = 500
# Source characters shown per call. Smaller prompts are faster on a CPU and
# keep each batch focused on its own part of the module.
CHARS_PER_CALL = 4500

RETRY_ON = frozenset({"empty", "malformed", "invalid_schema"})


class QuizGenerationFailed(APIError):
    status_code = 503
    code = "QUIZ_GENERATION_FAILED"
    message = "The tutor model could not write questions for these modules."


def mcq_schema(n):
    """n multiple-choice questions: four plain option strings and a letter."""
    return {
        "type": "array", "minItems": n, "maxItems": n,
        "items": {"type": "object", "properties": {
            "question": {"type": "string"},
            "options": {"type": "array", "minItems": 4, "maxItems": 4, "items": {"type": "string"}},
            "answer": {"type": "string", "enum": MCQ_KEYS},
            "explanation": {"type": "string"},
            "quote": {"type": "string"},
        }, "required": ["question", "options", "answer", "explanation", "quote"]},
    }


def subjective_schema(n):
    return {
        "type": "array", "minItems": n, "maxItems": n,
        "items": {"type": "object", "properties": {
            "question": {"type": "string"}, "rubric": {"type": "string"}, "quote": {"type": "string"},
        }, "required": ["question", "rubric", "quote"]},
    }


def normalize_questions(raw_questions):
    """Validate and canonicalise a question list (manual or AI). Raises on problems."""
    out, errors = [], []
    for idx, q in enumerate(raw_questions or [], start=1):
        qtype = (q.get("type") or "mcq").lower()
        text = str(q.get("question") or "").strip()
        if not text:
            errors.append(f"q{idx}: question text is required")
            continue
        item = {"id": f"q{idx}", "type": qtype, "question": text, "source_reference": str(q.get("source_reference") or "")}
        if q.get("source_module_id"):
            # Which chosen module the question was written from (AI questions).
            item["source_module_id"] = str(q["source_module_id"])
        if qtype == "mcq":
            options = q.get("options") or []
            if len(options) != 4:
                errors.append(f"q{idx}: mcq needs exactly 4 options")
                continue
            keys = []
            norm = []
            for pos, opt in enumerate(options):
                key = str(opt.get("key") or MCQ_KEYS[pos]).strip().upper()
                keys.append(key)
                norm.append({"key": key, "text": str(opt.get("text") or "").strip()})
            if sorted(keys) != MCQ_KEYS or any(not o["text"] for o in norm):
                errors.append(f"q{idx}: options must be A-D with text")
                continue
            if len({o["text"].casefold() for o in norm}) != 4:
                errors.append(f"q{idx}: options must be distinct")
                continue
            correct = str(q.get("correct_answer") or "").strip().upper()
            if correct not in MCQ_KEYS:
                errors.append(f"q{idx}: correct_answer must be one of A-D")
                continue
            item.update({"options": norm, "correct_answer": correct, "explanation": str(q.get("explanation") or "")})
        elif qtype == "subjective":
            rubric = str(q.get("expected_rubric") or "").strip()
            if not rubric:
                errors.append(f"q{idx}: subjective question needs expected_rubric")
                continue
            item["expected_rubric"] = rubric
        else:
            errors.append(f"q{idx}: unsupported type {qtype}")
            continue
        out.append(item)
    if errors:
        raise ValidationFailed("Question set is invalid.", code="INVALID_QUESTIONS", details={"questions": errors})
    if not out:
        raise ValidationFailed("At least one question is required.", code="INVALID_QUESTIONS")
    return out


# ----------------------------------------------------------------- wording --

from ai.wording import META as _META
from ai.wording import repair as _repair
from ai.wording import tidy as _tidy

_OPTION_PREFIX = re.compile(r"^\s*(?:\(?[A-Da-d1-4][).:\-]\s+|option\s+[A-Da-d1-4]\s*[:.\-)]\s*)")
_BAD_OPTION = re.compile(
    r"^\s*(?:option\s*[a-d1-4]?|choice\s*[a-d1-4]?|answer\s*[a-d1-4]?|[a-d1-4]|n/?a|none|nil|null|unknown|"
    r"all\s+of\s+(?:the\s+)?above|none\s+of\s+(?:the\s+)?above|both\s+[a-d1-4]\s+and\s+[a-d1-4]|neither\s+[a-d1-4]\s+nor\s+[a-d1-4]|not\s+(?:given|mentioned|stated)|"
    r"cannot\s+be\s+determined|\.{2,}|[-_?]+|tbd|todo|placeholder.*|distractor.*|\[.*\]|<.*>|\{.*\})\s*\.?\s*$",
    re.I,
)
_LETTER_REF = re.compile(r"\b(?i:option|choice|answer)\s*\(?([A-D])\)?(?![A-Za-z])")


def clean_question_text(text: str) -> str | None:
    """A question students can read on its own, or None when it cannot be
    made into one (it still depends on "the text" after repair)."""
    repaired = _repair(text)
    if len(repaired) < 12 or _META.search(repaired):
        return None
    return repaired


def clean_option_text(text: str) -> str | None:
    repaired = _repair(_OPTION_PREFIX.sub("", str(text or "")))
    repaired = repaired.rstrip(".") if repaired.count(".") == 1 and repaired.endswith(".") else repaired
    if not repaired or len(repaired) > 220 or _BAD_OPTION.match(repaired) or _META.search(repaired):
        return None
    return repaired


def clean_explanation(text: str, correct_text: str, letters: dict) -> str:
    """Explanations are shown to students after an attempt. Letter references
    would be wrong after shuffling, so they become the option's own words;
    sentences that still talk about "the text" are dropped."""
    text = _LETTER_REF.sub(lambda m: f'"{letters.get(m.group(1).upper(), m.group(0))}"', str(text or ""))
    sentences = [s for s in re.split(r"(?<=[.!?])\s+", _repair(text)) if s and not _META.search(s)]
    cleaned = _tidy(" ".join(sentences))
    return cleaned or f"The correct answer is: {correct_text}."


# --------------------------------------------------------------- building --

def _mcq_from_model(raw: dict, module_id, seed: str):
    question = clean_question_text(raw.get("question"))
    if not question:
        return None, "unclear wording"
    raw_options = raw.get("options") or []
    texts = [o.get("text") if isinstance(o, dict) else o for o in raw_options]
    if len(texts) != 4:
        return None, "did not have four options"
    cleaned = [clean_option_text(x) for x in texts]
    if any(c is None for c in cleaned):
        return None, "had a blank or filler option"
    if len({c.casefold() for c in cleaned}) != 4 or any(c.casefold() == question.casefold() for c in cleaned):
        return None, "had repeated options"
    letter = str(raw.get("answer") or raw.get("correct_answer") or "").strip().upper()[:1]
    if letter not in MCQ_KEYS:
        return None, "had no valid answer"
    original = dict(zip(MCQ_KEYS, cleaned))
    correct_text = original[letter]
    order = list(cleaned)
    random.Random(int(hashlib.sha256(f"{seed}|{question}".encode()).hexdigest()[:12], 16)).shuffle(order)
    options = [{"key": k, "text": x} for k, x in zip(MCQ_KEYS, order)]
    correct = MCQ_KEYS[order.index(correct_text)]
    return {
        "type": "mcq", "question": question, "options": options, "correct_answer": correct,
        "explanation": clean_explanation(raw.get("explanation"), correct_text, original),
        "source_reference": " ".join(str(raw.get("quote") or raw.get("source_reference") or "").split())[:300],
        "source_module_id": str(module_id) if module_id else None,
    }, ""


def _subjective_from_model(raw: dict, module_id):
    question = clean_question_text(raw.get("question"))
    rubric = _repair(raw.get("rubric") or raw.get("expected_rubric") or "")
    if not question:
        return None, "unclear wording"
    if len(rubric) < 8:
        return None, "had no marking points"
    return {
        "type": "subjective", "question": question, "expected_rubric": rubric,
        "source_reference": " ".join(str(raw.get("quote") or raw.get("source_reference") or "").split())[:300],
        "source_module_id": str(module_id) if module_id else None,
    }, ""


SYSTEM_PROMPT = (
    "You are a teacher writing exam questions for students from a textbook section. Follow every rule.\n"
    "1. Ask only about facts stated in the TEXTBOOK SECTION. Do not use outside knowledge.\n"
    "2. Write each question so a student understands it on its own, exactly as it would be printed in an exam. "
    "Never mention the text, the passage, the source, the section, the excerpt, the module or the author.\n"
    "3. Multiple-choice questions have exactly four options. Each option is a complete, specific answer. Exactly one is "
    "correct; the other three are believable but wrong. Never write \"All of the above\", \"None of the above\" or "
    "\"Both\" options, and do not put letters in front of the options.\n"
    "4. answer is the letter of the correct option: A for the first option, B for the second, C for the third, D for the fourth.\n"
    "5. explanation is one short sentence, as a teacher would say it, about why the answer is right.\n"
    "6. quote is a short phrase, under twelve words, copied exactly from the TEXTBOOK SECTION, that supports the answer.\n"
    "7. For open-ended questions, rubric lists the two to four points a complete answer must contain.\n"
    "8. Every question is about a different fact. Output JSON only."
)


def _module_parts(module, parts: int) -> list[str]:
    """The module's text in `parts` consecutive slices of at most
    CHARS_PER_CALL characters each, following its stored chunks."""
    from documents.services.chunking import ensure_chunks

    parts = max(1, parts)
    stored = ensure_chunks(module) if getattr(module, "pk", None) and getattr(module, "chapter_id", None) else []
    pieces = [c.text for c in stored] or [p for p in (module.source_text or "").split("\n\n") if p.strip()]
    if not pieces:
        return [""] * parts
    total = sum(len(p) for p in pieces)
    if total <= CHARS_PER_CALL or parts == 1:
        # Short module: every batch reads the whole of it (evenly sampled when long).
        if total <= CHARS_PER_CALL:
            whole = "\n\n".join(pieces)
        else:
            step = max(1, math.ceil(total / CHARS_PER_CALL))
            whole = "\n\n".join(pieces[::step])[:CHARS_PER_CALL]
        return [whole] * parts
    size = math.ceil(len(pieces) / parts)
    slices = []
    for i in range(parts):
        group = pieces[i * size:(i + 1) * size] or pieces[-size:]
        text = "\n\n".join(group)
        slices.append(text[:CHARS_PER_CALL].rsplit(" ", 1)[0] if len(text) > CHARS_PER_CALL else text)
    return slices


def allocate(total: int, sizes: list[int], per_question: int) -> tuple[list[int], int]:
    """Spread `total` questions over modules of the given text lengths.

    Every chosen module gets one question first (largest modules first when
    there are fewer questions than modules), then the rest go one at a time
    to the module with the most text per question so far, so the split is
    proportional to length. No module gets more than its text can carry.
    Returns (per-module counts, how many could not be placed).
    """
    caps = [max(1, size // per_question) if size else 0 for size in sizes]
    counts = [0] * len(sizes)
    budget = min(max(0, total), sum(caps))
    for i in sorted(range(len(sizes)), key=lambda j: (-sizes[j], j)):
        if budget <= 0:
            break
        if caps[i]:
            counts[i] = 1
            budget -= 1
    while budget > 0:
        open_ = [i for i in range(len(sizes)) if counts[i] < caps[i]]
        if not open_:
            break
        best = max(open_, key=lambda j: (sizes[j] / (counts[j] + 1), -j))
        counts[best] += 1
        budget -= 1
    return counts, max(0, total) - sum(counts)


# Failures that say the model itself is off or overloaded: the remaining
# batches would fail the same way, so the request stops at once.
FATAL = frozenset({"disabled", "unavailable", "timeout"})


class _Collector:
    def __init__(self, previous_questions):
        self.earlier = {" ".join(str(q).split()).casefold() for q in (previous_questions or [])}
        self.seen = set()
        self.questions = []
        self.dropped = {}
        self.repeated = 0
        self.errors = []
        self.fatal = False

    def add(self, question, reason):
        if question is None:
            self.dropped[reason] = self.dropped.get(reason, 0) + 1
            return False
        key = " ".join(question["question"].split()).casefold()
        if key in self.earlier or key in self.seen:
            self.repeated += 1
            return False
        self.seen.add(key)
        self.questions.append(question)
        return True


def _ask(module, title, source, n_mcq, n_subjective, avoid, collector, seed, depth=0, background=False):
    """One model call for n questions about one module slice. Splits itself
    when the reply is cut off. Returns (mcqs added, subjective added)."""
    if n_mcq + n_subjective <= 0 or collector.fatal:
        return 0, 0
    props, required, tasks = {}, [], []
    if n_mcq:
        props["mcq_questions"] = mcq_schema(n_mcq)
        required.append("mcq_questions")
        tasks.append(f"exactly {n_mcq} multiple-choice question{'s' if n_mcq != 1 else ''}")
    if n_subjective:
        props["subjective_questions"] = subjective_schema(n_subjective)
        required.append("subjective_questions")
        tasks.append(f"exactly {n_subjective} open-ended question{'s' if n_subjective != 1 else ''}")
    avoid_block = ""
    if avoid:
        avoid_block = "\nALREADY ASKED ABOUT THIS TOPIC (ask about other facts):\n" + "\n".join(f"- {q}" for q in avoid[:12]) + "\n"
    user = (f"TOPIC: {title}\n\nTEXTBOOK SECTION:\n\"\"\"{source}\"\"\"\n{avoid_block}\n"
            f"TASK: Write {' and '.join(tasks)} about this topic. Output only the JSON.")
    budget = task_config("quiz")
    max_tokens = TOKENS_OVERHEAD + n_mcq * TOKENS_PER_MCQ + n_subjective * TOKENS_PER_SUBJECTIVE
    if depth:
        max_tokens = int(max_tokens * 1.5)
    result = gateway().generate(task="quiz", system_prompt=SYSTEM_PROMPT, user_prompt=user,
                                schema={"type": "object", "properties": props, "required": required},
                                source_chars=len(source), retrieved_chunks=1, max_tokens=min(max_tokens, budget.max_tokens),
                                retry_codes=RETRY_ON, background=background)
    if result.failed:
        if result.error_code == "truncated" and depth < 2:
            if n_mcq + n_subjective > 1:
                # Half the questions per call, instead of the identical request again.
                m1, s1 = (n_mcq + 1) // 2, (n_subjective + 1) // 2 if not n_mcq else 0
                a = _ask(module, title, source, m1, s1, avoid, collector, seed + "a", depth + 1, background)
                b = _ask(module, title, source, n_mcq - m1, n_subjective - s1, avoid, collector, seed + "b", depth + 1, background)
                return a[0] + b[0], a[1] + b[1]
            return _ask(module, title, source, n_mcq, n_subjective, avoid, collector, seed + "t", depth + 2, background)
        collector.errors.append(result.error_code or "error")
        if result.error_code in FATAL:
            collector.fatal = True
        logger.warning("Quiz batch for module %s failed: %s", getattr(module, "pk", None), result.error_code)
        return 0, 0
    data = result.data or {}
    got_m = got_s = 0
    for raw in (data.get("mcq_questions") or [])[:n_mcq]:
        q, why = _mcq_from_model(raw if isinstance(raw, dict) else {}, getattr(module, "pk", None), seed)
        got_m += collector.add(q, why)
    for raw in (data.get("subjective_questions") or [])[:n_subjective]:
        q, why = _subjective_from_model(raw if isinstance(raw, dict) else {}, getattr(module, "pk", None))
        got_s += collector.add(q, why)
    return got_m, got_s


def _avoid_for(module, previous_questions_full):
    """Earlier questions about this module only, recognised by their quote
    appearing in its text, so a question about another module never reaches
    the prompt (a small model tends to echo what it is shown)."""
    text = " ".join((module.source_text or "").split()).casefold()
    out = []
    for q in previous_questions_full or []:
        ref = " ".join(str(q.get("source_reference") or "").split()).casefold()
        if (q.get("source_module_id") and str(q["source_module_id"]) == str(module.pk)) or (len(ref) > 12 and ref in text):
            out.append(q.get("question", ""))
    return out[:12]


def generate_questions(modules, num_mcqs=6, num_subjective=0, previous_questions=None, background=False):
    """Write questions from exactly these modules. Returns (questions, note).

    `previous_questions` are full question dicts from recent quizzes on the
    same material; repeats of them are dropped. Raises QuizGenerationFailed
    when not a single question could be written. `note` says, in words
    faculty can act on, anything that fell short of the request.
    """
    modules = [m for m in modules if (m.source_text or "").strip()]
    if not modules:
        raise ValidationFailed("Cannot generate questions without source text.", code="NO_SOURCE")
    sizes = [len(m.source_text.strip()) for m in modules]
    mcq_counts, mcq_short = allocate(num_mcqs, sizes, CHARS_PER_MCQ)
    sub_counts, sub_short = allocate(num_subjective, sizes, CHARS_PER_SUBJECTIVE)
    collector = _Collector([q.get("question") for q in (previous_questions or [])])
    per_module = {}

    def run_round(plan):
        for module, (want_m, want_s) in plan:
            if want_m + want_s == 0:
                continue
            batches = max(math.ceil(want_m / MCQ_BATCH) if want_m else 0, math.ceil(want_s / SUBJECTIVE_BATCH) if want_s else 0, 1)
            slices = _module_parts(module, batches)
            left_m, left_s = want_m, want_s
            for b in range(batches):
                if collector.fatal:
                    return
                n_m = min(MCQ_BATCH, math.ceil(left_m / (batches - b))) if left_m else 0
                n_s = min(SUBJECTIVE_BATCH, math.ceil(left_s / (batches - b))) if left_s else 0
                avoid = _avoid_for(module, previous_questions) + [q["question"] for q in collector.questions if q.get("source_module_id") == str(module.pk)]
                got_m, got_s = _ask(module, module.title, slices[b], n_m, n_s, avoid, collector, f"{module.pk}:{b}", background=background)
                done = per_module.setdefault(module.pk, [0, 0])
                done[0] += got_m
                done[1] += got_s
                left_m -= n_m
                left_s -= n_s

    run_round(list(zip(modules, zip(mcq_counts, sub_counts))))
    # One top-up round for modules that came back short.
    top_up = []
    for module, want_m, want_s in zip(modules, mcq_counts, sub_counts):
        done = per_module.get(module.pk, [0, 0])
        if done[0] < want_m or done[1] < want_s:
            top_up.append((module, (want_m - done[0], want_s - done[1])))
    if top_up and not collector.fatal:
        run_round(top_up)

    if not collector.questions:
        reasons = sorted(set(collector.errors)) or sorted(collector.dropped) or (["repeated earlier quizzes"] if collector.repeated else ["no usable questions"])
        raise QuizGenerationFailed(
            "The tutor model could not write usable questions for these modules. Try again, choose different modules, "
            "or write the questions yourself.", details={"reasons": reasons})

    mcqs = [q for q in collector.questions if q["type"] == "mcq"]
    subjective = [q for q in collector.questions if q["type"] == "subjective"]
    # Book order: the modules as chosen, questions in the order written.
    order = {str(m.pk): i for i, m in enumerate(modules)}
    mcqs.sort(key=lambda q: order.get(q.get("source_module_id"), 0))
    subjective.sort(key=lambda q: order.get(q.get("source_module_id"), 0))
    questions = normalize_questions(mcqs + subjective)

    notes = []
    if len(mcqs) < num_mcqs:
        notes.append(f"{len(mcqs)} of {num_mcqs} multiple-choice questions written")
    if len(subjective) < num_subjective:
        notes.append(f"{len(subjective)} of {num_subjective} open-ended questions written")
    if mcq_short or sub_short:
        notes.append("the chosen modules do not have enough text for more questions without repeating themselves")
    if collector.repeated:
        notes.append(f"{collector.repeated} dropped for repeating an earlier quiz or another question")
    dropped = sum(collector.dropped.values())
    if dropped:
        notes.append(f"{dropped} dropped because the wording or options were not clear enough")
    if collector.errors:
        notes.append(f"{len(collector.errors)} request(s) to the tutor model failed ({', '.join(sorted(set(collector.errors)))})")
    covered = {q.get("source_module_id") for q in collector.questions}
    missing = [m.title for m in modules if str(m.pk) not in covered]
    if missing and len(collector.questions) >= len(modules):
        notes.append("no question came from: " + ", ".join(missing[:5]))
    return questions, "; ".join(notes)
