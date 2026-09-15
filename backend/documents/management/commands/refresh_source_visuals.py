"""Backfill source figures without deleting modules, lessons or student work."""
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from documents.models import Document, EDITABLE_STATUSES
from documents.signals import sync_document_visuals


class Command(BaseCommand):
    help = "Extract/rematch source pictures for existing processed PDF/DOCX books."

    def add_arguments(self, parser):
        group = parser.add_mutually_exclusive_group(required=True)
        group.add_argument("--document", help="Document UUID")
        group.add_argument("--all", action="store_true", help="All processed, editable course books")

    def handle(self, *args, **options):
        books = Document.objects.filter(status__in=EDITABLE_STATUSES).exclude(processed_markdown_path="")
        if options["document"]:
            try:
                books = books.filter(pk=options["document"])
                if not books.exists():
                    raise CommandError("No processed editable document found.")
            except (ValueError, TypeError, ValidationError) as exc:
                raise CommandError("Provide a valid document UUID.") from exc
        errors = 0
        for document in books.iterator():
            result = sync_document_visuals(document.pk)
            if result is None or result.get("status") != "ready":
                errors += 1
                self.stderr.write(f"{document.pk}: extraction failed or document changed; retry.")
                continue
            self.stdout.write(f"{document.pk}: {result['assigned']} assigned, {len(result['unassigned'])} need review, {len(result['warnings'])} warnings")
        if errors:
            raise CommandError(f"{errors} book(s) could not be refreshed. Existing text and student work were not changed.")
