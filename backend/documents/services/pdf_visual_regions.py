"""Conservative PDF visual-region detection for textbook source material.

The detector favours source evidence over page geometry:
* real embedded raster figures are accepted;
* vector artwork is anchored to explicit source captions where possible;
* table crops must look genuinely tabular;
* page masks, headers, footers, QR/navigation art, coloured prose panels and
  other page furniture are rejected.

This module returns crop rectangles only. It never renders or stores a full page.
"""
from __future__ import annotations

import logging
import re
import statistics

logger = logging.getLogger("localmind.documents.visuals")

MAX_REGION_PAGE_RATIO = 0.72
MAX_GENERIC_VECTOR_RATIO = 0.18
MAX_UNCAPTIONED_TABLE_RATIO = 0.35
MAX_CAPTIONED_TABLE_RATIO = 0.45
MIN_REGION_POINTS = 42

# Deliberately strict. Textbook figures normally have an explicit figure/table
# label. Requiring that pattern prevents headings such as "Activity 5.1" or
# "Questions" from being mistaken for instructional artwork.
_STRICT_CAPTION_RE = re.compile(
    r"^(?:FIGURE|TABLE|CHART|DIAGRAM)\s+[\w.-]+|"
    r"^(?:Figure|Table|Chart|Diagram)\s+[\w.-]+\s*(?:[:\-–—]|\s)",
)


def area(rect) -> float:
    return max(0.0, float(rect.x1 - rect.x0)) * max(0.0, float(rect.y1 - rect.y0))


def intersection_ratio(a, b) -> float:
    x0, y0 = max(a.x0, b.x0), max(a.y0, b.y0)
    x1, y1 = min(a.x1, b.x1), min(a.y1, b.y1)
    if x1 <= x0 or y1 <= y0:
        return 0.0
    return (x1 - x0) * (y1 - y0) / max(1.0, min(area(a), area(b)))


def valid_region(rect, page_rect) -> bool:
    if rect.width < MIN_REGION_POINTS or rect.height < MIN_REGION_POINTS:
        return False
    region_area, page_area = area(rect), area(page_rect)
    if not region_area or not page_area or region_area / page_area > MAX_REGION_PAGE_RATIO:
        return False
    return region_area >= 2500 and max(rect.width, rect.height) / max(1.0, min(rect.width, rect.height)) <= 12


def is_page_furniture(rect, page_rect) -> bool:
    """Header/footer-contained graphics are navigation/layout, not lesson art."""
    height = page_rect.height
    return rect.y1 <= page_rect.y0 + height * 0.18 or rect.y0 >= page_rect.y0 + height * 0.90


def source_caption_line(text) -> str:
    for line in str(text or "").splitlines():
        value = " ".join(line.strip().split())
        if value and len(value) <= 300 and _STRICT_CAPTION_RE.match(value):
            return value[:300]
    return ""


def _text_blocks(page):
    return [b for b in page.get_text("blocks") if len(b) >= 7 and b[6] == 0]


def _caption_blocks(blocks):
    import pymupdf

    result = []
    for block in blocks:
        caption = source_caption_line(block[4])
        if caption:
            result.append((caption, pymupdf.Rect(block[:4])))
    return result


def _axis_overlap(a0, a1, b0, b1):
    overlap = max(0.0, min(a1, b1) - max(a0, b0))
    return overlap / max(1.0, min(a1 - a0, b1 - b0))


def _rect_gap(a, b):
    return max(b.x0 - a.x1, a.x0 - b.x1, 0.0), max(b.y0 - a.y1, a.y0 - b.y1, 0.0)


def _linkable(a, b, gap):
    gx, gy = _rect_gap(a, b)
    ox = _axis_overlap(a.x0, a.x1, b.x0, b.x1)
    oy = _axis_overlap(a.y0, a.y1, b.y0, b.y1)
    return (gx <= gap and oy >= 0.10) or (gy <= gap and ox >= 0.10) or (gx <= 18 and gy <= 18)


def _merge_rectangles(rects, gap=38):
    rects = list(rects)
    changed = True
    while changed:
        changed = False
        output = []
        while rects:
            current = rects.pop(0)
            hit = None
            for index, other in enumerate(rects):
                if _linkable(current, other, gap):
                    current |= other
                    hit = index
                    break
            if hit is None:
                output.append(current)
            else:
                rects.pop(hit)
                rects.insert(0, current)
                changed = True
        rects = output
    return rects


def _connected_components(rects, gap=85):
    remaining, groups = list(rects), []
    while remaining:
        group = [remaining.pop(0)]
        changed = True
        while changed:
            changed = False
            for rect in remaining[:]:
                if any(_linkable(rect, member, gap) for member in group):
                    group.append(rect)
                    remaining.remove(rect)
                    changed = True
        groups.append(group)
    return groups


def _text_chars_inside(blocks, rect):
    import pymupdf

    total = 0
    for block in blocks:
        text = str(block[4]).strip()
        if not text or source_caption_line(text):
            continue
        box = pymupdf.Rect(block[:4])
        overlap = box & rect
        if overlap.is_empty:
            continue
        fraction = area(overlap) / max(1.0, area(box))
        if fraction > 0.15:
            total += int(len(text) * min(1.0, fraction))
    return total


def _distance_to_caption(rect, caption_rect):
    horizontal = max(0.0, min(caption_rect.x1, rect.x1) - max(caption_rect.x0, rect.x0))
    x_distance = 0.0 if horizontal > 0 else min(abs(caption_rect.x0 - rect.x1), abs(rect.x0 - caption_rect.x1))
    vertical = max(rect.y0 - caption_rect.y1, caption_rect.y0 - rect.y1, 0.0)
    return vertical + x_distance * 0.45


def dedupe(regions):
    def priority(region):
        if region["kind"] == "figure":
            return 5
        if region.get("caption") and region["kind"] == "diagram":
            return 4
        if region["kind"] == "table":
            return 3
        return 2

    kept = []
    for candidate in sorted(regions, key=lambda r: (priority(r), area(r["rect"])), reverse=True):
        if any(intersection_ratio(candidate["rect"], old["rect"]) >= 0.72 for old in kept):
            continue
        kept.append(candidate)
    return sorted(kept, key=lambda r: (r["page"], r["rect"].y0, r["rect"].x0))


def _embedded_images(page, page_no):
    import pymupdf

    result = []
    for info in page.get_image_info(xrefs=True):
        if not info.get("bbox"):
            continue
        rect = pymupdf.Rect(info["bbox"])
        if is_page_furniture(rect, page.rect):
            continue
        # 1-bit textbook page masks/stencils are the main source of near-page
        # screenshots. Genuine photos and rendered figures are normally multi-bit.
        if int(info.get("bpc") or 8) <= 1 and int(info.get("colorspace") or 1) <= 1:
            continue
        if valid_region(rect, page.rect):
            result.append({"kind": "figure", "page": page_no, "rect": rect, "origin": "embedded"})
    return result


def _filtered_drawings(page):
    result = []
    page_area = area(page.rect)
    for drawing in page.get_drawings():
        rect = drawing["rect"]
        ratio = area(rect) / max(1.0, page_area)
        if is_page_furniture(rect, page.rect):
            continue
        # Large filled rectangles are textbook panels/backgrounds, not the
        # instructional drawing inside them. This removes Activity, Questions,
        # More-to-Know, Summary and similar coloured prose panels.
        if ratio > 0.12 and drawing.get("fill") is not None:
            continue
        aspect = max(rect.width, rect.height) / max(0.01, min(rect.width, rect.height))
        if aspect > 20 and ratio < 0.04:
            continue
        # Long coloured example/activity rails should not bridge nearby artwork.
        if drawing.get("fill") is not None and aspect > 8 and rect.height > page.rect.height * 0.22 and rect.width < page.rect.width * 0.08:
            continue
        result.append(drawing)
    return result


def _vector_regions(page, page_no, blocks, captions):
    import pymupdf

    drawings = _filtered_drawings(page)
    if not drawings:
        return []
    try:
        clusters = [pymupdf.Rect(r) for r in page.cluster_drawings(drawings=drawings)]
    except Exception as exc:
        logger.debug("Vector clustering failed on page %s: %s", page_no, exc)
        return []
    clusters = _merge_rectangles(clusters, gap=38)
    page_area = area(page.rect)
    clean = []
    for rect in clusters:
        if is_page_furniture(rect, page.rect) or min(rect.width, rect.height) <= 0:
            continue
        ratio = area(rect) / max(1.0, page_area)
        aspect = max(rect.width, rect.height) / max(0.01, min(rect.width, rect.height))
        if aspect > 14 and ratio < 0.06:
            continue
        clean.append(rect)

    result, used = [], set()
    # Captions are strong evidence. Assemble nearby vector pieces into the one
    # figure belonging to that caption, rather than emitting every small arrow,
    # axis or box as a separate visual.
    for caption, caption_rect in captions:
        nearby = []
        for index, rect in enumerate(clean):
            horizontal = max(0.0, min(caption_rect.x1, rect.x1) - max(caption_rect.x0, rect.x0))
            x_distance = 0.0 if horizontal > 0 else min(abs(caption_rect.x0 - rect.x1), abs(rect.x0 - caption_rect.x1))
            vertical = max(rect.y0 - caption_rect.y1, caption_rect.y0 - rect.y1, 0.0)
            if _text_chars_inside(blocks, rect) > 120 and vertical > 40:
                continue
            if vertical <= 340 and x_distance <= max(180.0, rect.width * 1.5):
                nearby.append((index, rect))
        if not nearby:
            continue

        candidates = []
        for group in _connected_components([r for _, r in nearby], gap=85):
            union = pymupdf.Rect(group[0])
            for rect in group[1:]:
                union |= rect
            ratio = area(union) / max(1.0, page_area)
            if ratio > 0.55 or not valid_region(union, page.rect):
                continue
            if _text_chars_inside(blocks, union) > 350 and ratio > 0.12:
                continue
            candidates.append((_distance_to_caption(union, caption_rect), -area(union), union, group))
        if not candidates:
            continue
        candidates.sort(key=lambda item: (item[0], item[1]))
        _, _, union, group = candidates[0]
        result.append({"kind": "diagram", "page": page_no, "rect": union, "caption": caption, "origin": "captioned_vector"})
        for index, rect in nearby:
            if any(intersection_ratio(rect, member) > 0.95 for member in group):
                used.add(index)

    # Keep only compact, low-text generic vector clusters. This is the fallback
    # for genuine diagrams without captions; it is deliberately conservative.
    for index, rect in enumerate(clean):
        if index in used:
            continue
        ratio = area(rect) / max(1.0, page_area)
        if ratio > MAX_GENERIC_VECTOR_RATIO or not valid_region(rect, page.rect):
            continue
        if _text_chars_inside(blocks, rect) > 90:
            continue
        result.append({"kind": "diagram", "page": page_no, "rect": rect, "origin": "vector"})
    return result


def _table_quality(table, captioned=False):
    try:
        matrix = table.extract()
    except Exception:
        return None
    cells = []
    for row_index, row in enumerate(matrix):
        for col_index, value in enumerate(row):
            text = str(value or "").strip()
            if text:
                cells.append((row_index, col_index, text))
    if len(cells) < 4 or table.row_count < 2 or table.col_count < 2:
        return None
    rows, cols = len({r for r, _, _ in cells}), len({c for _, c, _ in cells})
    if rows < 2 or cols < 2:
        return None
    lengths = [len(text) for _, _, text in cells]
    occupancy = len(cells) / max(1, table.row_count * table.col_count)
    median = statistics.median(lengths)
    if occupancy < 0.12 or median > 28:
        return None
    if not captioned and cols < 4:
        return None
    if max(lengths) > 450 and median > 14:
        return None
    return occupancy + min(0.5, cols * 0.04) + min(0.3, rows * 0.02) - min(0.4, median / 100)


def _caption_near(rect, captions, max_gap=140):
    best = None
    for caption, caption_rect in captions:
        vertical = max(rect.y0 - caption_rect.y1, caption_rect.y0 - rect.y1, 0.0)
        if vertical > max_gap:
            continue
        distance = _distance_to_caption(rect, caption_rect)
        if best is None or distance < best[0]:
            best = (distance, caption)
    return best[1] if best else ""


def _table_regions(page, page_no, captions):
    import pymupdf

    candidates = []
    # Try PyMuPDF's normal inference and a line/text hybrid. Text-only textbook
    # tables are common, while prose boxes should fail the quality checks below.
    for options in ({}, {"vertical_strategy": "lines", "horizontal_strategy": "text"}):
        try:
            tables = page.find_tables(**options).tables
        except Exception as exc:
            logger.debug("Table detection failed on page %s: %s", page_no, exc)
            continue
        for table in tables:
            rect = pymupdf.Rect(table.bbox)
            if is_page_furniture(rect, page.rect) or rect.width < 80 or rect.height < 35:
                continue
            caption = _caption_near(rect, captions)
            captioned_table = caption.upper().startswith(("TABLE", "CHART", "FIGURE"))
            ratio = area(rect) / max(1.0, area(page.rect))
            if ratio > (MAX_CAPTIONED_TABLE_RATIO if captioned_table else MAX_UNCAPTIONED_TABLE_RATIO):
                continue
            score = _table_quality(table, captioned=captioned_table)
            if score is not None:
                candidates.append((score + (1.0 if captioned_table else 0.0), rect, caption if captioned_table else ""))

    candidates.sort(key=lambda item: item[0], reverse=True)
    result = []
    for _, rect, caption in candidates:
        if any(intersection_ratio(rect, row["rect"]) >= 0.75 for row in result):
            continue
        result.append({"kind": "table", "page": page_no, "rect": rect, "caption": caption, "origin": "table"})
    return result


def pdf_regions(page, page_no):
    """Return conservative figure/table/diagram rectangles for one PDF page."""
    blocks = _text_blocks(page)
    captions = _caption_blocks(blocks)
    regions = []
    try:
        regions.extend(_embedded_images(page, page_no))
    except Exception as exc:
        logger.debug("Image rectangle detection failed on page %s: %s", page_no, exc)
    regions.extend(_table_regions(page, page_no, captions))
    regions.extend(_vector_regions(page, page_no, blocks, captions))
    return dedupe(regions)
