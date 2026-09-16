"""Authenticated, offline-safe source images for course reading and lessons."""
import base64
from pathlib import Path

from django.conf import settings

from .visual_context import place_in_lesson
from .visuals import extraction_manifest, visual_path


def _data_url(path):
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def module_visuals(module):
    """The caller must first resolve module access using the existing policy."""
    rows = []
    for visual in module.source_visuals or []:
        if visual.get("kind") == "page" or str(visual.get("caption", "")).startswith("Original page"):
            continue
        path = visual_path(module.chapter.document, module, str(visual.get("id") or ""))
        if path is None or not path.is_file():
            continue
        row = {k: visual.get(k) for k in ("id", "kind", "page", "caption", "caption_origin", "width", "height", "context_text", "heading_path")}
        row["data_url"] = "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii")
        rows.append(row)
    return rows


def enrich_lesson(lesson, module):
    if not lesson:
        return lesson
    result = place_in_lesson(lesson, module_visuals(module))
    # Context is used for deterministic association, not duplicated in the UI.
    result["source_visuals"] = [{k: v for k, v in row.items() if k not in {"context_text", "heading_path"}}
                                for row in result["source_visuals"]]
    return result


def picture_index(document):
    """Chapter and module structure with picture counts, and no image bytes.

    The staff Pictures tab opens on this, so a book with five hundred figures
    still loads at once; the pictures themselves are fetched one module at a
    time from the module endpoint.
    """
    from learning.models import Module

    chapters = {}
    for module in (Module.objects.filter(chapter__document=document)
                   .select_related("chapter").order_by("chapter__order", "order")):
        chapter = chapters.setdefault(str(module.chapter_id), {
            "id": str(module.chapter_id), "title": module.chapter.title, "order": module.chapter.order, "modules": []})
        chapter["modules"].append({
            "id": str(module.pk), "title": module.title, "order": module.order,
            "start_page": module.start_page, "end_page": module.end_page,
            "count": len([v for v in (module.source_visuals or []) if v.get("id") and v.get("filename")]),
        })
    return sorted(chapters.values(), key=lambda c: c["order"])


def unassigned_visuals(document, limit=40):
    """Pictures that were extracted but matched no module, with their images.

    They are kept rather than discarded: an unplaced figure is a review task,
    and a figure dropped into the wrong lesson is a teaching error.
    """
    report = document.visual_report or {}
    pending = report.get("unassigned") or []
    if not pending or not document.processed_markdown_path:
        return [], len(pending)
    base = Path(document.processed_markdown_path).parent
    by_id = {str(v.get("id")): v for v in (extraction_manifest(base).get("visuals") or [])}
    rows = []
    for entry in pending[:limit]:
        visual = by_id.get(str(entry.get("id"))) or {}
        filename = Path(str(visual.get("filename") or "")).name
        if not filename:
            continue
        candidate = (base / "visuals" / filename).resolve()
        try:
            candidate.relative_to(Path(settings.MEDIA_ROOT).resolve())
        except ValueError:
            continue
        if not candidate.is_file():
            continue
        rows.append({"id": entry.get("id"), "caption": entry.get("caption") or visual.get("caption"),
                     "page": entry.get("page"), "reason": entry.get("reason"), "kind": visual.get("kind"),
                     "width": visual.get("width"), "height": visual.get("height"),
                     "data_url": _data_url(candidate)})
    return rows, len(pending)
