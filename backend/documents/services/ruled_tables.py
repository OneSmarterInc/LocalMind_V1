"""Fallback detector for textbook tables made from text plus horizontal rules.

PyMuPDF's ``find_tables`` is strongest when a PDF carries vertical cell borders.
Many typeset textbooks instead use a shaded header and horizontal row rules only.
Those are real instructional tables, but normal table inference can return nothing.
This detector recognises that layout without treating ordinary prose boxes as tables.
"""
from __future__ import annotations

import re

_CAPTION_RE = re.compile(r"^(?:figure|table|chart)\s+[\w.-]+(?:\s*[:.\-–—]|\s+)", re.I)


def _area(rect) -> float:
    return max(0.0, float(rect.x1 - rect.x0)) * max(0.0, float(rect.y1 - rect.y0))


def _caption_blocks(page):
    import pymupdf

    out = []
    for block in page.get_text("blocks"):
        if len(block) < 7 or block[6] != 0:
            continue
        for line in str(block[4] or "").splitlines():
            text = " ".join(line.split())
            if text and _CAPTION_RE.match(text):
                out.append((text[:300], pymupdf.Rect(block[:4])))
                break
    return out


def _near_caption(rect, captions, max_gap=120):
    best = None
    for text, box in captions:
        vertical = max(rect.y0 - box.y1, box.y0 - rect.y1, 0.0)
        horizontal_overlap = max(0.0, min(rect.x1, box.x1) - max(rect.x0, box.x0))
        if vertical > max_gap or horizontal_overlap < min(rect.width, box.width) * 0.25:
            continue
        if best is None or vertical < best[0]:
            best = (vertical, text)
    return best[1] if best else ""


def _text_blocks_inside(page, rect):
    import pymupdf

    rows = []
    for block in page.get_text("blocks"):
        if len(block) < 7 or block[6] != 0:
            continue
        box = pymupdf.Rect(block[:4])
        overlap = box & rect
        if overlap.is_empty:
            continue
        text = " ".join(str(block[4] or "").split())
        if not text or _CAPTION_RE.match(text):
            continue
        if _area(overlap) / max(1.0, _area(box)) >= 0.35:
            rows.append((box, text))
    return rows


def _dedupe_y(values, tolerance=2.5):
    out = []
    for value in sorted(values):
        if not out or abs(value - out[-1]) > tolerance:
            out.append(value)
        else:
            out[-1] = (out[-1] + value) / 2.0
    return out


def _runs(values):
    """Return plausible consecutive table-rule runs."""
    if len(values) < 3:
        return []
    runs, current = [], [values[0]]
    for value in values[1:]:
        gap = value - current[-1]
        if 8 <= gap <= 95:
            current.append(value)
        else:
            if len(current) >= 3:
                runs.append(current)
            current = [value]
    if len(current) >= 3:
        runs.append(current)
    return runs


def ruled_table_regions(page, page_no):
    """Return table crops for wide, horizontally ruled textbook tables.

    Requires several aligned row rules plus text inside the band. A caption is
    strong evidence, but an uncaptained table is accepted when it has at least
    four boundaries and multiple text rows. Full-page and prose-panel crops are
    never returned.
    """
    import pymupdf

    page_rect = page.rect
    page_area = max(1.0, _area(page_rect))
    wide = []
    for drawing in page.get_drawings():
        rect = pymupdf.Rect(drawing["rect"])
        if rect.width < page_rect.width * 0.55:
            continue
        # Ignore the running header/footer separator itself.
        if rect.y1 < page_rect.height * 0.05 or rect.y0 > page_rect.height * 0.92:
            continue
        if rect.height <= 2.5:
            wide.append((rect, [float((rect.y0 + rect.y1) / 2.0)]))
        elif drawing.get("fill") is not None and 12 <= rect.height <= 70:
            # Shaded table header: its top and bottom are useful boundaries.
            wide.append((rect, [float(rect.y0), float(rect.y1)]))

    if not wide:
        return []

    # Most textbook tables on a page share almost identical left/right edges.
    # Build one candidate per aligned x-band, rather than merging unrelated
    # horizontal rules elsewhere on the page.
    bands = []
    for rect, ys in wide:
        found = None
        for band in bands:
            if abs(rect.x0 - band["x0"]) <= 18 and abs(rect.x1 - band["x1"]) <= 18:
                found = band
                break
        if found is None:
            found = {"x0": rect.x0, "x1": rect.x1, "ys": []}
            bands.append(found)
        found["ys"].extend(ys)

    captions = _caption_blocks(page)
    result = []
    for band in bands:
        ys = _dedupe_y(band["ys"])
        for run in _runs(ys):
            rect = pymupdf.Rect(band["x0"], run[0], band["x1"], run[-1])
            if rect.height < 38 or rect.width < 120:
                continue
            ratio = _area(rect) / page_area
            if ratio > 0.38:
                continue
            rows = _text_blocks_inside(page, rect)
            if len(rows) < 2:
                continue
            text_chars = sum(len(text) for _, text in rows)
            if text_chars < 12:
                continue
            caption = _near_caption(rect, captions)
            # Without a caption, insist on a stronger tabular signature so a
            # short ruled note/callout cannot become a source visual.
            if not caption and (len(run) < 4 or len(rows) < 3):
                continue
            result.append({
                "kind": "table",
                "page": page_no,
                "rect": rect,
                "caption": caption,
                "origin": "ruled_text_table",
            })
    return result
