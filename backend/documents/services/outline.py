"""Outline construction with deterministic source mapping.

Every chapter and module in an outline carries a `source_heading_index` that
points at a section produced by the parser. Source text is always copied from
that section, never from a title match. The AI is only asked to *group and
label* headings it is given by index; anything it returns that does not
reference a real index is discarded and the source hierarchy is used instead.
"""
import html
import logging
import re
from pathlib import Path

from django.db import transaction
from django.db.models import Q

from ai.gateway import gateway
from core.exceptions import Conflict, ValidationFailed
from learning.models import Chapter, Module

logger = logging.getLogger("localmind.outline")

OUTLINE_SCHEMA = {
    "type": "object",
    "properties": {
        "document_title": {"type": "string"},
        "chapters": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "source_heading_index": {"type": "integer"},
                    "modules": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "source_heading_index": {"type": "integer"},
                            },
                            "required": ["title", "source_heading_index"],
                        },
                    },
                },
                "required": ["title", "source_heading_index", "modules"],
            },
        },
    },
    "required": ["document_title", "chapters"],
}


def _has_meaningful_text(text):
    return sum(c.isalnum() for c in str(text or "")) >= 200


def clean_title(value):
    return " ".join(html.unescape(str(value or "")).split()).strip()


def section_lookup(sections):
    return {int(s["index"]): s for s in sections}


def source_hierarchy_outline(original_name, sections):
    """Shallowest heading level → chapters; next level inside each → modules."""
    if not sections:
        raise ValidationFailed("No source sections are available to build an outline.", code="NO_SECTIONS")
    levels = [s["level"] for s in sections if s.get("level")]
    chapter_level = min(levels)
    chapter_sections = [s for s in sections if s["level"] == chapter_level] or [sections[0]]
    # Headings that come before the first chapter-level heading (a preface or
    # introduction written as H2 ahead of the first H1) would otherwise be
    # dropped, and their text with them. Promote them to chapters of their own.
    first_chapter_index = chapter_sections[0]["index"]
    leading = [s for s in sections if s["index"] < first_chapter_index and s.get("source_text", "").strip()]
    if leading:
        leading_level = min(s["level"] for s in leading)
        chapter_sections = [s for s in leading if s["level"] == leading_level] + chapter_sections

    chapters = []
    for pos, ch in enumerate(chapter_sections):
        next_index = chapter_sections[pos + 1]["index"] if pos + 1 < len(chapter_sections) else float("inf")
        nested = [s for s in sections if ch["index"] < s["index"] < next_index and s["level"] > ch["level"]]
        modules = []
        if nested:
            module_level = min(s["level"] for s in nested)
            modules = [{"title": clean_title(s["title"]), "source_heading_index": s["index"]}
                       for s in nested if s["level"] == module_level]
        if modules and _has_meaningful_text(ch.get("own_text", "")):
            # The chapter's own introduction, written before its first
            # sub-heading, would otherwise be invisible to students (they read
            # modules, not chapters). Keep it as the chapter's first module.
            modules.insert(0, {"title": f"{clean_title(ch['title'])}: Overview", "source_text": ch["own_text"],
                               "start_page": ch.get("start_page"), "end_page": ch.get("end_page")})
        if not modules:
            # A chapter with no sub-headings (a flat document, or a short
            # chapter written as one block) still needs something a student can
            # open, and a book with no modules at all cannot be published. The
            # chapter's own text becomes its single module.
            modules = [{"title": clean_title(ch["title"]), "source_heading_index": ch["index"]}]
        chapters.append({"title": clean_title(ch["title"]), "source_heading_index": ch["index"], "modules": modules})
    title = chapters[0]["title"] if len(chapters) == 1 else Path(original_name).stem
    return {"document_title": title, "chapters": chapters}


def ai_outline(document, headings):
    """Ask the model to group indexed headings. Returns None on any failure."""
    if not headings:
        return None
    heading_text = "\n".join(f'[{h["index"]}] level {h["level"]}: {h["title"]}' for h in headings[:600])
    system = ("You organise a textbook's headings into a course outline of chapters that contain modules. "
              "Every source_heading_index must be one of the bracketed numbers in the list; never invent an index and never "
              "use the same index twice. Keep the document order. Output JSON only.")
    user = f"""File name: {document.original_name}

Headings (index in brackets):
{heading_text}

Produce a course outline as chapters containing modules.
Rules:
1. Every chapter and module MUST reference one of the given heading indices in source_heading_index.
2. Do not invent topics. Do not reference indices that were not listed.
3. Keep the document order.
4. Chapters are the top-level divisions; modules are the sections a student studies in one sitting.
5. Titles may be tidied but must keep the heading's meaning.
"""
    result = gateway().generate(task="outline", system_prompt=system, user_prompt=user,
                                schema=OUTLINE_SCHEMA, model_kind="outline", temperature=0.0, timeout=180)
    if result.failed:
        return None
    valid = {h["index"] for h in headings}
    used = set()
    chapters = []
    for ch in result.data["chapters"]:
        ci = ch["source_heading_index"]
        if ci not in valid or ci in used:
            logger.warning("AI outline referenced invalid/duplicate chapter index %s; discarding AI outline", ci)
            return None
        used.add(ci)
        modules = []
        for m in ch.get("modules", []):
            mi = m["source_heading_index"]
            if mi not in valid or mi in used:
                logger.warning("AI outline referenced invalid/duplicate module index %s; discarding AI outline", mi)
                return None
            used.add(mi)
            modules.append({"title": clean_title(m["title"]) or clean_title(next(h["title"] for h in headings if h["index"] == mi)),
                            "source_heading_index": mi})
        chapters.append({"title": clean_title(ch["title"]), "source_heading_index": ci, "modules": modules})
    if not chapters:
        return None
    # A module's text is its heading plus everything nested under it. If the
    # model picks a heading that contains other picked headings (a chapter
    # heading used as a module), that module repeats the whole chapter.
    spans = _heading_spans(headings)
    for ch in chapters:
        for m in ch["modules"]:
            start, end = spans[m["source_heading_index"]]
            if any(start < i < end for i in used):
                logger.warning("AI outline module %s contains other outline headings; discarding AI outline", start)
                return None
    return {"document_title": clean_title(result.data.get("document_title")) or document.title, "chapters": chapters}


def _heading_spans(headings):
    """index -> (index, first index after its section) in document order."""
    rows = sorted(headings, key=lambda h: h["index"])
    spans = {}
    for pos, h in enumerate(rows):
        end = next((r["index"] for r in rows[pos + 1:] if r["level"] <= h["level"]), float("inf"))
        spans[h["index"]] = (h["index"], end)
    return spans


# ------------------------------------------------------ tidying a new outline --
#
# PDFs of school textbooks give the heading finder two kinds of trouble.
#
# Titles come out garbled: letter-spaced display type ("Q U E S T I O N S"),
# the same heading printed twice ("Activity 5.3 Activity 5.3") and a drop-cap
# layer interleaved with the real one ("5.1 WHA 5.1 WHAT ARE LIFE PROCESSES?
# T ARE LIFE PROCESSES?"). ``tidy_heading_title`` repairs those three shapes.
#
# And every box in the page gets a heading of its own, so "Questions",
# "Activity 5.4" or a three-line "Do You Know?" become modules: a student's
# module list fills with fragments, and each one costs a lesson and a quiz.
# ``plan_merges`` folds such boxes, and any module too short to stand alone,
# into the section they belong to (the one before them in the book).

BOX_TITLE_RE = re.compile(
    r"^(?:questions?|exercis\w*|activit(?:y|ies)(?:\s*[\d.]+)?|group\s+activity(?:\s*[\d.]+)?|"
    r"do\s+you\s+know\??|did\s+you\s+know\??|more\s+to\s+know!?|think\s+it\s+over\??|"
    r"think\s+and\s+act|let\s+us\s+recall|recall|test\s+yourself|try\s+this|fact\s+file|"
    r"intext\s+questions?|check\s+your\s+progress)\s*[.!?:]*$",
    re.I,
)


def _layered_copy(tokens):
    """Two copies of one title printed on top of each other, read as one line
    with their words interleaved ("5.3 RESPIR 5.3 RESPIRA ATION TION" is
    "5.3 RESPIR|ATION" and "5.3 RESPIRA|TION"). Finds a split of the tokens
    into two in-order layers that spell the same letters, and returns that
    title with a space only where both layers agree there is one. None when
    the tokens are not two copies."""
    n = len(tokens)
    if n < 2 or n > 16:
        return None
    joined = "".join(tokens)
    if len(joined) % 2 or len(joined) < 8:
        return None
    half = len(joined) // 2

    def boundaries(layer):
        out, pos = set(), 0
        for tok in layer[:-1]:
            pos += len(tok)
            out.add(pos)
        return out

    best = None
    for mask in range(1, 1 << (n - 1)):  # token 0 always opens layer A
        a = [tokens[0]] + [tokens[i] for i in range(1, n) if not mask & (1 << (i - 1))]
        b = [tokens[i] for i in range(1, n) if mask & (1 << (i - 1))]
        if len("".join(a)) != half or "".join(a) != "".join(b):
            continue
        cuts = sorted(boundaries(a) & boundaries(b))
        word = "".join(a)
        pieces, start = [], 0
        for cut in cuts:
            pieces.append(word[start:cut])
            start = cut
        pieces.append(word[start:])
        candidate = " ".join(pieces)
        # Prefer the reading with the most agreed word breaks.
        if best is None or len(cuts) > best[0]:
            best = (len(cuts), candidate)
    return best[1] if best else None


def tidy_heading_title(value) -> str:
    """Repair letter-spaced and overprinted heading text from textbook PDFs."""
    text = html.unescape(str(value or "")).strip()
    # Words separated by two or more spaces, letters by one: "M O R E  T O  K N O W".
    groups = re.split(r"\s{2,}", text)
    spaced = [len(g.split()) >= 2 and all(len(tok) == 1 for tok in g.split()) for g in groups]
    if any(s and len(g.split()) >= 3 for s, g in zip(spaced, groups)):
        groups = ["".join(g.split()) if s else g for s, g in zip(spaced, groups)]
    text = " ".join(" ".join(groups).split())
    # "Activity 5.3 Activity 5.3", "5.1 WHA 5.1 WHAT ARE LIFE PROCESSES? T ARE
    # LIFE PROCESSES?", "5.4 TR 5.4 TRANSPORT ANSPORTA ATION TION".
    repaired = _layered_copy(text.split()) or text
    # Letter-spaced box titles often lose their last letters in extraction
    # ("E X E R C I S"); give the word back its ending.
    for word in ("EXERCISES", "QUESTIONS"):
        if len(repaired) >= 6 and repaired.isupper() and word.startswith(repaired) and repaired != word:
            return word
    return repaired


_NUMBER_RE = re.compile(r"^(\d+(?:\.\d+)*)\s")


def _section_number(title):
    match = _NUMBER_RE.match(tidy_heading_title(title))
    return match.group(1) if match else None


def is_box_title(title) -> bool:
    return bool(BOX_TITLE_RE.match(tidy_heading_title(title)))


def plan_merges(items, min_chars, max_chars):
    """Decide which modules fold into which.

    ``items`` are dicts in book order with ``key``, ``chapter``, ``title``,
    ``text`` and optionally ``locked`` (cannot be removed: student work refers
    to it). A module is a fragment when it is a textbook box or shorter than
    ``min_chars``. A fragment folds into:

    1. the module after it, when it is a short numbered heading that opens the
       next numbered section ("5.2 Nutrition" with a few lines, before the
       text and "5.2.1 Autotrophic Nutrition" that follow);
    2. otherwise the nearest earlier real module in its chapter, or the
       previous chapter's last one when its whole chapter is fragments;
    3. failing that, the next real module of its chapter.

    A fragment of ``min_chars`` or more never grows a module beyond
    ``max_chars``; a shorter one always fits. Returns ``[(source_key, target_key,
    "append" | "prepend")]`` in the order to apply them.
    """
    if not items:
        return []
    size = {it["key"]: len((it.get("text") or "").strip()) for it in items}
    by_chapter = {}
    for it in items:
        by_chapter.setdefault(it["chapter"], []).append(it)

    position = {it["key"]: i for i, it in enumerate(items)}

    def opens_next(it):
        # Books whose headings all sit at one level come out as one chapter per
        # heading, so the next numbered heading is looked for across the book.
        number = _section_number(it["title"])
        later = items[position[it["key"]] + 1:]
        nxt = next((r for r in later if _section_number(r["title"])), None)
        return bool(number and nxt and _section_number(nxt["title"]).startswith(number + "."))

    def fragment(it):
        if it.get("locked"):
            return False
        if is_box_title(it["title"]):
            return True
        if size[it["key"]] >= min_chars:
            return False
        # A short numbered heading is a real section whose text follows in the
        # boxes after it ("5.2.4 Nutrition in Human Beings", then "Activity
        # 5.5"...), unless it only introduces its first subsection ("5.2
        # Nutrition" before "5.2.1").
        return not _section_number(it["title"]) or opens_next(it)

    all_fragments = {ch: all(fragment(it) for it in rows) for ch, rows in by_chapter.items()}

    def target_ok(it):
        # Text can land in a real section, including one student work refers
        # to, but never in another box that could not be folded.
        return not fragment(it) and not is_box_title(it["title"])

    def next_real(it):
        rows = by_chapter[it["chapter"]]
        found = next((r for r in rows[rows.index(it) + 1:] if target_ok(r)), None)
        if found is None and all_fragments[it["chapter"]]:
            found = next((r for r in items[position[it["key"]] + 1:] if target_ok(r)), None)
        return found

    merges, done = [], set()

    def fold(src, dst, mode):
        # The size cap is for real content; a few lines of box always fit.
        if dst is None or (size[src["key"]] >= min_chars and size[dst["key"]] + size[src["key"]] > max_chars):
            return False
        merges.append((src["key"], dst["key"], mode))
        size[dst["key"]] += size[src["key"]]
        done.add(src["key"])
        return True

    last_real = None
    for it in items:
        if not fragment(it):
            if target_ok(it):
                last_real = it
            continue
        nxt = next_real(it)
        if _section_number(it["title"]) and opens_next(it) and nxt is not None:
            if fold(it, nxt, "prepend"):
                continue
        if last_real is not None and (last_real["chapter"] == it["chapter"] or all_fragments[it["chapter"]]):
            if fold(it, last_real, "append"):
                continue
        fold(it, nxt, "prepend")
    # Prepends must land in book order: a later prepend into the same target
    # sits closer to it, so apply prepends to a target in reverse.
    appends = [m for m in merges if m[2] == "append"]
    prepends = [m for m in merges if m[2] == "prepend"]
    return appends + list(reversed(prepends))


def _joined(target_text, title, text, mode):
    block = f"## {title}\n\n{(text or '').strip()}".strip()
    base = (target_text or "").strip()
    if not base:
        return block
    return f"{base}\n\n{block}" if mode == "append" else f"{block}\n\n{base}"


def tidy_outline(outline, sections):
    """Clean titles and fold fragments into their sections in a freshly
    planned outline. Returns (outline, report). Used for processing only; an
    outline a person saved is kept exactly as they arranged it."""
    from django.conf import settings

    cfg = settings.LOCALMIND
    lookup = section_lookup(sections or [])
    report = {"merged_modules": [], "renamed": 0}
    items, entries = [], {}
    for c_pos, chapter in enumerate(outline.get("chapters") or []):
        tidy = tidy_heading_title(chapter.get("title"))
        if tidy and tidy != chapter.get("title"):
            chapter["title"] = tidy
            report["renamed"] += 1
        for m_pos, module in enumerate(chapter.get("modules") or []):
            tidy = tidy_heading_title(module.get("title"))
            if tidy and tidy != module.get("title"):
                module["title"] = tidy
                report["renamed"] += 1
            idx = module.get("source_heading_index")
            section = lookup.get(int(idx)) if idx is not None and str(idx).lstrip("-").isdigit() else None
            text = section.get("source_text", "") if section else str(module.get("source_text") or "")
            key = (c_pos, m_pos)
            entries[key] = {"module": module, "text": text, "section": section}
            items.append({"key": key, "chapter": c_pos, "title": module.get("title") or "", "text": text})
    if not cfg.get("OUTLINE_MERGE_SMALL", True):
        return outline, report
    merges = plan_merges(items, int(cfg.get("OUTLINE_MERGE_MIN_CHARS", 500)), int(cfg.get("OUTLINE_MERGE_MAX_CHARS", 12000)))
    removed = set()
    for source, target, mode in merges:
        src, dst = entries[source], entries[target]
        dst["text"] = _joined(dst["text"], src["module"].get("title"), src["text"], mode)
        module = dst["module"]
        if dst["section"] and module.get("source_heading_index") is not None:
            module["start_page"] = dst["section"].get("start_page")
            module["end_page"] = dst["section"].get("end_page")
        module["source_heading_index"] = None
        module["source_text"] = dst["text"]
        pages = [p for p in (module.get("end_page"), (src["section"] or {}).get("end_page"), src["module"].get("end_page")) if p]
        if pages:
            module["end_page"] = max(pages)
        removed.add(source)
        report["merged_modules"].append({"title": src["module"].get("title"), "into": module.get("title")})
    chapters = []
    for c_pos, chapter in enumerate(outline.get("chapters") or []):
        had_modules = bool(chapter.get("modules"))
        chapter["modules"] = [m for m_pos, m in enumerate(chapter.get("modules") or []) if (c_pos, m_pos) not in removed]
        # A chapter whose every module was folded into the previous chapter is
        # gone; one the planner gave no modules keeps its own fallback.
        if chapter["modules"] or not had_modules:
            chapters.append(chapter)
    outline["chapters"] = chapters
    return outline, report


def _adopt_missing_headings(document, modules):
    """Numbered section headings the book has but no module carries.

    Processing drops a heading with no text of its own, and in a textbook that
    is usually a section title followed straight away by a box: "5.3
    RESPIRATION", then "Activity 5.4". Without the heading, the section's boxes
    would fold into the previous section (respiration into nutrition). The
    first module after such a heading becomes the section's home instead: it
    takes the heading's title and the boxes that follow fold into it. Returns
    {module_pk: {"title": ..., "parents": [...]}}."""
    headings = {int(h["index"]): h for h in (document.extracted_headings or []) if str(h.get("index", "")).lstrip("-").isdigit()}
    if not headings:
        return {}
    used = {m.source_heading_index for m in modules if m.source_heading_index is not None}
    # A module that has been edited or tidied before no longer records its
    # heading index; its title still says which heading it is.
    present = {tidy_heading_title(m.title).casefold() for m in modules}
    homes, previous = {}, -1
    for m in modules:
        idx = m.source_heading_index
        if idx is None:
            continue
        missing = [tidy_heading_title(headings[i]["title"]) for i in range(previous + 1, idx)
                   if i in headings and i not in used and _section_number(headings[i]["title"])
                   and tidy_heading_title(headings[i]["title"]).casefold() not in present]
        previous = idx
        if missing and not _section_number(m.title):
            homes[m.pk] = {"title": missing[-1], "parents": missing[:-1]}
    return homes


def tidy_existing_document(document, *, dry_run=False, actor=None, titles=True):
    """Apply the same tidying to a book that is already in use.

    Titles are repaired in place. Fragments are folded into their sections as
    for a new outline, except modules that student work refers to (progress, a
    quiz attempt, an assignment, a tutor conversation), which stay where they
    are. A folded module's unattempted automatic quiz and its lesson go with
    it; the module that receives the text gets a new lesson and, if nobody has
    attempted it, a new automatic quiz. Returns a report; with ``dry_run``
    nothing changes.
    """
    from django.conf import settings
    from django.db import transaction as db_transaction

    from audit import services as audit

    cfg = settings.LOCALMIND
    modules = list(Module.objects.filter(chapter__document=document).select_related("chapter").order_by("chapter__order", "order"))
    report = {"renamed": [], "merged": [], "kept_in_use": [], "chapters_removed": [], "adopted": []}
    homes = _adopt_missing_headings(document, modules)
    items = []
    for m in modules:
        locked = _module_is_referenced(m)
        title = homes[m.pk]["title"] if m.pk in homes else m.title
        items.append({"key": m.pk, "chapter": m.chapter_id, "title": title, "text": m.source_text, "locked": locked})
        if locked and (is_box_title(m.title) or len(m.source_text.strip()) < int(cfg.get("OUTLINE_MERGE_MIN_CHARS", 500))):
            report["kept_in_use"].append(m.title)
    merges = plan_merges(items, int(cfg.get("OUTLINE_MERGE_MIN_CHARS", 500)), int(cfg.get("OUTLINE_MERGE_MAX_CHARS", 12000)))
    by_pk = {m.pk: m for m in modules}
    chapters = {m.chapter_id: m.chapter for m in modules}
    absorbed = {source for source, _, _ in merges}
    # A home is only worth creating when something folds into it or it was a
    # box itself; otherwise the module stays as it was.
    homes = {pk: h for pk, h in homes.items() if pk not in absorbed and (
        any(target == pk for _, target, _ in merges) or is_box_title(by_pk[pk].title))}
    for pk, home in homes.items():
        report["adopted"].append({"heading": home["title"], "module": by_pk[pk].title})

    def new_title(pk):
        return homes[pk]["title"] if pk in homes else tidy_heading_title(by_pk[pk].title)

    for source, target, mode in merges:
        report["merged"].append({"title": tidy_heading_title(by_pk[source].title), "into": new_title(target), "position": mode})
    renames = []
    if titles:
        for m in modules:
            if m.pk in absorbed:
                continue
            tidy = new_title(m.pk)
            if tidy and tidy != m.title:
                same_chapter = m.chapter.title == m.title and m.chapter.modules.count() == 1
                renames.append((m, tidy, same_chapter))
                report["renamed"].append({"from": m.title, "to": tidy, "kind": "chapter and module" if same_chapter else "module"})
        for chapter in chapters.values():
            if any(same and m.chapter_id == chapter.pk for m, _, same in renames):
                continue
            if all(m.pk in absorbed for m in modules if m.chapter_id == chapter.pk):
                continue
            tidy = tidy_heading_title(chapter.title)
            if tidy and tidy != chapter.title:
                renames.append((chapter, tidy, False))
                report["renamed"].append({"from": chapter.title, "to": tidy, "kind": "chapter"})
    if dry_run or not (merges or renames or homes):
        return report

    changed = {}
    with db_transaction.atomic():
        for pk, home in homes.items():
            module = by_pk[pk]
            # The box keeps its own heading inside the section it now opens.
            module.source_text = _joined("", tidy_heading_title(module.title), module.source_text, "append")
            if home.get("parents"):
                module.source_text = "\n\n".join(f"## {p}" for p in home["parents"]) + "\n\n" + module.source_text
            module.save(update_fields=["source_text", "updated_at"])
            changed[pk] = module
        for obj, tidy, same_chapter in renames:
            obj.title = tidy
            obj.save(update_fields=["title", "updated_at"])
            if same_chapter:
                obj.chapter.title = tidy
                obj.chapter.save(update_fields=["title", "updated_at"])
        for pk, home in homes.items():
            module = by_pk[pk]
            if module.title != home["title"]:
                if module.chapter.title == module.title and module.chapter.modules.count() == 1:
                    module.chapter.title = home["title"]
                    module.chapter.save(update_fields=["title", "updated_at"])
                module.title = home["title"]
                module.save(update_fields=["title", "updated_at"])
        for source, target, mode in merges:
            src, dst = by_pk[source], by_pk[target]
            dst.source_text = _joined(dst.source_text, tidy_heading_title(src.title), src.source_text, mode)
            dst.source_heading_index = None
            dst.source_missing = False
            pages = [p for p in (dst.end_page, src.end_page) if p]
            if pages:
                dst.end_page = max(pages)
            dst.save(update_fields=["source_text", "source_heading_index", "source_missing", "end_page", "updated_at"])
            changed[dst.pk] = dst
            _drop_module(src)
        for chapter in chapters.values():
            if not chapter.modules.exists() and not _chapter_has_own_references(chapter):
                report["chapters_removed"].append(chapter.title)
                chapter.delete()
        from . import documents as doc_service
        doc_service._bump_version(document, actor)
        audit.record(actor, "document.tidied", document, {
            "merged": len(report["merged"]), "renamed": len(report["renamed"]), "kept_in_use": len(report["kept_in_use"])})
        if changed:
            doc_service._queue_lessons_after_commit(document, "document.tidied", modules=list(changed.values()))
    return report


def build_proposed_outline(document, sections, headings):
    """The outline processing proposes: the AI's plan when usable, the book's
    own heading levels otherwise, then tidied (see ``tidy_outline``). The
    tidying report rides along under ``_tidy_report``; persist_outline ignores
    unknown keys."""
    outline = ai_outline(document, headings)
    source = "ai"
    if not outline:
        outline, source = source_hierarchy_outline(document.original_name, sections), "source_hierarchy"
    outline, report = tidy_outline(outline, sections)
    outline["_tidy_report"] = report
    return outline, source


def _fill_from_section(target, data, lookup):
    idx = data.get("source_heading_index")
    section = lookup.get(int(idx)) if idx is not None and str(idx).lstrip("-").isdigit() else None
    if section:
        target.source_heading_index = section["index"]
        target.source_text = section.get("source_text", "")
        target.start_page = section.get("start_page")
        target.end_page = section.get("end_page")
    elif "source_text" in data and data.get("source_text") is not None:
        # Explicit, reviewer-supplied text.
        target.source_heading_index = None
        target.source_text = str(data.get("source_text") or "")
        target.start_page = data.get("start_page")
        target.end_page = data.get("end_page")
    elif target.pk and target.source_text:
        # Existing row, no resolvable section, nothing explicit: keep what it has.
        pass
    else:
        target.source_heading_index = None
        target.source_text = ""


def _resolved_text(existing, data, lookup) -> str:
    """The text a module or chapter will carry after ``_fill_from_section``,
    worked out without touching the instance. Same precedence: a resolvable
    heading, then explicit text, then what an existing row already has."""
    idx = data.get("source_heading_index")
    section = lookup.get(int(idx)) if idx is not None and str(idx).lstrip("-").isdigit() else None
    if section:
        return section.get("source_text", "") or ""
    if "source_text" in data and data.get("source_text") is not None:
        return str(data.get("source_text") or "")
    if existing is not None and existing.pk and existing.source_text:
        return existing.source_text
    return ""


@transaction.atomic
def persist_outline(document, outline, sections, user_edited=False):
    """Create or reconcile Chapter/Module rows from an outline.

    Rows whose id appears in the outline are updated in place so that
    assessments, progress and conversations keep pointing at the same module.
    Rows omitted from the outline are deleted only if nothing references them.

    A module with no source text never becomes part of the book: a new one is
    not created, and an existing one whose text resolves to nothing is removed.
    The single exception is a module that quizzes, assignments or student work
    already refer to, which cannot be deleted; it is kept with
    ``source_missing`` set and is hidden from students. A chapter left with no
    modules is removed with them. Returns a report of what was dropped so the
    caller can tell the person who saved.
    """
    chapters_data = outline.get("chapters") or []
    if not chapters_data:
        raise ValidationFailed("The outline must contain at least one chapter.", code="EMPTY_OUTLINE")
    lookup = section_lookup(sections or [])

    existing_chapters = {str(c.id): c for c in document.chapters.all()}
    existing_modules = {str(m.id): m for m in Module.objects.filter(chapter__document=document)}
    report = {"removed_empty_modules": [], "hidden_empty_modules": [], "removed_empty_chapters": []}

    # Decide what survives before writing anything, so chapter and module
    # orders stay contiguous and an outline with no text at all is refused
    # without half-applying it.
    plan = []
    for c_pos, cdata in enumerate(chapters_data, start=1):
        title = clean_title(cdata.get("title"))
        if not title:
            raise ValidationFailed(f"Chapter {c_pos} needs a title.", code="MISSING_TITLE")
        kept = []
        for m_pos, mdata in enumerate(cdata.get("modules") or [], start=1):
            mtitle = clean_title(mdata.get("title"))
            if not mtitle:
                raise ValidationFailed(f'Module {m_pos} in "{title}" needs a title.', code="MISSING_TITLE")
            existing = existing_modules.get(str(mdata.get("id") or ""))
            if _resolved_text(existing, mdata, lookup).strip():
                kept.append((mdata, mtitle, existing, False))
            elif existing is not None and _module_is_referenced(existing):
                kept.append((mdata, mtitle, existing, True))
                report["hidden_empty_modules"].append({"id": str(existing.id), "title": mtitle, "chapter": title})
            else:
                report["removed_empty_modules"].append({"id": str(existing.id) if existing else None, "title": mtitle, "chapter": title})
        existing_chapter = existing_chapters.get(str(cdata.get("id") or ""))
        if not kept and not user_edited:
            # Processing only: a planned chapter whose modules all came out
            # empty (or that the planner gave no modules) still has its own
            # text, which becomes its single module, as the heading-based
            # outline already does for a chapter with no sub-headings. A person
            # editing the outline gets exactly the modules they kept.
            chapter_text = _resolved_text(existing_chapter, cdata, lookup)
            if chapter_text.strip():
                kept.append(({"title": title, "source_heading_index": cdata.get("source_heading_index"), "source_text": chapter_text},
                             title, None, False))
                report["removed_empty_modules"] = [m for m in report["removed_empty_modules"] if m["chapter"] != title or m["id"]]
        if not kept and not (existing_chapter is not None and _chapter_has_own_references(existing_chapter)):
            report["removed_empty_chapters"].append({"id": str(existing_chapter.id) if existing_chapter else None, "title": title})
            continue
        plan.append((cdata, title, existing_chapter, kept))

    if not any(not hidden for _, _, _, kept in plan for *_rest, hidden in kept):
        raise ValidationFailed(
            "None of the modules in this outline has source text. A module needs text from the book, or text "
            "typed in, before it can be kept.", code="NO_SOURCE_TEXT",
            details={"removed_empty_modules": [m["title"] for m in report["removed_empty_modules"]]})

    # Two-pass ordering avoids unique(order) collisions while reordering.
    for c in existing_chapters.values():
        Chapter.objects.filter(pk=c.pk).update(order=c.order + 100000)
    for m in existing_modules.values():
        Module.objects.filter(pk=m.pk).update(order=m.order + 100000)

    kept_chapter_ids, kept_module_ids = set(), set()
    for c_order, (cdata, title, existing_chapter, kept) in enumerate(plan, start=1):
        chapter = existing_chapter or Chapter(document=document)
        chapter.title = title
        chapter.order = c_order
        chapter.is_user_edited = user_edited or chapter.is_user_edited
        _fill_from_section(chapter, cdata, lookup)
        chapter.save()
        kept_chapter_ids.add(str(chapter.id))

        for m_order, (mdata, mtitle, existing, hidden) in enumerate(kept, start=1):
            module = existing if existing is not None else Module(chapter=chapter)
            module.chapter = chapter
            module.title = mtitle
            module.order = m_order
            module.is_user_edited = user_edited or module.is_user_edited
            _fill_from_section(module, mdata, lookup)
            module.source_missing = not module.source_text.strip()
            module.save()
            kept_module_ids.add(str(module.id))

    dropped_empty = {m["id"] for m in report["removed_empty_modules"] if m["id"]}
    for mid, module in existing_modules.items():
        if mid not in kept_module_ids:
            if mid not in dropped_empty and _module_is_referenced(module):
                raise Conflict(f'Module "{module.title}" has student activity and cannot be removed; unpublish and archive instead.',
                               code="MODULE_IN_USE", details={"module_id": mid})
            _drop_module(module)
    for cid, chapter in existing_chapters.items():
        if cid not in kept_chapter_ids:
            if _chapter_is_referenced(chapter):
                raise Conflict(f'Chapter "{chapter.title}" has a quiz or assignment built on it and cannot be removed.',
                               code="CHAPTER_IN_USE", details={"chapter_id": cid})
            chapter.delete()

    document.title = clean_title(outline.get("document_title")) or document.title
    document.save(update_fields=["title", "updated_at"])
    return report


def _module_is_referenced(module):
    """Anything that would lose meaning, or fail, if the module were deleted:
    progress, a quiz or assignment written on it (directly or as one of several
    chosen modules), or a tutor conversation a student had about it."""
    if not module.pk:
        return False
    if module.progress.exists():
        return True
    from assessments.models import Assessment
    from assignments.models import Assignment
    from tutor.models import Conversation

    # The module's own automatic quiz is not student activity until someone
    # attempts it; it is removed with the module (see _drop_module).
    quizzes = Assessment.objects.filter(Q(module=module) | Q(source_modules=module)).exclude(auto_generated=True, attempts__isnull=True)
    return (quizzes.exists()
            or Assignment.objects.filter(Q(module=module) | Q(source_modules=module)).exists()
            or Conversation.objects.filter(module=module).exists())


def _drop_module(module):
    """Delete a module and the automatic quiz nobody has attempted yet (the
    quiz protects the module from deletion otherwise)."""
    from assessments.models import Assessment
    Assessment.objects.filter(module=module, auto_generated=True, attempts__isnull=True).delete()
    module.delete()


def _chapter_has_own_references(chapter):
    """A chapter-level quiz or assignment points at the chapter itself, and the
    database protects it from deletion."""
    if not chapter.pk:
        return False
    from assessments.models import Assessment
    from assignments.models import Assignment

    return Assessment.objects.filter(chapter=chapter).exists() or Assignment.objects.filter(chapter=chapter).exists()


def _chapter_is_referenced(chapter):
    """Own references, or a referenced module still inside it."""
    if _chapter_has_own_references(chapter):
        return True
    return any(_module_is_referenced(m) for m in chapter.modules.all())


def missing_source_modules(document):
    return list(Module.objects.filter(chapter__document=document, source_missing=True).values("id", "title", "chapter__title"))
