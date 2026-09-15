"""Authenticated, offline-safe source images for course reading and lessons."""
import base64

from .visual_context import place_in_lesson
from .visuals import visual_path


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
