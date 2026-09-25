"""Embedded DOCX pictures with authored headings, captions and nearby text.

Only internal raster relationships are read. External links, active SVG,
SmartArt and charts without a raster fallback are not fetched or executed.
"""
from __future__ import annotations

import io
import logging
import warnings
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from PIL import Image, ImageOps
from .visual_context import CAPTION_RE
from .visual_quality import looks_like_qr_image

log = logging.getLogger("localmind.documents.visuals")
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
WP = "{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}"
MAX_PIXELS = 36_000_000
MAX_IMAGE_BYTES = 16 * 1024 * 1024


def normalized_picture(data, crop=None):
    """Decode once, apply Word's source crop and produce bounded safe PNG bytes."""
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("embedded picture exceeds 16 MB")
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(data)) as original:
            if original.format not in {"PNG", "JPEG", "GIF", "WEBP", "BMP", "TIFF"}:
                raise ValueError("unsupported raster picture format")
            if original.width * original.height > MAX_PIXELS:
                raise ValueError("embedded picture exceeds 36 million pixels")
            image = ImageOps.exif_transpose(original).convert("RGBA")
    if crop:
        left, top, right, bottom = crop
        w, h = image.size
        box = (round(w * left), round(h * top), round(w * (1-right)), round(h * (1-bottom)))
        if box[2] <= box[0] or box[3] <= box[1]:
            raise ValueError("empty Word picture crop")
        image = image.crop(box)
    width, height = image.size
    if min(width, height) < 40 or max(width, height) / min(width, height) > 12:
        return None
    # Normalize to RGB on white; no metadata or active image content is retained.
    background = Image.new("RGB", image.size, "white")
    background.paste(image, mask=image.getchannel("A"))
    if looks_like_qr_image(background):
        raise ValueError("QR/navigation code excluded by instructional-visual policy")
    out = io.BytesIO(); background.save(out, format="PNG")
    return out.getvalue(), background.width, background.height


def read_docx_visuals(source, save, notices):
    """Walk the same supported body blocks/styles as the course text parser."""
    from .parser import _read_docx_style_map, _docx_body_blocks, _docx_paragraph_heading_level, _docx_paragraph_text
    from .word_numbering import WordNumbering

    with ZipFile(source) as archive:
        infos = archive.infolist()
        if len(infos) > 3000 or sum(i.file_size for i in infos) > 100 * 1024 * 1024:
            raise ValueError("DOCX expanded content exceeds the safe limit")
        def xml(name):
            data = archive.read(name)
            if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
                raise ValueError("unsupported XML declarations")
            return ET.fromstring(data)
        root = xml("word/document.xml")
        rels = {}
        if "word/_rels/document.xml.rels" in archive.namelist():
            for rel in xml("word/_rels/document.xml.rels"):
                rels[rel.get("Id")] = rel
        styles, numbering = _read_docx_style_map(archive), WordNumbering(archive)
        body = root.find(f"{W}body")
        if body is None:
            raise ValueError("DOCX body is missing")
        paragraphs = []
        heading_path = []
        for block in _docx_body_blocks(body):
            # Nested table paragraphs and anchored pictures are included too.
            for p in ([block] if block.tag == f"{W}p" else block.iter(f"{W}p")):
                text = _docx_paragraph_text(p)
                level = _docx_paragraph_heading_level(p, styles)
                prefix = (numbering.prefix(p) or "") if text else ""
                if level and text:
                    heading_path = [h for h in heading_path if h[0] < level]
                    heading_path.append((level, f"{prefix.strip()} {text}".strip()))
                style = p.find(f"{W}pPr/{W}pStyle")
                paragraphs.append({"node": p, "text": text,
                                   "heading_path": [h[1] for h in heading_path],
                                   "caption": style is not None and "caption" in style.get(f"{W}val", "").lower()})
        # Word dimensions are twips; drawing extents are EMUs (635 per twip).
        sizes = list(body.iter(f"{W}pgSz"))
        page_area = min((int(s.get(f"{W}w", 12240))*int(s.get(f"{W}h", 15840))*635**2 for s in sizes), default=12240*15840*635**2)
        records = []
        for position, entry in enumerate(paragraphs):
            node = entry["node"]
            neighbours = [x for x in paragraphs[max(0, position-3):position+4] if x["heading_path"] == entry["heading_path"]]
            context = "\n".join(x["text"] for x in neighbours if x["text"])[:1800]
            nearby = sorted(range(max(0, position-2), min(len(paragraphs), position+3)), key=lambda n: (abs(n-position), n < position))
            caption = next((paragraphs[n]["text"][:300] for n in nearby
                            if paragraphs[n]["heading_path"] == entry["heading_path"] and
                            (paragraphs[n]["caption"] or CAPTION_RE.match(paragraphs[n]["text"]))), "")
            for occurrence, picture in enumerate(node.iter(f"{A}blip")):
                try:
                    rid = picture.get(f"{R}embed")
                    rel = rels.get(rid)
                    if rel is None or rel.get("TargetMode") == "External":
                        raise ValueError("external or missing picture relationship")
                    target = rel.get("Target", "")
                    if not target.startswith("media/") or "/" in target[6:] or "\\" in target or ".." in target:
                        raise ValueError("unsupported picture path")
                    # Locate the enclosing drawing for display size and source crop.
                    drawing = next((d for d in node.iter(f"{W}drawing") if picture in list(d.iter())), None)
                    crop = None
                    if drawing is not None:
                        extent = drawing.find(f".//{WP}extent")
                        if extent is not None and int(extent.get("cx", 0))*int(extent.get("cy", 0)) > page_area*0.72:
                            raise ValueError("page-sized Word picture excluded by cropped-only policy")
                        src = drawing.find(f".//{A}srcRect")
                        if src is not None:
                            crop = tuple(max(0, min(1, int(src.get(k, 0))/100000)) for k in ("l", "t", "r", "b"))
                    info = archive.getinfo(f"word/{target}")
                    if info.file_size > MAX_IMAGE_BYTES:
                        raise ValueError("embedded picture exceeds 16 MB")
                    normalized = normalized_picture(archive.read(info), crop)
                    if not normalized:
                        continue
                    raw, width, height = normalized
                    record = save(raw, {"id_prefix": f"d{position+1}-{occurrence+1}", "kind": "figure", "page": None,
                                        "width": width, "height": height, "context_text": context,
                                        "heading_path": entry["heading_path"], "source_position": position,
                                        "caption": caption or "Source figure" + (f" — {entry['heading_path'][-1]}" if entry["heading_path"] else ""),
                                        "caption_origin": "source" if caption else "label"})
                    records.append(record)
                except (ValueError, KeyError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
                    notices.append(f"Word picture near paragraph {position+1} was not imported: {exc}.")
                    log.warning("Word picture skipped: %s", exc)
            if any(e.tag.endswith(("}chart", "}relIds", "}imagedata")) for e in node.iter()):
                notices.append("Some Word charts, SmartArt or legacy drawings need a PDF export; embedded raster fallbacks are retained when present.")
        return records
