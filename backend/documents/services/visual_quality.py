"""Content-level quality checks shared by PDF and DOCX visual extraction.

Geometry alone cannot distinguish an instructional figure from a QR code or a
publisher/navigation tile.  These checks inspect the rendered raster itself and
are intentionally conservative: a candidate is rejected as QR only when several
finder-pattern signals agree.
"""
from __future__ import annotations

import io

from PIL import Image


def _binary_rows(image: Image.Image, max_side: int = 192):
    """Return a compact black/white matrix for cheap structural inspection."""
    gray = image.convert("L")
    scale = min(1.0, max_side / max(gray.size))
    if scale < 1.0:
        gray = gray.resize((max(1, round(gray.width * scale)), max(1, round(gray.height * scale))))
    # A fixed threshold is adequate for printed QR codes and avoids bringing in
    # an OCR/computer-vision dependency just to filter navigation furniture.
    pixels = list(gray.getdata())
    return gray.width, gray.height, [[1 if pixels[y * gray.width + x] < 128 else 0 for x in range(gray.width)] for y in range(gray.height)]


def _finder_centres(line):
    """Locate approximate 1:1:3:1:1 dark/light QR finder runs on one scanline."""
    runs = []
    if not line:
        return runs
    colour, start = line[0], 0
    for index, value in enumerate(line[1:], 1):
        if value != colour:
            runs.append((colour, start, index - start))
            colour, start = value, index
    runs.append((colour, start, len(line) - start))
    centres = []
    for i in range(len(runs) - 4):
        window = runs[i:i + 5]
        if [r[0] for r in window] != [1, 0, 1, 0, 1]:
            continue
        widths = [r[2] for r in window]
        unit = (widths[0] + widths[1] + widths[3] + widths[4]) / 4.0
        if unit < 1:
            continue
        if any(abs(widths[j] - unit) > unit * 0.85 for j in (0, 1, 3, 4)):
            continue
        if abs(widths[2] - unit * 3) > unit * 1.55:
            continue
        centres.append(window[0][1] + sum(widths[:2]) + widths[2] / 2.0)
    return centres


def looks_like_qr_image(image: Image.Image) -> bool:
    """High-confidence QR rejection without decoding the QR payload.

    We require a nearly square, high-contrast image plus finder-pattern evidence
    on several horizontal and vertical scanlines.  This avoids rejecting normal
    textbook diagrams that merely contain a few square boxes.
    """
    width, height = image.size
    if min(width, height) < 42:
        return False
    aspect = max(width, height) / max(1, min(width, height))
    if aspect > 1.38:
        return False
    w, h, matrix = _binary_rows(image)
    black = sum(sum(row) for row in matrix)
    ratio = black / max(1, w * h)
    if not 0.12 <= ratio <= 0.72:
        return False

    sample_ys = sorted({max(0, min(h - 1, round(h * f))) for f in (0.18, 0.25, 0.32, 0.50, 0.68, 0.75, 0.82)})
    horizontal_hits = sum(bool(_finder_centres(matrix[y])) for y in sample_ys)
    if horizontal_hits < 2:
        return False
    sample_xs = sorted({max(0, min(w - 1, round(w * f))) for f in (0.18, 0.25, 0.32, 0.50, 0.68, 0.75, 0.82)})
    vertical_hits = 0
    for x in sample_xs:
        column = [matrix[y][x] for y in range(h)]
        vertical_hits += bool(_finder_centres(column))
    return vertical_hits >= 2


def looks_like_qr_png(raw: bytes) -> bool:
    try:
        with Image.open(io.BytesIO(raw)) as image:
            return looks_like_qr_image(image)
    except Exception:
        return False
