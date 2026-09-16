"""Extract source visuals without ever saving a full page screenshot.

PDF visuals are cropped from conservative source evidence:
* embedded raster image rectangles;
* caption-linked vector diagrams/charts;
* table regions that pass tabular-quality checks;
* horizontally ruled textbook tables missed by normal table inference.

Page furniture, large prose panels, page masks and near-full-page regions are
rejected before rendering. Lesson generation stays text-grounded; the original
source visual is shown beside the generated lesson rather than asking the local
text model to invent an interpretation of pixels.
"""
from __future__ import annotations

import hashlib
import json
import os
import uuid
import logging
from pathlib import Path

from .visual_context import CAPTION_RE
from .pdf_visual_regions import (
    MAX_REGION_PAGE_RATIO,
    MIN_REGION_POINTS,
    area as _area,
    intersection_ratio as _intersection_ratio,
    valid_region as _valid_region,
    dedupe as _dedupe,
)
from .pdf_visual_sanitizer import pdf_regions
from .ruled_tables import ruled_table_regions

logger = logging.getLogger("localmind.documents.visuals")

MAX_VISUALS_PER_DOCUMENT = 500
RENDER_SCALE = 2.0
# Version 5 adds a final textbook safety pass that rejects page fragments,
# headers/page-number tiles and text-heavy embedded composites. Bump so books
# processed with the earlier policy are automatically re-extracted.
EXTRACTOR_VERSION = 5
MAX_STORED_BYTES = 128 * 1024 * 1024


def _expanded(rect, page_rect, margin=6):
    import pymupdf

    return pymupdf.Rect(
        max(page_rect.x0, rect.x0 - margin),
        max(page_rect.y0, rect.y0 - margin),
        min(page_rect.x1, rect.x1 + margin),
        min(page_rect.y1, rect.y1 + margin),
    )


def _pdf_regions(page, page_no):
    """Return sanitized visual regions plus ruled-text table fallback."""
    regions = list(pdf_regions(page, page_no))
    try:
        regions.extend(ruled_table_regions(page, page_no))
    except Exception as exc:
        logger.debug("Ruled table detection failed on page %s: %s", page_no, exc)
    return _dedupe(regions)


def _atomic_json(path, value):
    temp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        temp.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


class VisualLimitReached(RuntimeError):
    pass


class AssetStore:
    """One PNG per content hash, one metadata record per source occurrence."""
    def __init__(self, folder):
        self.folder = Path(folder)
        self.folder.mkdir(parents=True, exist_ok=True)
        self.rows = []
        self.bytes = 0
        self.digests = set()

    def save(self, raw, metadata):
        if len(self.rows) >= MAX_VISUALS_PER_DOCUMENT:
            raise VisualLimitReached("The 500-visual limit was reached; remaining pictures were not imported.")
        digest = hashlib.sha256(raw).hexdigest()
        if digest not in self.digests:
            if self.bytes + len(raw) > MAX_STORED_BYTES:
                raise VisualLimitReached("The 128 MB visual storage limit was reached; remaining pictures were not imported.")
            self.bytes += len(raw)
            self.digests.add(digest)
        filename = digest + ".png"
        path = self.folder / filename
        if not path.is_file():
            temp = self.folder / (uuid.uuid4().hex + ".tmp")
            try:
                temp.write_bytes(raw)
                os.replace(temp, path)
            finally:
                temp.unlink(missing_ok=True)
        row = dict(metadata)
        prefix = row.pop("id_prefix")
        row.update(id=f"{prefix}-{digest[:16]}", filename=filename, digest=digest)
        self.rows.append(row)
        return row


def _nearby_pdf_text(page, rect):
    """Save nearby source paragraphs separately from the cropped image bytes."""
    import pymupdf
    candidates = []
    for block in page.get_text("blocks"):
        if len(block) < 7 or block[6] != 0:
            continue
        box = pymupdf.Rect(block[:4])
        horizontal = min(box.x1, rect.x1) - max(box.x0, rect.x0)
        gap = max(rect.y0-box.y1, box.y0-rect.y1, 0)
        if horizontal > 0 and gap <= 90:
            candidates.append((gap, box.y0, str(block[4]).strip()))
    candidates.sort()
    nearby = [text for _, _, text in candidates[:5]]
    caption = next((line.strip()[:300] for text in nearby for line in text.splitlines()
                    if CAPTION_RE.match(line.strip())), "")
    return "\n".join(nearby)[:1800], caption


def filter_repeated_furniture(rows):
    """Only repeated SMALL margin artwork is furniture, not repeated concepts.

    Count distinct source pages. Keep every body occurrence, even when the
    same figure is taught in several modules. AssetStore deduplicates bytes.
    """
    pages = {}
    for row in rows:
        if row.get("margin_art") and row.get("page"):
            pages.setdefault(row["digest"], set()).add(row["page"])
    return [r for r in rows if not (r.get("margin_art") and len(pages.get(r["digest"], ())) >= 4)]


def _save_pdf_visuals(source: Path, output_dir: Path, notices=None):
    import pymupdf
    notices = notices if notices is not None else []
    store = AssetStore(output_dir)
    with pymupdf.open(str(source)) as document:
        for index, page in enumerate(document):
            # Text/drawing rectangles are unrotated. Work in that coordinate
            # system; the original uploaded PDF is never changed or saved.
            rotation = page.rotation
            page.set_rotation(0)
            try:
                regions = _pdf_regions(page, index + 1)
                if not regions and any(_area(pymupdf.Rect(i["bbox"])) / max(1, _area(page.rect)) > .72
                                       for i in page.get_image_info() if i.get("bbox")):
                    notices.append(f"Page {index+1}: a page-sized scan was not saved as a figure. Separate visual regions were not detected.")
                for occurrence, region in enumerate(regions, 1):
                    if len(store.rows) >= MAX_VISUALS_PER_DOCUMENT:
                        notices.append("The 500-visual limit was reached; remaining pictures were not imported.")
                        return filter_repeated_furniture(store.rows)
                    # Embedded pictures keep their exact rectangle. Vector/table
                    # crops receive only two points of breathing room, never the
                    # surrounding prose or whole page.
                    clip = _expanded(region["rect"], page.rect, margin=0 if region["kind"] == "figure" else 2)
                    if not _valid_region(clip, page.rect):
                        continue
                    scale = min(RENDER_SCALE, 2200 / max(clip.width, clip.height))
                    pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=clip, alpha=False)
                    context, nearby_caption = _nearby_pdf_text(page, clip)
                    source_caption = str(region.get("caption") or "").strip()
                    caption = source_caption or nearby_caption
                    relative_area = _area(clip) / max(1, _area(page.rect))
                    store.save(pix.tobytes("png"), {
                        "id_prefix": f"p{index+1}-{occurrence}-{region['kind']}",
                        "kind": region["kind"], "page": index+1,
                        "width": pix.width, "height": pix.height,
                        "context_text": context, "heading_path": [],
                        "caption": caption or f"Source {region['kind']} from page {index+1}",
                        "caption_origin": "source" if caption else "label",
                        "bbox": [round(v, 2) for v in clip],
                        "origin": region.get("origin", "detected"),
                        "margin_art": relative_area < .035 and (clip.y1 < page.rect.height*.12 or clip.y0 > page.rect.height*.88),
                    })
            except VisualLimitReached as exc:
                notices.append(str(exc))
                return filter_repeated_furniture(store.rows)
            finally:
                page.set_rotation(rotation)
    result = filter_repeated_furniture(store.rows)
    if len(result) != len(store.rows):
        notices.append(f"Excluded {len(store.rows)-len(result)} repeated small margin pictures; repeated body illustrations were kept.")
    return result


def extraction_manifest(processed_dir):
    path = Path(processed_dir) / "visuals" / "manifest.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def extract_source_visuals(source: Path, processed_dir: Path):
    """Bounded PDF/DOCX extraction, cached by source bytes and policy version."""
    digest = hashlib.sha256()
    with source.open("rb") as stream:
        for block in iter(lambda: stream.read(1024*1024), b""):
            digest.update(block)
    fingerprint = digest.hexdigest()
    manifest = extraction_manifest(processed_dir)
    output = processed_dir / "visuals"
    if (manifest.get("source_hash") == fingerprint and manifest.get("version") == EXTRACTOR_VERSION
            and all((output / Path(v.get("filename", "")).name).is_file() for v in manifest.get("visuals", []))):
        return manifest["visuals"]
    notices = []
    if source.suffix.lower() == ".pdf":
        rows = _save_pdf_visuals(source, output, notices)
    elif source.suffix.lower() == ".docx":
        from .docx_visuals import read_docx_visuals
        store = AssetStore(output)
        try:
            rows = read_docx_visuals(source, store.save, notices)
        except VisualLimitReached as exc:
            notices.append(str(exc)); rows = store.rows
    else:
        rows = []
        notices.append("Visual extraction supports PDF and DOCX. This format retains its existing text-only processing.")
    output.mkdir(parents=True, exist_ok=True)
    _atomic_json(output / "manifest.json", {"version": EXTRACTOR_VERSION, "source_hash": fingerprint,
                                          "visuals": rows, "warnings": list(dict.fromkeys(notices))[:40]})
    return rows


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
    from django.conf import settings
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
