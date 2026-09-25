"""Pure outline/source-mapping policies shared by authoring and tests."""
import html
from pathlib import Path


def clean_title(value):
    return " ".join(html.unescape(str(value or "")).split()).strip()


def section_lookup(sections):
    return {int(s["index"]): s for s in sections}


def _outer_sections(sections):
    """Keep source-order roots, including headings before a shallower one.

    Selecting only min(level) loses an H3 that precedes the first H2. Instead,
    a heading is a root when the preceding root's section has ended.
    """
    roots = []
    for section in sorted(sections, key=lambda row: row["index"]):
        if not roots or section["level"] <= roots[-1]["level"]:
            roots.append(section)
    return roots


def source_hierarchy_outline(original_name, sections):
    """Source-order root headings become chapters; their children, modules.

    Correctly handles skipped heading levels and introductory headings before
    the first H1. Deeper descendants remain in their parent module's text.
    """
    if not sections:
        raise ValueError("No source sections are available to build an outline.")
    sections = sorted(sections, key=lambda row: row["index"])
    chapter_sections = _outer_sections(sections)
    chapters = []
    for pos, chapter in enumerate(chapter_sections):
        next_index = chapter_sections[pos + 1]["index"] if pos + 1 < len(chapter_sections) else float("inf")
        nested = [row for row in sections if chapter["index"] < row["index"] < next_index]
        modules = [{"title": clean_title(row["title"]), "source_heading_index": row["index"]}
                   for row in _outer_sections(nested)]
        if modules and str(chapter.get("own_text", "")).strip():
            # Students read modules rather than chapter-only text. Even a
            # short introduction is part of the author's content.
            modules.insert(0, {
                "title": f"{clean_title(chapter['title'])}: Overview",
                "source_text": chapter["own_text"],
                "start_page": chapter.get("start_page"),
                "end_page": chapter.get("end_page"),
            })
        if not modules:
            modules = [{"title": clean_title(chapter["title"]), "source_heading_index": chapter["index"]}]
        chapters.append({"title": clean_title(chapter["title"]),
                         "source_heading_index": chapter["index"], "modules": modules})
    title = chapters[0]["title"] if len(chapters) == 1 else Path(original_name).stem
    return {"document_title": title, "chapters": chapters}


def _heading_spans(headings):
    """index -> (index, first index after its section) in document order."""
    rows = sorted(headings, key=lambda h: h["index"])
    spans = {}
    for pos, h in enumerate(rows):
        end = next((r["index"] for r in rows[pos + 1:] if r["level"] <= h["level"]), float("inf"))
        spans[h["index"]] = (h["index"], end)
    return spans


def _ai_plan_covers_source(outline, sections):
    """Prove that each source passage is reachable as module text.

    A chapter's introduction is NOT covered merely by naming the chapter.
    Parent modules cover descendants; separate module ranges must not overlap.
    """
    lookup = section_lookup(sections)
    spans = _heading_spans(sections)
    chosen = []
    for chapter in outline.get("chapters", []):
        modules = chapter.get("modules") or []
        indices = [m.get("source_heading_index") for m in modules] or [chapter.get("source_heading_index")]
        for index in indices:
            if index not in lookup or not str(lookup[index].get("source_text", "")).strip():
                return False
            lo, hi = spans[index]
            if any(lo < b and a < hi for a, b in chosen):
                return False
            chosen.append((lo, hi))
    return bool(chosen) and all(
        any(a <= section["index"] < b for a, b in chosen)
        for section in sections if str(section.get("own_text", section.get("source_text", ""))).strip()
    )
