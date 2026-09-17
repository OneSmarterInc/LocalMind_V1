"""Backfill imagery only. Never reparse text, change modules or regenerate lessons."""
from django.core.management.base import BaseCommand, CommandError
from documents.models import Document
from documents.services.visual_delivery import prepare_visuals


class Command(BaseCommand):
    help = 'Extract original source figures for existing books without modifying their outlines or lessons.'

    def add_arguments(self, parser):
        parser.add_argument('--all', action='store_true')
        parser.add_argument('--document', help='One document UUID')

    def handle(self, *args, **options):
        if not options['all'] and not options['document']:
            raise CommandError('Specify --all or --document UUID.')
        documents = Document.objects.exclude(processed_markdown_path='')
        if options['document']:
            documents = documents.filter(pk=options['document'])
        failures = 0
        for document in documents.iterator():
            try:
                rows = prepare_visuals(document)
                self.stdout.write(f'{document.pk}: {len(rows)} source images; outline unchanged.')
            except Exception as exc:
                failures += 1
                self.stderr.write(f'{document.pk}: {exc}')
        if failures:
            raise CommandError(f'{failures} book(s) need image extraction review. Their text and lessons are unchanged.')
