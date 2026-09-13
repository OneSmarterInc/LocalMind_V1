"""Chunking: split each module's source text into retrieval units, once.

The tutor used to put a module's whole source text (up to 14,000 characters)
into every prompt. Now, when a document finishes processing or a module is
edited, the module's text is split here into chunks of roughly
CHUNK_TARGET_CHARS characters on paragraph and sentence boundaries, with the
nearest heading and the page range carried along, and stored as
``DocumentChunk`` rows. Retrieval (``retrieval.py``) reads those rows; no
request ever chunks text.

Sizing: 600-1200 tokens is the target from the spec; at ~3.5 characters per
token that is 2,100-4,200 characters, so the default target is 3,000 with a
hard ceiling at 4,200 and a floor that merges tiny tail fragments.
"""
from __future__ import annotations

import logging
import re
from collections import Counter

from django.db import transaction

from learning.models import Module

from ..models import DocumentChunk

logger = logging.getLogger("localmind.chunking")

CHUNK_TARGET_CHARS = 3000
CHUNK_MAX_CHARS = 4200
CHUNK_MIN_CHARS = 600
# Paragraphs that overlap the previous chunk by this many characters give a
# question that straddles a boundary both halves. Kept small so the total
# stored text stays close to the source size.
CHUNK_OVERLAP_CHARS = 200

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
_PAGE_RE = re.compile(r"<!--\s*page break\s*-->")
_SENTENCE_END_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(])")
_TOKEN_RE = re.compile(r"[a-z0-9]+(?:['\-][a-z0-9]+)*")

# Words that carry no retrieval signal; kept short and language-neutral-ish
# so technical terms are never dropped.
STOPWORDS = frozenset("""
a an the and or but if then else of to in on at by for with from as is are was were be been being
it its this that these those there here which who whom whose what when where why how do does did
not no nor so than too very can could should would may might will shall have has had i you he she
we they them his her their our your my me us am into onto over under again further about above
below between through during before after up down out off own same other some such only just also
""".split())


def tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN_RE.findall((text or "").lower()) if t not in STOPWORDS and len(t) > 1]


def term_frequencies(text: str) -> dict[str, int]:
    return dict(Counter(tokenize(text)))


def _paragraphs(source_text: str):
    """Yield (paragraph, heading, page) triples in order. Headings inside the
    module text are remembered as context for the paragraphs that follow and
    are not emitted as chunks of their own."""
    heading, page = "", 1  # page is relative to the module's first page
    buffer: list[str] = []

    def flush():
        nonlocal buffer
        text = "\n".join(buffer).strip()
        buffer = []
        return text

    for raw in (source_text or "").splitlines():
        line = raw.rstrip()
        if _PAGE_RE.search(line):
            text = flush()
            if text:
                yield text, heading, page
            page += 1
            continue
        match = _HEADING_RE.match(line.strip())
        if match:
            text = flush()
            if text:
                yield text, heading, page
            heading = match.group(2).strip()[:300]
            continue
        if not line.strip():
            text = flush()
            if text:
                yield text, heading, page
            continue
        buffer.append(line)
    text = flush()
    if text:
        yield text, heading, page


def _split_long(text: str, limit: int) -> list[str]:
    """Split one over-long paragraph on sentence ends; a single sentence
    longer than the limit (a code listing, a table row) is cut on whitespace."""
    if len(text) <= limit:
        return [text]
    pieces, current = [], ""
    for sentence in _SENTENCE_END_RE.split(text):
        if len(sentence) > limit:
            if current:
                pieces.append(current)
                current = ""
            words = sentence.split()
            chunk = ""
            for word in words:
                if len(chunk) + len(word) + 1 > limit and chunk:
                    pieces.append(chunk)
                    chunk = word
                else:
                    chunk = f"{chunk} {word}".strip()
            if chunk:
                current = chunk
            continue
        if len(current) + len(sentence) + 1 > limit and current:
            pieces.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        pieces.append(current)
    return pieces


def split_text(source_text: str, *, target: int = CHUNK_TARGET_CHARS, maximum: int = CHUNK_MAX_CHARS,
               minimum: int = CHUNK_MIN_CHARS, overlap: int = CHUNK_OVERLAP_CHARS,
               first_page: int | None = None) -> list[dict]:
    """Pure function: text -> list of {text, heading, page_start, page_end}.

    Paragraphs are packed until the target is reached; a paragraph that would
    push a chunk past the maximum starts the next one, carrying a short
    overlap of the previous chunk's tail so boundary sentences appear in both.
    """
    units = []
    for paragraph, heading, page in _paragraphs(source_text):
        # Absolute page when the module knows where it starts; otherwise None
        # (DOCX and edited text carry no page information).
        page_number = first_page + (page - 1) if first_page else None
        for piece in _split_long(paragraph, maximum):
            units.append((piece, heading, page_number))
    if not units:
        return []

    chunks: list[dict] = []
    current: list[str] = []
    current_len = 0
    current_heading = units[0][1]
    page_start = page_end = units[0][2]

    def close():
        nonlocal current, current_len
        if current:
            text = "\n\n".join(current).strip()
            chunks.append({"text": text, "heading": current_heading, "page_start": page_start, "page_end": page_end})
        current, current_len = [], 0

    for piece, heading, page in units:
        if current and (current_len + len(piece) + 2 > maximum or current_len >= target):
            tail = current[-1][-overlap:] if overlap and current else ""
            close()
            current_heading = heading
            page_start = page_end = page
            if tail and len(tail) < len(piece):
                # Overlap: the last sentence(s) of the previous chunk.
                cut = tail.rfind(". ")
                tail = tail[cut + 2:] if cut != -1 else tail
                if tail.strip():
                    current.append(tail.strip())
                    current_len += len(tail)
        if not current:
            current_heading = heading
            page_start = page
        current.append(piece)
        current_len += len(piece) + 2
        if page is not None:
            page_end = page
    close()

    # A tiny tail fragment reads better attached to its predecessor.
    if len(chunks) >= 2 and len(chunks[-1]["text"]) < minimum:
        last = chunks.pop()
        chunks[-1]["text"] = f"{chunks[-1]['text']}\n\n{last['text']}"
        chunks[-1]["page_end"] = last["page_end"] or chunks[-1]["page_end"]
    return chunks


def rebuild_for_module(module: Module, content_version: int | None = None) -> int:
    """Replace the module's chunks for the given content version. Returns the
    number stored. The delete/insert is one short transaction; the splitting
    happens before it."""
    version = content_version or module.chapter.document.content_version
    prepared = split_text(module.source_text, first_page=module.start_page)
    rows = [
        DocumentChunk(document=module.chapter.document, module=module, content_version=version, order=index,
                      text=chunk["text"], char_count=len(chunk["text"]), page_start=chunk["page_start"],
                      page_end=chunk["page_end"], heading=chunk["heading"] or "", terms=term_frequencies(chunk["text"]))
        for index, chunk in enumerate(prepared)
    ]
    with transaction.atomic():
        DocumentChunk.objects.filter(module=module).delete()
        if rows:
            DocumentChunk.objects.bulk_create(rows)
    return len(rows)


def rebuild_for_document(document) -> int:
    """Chunk every module of a document at its current version. Called at the
    end of processing and after outline edits; per-module edits call
    ``rebuild_for_module`` for the one module that changed."""
    total = 0
    for module in Module.objects.filter(chapter__document=document).select_related("chapter__document"):
        if module.source_text.strip():
            total += rebuild_for_module(module, document.content_version)
        else:
            DocumentChunk.objects.filter(module=module).delete()
    logger.info("Chunked document %s: %d chunk(s) at version %s", document.id, total, document.content_version)
    return total


def ensure_chunks(module: Module) -> list[DocumentChunk]:
    """Chunks for the module at the document's current version. Documents
    processed before chunking existed have none; build them once, here, so
    the tutor never falls back to the whole source for a modern document."""
    version = module.chapter.document.content_version
    chunks = list(DocumentChunk.objects.filter(module=module, content_version=version).order_by("order"))
    if not chunks and module.source_text.strip():
        rebuild_for_module(module, version)
        chunks = list(DocumentChunk.objects.filter(module=module, content_version=version).order_by("order"))
    return chunks
