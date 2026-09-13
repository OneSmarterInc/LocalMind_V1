"""Fast PDF structure pass built on the PDF's own text layer.

Docling's layout model recognises headings by running a PyTorch vision model
over a rendering of every page, which is seconds per page on a CPU and
minutes for a textbook. Most text-based PDFs carry the same information in
their font metrics: headings are set larger, or bold, than the body. pdfium
(pypdfium2, already a Docling dependency) exposes the size and font name of
every character, so this module reads them, decides which lines are headings
and at which level, and emits the same Markdown-with-page-breaks that the
Docling path produces. No model is loaded, and a 300-page book takes seconds.

Everything here is deterministic and derived from the document itself: the
body size is the size that carries the most characters, heading sizes are
whatever distinct sizes sit clearly above it, and levels follow size order.
Nothing about a particular publisher or layout is assumed.
"""
from __future__ import annotations

import ctypes
import logging
import re
from collections import Counter
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

PAGE_BREAK_MARKER = "<!-- page break -->"

# A heading is at least this much larger than the body text, in points.
# 1.0 pt is below any deliberate size step a typesetter uses, and above the
# rounding noise between fonts of nominally equal size.
MIN_HEADING_SIZE_STEP = 1.0
# Sizes closer than this are the same style (11.0 and 11.04 are one font).
SIZE_BUCKET = 0.5
# Heading lines are short; longer lines are body text that happens to be
# set in a display size (a pull quote, a subtitle sentence).
MAX_HEADING_CHARS = 100
MAX_HEADING_WORDS = 14
# Deepest heading level the outline can use.
MAX_LEVELS = 4
# If more than this share of the document's characters would become
# headings, the size signal is noise (a slide deck, a poster, a mind-map) and
# no headings are emitted so the page-group fallback can take over.
MAX_HEADING_CHAR_SHARE = 0.25
# Minimum share of body-sized characters for the "body size" to be trusted.
MIN_BODY_SHARE = 0.35
# Body-size bold runs that are short and stand on their own line are
# sub-headings (the "Learn Python syntax" style). They need at least this
# many characters to count, so a bold "Note:" or a bold list bullet does
# not become a section.
MIN_BOLD_HEADING_CHARS = 3

_BOLD_NAME_RE = re.compile(r"bold|black|heavy|semibold|demibold|extrabold|ultrabold", re.IGNORECASE)
# pdfium FXFONT_FORCE_BOLD; set on synthetic-bold fonts.
_FXFONT_FORCE_BOLD = 1 << 18
_TERMINAL_PUNCT = ".,;!?"


@dataclass
class _Line:
    text: str
    size: float
    bold: bool
    page: int
    chars: int = 0
    level: int = 0  # 0 = body text
    style: tuple = field(default_factory=tuple)


def _bucket(size: float) -> float:
    return round(round(size / SIZE_BUCKET) * SIZE_BUCKET, 2)


def _is_bold(font_name: str, flags: int) -> bool:
    return bool(flags & _FXFONT_FORCE_BOLD) or bool(_BOLD_NAME_RE.search(font_name or ""))


def _page_lines(textpage, page_number: int) -> list[_Line]:
    """Lines of one page with their dominant size and bold flag.

    pdfium inserts ``\\r\\n`` at the end of every visual line in its text
    page, which is the same segmentation ``get_text_range`` produces, so the
    plain text-layer probe and this pass see identical line breaks.
    """
    import pypdfium2.raw as raw

    count = raw.FPDFText_CountChars(textpage)
    lines: list[_Line] = []
    chars: list[str] = []
    sizes: Counter = Counter()
    bold_chars = 0
    font_buffer = ctypes.create_string_buffer(128)
    flags = ctypes.c_int()

    def flush():
        nonlocal chars, sizes, bold_chars
        text = "".join(chars).strip()
        if text:
            visible = sum(1 for c in text if not c.isspace())
            size = _bucket(sizes.most_common(1)[0][0]) if sizes else 0.0
            lines.append(_Line(text=text, size=size, bold=visible > 0 and bold_chars >= 0.8 * visible, page=page_number, chars=visible))
        chars, sizes, bold_chars = [], Counter(), 0

    for index in range(count):
        code = raw.FPDFText_GetUnicode(textpage, index)
        char = chr(code) if 0 <= code < 0x110000 else ""
        if char in ("\r", "\n"):
            flush()
            continue
        if not char:
            continue
        chars.append(char)
        if char.isspace():
            continue
        size = raw.FPDFText_GetFontSize(textpage, index)
        if size and size > 0:
            sizes[size] += 1
        raw.FPDFText_GetFontInfo(textpage, index, font_buffer, len(font_buffer), ctypes.byref(flags))
        if _is_bold(font_buffer.value.decode("latin-1", errors="ignore"), flags.value):
            bold_chars += 1
    flush()
    return lines


def _looks_like_heading_text(text: str) -> bool:
    if len(text) > MAX_HEADING_CHARS or len(text.split()) > MAX_HEADING_WORDS:
        return False
    # At least one real word: "V V" (an arrow glyph rendered as text) or a
    # lone letter set large is decoration, not a title.
    if not any(sum(c.isalpha() for c in word) >= 3 for word in text.split()):
        return False
    stripped = text.rstrip()
    # A line that ends a sentence is body text set large, not a title.
    # ':' is allowed ("Phase 1: Python Basics") and so is ')' (a numbered
    # heading in parentheses); a full stop after a single number is fine.
    if stripped[-1] in _TERMINAL_PUNCT and not re.match(r"^\d+(\.\d+)*\.$", stripped):
        return False
    return True


def _assign_levels(lines: list[_Line]) -> tuple[int, dict]:
    """Mark heading lines in place and return (heading_count, stats).

    Body size: the size bucket that carries the most visible characters.
    Heading sizes: distinct buckets at least MIN_HEADING_SIZE_STEP above the
    body, largest first, each its own level. Bold lines at body size, short
    and on their own, become the level below the smallest size-based level.
    """
    total_chars = sum(l.chars for l in lines)
    if total_chars == 0:
        return 0, {"reason": "no text"}
    by_size: Counter = Counter()
    for line in lines:
        by_size[line.size] += line.chars
    body_size, body_chars = by_size.most_common(1)[0]
    body_share = body_chars / total_chars
    if body_share < MIN_BODY_SHARE:
        # No dominant text size: a poster, a diagram, a form. Size cannot
        # separate headings from body here.
        return 0, {"reason": "no dominant body size", "body_share": round(body_share, 2)}

    heading_sizes = sorted((s for s in by_size if s >= body_size + MIN_HEADING_SIZE_STEP), reverse=True)
    size_level = {}
    for position, size in enumerate(heading_sizes):
        # Deeper than MAX_LEVELS-1 by size collapses into the smallest
        # size-based level; bold-at-body gets the next level after that.
        size_level[size] = min(position + 1, MAX_LEVELS - 1)
    bold_level = min(len(size_level) + 1, MAX_LEVELS)

    heading_chars = 0
    count = 0
    for line in lines:
        if not _looks_like_heading_text(line.text):
            continue
        level = 0
        if line.size in size_level:
            level = size_level[line.size]
        elif line.size == body_size and line.bold and line.chars >= MIN_BOLD_HEADING_CHARS:
            level = bold_level
        if level:
            line.level = level
            heading_chars += line.chars
            count += 1

    stats = {"body_size": body_size, "body_share": round(body_share, 2), "heading_sizes": heading_sizes,
             "heading_char_share": round(heading_chars / total_chars, 3)}
    if count and heading_chars / total_chars > MAX_HEADING_CHAR_SHARE:
        for line in lines:
            line.level = 0
        stats["reason"] = "headings would exceed the character share limit"
        return 0, stats
    return count, stats


def _merge_wrapped_headings(lines: list[_Line]) -> list[_Line]:
    """A title that wraps onto a second line arrives as two consecutive
    heading lines of the same size on the same page; join them."""
    merged: list[_Line] = []
    for line in lines:
        previous = merged[-1] if merged else None
        if (line.level and previous is not None and previous.level == line.level
                and previous.page == line.page and previous.size == line.size
                and len(previous.text) + len(line.text) + 1 <= MAX_HEADING_CHARS
                and not previous.text.rstrip().endswith((":", ")"))):
            previous.text = f"{previous.text} {line.text}"
            previous.chars += line.chars
            continue
        merged.append(line)
    return merged


def _demote_repeated_headings(lines: list[_Line]) -> None:
    """Running headers and footers repeat the same short text on many pages
    (a chapter name at the top of every page, the book title at the bottom).
    Those are not section boundaries; treat any heading text that recurs on
    three or more pages as body text."""
    pages_by_text: dict[str, set] = {}
    for line in lines:
        if line.level:
            pages_by_text.setdefault(line.text.casefold(), set()).add(line.page)
    repeated = {text for text, pages in pages_by_text.items() if len(pages) >= 3}
    if repeated:
        for line in lines:
            if line.level and line.text.casefold() in repeated:
                line.level = 0


def _render(lines: list[_Line], page_count: int) -> str:
    out: list[str] = []
    current_page = 1
    for line in lines:
        while line.page > current_page:
            out.append("")
            out.append(PAGE_BREAK_MARKER)
            out.append("")
            current_page += 1
        if line.level:
            if out and out[-1] != "":
                out.append("")
            out.append(f"{'#' * line.level} {line.text}")
            out.append("")
        else:
            out.append(line.text)
    while current_page < page_count:
        out.append("")
        out.append(PAGE_BREAK_MARKER)
        out.append("")
        current_page += 1
    return "\n".join(out).strip()


def structured_text_layer(source, max_pages: int = 400) -> tuple[str, int, int, dict]:
    """Return (markdown, meaningful_chars, heading_count, stats) for a PDF.

    ``meaningful_chars`` counts alphanumerics, the same measure the text-layer
    probe in parser.py uses, so the caller can apply one threshold to both.
    On any pdfium failure the result is empty and the caller falls through to
    the slower strategies; this pass never raises.
    """
    try:
        import pypdfium2 as pdfium
    except Exception as exc:  # pragma: no cover - pypdfium2 ships with docling
        logger.warning("LocalMind: pypdfium2 unavailable (%s); skipping the font-metric structure pass", exc)
        return "", 0, 0, {"reason": "pypdfium2 unavailable"}
    lines: list[_Line] = []
    page_count = 0
    try:
        pdf = pdfium.PdfDocument(str(source))
        try:
            page_count = min(len(pdf), max_pages)
            for page_index in range(page_count):
                page = pdf[page_index]
                try:
                    textpage = page.get_textpage()
                    try:
                        lines.extend(_page_lines(textpage, page_index + 1))
                    finally:
                        textpage.close()
                finally:
                    page.close()
        finally:
            pdf.close()
    except Exception as exc:
        logger.warning("LocalMind: font-metric structure pass could not read %s (%s)", getattr(source, "name", source), exc)
        return "", 0, 0, {"reason": str(exc)}

    meaningful = sum(sum(c.isalnum() for c in line.text) for line in lines)
    count, stats = _assign_levels(lines)
    if count:
        lines = _merge_wrapped_headings(lines)
        _demote_repeated_headings(lines)
        count = sum(1 for line in lines if line.level)
    return _render(lines, page_count), meaningful, count, stats
