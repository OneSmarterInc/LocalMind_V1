"""Final safety filter for PDF visual regions.

Every PDF detector feeds this module before anything is rendered.  Candidate
regions are kept when they have positive instructional evidence (caption, table
structure, or substantial diagram geometry) and rejected when they look like page
furniture, page fragments, prose callouts, or navigation art.
"""
from __future__ import annotations

import re

from .pdf_visual_regions import (
    area,
    dedupe,
    pdf_regions as _detected_regions,
    source_caption_line,
)
from .textbook_visual_fallbacks import textbook_fallback_regions
from .ruled_tables import ruled_table_regions

_CALLOUT_RE = re.compile(
    r"^(?:why\s+this\s+is\s+happening|activity(?:\s*[\d.]+)?|questions?|"
    r"examples?(?:\s*[\d.]+)?|more\s+to\s+know!?|do\s+you\s+know\??|"
    r"did\s+you\s+know\??|points?\s+to\s+ponder|summary|exercises?|"
    r"think\s+it\s+over\??|try\s+this|fact\s+file)\b",
    re.I,
)
_TABLE_ORIGINS = {"table", "ruled_text_table", "borderless_text_table"}


def _text_blocks(page):
    return [b for b in page.get_text("blocks") if len(b) >= 7 and b[6] == 0]


def _text_inside(blocks, rect):
    import pymupdf

    rows = []
    total = 0
    for block in blocks:
        text = str(block[4] or "").strip()
        if not text:
            continue
        box = pymupdf.Rect(block[:4])
        overlap = box & rect
        if overlap.is_empty:
            continue
        fraction = area(overlap) / max(1.0, area(box))
        if fraction > 0.12:
            chars = int(len(text) * min(1.0, fraction))
            total += chars
            rows.append(text)
    return total, rows


def _caption_blocks(blocks):
    import pymupdf

    rows = []
    for block in blocks:
        caption = source_caption_line(block[4])
        if caption:
            rows.append((caption, pymupdf.Rect(block[:4])))
    return rows


def _axis_overlap(a0, a1, b0, b1):
    overlap = max(0.0, min(a1, b1) - max(a0, b0))
    return overlap / max(1.0, min(a1 - a0, b1 - b0))


def _nearby_caption(rect, captions):
    """Return an explicit source caption close enough to identify this crop."""
    best = None
    for caption, box in captions:
        vertical = max(rect.y0 - box.y1, box.y0 - rect.y1, 0.0)
        horizontal = max(rect.x0 - box.x1, box.x0 - rect.x1, 0.0)
        overlap = _axis_overlap(rect.x0, rect.x1, box.x0, box.x1)
        if vertical <= 115 and (overlap >= 0.18 or horizontal <= 90):
            distance = vertical + horizontal * 0.35
            if best is None or distance < best[0]:
                best = (distance, caption)
    return best[1] if best else ""


def _has_callout_text(lines):
    for block in lines:
        for raw in str(block).splitlines():
            text = " ".join(raw.strip().split())
            if text and _CALLOUT_RE.match(text):
                return True
    return False


def _reject_region(page, region, blocks, captions):
    rect = region["rect"]
    page_area = max(1.0, area(page.rect))
    ratio = area(rect) / page_area
    text_chars, text_lines = _text_inside(blocks, rect)
    caption = str(region.get("caption") or "").strip() or _nearby_caption(rect, captions)
    origin = str(region.get("origin") or "")
    is_table = origin in _TABLE_ORIGINS or region.get("kind") == "table"

    # Large selectable-text regions are page/article fragments, not visual
    # crops.  Tables are exempt because their content is intentionally text-rich.
    if not is_table:
        if ratio >= 0.24 and text_chars >= 260:
            return True
        if ratio >= 0.14 and text_chars >= 520:
            return True

    # Coloured Example / Activity / Questions / explanatory callouts are a
    # recurring NCERT false positive.  Keep a separately detected, captioned
    # figure inside the panel; reject the panel itself.
    if not is_table and not caption and _has_callout_text(text_lines):
        return True

    # Embedded images can be composite screenshots of a large part of a page.
    if origin == "embedded" and not caption and ratio >= 0.10 and text_chars >= 140:
        return True
    if origin == "captioned_raster_group" and ratio >= 0.16 and text_chars >= 180:
        return True

    height, width = page.rect.height, page.rect.width
    top = (rect.y0 - page.rect.y0) / max(1.0, height)
    bottom = (rect.y1 - page.rect.y0) / max(1.0, height)

    # Running heads, chapter banners and decorative strips.
    if not caption and top < 0.17 and rect.width > width * 0.38:
        return True
    if not caption and bottom > 0.90 and rect.width > width * 0.30:
        return True

    # Small uncaptained tiles near top/bottom are overwhelmingly page numbers,
    # chapter markers, icons or publisher furniture.
    if not caption and not is_table and ratio < 0.10:
        if top < 0.24 or bottom > 0.82:
            return True
        if origin == "vector" and ratio < 0.05 and text_chars < 16:
            return True

    # Generic vector fragments need enough substance when no source caption
    # anchors them to the lesson.
    if origin == "vector" and not caption and ratio < 0.07 and text_chars < 16:
        return True

    if caption and not region.get("caption"):
        region["caption"] = caption
    return False


def pdf_regions(page, page_no):
    """Return all PDF candidate types after one common safety policy."""
    blocks = _text_blocks(page)
    captions = _caption_blocks(blocks)
    raw = list(_detected_regions(page, page_no))
    try:
        raw.extend(textbook_fallback_regions(page, page_no))
    except Exception:
        pass
    try:
        raw.extend(ruled_table_regions(page, page_no))
    except Exception:
        pass

    regions = []
    for region in raw:
        row = dict(region)
        if not _reject_region(page, row, blocks, captions):
            regions.append(row)
    return dedupe(regions)
