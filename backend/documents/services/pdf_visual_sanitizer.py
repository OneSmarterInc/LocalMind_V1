"""Final safety filter for PDF visual regions.

The low-level detector intentionally collects several kinds of PDF evidence. This
module applies a last, textbook-oriented sanity pass before a crop is rendered.
It is deliberately conservative about regions that resemble page fragments,
headers, page-number tiles or prose panels while preserving regions that have an
explicit Figure/Table/Chart/Diagram caption nearby.

A second source-aware fallback handles NCERT-style multipart raster figures and
borderless text tables. Those candidates still pass through this same sanitizer;
the fallback never bypasses the page-fragment protections.
"""
from __future__ import annotations

from .pdf_visual_regions import (
    area,
    dedupe,
    pdf_regions as _detected_regions,
    source_caption_line,
)
from .textbook_visual_fallbacks import textbook_fallback_regions


def _text_blocks(page):
    return [b for b in page.get_text("blocks") if len(b) >= 7 and b[6] == 0]


def _text_chars_inside(blocks, rect):
    import pymupdf

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
            total += int(len(text) * min(1.0, fraction))
    return total


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
        # Textbook captions are normally immediately above/below the figure.
        if vertical <= 115 and (overlap >= 0.18 or horizontal <= 90):
            distance = vertical + horizontal * 0.35
            if best is None or distance < best[0]:
                best = (distance, caption)
    return best[1] if best else ""


def _reject_region(page, region, blocks, captions):
    rect = region["rect"]
    page_area = max(1.0, area(page.rect))
    ratio = area(rect) / page_area
    text_chars = _text_chars_inside(blocks, rect)
    caption = str(region.get("caption") or "").strip() or _nearby_caption(rect, captions)

    # A crop containing hundreds of characters and a quarter of the page is a
    # page/article fragment, not an instructional visual. This is the failure
    # mode that produced near-page screenshots in the faculty picture report.
    if ratio >= 0.24 and text_chars >= 300:
        return True
    if ratio >= 0.16 and text_chars >= 650:
        return True

    # Embedded images can be page composites or large textbook panels. Real
    # raster figures may contain labels, but they should not contain paragraphs
    # of the selectable page text.
    if region.get("origin") == "embedded" and ratio >= 0.12 and text_chars >= 180:
        return True

    # Caption-linked raster groups may contain several image pieces, but never
    # accept a large selectable-text page fragment just because a caption is nearby.
    if region.get("origin") == "captioned_raster_group" and ratio >= 0.16 and text_chars >= 180:
        return True

    height, width = page.rect.height, page.rect.width
    top = (rect.y0 - page.rect.y0) / max(1.0, height)
    bottom = (rect.y1 - page.rect.y0) / max(1.0, height)

    # Chapter banners, running heads and wide decorative strips. Preserve a
    # genuine top-of-page figure only when the source explicitly captions it.
    if not caption and top < 0.18 and rect.width > width * 0.42:
        return True

    # Page-number/section-number tiles such as the isolated blue "2" reported
    # in the Physics book. Small, uncaptured regions near either margin are not
    # useful lesson visuals.
    if not caption and ratio < 0.09 and text_chars <= 6:
        if top < 0.28 or bottom > 0.82:
            return True
        if region.get("origin") == "vector" and ratio < 0.045:
            return True

    # Generic vectors with no caption need enough substance to justify being a
    # teaching visual. A tiny box/number/decoration should not survive merely
    # because it is technically vector artwork.
    if region.get("origin") == "vector" and not caption and ratio < 0.065 and text_chars < 12:
        return True

    if caption and not region.get("caption"):
        region["caption"] = caption
    return False


def pdf_regions(page, page_no):
    """Return detected and fallback regions after one common safety filter."""
    blocks = _text_blocks(page)
    captions = _caption_blocks(blocks)
    raw = list(_detected_regions(page, page_no))
    try:
        raw.extend(textbook_fallback_regions(page, page_no))
    except Exception:
        # The primary detector still works if a malformed page defeats a fallback.
        pass
    regions = []
    for region in raw:
        row = dict(region)
        if not _reject_region(page, row, blocks, captions):
            regions.append(row)
    return dedupe(regions)
