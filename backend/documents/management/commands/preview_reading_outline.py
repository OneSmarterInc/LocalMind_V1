"""Preview a new outline without altering lessons, attempts or the uploaded file."""
import json
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from documents.models import Document
from documents.services.parser import load_processed_sections, extract_sections_from_markdown
from documents.services.reading_outline import apply_pdf_bookmarks, reading_outline


class Command(BaseCommand):
    help = 'Write a coverage-checked reading outline for review. Never changes the book.'

    def add_arguments(self, parser):
        parser.add_argument('document_id')
        parser.add_argument('--output', required=True)

    def handle(self, *args, **options):
        try:
            doc = Document.objects.get(pk=options['document_id'])
        except (Document.DoesNotExist, ValueError) as exc:
            raise CommandError('Book not found.') from exc
        sections = load_processed_sections(doc)
        if doc.file_type == 'pdf' and doc.processed_markdown_path:
            path = Path(doc.processed_markdown_path)
            markdown = path.read_text(encoding='utf-8')
            markdown, _ = apply_pdf_bookmarks(markdown, doc.file.path)
            sections = extract_sections_from_markdown(markdown)
        outline = reading_outline(doc.original_name, sections)
        output = Path(options['output'])
        if output.exists():
            raise CommandError('Output already exists; choose another filename.')
        output.write_text(json.dumps(outline, ensure_ascii=False, indent=2), encoding='utf-8')
        self.stdout.write(self.style.SUCCESS(
            f"Preview: {len(outline['chapters'])} groups, "
            f"{sum(len(c['modules']) for c in outline['chapters'])} reading units. "
            f"All {outline['_quality']['covered_sections']} extracted sections accounted for. "
            f"Saved to {output}. The existing book has not changed."))
