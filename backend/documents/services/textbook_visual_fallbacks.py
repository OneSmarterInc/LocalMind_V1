"""Fallback detectors for textbook PDFs whose visuals are not represented as one clean image object.

NCERT-style books often compose a teaching figure from several raster pieces next to a
``FIGURE 5.7`` caption, while business textbooks commonly typeset borderless tables as
aligned text.  These fallbacks use explicit source captions and layout evidence so we can
recover those visuals without falling back to page screenshots or coloured activity boxes.
"""
from __future__ import annotations

import re
import statistics

_CAPTION_RE = re.compile(
    r"^(?P<kind>fig(?:ure)?\.?|table|chart|graph|diagram|plate|map)\s*(?P<num>\d+(?:\.\d+)*(?:[A-Za-z])?)\b",
    re.I,
)


def _area(rect) -> float:
    return max(0.0, float(rect.x1 - rect.x0)) * max(0.0, float(rect.y1 - rect.y0))


def _caption_blocks(page):
    import pymupdf

    out = []
    for block in page.get_text("blocks"):
        if len(block) < 7 or block[6] != 0:
            continue
        box = pymupdf.Rect(block[:4])
        for raw in str(block[4] or "").splitlines():
            text = " ".join(raw.split())
            match = _CAPTION_RE.match(text)
            if match:
                out.append((text[:300], match.group("kind").lower(), box))
                break
    return out


def _text_chars_inside(page, rect):
    import pymupdf

    total = 0
    for block in page.get_text("blocks"):
        if len(block) < 7 or block[6] != 0:
            continue
        box = pymupdf.Rect(block[:4])
        overlap = box & rect
        if overlap.is_empty:
            continue
        fraction = _area(overlap) / max(1.0, _area(box))
        if fraction > 0.15:
            total += int(len(str(block[4] or "").strip()) * min(1.0, fraction))
    return total


def _horizontal_overlap(a, b):
    overlap = max(0.0, min(a.x1, b.x1) - max(a.x0, b.x0))
    return overlap / max(1.0, min(a.width, b.width))


def _vertical_gap(a, b):
    return max(a.y0 - b.y1, b.y0 - a.y1, 0.0)


def _good_image_candidate(page, rect, info):
    page_area = max(1.0, _area(page.rect))
    ratio = _area(rect) / page_area
    if rect.width < 34 or rect.height < 28 or ratio < 0.0025 or ratio > 0.55:
        return False
    # Page scans, chapter backgrounds and masks are not figures.
    if int(info.get("bpc") or 8) <= 1 and int(info.get("colorspace") or 1) <= 1:
        return False
    if rect.width > page.rect.width * 0.90 and rect.height > page.rect.height * 0.58:
        return False
    if rect.width > page.rect.width * 0.72 and rect.height < page.rect.height * 0.08:
        return False
    # A large image object carrying selectable paragraphs is a page composite,
    # not the teaching illustration inside it.
    if ratio > 0.12 and _text_chars_inside(page, rect) > 140:
        return False
    return True


def _union(rects):
    import pymupdf

    rect = pymupdf.Rect(rects[0])
    for other in rects[1:]:
        rect |= other
    return rect


def _captioned_image_regions(page, page_no):
    """Recover multipart raster figures by anchoring image pieces to captions.

    The nearest compatible side of a caption wins, then nearby pieces on that same side are
    merged.  This handles NCERT figures made from several image objects while preventing a
    running header or page-number tile from being joined to the figure.
    """
    import pymupdf

    captions = [row for row in _caption_blocks(page) if not row[1].startswith("table")]
    if not captions:
        return []
    images = []
    for info in page.get_image_info(xrefs=True):
        if not info.get("bbox"):
            continue
        rect = pymupdf.Rect(info["bbox"])
        if _good_image_candidate(page, rect, info):
            images.append((rect, info))
    if not images:
        return []

    result = []
    for caption, kind, cap in captions:
        scored = []
        for rect, info in images:
            gap = _vertical_gap(rect, cap)
            if gap > 260:
                continue
            xover = _horizontal_overlap(rect, cap)
            xgap = max(rect.x0 - cap.x1, cap.x0 - rect.x1, 0.0)
            if xover < 0.10 and xgap > 110:
                continue
            side = "above" if rect.y1 <= cap.y0 + 6 else "below" if rect.y0 >= cap.y1 - 6 else "overlap"
            distance = gap + xgap * 0.35
            scored.append((distance, -_area(rect), side, rect))
        if not scored:
            continue
        scored.sort(key=lambda item: (item[0], item[1]))
        best_distance, _, best_side, best = scored[0]
        # Do not rescue a remote decorative image merely because the page has a caption.
        if best_distance > 190:
            continue
        group = [best]
        for distance, _, side, rect in scored[1:]:
            if side != best_side or distance > best_distance + 85:
                continue
            combined = _union(group + [rect])
            if _area(combined) / max(1.0, _area(page.rect)) > 0.48:
                continue
            # Same figure pieces tend to be close or aligned. This prevents a nearby
            # Activity panel image from being merged into a labelled biology figure.
            if min(_vertical_gap(rect, member) for member in group) <= 55 or any(_horizontal_overlap(rect, member) >= 0.30 for member in group):
                group.append(rect)
        crop = _union(group)
        if crop.width < 42 or crop.height < 42:
            continue
        ratio = _area(crop) / max(1.0, _area(page.rect))
        if ratio > 0.50 or (ratio > 0.16 and _text_chars_inside(page, crop) > 180):
            continue
        result.append({
            "kind": "figure" if kind.startswith("fig") or kind in {"plate", "map"} else "diagram",
            "page": page_no,
            "rect": crop,
            "caption": caption,
            "origin": "captioned_raster_group",
        })
    return result


def _table_quality(table, captioned):
    try:
        matrix = table.extract()
    except Exception:
        return None
    cells = []
    for r, row in enumerate(matrix):
        for c, value in enumerate(row):
            text = " ".join(str(value or "").split())
            if text:
                cells.append((r, c, text))
    if len(cells) < 4 or table.row_count < 2 or table.col_count < 2:
        return None
    rows = len({r for r, _, _ in cells})
    cols = len({c for _, c, _ in cells})
    if rows < 2 or cols < 2:
        return None
    occupancy = len(cells) / max(1, table.row_count * table.col_count)
    lengths = [len(text) for _, _, text in cells]
    median = statistics.median(lengths)
    if occupancy < 0.18 or median > 44:
        return None
    if not captioned and (rows < 3 or cols < 3 or occupancy < 0.36):
        return None
    if max(lengths) > 300 and median > 20:
        return None
    return occupancy + min(0.5, rows * 0.03) + min(0.5, cols * 0.04) - min(0.4, median / 120)


def _near_table_caption(rect, captions):
    best = None
    for text, kind, box in captions:
        if not (kind.startswith("table") or kind in {"chart", "graph"}):
            # Many textbooks label small teaching tables as Figure N.N.
            if not kind.startswith("fig"):
                continue
        gap = _vertical_gap(rect, box)
        if gap > 150 or _horizontal_overlap(rect, box) < 0.12:
            continue
        if best is None or gap < best[0]:
            best = (gap, text)
    return best[1] if best else ""


def borderless_table_regions(page, page_no):
    """Detect aligned text tables with few or no drawn borders.

    This complements normal and ruled-table inference.  Captioned tables may be small; an
    uncaptioned candidate needs a stronger 3x3 tabular signature so paragraph columns are not
    misclassified.
    """
    import pymupdf

    captions = _caption_blocks(page)
    candidates = []
    for options in (
        {"vertical_strategy": "text", "horizontal_strategy": "text"},
        {"vertical_strategy": "text", "horizontal_strategy": "lines"},
    ):
        try:
            tables = page.find_tables(**options).tables
        except Exception:
            continue
        for table in tables:
            rect = pymupdf.Rect(table.bbox)
            if rect.width < 95 or rect.height < 34:
                continue
            ratio = _area(rect) / max(1.0, _area(page.rect))
            if ratio > 0.42:
                continue
            caption = _near_table_caption(rect, captions)
            score = _table_quality(table, bool(caption))
            if score is None:
                continue
            candidates.append((score + (1.0 if caption else 0.0), rect, caption))
    candidates.sort(key=lambda row: row[0], reverse=True)
    result = []
    for _, rect, caption in candidates:
        if any(_area(rect & old["rect"]) / max(1.0, min(_area(rect), _area(old["rect"]))) >= 0.75 for old in result):
            continue
        result.append({"kind": "table", "page": page_no, "rect": rect,
                       "caption": caption, "origin": "borderless_text_table"})
    return result


def textbook_fallback_regions(page, page_no):
    """Return high-confidence captioned raster figures plus borderless tables."""
    return _captioned_image_regions(page, page_no) + borderless_table_regions(page, page_no)
