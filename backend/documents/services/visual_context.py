"""Deterministic, source-only picture matching. No inference or network access.

Adapted from the supplied picture-extraction reference: nearby words help resolve
placement, but an ambiguous picture NEVER falls back to chapter one. Context is
metadata, not an extra rectangle of page text in the image.
"""
from __future__ import annotations

import re
import unicodedata

CAPTION_RE = re.compile(r"^(?:fig(?:ure)?\.?|diagram|chart|table)\s+[\w.-]+(?:\s*[:.\-–—]|\s+)", re.I)
STOP = frozenset("about after before their there these those which would source figure diagram chart table chapter module section".split())


def normalize(text):
    return " ".join(unicodedata.normalize("NFKC", str(text or "")).casefold().split())


def words(text):
    return {w for w in re.findall(r"[^\W_]+", normalize(text), re.UNICODE) if len(w) >= 4 and w not in STOP}


def context_score(context, target):
    """Exact source phrases outrank loose words; whole tokens, not substrings."""
    text = normalize(target)
    phrases = [normalize(p) for p in re.split(r"[\n.!?]+", context or "")]
    exact = sum(1 for p in set(phrases) if len(p) >= 24 and p in text)
    return min(4, exact) * 10 + min(9, len(words(context) & words(target)))


def choose_target(visual, targets, *, use_pages=True):
    """Return (target, reason). Targets are dicts with id/title/source/page spans.

    A unique page span is reliable provenance. Where spans overlap, combine the
    closest authored heading, caption and nearby source phrases. Ties and weak
    evidence remain unassigned. Never search outside a known PDF page span.
    """
    candidates = list(targets)
    page = visual.get("page")
    if use_pages and page:
        candidates = [t for t in candidates if t.get("start_page") and
                      t["start_page"] <= page <= (t.get("end_page") or t["start_page"])]
        if len(candidates) == 1:
            return candidates[0], "source_page"
        if not candidates:
            return None, "no_matching_source_page"
    headings = [normalize(h) for h in visual.get("heading_path", []) if h]
    context = visual.get("context_text", "")
    caption = visual.get("caption", "") if visual.get("caption_origin") == "source" else ""
    ranked = []
    for target in candidates:
        title = normalize(target.get("title"))
        source = target.get("source", "")
        context_evidence = context_score(context, source)
        caption_evidence = context_score(caption, source) if caption else 0
        exact_heading = bool(headings and title == headings[-1])
        lexical_evidence = len(words(context + "\n" + caption) & words(source))
        # A common parent chapter or a few shared terms (for example "leaf"
        # and "photosynthesis") must not relocate an orphaned figure after an
        # edit. Require an exact source phrase, six distinct content words,
        # or the nearest authored heading before adding structural bonuses.
        if not exact_heading and max(context_evidence, caption_evidence) < 10 and lexical_evidence < 6:
            continue
        score = context_evidence + caption_evidence
        # Nearest authored heading beats a parent chapter name. The chapter
        # alone cannot arbitrarily select one of its several child modules.
        if headings and title == headings[-1]:
            score += 40
        elif title and title in headings:
            score += 12
        if normalize(target.get("chapter_title")) in headings[:-1]:
            score += 10
        ranked.append((score, target))
    ranked.sort(key=lambda entry: entry[0], reverse=True)
    if not ranked or ranked[0][0] < 4:
        return None, "insufficient_context"
    if len(ranked) > 1 and ranked[0][0] - ranked[1][0] < 3:
        return None, "ambiguous_context"
    return ranked[0][1], "heading_and_context"


def place_in_lesson(lesson, visuals):
    """Attach safe visual IDs, not model-authored URLs, to supported sections.

    Keep unmatched visuals in the module gallery; do not invent a relevance
    claim. This also upgrades already-saved lessons without another model call.
    """
    if not lesson:
        return lesson
    result = dict(lesson)
    sections = [{**s, "visual_ids": []} for s in lesson.get("sections", [])]
    targets = [{"id": i, "title": s.get("heading", ""),
                "source": "\n".join(str(s.get(k, "")) for k in ("source_reference", "quote", "explanation", "content"))}
               for i, s in enumerate(sections)]
    for visual in visuals:
        target, _ = choose_target(visual, targets, use_pages=False)
        if target is not None:
            sections[target["id"]]["visual_ids"].append(visual["id"])
    result["sections"] = sections
    result["source_visuals"] = visuals
    return result
