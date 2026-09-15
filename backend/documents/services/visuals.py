"""Extract source visuals without ever saving a full page screenshot.

PDF visuals are cropped from three layout signals:
* embedded raster image rectangles;
* vector drawing clusters (charts / diagrams / line art);
* table bounding boxes.

The output is intentionally presentation-only metadata. Lesson generation stays
text-grounded; the original source visual is shown beside the generated lesson
rather than asking the local text model to invent an interpretation of pixels.
"""
from __future__ import annotations

import hashlib
import logging
from pathlib import Path

from django.conf import settings

logger = logging.getLogger("localmind.documents.visuals")

MAX_VISUALS_PER_DOCUMENT = 500
MAX_REGION_PAGE_RATIO = 0.72  # never persist a near-full-page crop
MIN_REGION_POINTS = 42
RENDER_SCALE = 2.0


def _area(rect) -> float:
    return max(0.0, float(rect.x1 - rect.x0)) * max(0.0, float(rect.y1 - rect.y0))


def _intersection_ratio(a, b) -> float:
    x0, y0 = max(a.x0, b.x0), max(a.y0, b.y0)
    x1, y1 = min(a.x1, b.x1), min(a.y1, b.y1)
    if x1 <= x0 or y1 <= y0:
        return 0.0
    overlap = (x1 - x0) * (y1 - y0)
    return overlap / max(1.0, min(_area(a), _area(b)))


def _valid_region(rect, page_rect) -> bool:
    if rect.width < MIN_REGION_POINTS or rect.height < MIN_REGION_POINTS:
        return False
    area = _area(rect)
    page_area = _area(page_rect)
    if not area or not page_area or area / page_area > MAX_REGION_PAGE_RATIO:
        return False
    # Headers, rules and tiny decorative marks should never become lesson art.
    return area >= 2500


def _expanded(rect, page_rect, margin=6):
    import pymupdf

    return pymupdf.Rect(
        max(page_rect.x0, rect.x0 - margin),
        max(page_rect.y0, rect.y0 - margin),
        min(page_rect.x1, rect.x1 + margin),
        min(page_rect.y1, rect.y1 + margin),
    )


def _dedupe(regions):
    # Priority matters: a table rectangle is more informative than the line-art
    # cluster that made the same table detectable. Embedded figures beat an
    # overlapping generic vector cluster as well.
    priority = {"table": 3, "figure": 2, "diagram": 1}
    kept = []
    for candidate in sorted(regions, key=lambda r: (priority[r["kind"]], _area(r["rect"])), reverse=True):
        if any(_intersection_ratio(candidate["rect"], old["rect"]) >= 0.72 for old in kept):
            continue
        kept.append(candidate)
    return sorted(kept, key=lambda r: (r["page"], r["rect"].y0, r["rect"].x0))


def _pdf_regions(page, page_no):
    regions = []
    page_rect = page.rect

    # Raster figures / photographs / screenshots.
    try:
        for info in page.get_image_info(xrefs=True):
            bbox = info.get("bbox")
            if not bbox:
                continue
            import pymupdf
            rect = pymupdf.Rect(bbox)
            if _valid_region(rect, page_rect):
                regions.append({"kind": "figure", "page": page_no, "rect": rect})
    except Exception as exc:
        logger.debug("Image rectangle detection failed on page %s: %s", page_no, exc)

    drawings = None
    try:
        drawings = page.get_drawings()
    except Exception as exc:
        logger.debug("Vector drawing detection failed on page %s: %s", page_no, exc)

    # Tables have explicit bounding boxes; capture the source table itself, not
    # the whole page containing it.
    try:
        finder = page.find_tables(paths=drawings) if drawings is not None else page.find_tables()
        for table in finder.tables:
            import pymupdf
            rect = pymupdf.Rect(table.bbox)
            if _valid_region(rect, page_rect):
                regions.append({"kind": "table", "page": page_no, "rect": rect})
    except Exception as exc:
        logger.debug("Table detection failed on page %s: %s", page_no, exc)

    # Vector clusters catch bar charts, pie charts, flow diagrams and other
    # line-art that does not exist as an embedded bitmap.
    if drawings:
        try:
            for rect in page.cluster_drawings(drawings=drawings):
                if _valid_region(rect, page_rect):
                    regions.append({"kind": "diagram", "page": page_no, "rect": rect})
        except Exception as exc:
            logger.debug("Vector clustering failed on page %s: %s", page_no, exc)

    return _dedupe(regions)


def _save_pdf_visuals(source: Path, output_dir: Path):
    try:
        import pymupdf
    except Exception as exc:  # pragma: no cover - dependency validation happens in deployment
        logger.warning("PyMuPDF unavailable; source visuals skipped: %s", exc)
        return []

    visuals = []
    output_dir.mkdir(parents=True, exist_ok=True)
    document = pymupdf.open(str(source))
    try:
        for index in range(len(document)):
            page = document[index]
            page_no = index + 1
            for region in _pdf_regions(page, page_no):
                if len(visuals) >= MAX_VISUALS_PER_DOCUMENT:
                    logger.warning("Visual limit reached for %s", source.name)
                    return visuals
                clip = _expanded(region["rect"], page.rect)
                # Second guard after adding a small label margin.
                if _area(clip) / max(1.0, _area(page.rect)) > MAX_REGION_PAGE_RATIO:
                    continue
                pix = page.get_pixmap(matrix=pymupdf.Matrix(RENDER_SCALE, RENDER_SCALE), clip=clip, alpha=False)
                digest = hashlib.sha256(pix.samples).hexdigest()[:16]
                visual_id = f"p{page_no}-{region['kind']}-{digest}"
                filename = f"{visual_id}.png"
                path = output_dir / filename
                if not path.exists():
                    pix.save(str(path))
                visuals.append({
                    "id": visual_id,
                    "kind": region["kind"],
                    "page": page_no,
                    "filename": filename,
                    "width": pix.width,
                    "height": pix.height,
                    "caption": {
                        "table": f"Source table from page {page_no}",
                        "diagram": f"Source diagram or chart from page {page_no}",
                        "figure": f"Source figure from page {page_no}",
                    }[region["kind"]],
                    "bbox": [round(clip.x0, 2), round(clip.y0, 2), round(clip.x1, 2), round(clip.y1, 2)],
                })
    finally:
        document.close()
    return visuals


def extract_source_visuals(source: Path, processed_dir: Path):
    """Extract visual regions from a source file.

    A deliberate invariant: this function never creates page screenshots. If a
    region occupies most of a PDF page it is rejected, even if the page itself
    is a scan. Image-only pages remain readable through OCR text but are not
    silently copied into lessons as full-page images.
    """
    if source.suffix.lower() != ".pdf":
        # DOCX tables already survive as structured Markdown and embedded images
        # are handled by the private-device importer. Server-side DOCX visual
        # extraction will be added only when it can preserve placement without
        # associating an image with the wrong module.
        return []
    return _save_pdf_visuals(source, processed_dir / "visuals")


def attach_visuals_to_sections(sections, visuals):
    """Attach only visuals whose source page falls inside each section span."""
    if not visuals:
        return sections
    for section in sections:
        start = section.get("start_page")
        end = section.get("end_page") or start
        if not start:
            section["source_visuals"] = []
            continue
        section["source_visuals"] = [v for v in visuals if start <= int(v.get("page") or 0) <= end]
    return sections


def public_visual_metadata(document, module):
    """Stable API metadata; bytes are served through an authenticated endpoint."""
    return [
        {
            "id": visual["id"],
            "kind": visual.get("kind", "figure"),
            "page": visual.get("page"),
            "caption": visual.get("caption", "Source visual"),
            "width": visual.get("width"),
            "height": visual.get("height"),
            "url": f"/api/student/modules/{module.id}/visuals/{visual['id']}/",
        }
        for visual in (module.source_visuals or [])
        if visual.get("id") and visual.get("filename")
    ]


def visual_path(document, module, visual_id: str) -> Path | None:
    for visual in module.source_visuals or []:
        if visual.get("id") != visual_id:
            continue
        filename = Path(str(visual.get("filename") or "")).name
        if not filename:
            return None
        base = Path(document.processed_markdown_path).parent if document.processed_markdown_path else Path(settings.MEDIA_ROOT) / "processed" / str(document.id)
        candidate = (base / "visuals" / filename).resolve()
        try:
            candidate.relative_to(Path(settings.MEDIA_ROOT).resolve())
        except ValueError:
            return None
        return candidate
    return None
