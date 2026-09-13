import gc
import html
import logging
import os
import re
import threading
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile

# Keep Docling/PyTorch from depending on torch.compile on Windows where possible.
# These must be set before Docling is imported. Docling itself is imported lazily
# inside the PDF/legacy Word helpers so DOCX parsing can stay deterministic.
os.environ.setdefault("TORCHINDUCTOR_DISABLE", "1")
os.environ.setdefault("TORCH_COMPILE_DISABLE", "1")

logger = logging.getLogger(__name__)


class NoExtractableContent(ValueError):
    """Raised when a document yields no usable text after every extraction
    strategy (text layer, Docling layout parsing, OCR). Carries a message the
    faculty screen can show as-is."""

    code = "NO_EXTRACTABLE_CONTENT"


HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
INLINE_HEADING_RE = re.compile(
    r"^(?P<prefix>.+?\S)\s+(?P<marks>#{1,6})\s+(?P<title>[^#\s].{1,240})$"
)
PAGE_BREAK_MARKER = "<!-- page break -->"
IMAGE_MARKER_RE = re.compile(r"<!--\s*image\s*-->", re.IGNORECASE)
MIN_MEANINGFUL_TEXT_CHARS = 200
# A PDF with fewer heading-like lines than this gets heading inference; a
# section built from page groups aims at roughly this many characters.
MIN_STRUCTURED_HEADINGS = 2
PAGE_GROUP_TARGET_CHARS = 6000

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = f"{{{W_NS}}}"


def _has_meaningful_text(markdown: str) -> bool:
    meaningful_chars = sum(char.isalnum() for char in markdown)
    return meaningful_chars >= MIN_MEANINGFUL_TEXT_CHARS


def _clean_source_text(value: str) -> str:
    """
    Normalize extracted text without summarizing or rewriting it.

    The function removes Docling image placeholders, decodes HTML entities,
    trims trailing whitespace, and limits repeated blank lines. Newlines are
    intentionally preserved because they carry paragraph/list formatting.
    """
    text = html.unescape(str(value or ""))
    text = IMAGE_MARKER_RE.sub("", text)
    text = "\n".join(line.rstrip() for line in text.splitlines())
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _split_inline_markdown_headings(markdown: str) -> str:
    """
    Repair a common authoring mistake where a Markdown heading marker is typed
    at the end of a normal paragraph, for example:

        ... credit freezes. ## Introduction to Personal Cybersecurity

    That source really contains a paragraph followed by an H2 heading. Splitting
    it here prevents the heading from being swallowed into the previous section.
    """
    normalized_lines = []

    for raw_line in str(markdown or "").splitlines():
        stripped = raw_line.strip()

        # Already a proper heading; leave it untouched.
        if HEADING_RE.match(stripped):
            normalized_lines.append(raw_line)
            continue

        match = INLINE_HEADING_RE.match(stripped)
        if not match:
            normalized_lines.append(raw_line)
            continue

        prefix = match.group("prefix").rstrip()
        marks = match.group("marks")
        title = match.group("title").strip()

        # Require a meaningful prefix and title. This avoids splitting tiny
        # fragments that merely mention '#' characters. The prefix must also
        # end like a sentence and the title must start like one: a Python
        # comment ("total = x + y  # add them") or a prose "item # 3" must not
        # be turned into a heading, or a code listing in a textbook would be
        # shredded into dozens of bogus sections.
        if len(prefix) < 3 or len(title) < 2:
            normalized_lines.append(raw_line)
            continue
        if prefix[-1] not in ".!?:;\"')" or not (title[0].isupper() or title[0].isdigit()):
            normalized_lines.append(raw_line)
            continue

        normalized_lines.append(prefix)
        normalized_lines.append(f"{marks} {title}")

    return "\n".join(normalized_lines)


def extract_sections_from_markdown(markdown: str):
    """
    Convert normalized Markdown into source-backed heading sections.

    Each returned section contains:
      index, level, title, source_text, start_page, end_page

    A section ends at the next sibling or ancestor heading. Therefore an H1
    chapter keeps all H2/H3 content underneath it, while an H2 module keeps all
    H3 subheadings/content underneath it. Nothing is summarized or invented.
    """
    markdown = _split_inline_markdown_headings(markdown)
    raw_lines = markdown.splitlines()
    has_page_markers = any(
        line.strip() == PAGE_BREAK_MARKER for line in raw_lines
    )

    lines = []
    line_pages = []
    current_page = 1

    for raw_line in raw_lines:
        if raw_line.strip() == PAGE_BREAK_MARKER:
            current_page += 1
            continue

        lines.append(raw_line)
        line_pages.append(current_page if has_page_markers else None)

    heading_rows = []

    for line_number, line in enumerate(lines):
        match = HEADING_RE.match(line.strip())
        if not match:
            continue

        title = html.unescape(match.group(2).strip())
        if not title:
            continue

        heading_rows.append(
            {
                "index": len(heading_rows),
                "line_number": line_number,
                "level": len(match.group(1)),
                "title": title,
                "start_page": line_pages[line_number],
            }
        )

    sections = []
    if heading_rows:
        before = lines[:heading_rows[0]["line_number"]]
        preamble = _clean_source_text("\n".join(before))
        if preamble:
            nonblank = [i for i, line in enumerate(before) if line.strip()]
            sections.append({
                "index": -1, "level": min(h["level"] for h in heading_rows),
                "title": "Introduction", "source_text": preamble, "own_text": preamble,
                "start_page": line_pages[nonblank[0]] if nonblank else None,
                "end_page": line_pages[nonblank[-1]] if nonblank else None,
            })

    for position, heading in enumerate(heading_rows):
        boundary_line = len(lines)

        for candidate in heading_rows[position + 1 :]:
            if candidate["level"] <= heading["level"]:
                boundary_line = candidate["line_number"]
                break

        content_lines = lines[heading["line_number"] + 1 : boundary_line]
        source_text = _clean_source_text("\n".join(content_lines))

        # Text that belongs to this heading alone, before its first
        # sub-heading. A chapter's introduction lives here; the outline uses
        # it so that text is not lost when the chapter is split into modules.
        own_boundary = boundary_line
        for candidate in heading_rows[position + 1 :]:
            if candidate["line_number"] >= boundary_line:
                break
            own_boundary = candidate["line_number"]
            break
        own_text = _clean_source_text("\n".join(lines[heading["line_number"] + 1 : own_boundary]))

        end_page = heading["start_page"]
        if has_page_markers:
            # Walk back over the section's non-blank lines; the blank lines
            # that follow a page break must not push end_page onto the next page.
            for line_index in range(boundary_line - 1, heading["line_number"], -1):
                if lines[line_index].strip() and line_pages[line_index] is not None:
                    end_page = line_pages[line_index]
                    break

        sections.append(
            {
                "index": heading["index"],
                "level": heading["level"],
                "title": heading["title"],
                "source_text": source_text,
                "own_text": own_text,
                "start_page": heading["start_page"],
                "end_page": end_page,
            }
        )

    if not sections and has_page_markers:
        # Docling PDF output with no headings at all (scanned book, OCR text,
        # slides). Page groups give faculty something reviewable and editable
        # instead of one monolithic block. DOCX output has no page markers, so
        # its single-section behaviour below is untouched.
        sections = _page_group_sections(lines, line_pages, current_page)

    if not sections:
        cleaned_document_text = _clean_source_text(
            "\n".join(
                line
                for line in raw_lines
                if line.strip() != PAGE_BREAK_MARKER
            )
        )
        if cleaned_document_text:
            sections.append(
                {
                    "index": 0,
                    "level": 1,
                    "title": "Document Content",
                    "source_text": cleaned_document_text,
                    "start_page": 1 if has_page_markers else None,
                    "end_page": current_page if has_page_markers else None,
                }
            )

    return sections


def _page_group_sections(lines, line_pages, last_page):
    """Split heading-less PDF text into consecutive page groups of roughly
    PAGE_GROUP_TARGET_CHARS characters. Deterministic for a given markdown, so
    re-loading the processed file reproduces the same indices."""
    pages = {}
    for line, page in zip(lines, line_pages):
        pages.setdefault(page or 1, []).append(line)
    ordered = sorted(pages)
    groups = []
    current, current_chars = [], 0
    for page in ordered:
        text = _clean_source_text("\n".join(pages[page]))
        if not text:
            continue
        current.append((page, text))
        current_chars += len(text)
        if current_chars >= PAGE_GROUP_TARGET_CHARS:
            groups.append(current)
            current, current_chars = [], 0
    if current:
        # A small trailing remainder joins the previous group rather than
        # becoming a stub section of its own.
        if groups and current_chars < PAGE_GROUP_TARGET_CHARS // 3:
            groups[-1].extend(current)
        else:
            groups.append(current)

    sections = []
    for index, group in enumerate(groups):
        start, end = group[0][0], group[-1][0]
        title = f"Page {start}" if start == end else f"Pages {start}-{end}"
        sections.append(
            {
                "index": index,
                "level": 1,
                "title": title,
                "source_text": "\n\n".join(text for _, text in group),
                "start_page": start,
                "end_page": end,
            }
        )
    return sections


def _extract_headings(sections):
    return [
        {
            "index": section["index"],
            "level": section["level"],
            "title": section["title"],
            "start_page": section["start_page"],
            "end_page": section["end_page"],
        }
        for section in sections
    ]


def _read_docx_style_map(zip_file: ZipFile):
    """Return Word style metadata keyed by style id."""
    try:
        root = ET.fromstring(zip_file.read("word/styles.xml"))
    except KeyError:
        return {}

    styles = {}
    for style in root.findall(f".//{W}style"):
        style_id = style.get(f"{W}styleId")
        if not style_id:
            continue

        name_node = style.find(f"{W}name")
        based_on_node = style.find(f"{W}basedOn")
        outline_node = style.find(f"./{W}pPr/{W}outlineLvl")

        styles[style_id] = {
            "name": (
                name_node.get(f"{W}val", "") if name_node is not None else ""
            ),
            "based_on": (
                based_on_node.get(f"{W}val")
                if based_on_node is not None
                else None
            ),
            "outline_level": (
                int(outline_node.get(f"{W}val"))
                if outline_node is not None
                and str(outline_node.get(f"{W}val", "")).isdigit()
                else None
            ),
        }

    return styles


def _resolve_style_outline_level(style_id, styles, seen=None):
    if not style_id or style_id not in styles:
        return None

    seen = set(seen or ())
    if style_id in seen:
        return None
    seen.add(style_id)

    style = styles[style_id]
    if style.get("outline_level") is not None:
        return style["outline_level"] + 1

    # Built-in Word heading style ids/names are highly reliable.
    for candidate in (style_id, style.get("name") or ""):
        match = re.search(r"heading\s*([1-6])$", candidate, re.IGNORECASE)
        if match:
            return int(match.group(1))

    return _resolve_style_outline_level(
        style.get("based_on"), styles, seen=seen
    )


def _docx_paragraph_heading_level(paragraph, styles):
    p_pr = paragraph.find(f"{W}pPr")
    if p_pr is None:
        return None

    direct_outline = p_pr.find(f"{W}outlineLvl")
    if direct_outline is not None:
        value = direct_outline.get(f"{W}val")
        if value is not None and str(value).isdigit():
            level = int(value) + 1
            if 1 <= level <= 6:
                return level

    style_node = p_pr.find(f"{W}pStyle")
    style_id = (
        style_node.get(f"{W}val") if style_node is not None else None
    )
    level = _resolve_style_outline_level(style_id, styles)
    if level is not None and 1 <= level <= 6:
        return level

    return None


def _docx_paragraph_text(paragraph):
    parts = []

    for node in paragraph.iter():
        if node.tag == f"{W}t":
            parts.append(node.text or "")
        elif node.tag == f"{W}tab":
            parts.append("\t")
        elif node.tag in {f"{W}br", f"{W}cr"}:
            parts.append("\n")

    return "".join(parts).strip()


def _docx_is_numbered_paragraph(paragraph):
    p_pr = paragraph.find(f"{W}pPr")
    return p_pr is not None and p_pr.find(f"{W}numPr") is not None


def _docx_table_to_markdown(table, numbering=None):
    rows = []

    for row in table.findall(f"./{W}tr"):
        cells = []
        for cell in row.findall(f"./{W}tc"):
            paragraphs = [
                ((numbering.prefix(p) or "") if numbering is not None else "") + _docx_paragraph_text(p)
                for p in cell.findall(f".//{W}p")
            ]
            value = " <br> ".join(p for p in paragraphs if p)
            value = value.replace("|", "\\|")
            cells.append(value)
        if any(cells):
            rows.append(cells)

    if not rows:
        return []

    width = max(len(row) for row in rows)
    rows = [row + [""] * (width - len(row)) for row in rows]

    result = ["| " + " | ".join(rows[0]) + " |"]
    result.append("| " + " | ".join(["---"] * width) + " |")
    for row in rows[1:]:
        result.append("| " + " | ".join(row) + " |")
    return result


def _docx_body_blocks(body):
    """Yield the paragraphs and tables of a document body in order, looking
    inside content controls (``w:sdt``). Word wraps cover pages, bibliographies
    and any block a template author marks up in an sdt; ignoring those lost
    their text. A generated table of contents is also an sdt, and its entries
    are page-number noise rather than content, so that one is skipped.
    """
    for child in list(body):
        if child.tag == f"{W}sdt":
            gallery = child.find(f"./{W}sdtPr/{W}docPartObj/{W}docPartGallery")
            if gallery is not None and "table of contents" in (gallery.get(f"{W}val") or "").lower():
                continue
            content = child.find(f"{W}sdtContent")
            if content is not None:
                yield from _docx_body_blocks(content)
            continue
        if child.tag in (f"{W}p", f"{W}tbl"):
            yield child


def _convert_docx(source: Path):
    """
    Convert DOCX to Markdown using Word's real paragraph styles.

    This avoids guessing heading levels from visual font size. Heading 1/2/3
    styles (and custom styles with Word outline levels) are converted directly
    to #/##/###, which makes Chapter -> Module extraction deterministic.
    """
    try:
        with ZipFile(source) as zip_file:
            from .word_numbering import WordNumbering
            styles = _read_docx_style_map(zip_file)
            numbering = WordNumbering(zip_file)
            document_root = ET.fromstring(zip_file.read("word/document.xml"))
    except (BadZipFile, KeyError, ET.ParseError) as exc:
        raise ValueError(f"Invalid or unreadable DOCX file: {exc}") from exc

    body = document_root.find(f".{W}body")
    if body is None:
        raise ValueError("DOCX file does not contain a readable document body.")

    lines = []

    for child in _docx_body_blocks(body):
        if child.tag == f"{W}p":
            text = _docx_paragraph_text(child)
            if not text:
                continue

            prefix = numbering.prefix(child)
            heading_level = _docx_paragraph_heading_level(child, styles)
            if heading_level is not None:
                label = f"{(prefix or '').strip()} {text}".strip()
                lines.append(f"{'#' * heading_level} {label}")
                lines.append("")
                continue

            lines.append((prefix or "") + text)
            lines.append("")

        elif child.tag == f"{W}tbl":
            lines.extend(_docx_table_to_markdown(child, numbering))
            lines.append("")

    return _split_inline_markdown_headings("\n".join(lines)).strip()


# ---- Docling / OCR lifecycle -------------------------------------------------
#
# Docling's layout model (PyTorch) and the RapidOCR models are large. They are
# created once per configuration and cached for the duration of a processing
# job, so the no-OCR and OCR passes of one document, or several documents in a
# row, do not reload them; ``release_document_models()`` then drops them so
# the embedded LLM has the RAM back before the outline call. The cache lives
# in this module (one per process), guarded by a lock.

_converter_lock = threading.Lock()
_converters = {}


def _pdf_pipeline_options(use_ocr: bool, full_page_ocr: bool):
    from docling.datamodel.pipeline_options import PdfPipelineOptions

    options = PdfPipelineOptions()
    options.do_ocr = use_ocr
    options.do_table_structure = True
    if use_ocr and full_page_ocr:
        # Scanned pages carry no text layer (or a garbage one); OCR every
        # page in full instead of only the bitmap regions Docling detects.
        _enable_full_page_ocr(options.ocr_options)
    # Offline: Docling normally fetches its layout models from Hugging Face on
    # first use. `manage.py fetch_model --docling` stores them locally and we
    # point the pipeline at that folder so no network is ever needed.
    artifacts = docling_artifacts_dir()
    if artifacts is not None:
        options.artifacts_path = str(artifacts)
    return options


def _enable_full_page_ocr(ocr_options):
    """Docling >= 2.9x expresses this as ``mode=OcrMode.FULL_PAGE`` and only
    honours the older ``force_full_page_ocr`` flag at construction time;
    earlier releases know just the flag. Set whichever the installed version
    understands."""
    try:
        from docling.datamodel.pipeline_options import OcrMode

        if hasattr(ocr_options, "mode"):
            ocr_options.mode = OcrMode.FULL_PAGE
            return
    except ImportError:
        pass
    if hasattr(ocr_options, "force_full_page_ocr"):
        ocr_options.force_full_page_ocr = True


def _get_converter(use_ocr: bool, full_page_ocr: bool = False):
    """One DocumentConverter per (ocr, full-page) configuration per process."""
    from docling.datamodel.base_models import InputFormat
    from docling.document_converter import DocumentConverter, PdfFormatOption

    key = (bool(use_ocr), bool(use_ocr and full_page_ocr), str(docling_artifacts_dir() or ""))
    with _converter_lock:
        converter = _converters.get(key)
        if converter is None:
            logger.info("LocalMind: initialising Docling converter (ocr=%s, full_page_ocr=%s)", key[0], key[1])
            converter = DocumentConverter(
                format_options={
                    InputFormat.PDF: PdfFormatOption(pipeline_options=_pdf_pipeline_options(use_ocr, full_page_ocr)),
                }
            )
            _converters[key] = converter
        else:
            logger.info("LocalMind: reusing Docling converter (ocr=%s, full_page_ocr=%s)", key[0], key[1])
        return converter


def release_document_models():
    """Drop cached Docling/OCR converters and their PyTorch models. Called
    when a processing job finishes (before the LLM is asked for an outline)
    so the two families of models are not resident at the same time."""
    with _converter_lock:
        count = len(_converters)
        _converters.clear()
    if count:
        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():  # pragma: no cover - CPU hosts
                torch.cuda.empty_cache()
        except Exception:
            pass
        logger.info("LocalMind: released %s Docling converter(s) and their models", count)


def _convert_pdf(source: Path, use_ocr: bool, full_page_ocr: bool = False):
    converter = _get_converter(use_ocr, full_page_ocr)
    result = converter.convert(source)
    return result.document.export_to_markdown(
        page_break_placeholder=PAGE_BREAK_MARKER,
    )


def _pdf_text_layer(source: Path, max_pages: int = 400):
    """Read the PDF's own text layer with pypdfium2 (a Docling dependency).

    Returns (markdown_with_page_breaks, meaningful_chars). Cheap, needs no
    model, and is used twice: to decide up front whether OCR is required, and
    as a last resort when Docling's layout pass drops text it did find.
    """
    try:
        import pypdfium2 as pdfium
    except Exception as exc:  # pragma: no cover - pypdfium2 ships with docling
        logger.warning("LocalMind: pypdfium2 unavailable (%s); skipping text-layer probe", exc)
        return "", 0
    pages_text = []
    meaningful = 0
    try:
        pdf = pdfium.PdfDocument(str(source))
        try:
            for page_index in range(min(len(pdf), max_pages)):
                page = pdf[page_index]
                try:
                    text = page.get_textpage().get_text_range() or ""
                finally:
                    page.close()
                text = _clean_source_text(text)
                meaningful += sum(char.isalnum() for char in text)
                pages_text.append(text)
        finally:
            pdf.close()
    except Exception as exc:
        logger.warning("LocalMind: pypdfium2 could not read %s (%s)", source.name, exc)
        return "", 0
    markdown = f"\n\n{PAGE_BREAK_MARKER}\n\n".join(pages_text)
    return markdown, meaningful


def docling_artifacts_dir():
    """Local Docling model folder (backend/models/docling by default) when it
    has been populated; None means Docling uses its own cache/downloads."""
    from django.conf import settings

    folder = Path(settings.AI.get("DOCLING_ARTIFACTS") or Path(settings.BASE_DIR) / "models" / "docling")
    if folder.is_dir() and any(folder.iterdir()):
        # Belt and braces: even if a sub-model is missing, never phone home.
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        return folder
    return None


def legacy_doc_support() -> tuple[bool, str]:
    """Whether this machine can read a legacy binary Word (.doc) file.

    Docling reads .doc only in recent 2.x releases, and only by handing the
    file to LibreOffice to convert it to .docx first. The offline bundle ships
    neither guarantee, so a .doc used to be accepted at upload and then fail in
    processing. Checked at upload time instead. Returns (supported, reason).
    """
    import shutil

    try:
        from docling.datamodel.base_models import InputFormat
    except Exception as exc:  # docling missing or broken
        return False, f"the document parser (Docling) is not installed ({exc.__class__.__name__})"
    if not hasattr(InputFormat, "DOC"):
        return False, "the installed Docling release cannot read .doc files"
    if not (shutil.which("soffice") or shutil.which("libreoffice")):
        return False, "LibreOffice, which Docling uses to convert .doc files, is not installed on the server"
    return True, ""


def _convert_legacy_or_other(source: Path):
    from docling.document_converter import DocumentConverter

    artifacts = docling_artifacts_dir()
    converter = DocumentConverter() if artifacts is None else _converter_with_artifacts(artifacts)
    result = converter.convert(source)
    return result.document.export_to_markdown()


def _converter_with_artifacts(artifacts: Path):
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    options = PdfPipelineOptions(artifacts_path=str(artifacts))
    return DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})


# ---- PDF structure inference ---------------------------------------------------

_NUMBERED_HEADING_RE = re.compile(r"^(?P<num>\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+(?P<title>[A-Za-z][^\n]{2,90})$")
_KEYWORD_HEADING_RE = re.compile(
    r"^(?:chapter|unit|part|section|lesson|module|lecture|topic|appendix)\s+(?:\d{1,3}|[ivxlc]{1,6})\b[\s:.\-]*(?P<title>.{0,90})$",
    re.IGNORECASE,
)
_ROMAN_HEADING_RE = re.compile(r"^(?P<num>[IVXLC]{1,6})[.)]\s+(?P<title>[A-Za-z][^\n]{2,80})$")
_TERMINAL_PUNCT = ".,;:!?"


def _heading_like(line, previous_blank, next_line):
    """Return (level, title) if a plain text line reads like a heading, else None."""
    text = line.strip()
    if not text or len(text) > 100 or text.startswith(("-", "*", "|", ">", "<", "#", "!", "[")):
        return None
    if text[-1] in _TERMINAL_PUNCT and not _NUMBERED_HEADING_RE.match(text):
        return None
    words = text.split()
    if not any(char.isalpha() for char in text):
        return None

    match = _KEYWORD_HEADING_RE.match(text)
    if match and len(words) <= 14:
        return 1, text
    match = _NUMBERED_HEADING_RE.match(text)
    if match and len(words) <= 14:
        depth = match.group("num").count(".") + 1
        return min(depth, 3), text
    match = _ROMAN_HEADING_RE.match(text)
    if match and len(words) <= 12:
        return 1, text

    letters = [char for char in text if char.isalpha()]
    if len(letters) >= 4 and len(words) <= 10 and all(char.isupper() for char in letters):
        return 2, text

    # Title Case: most words capitalised, short, set off by a blank line above
    # and followed by a real paragraph. OCR noise rarely satisfies all three.
    if previous_blank and 2 <= len(words) <= 10 and next_line and len(next_line.strip()) > 80:
        capitalised = sum(1 for w in words if w[0].isupper())
        if capitalised / len(words) >= 0.7 and not text.endswith(","):
            return 2, text
    return None


def _count_markdown_headings(markdown):
    return sum(1 for line in markdown.splitlines() if HEADING_RE.match(line.strip()))


def infer_pdf_headings(markdown):
    """Promote heading-like plain lines in PDF markdown to Markdown headings.

    Docling marks headings only where its layout model recognises them; OCR
    text and simply laid-out PDFs often arrive with none. This adds `#` lines
    for numbered, keyword ("Chapter 3"), all-caps and Title-Case lines, keeps
    every existing heading, and never changes body text. It is deterministic,
    so the processed markdown on disk reproduces the same sections later.
    """
    lines = markdown.splitlines()
    candidates = []
    in_table = False
    for position, raw in enumerate(lines):
        stripped = raw.strip()
        if stripped.startswith("|"):
            in_table = True
            continue
        if in_table and not stripped:
            in_table = False
        if in_table or not stripped or HEADING_RE.match(stripped) or stripped == PAGE_BREAK_MARKER:
            continue
        previous_blank = position == 0 or not lines[position - 1].strip() or lines[position - 1].strip() == PAGE_BREAK_MARKER
        next_line = ""
        for follow in lines[position + 1 : position + 4]:
            if follow.strip() and follow.strip() != PAGE_BREAK_MARKER:
                next_line = follow
                break
        found = _heading_like(stripped, previous_blank, next_line)
        if found:
            candidates.append((position, found[0], found[1]))

    body_chars = sum(len(line.strip()) for line in lines if line.strip() and line.strip() != PAGE_BREAK_MARKER)
    heading_chars = sum(len(title) for _, _, title in candidates)
    if len(candidates) < MIN_STRUCTURED_HEADINGS or heading_chars > 0.2 * body_chars:
        # Too few to help, or headings would make up a fifth of the text: that
        # is a list or a slide deck where every line looks like a title.
        return markdown, 0

    for position, level, title in candidates:
        lines[position] = f"{'#' * level} {title}"
    return "\n".join(lines), len(candidates)


def _has_text(markdown):
    """True when anything but image/page markers and whitespace remains."""
    without_breaks = "\n".join(line for line in str(markdown or "").splitlines() if line.strip() != PAGE_BREAK_MARKER)
    return bool(_clean_source_text(without_breaks))


def load_processed_sections(document):
    if not document.processed_markdown_path:
        return []

    markdown_path = Path(document.processed_markdown_path)
    if not markdown_path.exists():
        return []

    markdown = markdown_path.read_text(encoding="utf-8")
    return extract_sections_from_markdown(markdown)


def _parse_pdf(source: Path, original_name: str):
    """PDF strategy, cheapest first:

    1. Read the text layer with pypdfium2 to decide whether OCR is needed.
    2. Text layer present: one Docling pass without OCR (layout + headings).
       If Docling drops the text the text layer already gave us, use that.
    3. No text layer (scanned) or nothing usable: one Docling pass with
       full-page OCR.
    4. Whatever came out, infer headings when Docling found fewer than two.
    Each Docling pass reuses the cached converter; the models are released
    by the caller when the job is done.
    """
    layer_markdown, layer_chars = _pdf_text_layer(source)
    has_text_layer = layer_chars >= MIN_MEANINGFUL_TEXT_CHARS
    logger.info(
        "LocalMind: PDF text layer for %s: %s meaningful characters (%s)",
        original_name, layer_chars, "will parse without OCR" if has_text_layer else "will OCR",
    )

    markdown, parse_mode = "", ""
    docling_error = None
    if has_text_layer:
        try:
            markdown = _convert_pdf(source, use_ocr=False)
        except Exception as exc:  # Docling missing, model files absent, torch failure
            docling_error = exc
            logger.warning("LocalMind: Docling layout pass unavailable for %s (%s)", original_name, exc)
            markdown = ""
        if _has_meaningful_text(markdown):
            parse_mode = "fast_no_ocr"
        elif _has_meaningful_text(layer_markdown):
            logger.warning(
                "LocalMind: Docling layout pass returned no usable text for %s; using the PDF text layer directly",
                original_name,
            )
            markdown, parse_mode = layer_markdown, "text_layer"

    if not parse_mode:
        logger.info("LocalMind: running OCR (full page) for %s", original_name)
        try:
            markdown = _convert_pdf(source, use_ocr=True, full_page_ocr=True)
            parse_mode = "ocr_fallback"
        except Exception as exc:
            # An offline install without Docling (or without its model files)
            # can still serve any PDF that carries a text layer; only scans
            # genuinely need OCR. Surface a precise message for those.
            docling_error = docling_error or exc
            logger.warning("LocalMind: OCR pass unavailable for %s (%s)", original_name, exc)
            if _has_meaningful_text(layer_markdown):
                markdown, parse_mode = layer_markdown, "text_layer"
            else:
                raise NoExtractableContent(
                    f"{original_name} needs OCR (it has no usable text layer) but the OCR engine is not available "
                    f"on this machine: {docling_error}. Install Docling with its models (python manage.py fetch_model "
                    "--docling) or upload a PDF that contains selectable text."
                ) from exc
        if not _has_meaningful_text(markdown) and _has_meaningful_text(layer_markdown):
            # OCR found less than the (weak) text layer did; keep the better one.
            markdown, parse_mode = layer_markdown, "text_layer"

    if not _has_text(markdown):
        raise NoExtractableContent(
            f"No readable text could be extracted from {original_name}: the PDF has no text layer and OCR "
            "produced nothing. Check that the pages are not blank, rotated, or scanned at a very low resolution."
        )

    if _count_markdown_headings(markdown) < MIN_STRUCTURED_HEADINGS:
        markdown, inferred = infer_pdf_headings(markdown)
        if inferred:
            logger.info("LocalMind: inferred %s headings for %s (%s)", inferred, original_name, parse_mode)
            parse_mode = f"{parse_mode}+inferred"  # stays within the 30-char column
        else:
            logger.info("LocalMind: no heading structure in %s; sections will follow page groups", original_name)

    return markdown, parse_mode


def parse_document(document):
    from django.conf import settings

    source = Path(document.file.path)
    extension = source.suffix.lower()

    if extension == ".pdf":
        markdown, parse_mode = _parse_pdf(source, document.original_name)

    elif extension == ".docx":
        logger.info(
            "LocalMind: reading DOCX heading styles directly for %s",
            document.original_name,
        )
        markdown = _convert_docx(source)
        parse_mode = "docx_style_hierarchy"

    else:
        # Legacy .doc remains on Docling because it is not an OOXML ZIP file.
        markdown = _convert_legacy_or_other(source)
        parse_mode = "standard"

    markdown = _split_inline_markdown_headings(markdown)

    if not _has_text(markdown):
        raise NoExtractableContent(
            "No readable text could be extracted from this document, even after OCR. "
            "It may be empty, image-only at too low a resolution, or encrypted."
        )

    processed_dir = Path(settings.MEDIA_ROOT) / "processed" / str(document.id)
    if getattr(document, "_processing_artifact_id", None):
        processed_dir = processed_dir / str(document._processing_artifact_id)
    processed_dir.mkdir(parents=True, exist_ok=True)

    markdown_path = processed_dir / "document.md"
    markdown_path.write_text(markdown, encoding="utf-8")

    sections = extract_sections_from_markdown(markdown)
    headings = _extract_headings(sections)

    logger.info(
        "LocalMind: processing complete. mode=%s headings=%s sections=%s",
        parse_mode,
        len(headings),
        len(sections),
    )

    if not sections:
        raise NoExtractableContent(
            "The document was read but contained no text that could form a section."
        )

    return {
        "markdown": markdown,
        "markdown_path": str(markdown_path),
        "headings": headings,
        "sections": sections,
        "parse_mode": parse_mode,
    }
