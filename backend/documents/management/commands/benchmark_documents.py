"""Time the PDF/DOCX parser on real files, without touching the database.

    python manage.py benchmark_documents path/to/book.pdf [more files...]
    python manage.py benchmark_documents --engine docling book.pdf   # compare engines
    python manage.py benchmark_documents --json book.pdf

Reports pages, parse mode, per-stage timings (text-layer probe, font-metric
structure pass, Docling, OCR), section and heading counts, and the size of
the chunk set the document would produce. Docling is only initialised if the
chosen engine and the file require it, exactly as in processing.
"""
import json
import time
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.test.utils import override_settings
from django.conf import settings


class Command(BaseCommand):
    help = "Benchmark document parsing (text layer, font-metric structure, Docling, OCR) on given files."

    def add_arguments(self, parser):
        parser.add_argument("files", nargs="+")
        parser.add_argument("--engine", choices=["auto", "fast", "docling"], default=None, help="Override PDF_LAYOUT_ENGINE for this run.")
        parser.add_argument("--json", action="store_true")

    def handle(self, *args, **options):
        from documents.services import parser
        from documents.services.chunking import split_text
        from documents.services.parser import release_document_models

        engine = options["engine"] or settings.LOCALMIND.get("PDF_LAYOUT_ENGINE", "auto")
        results = []
        try:
            with override_settings(LOCALMIND=dict(settings.LOCALMIND, PDF_LAYOUT_ENGINE=engine)):
                for name in options["files"]:
                    path = Path(name)
                    if not path.exists():
                        raise CommandError(f"{path} does not exist.")
                    started = time.monotonic()
                    if path.suffix.lower() == ".pdf":
                        markdown, mode = parser._parse_pdf(path, path.name)
                        stats = dict(parser._LAST_PDF_STATS)
                    elif path.suffix.lower() == ".docx":
                        markdown, mode, stats = parser._convert_docx(path), "docx_style_hierarchy", {}
                    else:
                        raise CommandError(f"{path.suffix} is not a PDF or DOCX.")
                    parse_ms = int((time.monotonic() - started) * 1000)
                    started = time.monotonic()
                    sections = parser.extract_sections_from_markdown(markdown)
                    chunks = [c for s in sections for c in split_text(s["source_text"])]
                    structure_ms = int((time.monotonic() - started) * 1000)
                    row = {"file": path.name, "mode": mode, "engine": engine, "parse_ms": parse_ms, "sections_ms": structure_ms,
                           "total_ms": parse_ms + structure_ms, "sections": len(sections), "headings": parser._count_markdown_headings(markdown),
                           "chars": len(markdown), "chunks": len(chunks), **stats}
                    results.append(row)
                    if not options["json"]:
                        self.stdout.write(" ".join(f"{k}={v}" for k, v in row.items()))
        finally:
            release_document_models()
        if options["json"]:
            self.stdout.write(json.dumps(results, indent=2))
