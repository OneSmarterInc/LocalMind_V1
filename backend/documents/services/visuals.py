"""Extract source visuals without ever saving a full page screenshot.

PDF visuals are detected from source evidence, then all candidates pass one
instructional-visual policy before rendering.  The rendered crop receives one last
content-level QR check.  DOCX extraction uses the same QR quality rule.
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
from .visual_quality import looks_like_qr_png

logger = logging.getLogger("localmind.documents.visuals")

MAX_VISUALS_PER_DOCUMENT = 500
RENDER_SCALE = 2.0
# Version 9 avoids QR false positives on colorful textures. Version 8 keeps version 7's shared safety policy, rendered QR rejection and
# positional furniture removal, and adds: a table has to look tabular even when
# a caption sits beside it, and a publisher's page-sized 1-bit watermark
# stencil is no longer reported as an unsaved page scan.
EXTRACTOR_VERSION = 9
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
    """All candidate types are already sanitized inside pdf_regions()."""
    return list(pdf_regions(page, page_no))


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


def _layout_key(row):
    """Approximate page-position signature for repeated publisher furniture."""
    bbox = row.get("bbox") or []
    page_size = row.get("page_size") or []
    if len(bbox) != 4 or len(page_size) != 2 or not all(page_size):
        return None
    x0, y0, x1, y1 = bbox
    width, height = page_size
    return (
        round(x0 / width, 1), round(y0 / height, 1),
        round((x1 - x0) / width, 1), round((y1 - y0) / height, 1),
    )


def filter_repeated_furniture(rows):
    """Remove repeated margin/header/footer art without removing body figures.

    Two signals are used: identical bytes on several pages and repeated placement
    at the same page-relative location.  The positional rule applies only to
    uncaptained small/margin candidates, so repeated teaching figures in the body
    remain available.
    """
    digest_pages = {}
    layout_pages = {}
    for row in rows:
        page = row.get("page")
        if not page:
            continue
        if row.get("margin_art"):
            digest_pages.setdefault(row.get("digest"), set()).add(page)
        key = _layout_key(row)
        if key and row.get("caption_origin") != "source" and row.get("layout_furniture_candidate"):
            layout_pages.setdefault(key, set()).add(page)

    result = []
    for row in rows:
        repeated_digest = row.get("margin_art") and len(digest_pages.get(row.get("digest"), ())) >= 4
        key = _layout_key(row)
        repeated_layout = bool(key and row.get("layout_furniture_candidate") and
                               row.get("caption_origin") != "source" and len(layout_pages.get(key, ())) >= 4)
        if repeated_digest or repeated_layout:
            continue
        result.append(row)
    return result


def _save_pdf_visuals(source: Path, output_dir: Path, notices=None):
    import pymupdf
    notices = notices if notices is not None else []
    store = AssetStore(output_dir)
    with pymupdf.open(str(source)) as document:
        for index, page in enumerate(document):
            rotation = page.rotation
            page.set_rotation(0)
            try:
                regions = _pdf_regions(page, index + 1)
                # A page-sized 1-bit stencil is the publisher's watermark, not a
                # scan of the page, so it must not raise a scan notice on every
                # page of an otherwise ordinary typeset book.
                if not regions and any(_area(pymupdf.Rect(i["bbox"])) / max(1, _area(page.rect)) > .72
                                       and int(i.get("bpc") or 8) > 1
                                       for i in page.get_image_info() if i.get("bbox")):
                    notices.append(f"Page {index+1}: a page-sized scan was not saved as a figure. Separate visual regions were not detected.")
                for occurrence, region in enumerate(regions, 1):
                    if len(store.rows) >= MAX_VISUALS_PER_DOCUMENT:
                        notices.append("The 500-visual limit was reached; remaining pictures were not imported.")
                        return filter_repeated_furniture(store.rows)
                    clip = _expanded(region["rect"], page.rect, margin=0 if region["kind"] == "figure" else 2)
                    if not _valid_region(clip, page.rect):
                        continue
                    scale = min(RENDER_SCALE, 2200 / max(clip.width, clip.height))
                    pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=clip, alpha=False)
                    raw = pix.tobytes("png")
                    if looks_like_qr_png(raw):
                        notices.append(f"Page {index+1}: a QR/navigation code was excluded from source visuals.")
                        continue
                    context, nearby_caption = _nearby_pdf_text(page, clip)
                    source_caption = str(region.get("caption") or "").strip()
                    caption = source_caption or nearby_caption
                    relative_area = _area(clip) / max(1, _area(page.rect))
                    top = clip.y0 / max(1.0, page.rect.height)
                    bottom = clip.y1 / max(1.0, page.rect.height)
                    layout_furniture = (not caption and relative_area < .12 and (top < .24 or bottom > .82))
                    store.save(raw, {
                        "id_prefix": f"p{index+1}-{occurrence}-{region['kind']}",
                        "kind": region["kind"], "page": index+1,
                        "width": pix.width, "height": pix.height,
                        "context_text": context, "heading_path": [],
                        "caption": caption or f"Source {region['kind']} from page {index+1}",
                        "caption_origin": "source" if caption else "label",
                        "bbox": [round(v, 2) for v in clip],
                        "page_size": [round(page.rect.width, 2), round(page.rect.height, 2)],
                        "origin": region.get("origin", "detected"),
                        "margin_art": relative_area < .035 and (clip.y1 < page.rect.height*.12 or clip.y0 > page.rect.height*.88),
                        "layout_furniture_candidate": layout_furniture,
                    })
            except VisualLimitReached as exc:
                notices.append(str(exc))
                return filter_repeated_furniture(store.rows)
            finally:
                page.set_rotation(rotation)
    result = filter_repeated_furniture(store.rows)
    if len(result) != len(store.rows):
        notices.append(f"Excluded {len(store.rows)-len(result)} repeated page-furniture pictures; repeated body illustrations were kept.")
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
