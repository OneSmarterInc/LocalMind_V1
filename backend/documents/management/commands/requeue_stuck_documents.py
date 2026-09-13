"""Re-run processing for documents abandoned by a recycled worker.

    python manage.py requeue_stuck_documents          # list and requeue
    python manage.py requeue_stuck_documents --dry-run

Suitable for a cron entry or a systemd timer every 15 minutes. Only documents
whose `processing_started_at` is older than LOCALMIND["PROCESSING_STALE_MINUTES"]
are touched; anything genuinely in progress is left alone.
"""
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from documents.models import Document, DocumentStatus
from documents.services.documents import claim_for_processing, run_processing


class Command(BaseCommand):
    help = "Requeue documents stuck in 'processing' beyond the stale window."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        minutes = settings.LOCALMIND.get("PROCESSING_STALE_MINUTES", 30)
        cutoff = timezone.now() - timedelta(minutes=minutes)
        stuck = [d for d in Document.objects.filter(status=DocumentStatus.PROCESSING)
                 if (d.processing_started_at or d.updated_at) < cutoff]
        if not stuck:
            self.stdout.write("No stuck documents.")
            return
        for doc in stuck:
            self.stdout.write(f"{doc.id}  {doc.original_name}  started {doc.processing_started_at}")
            if options["dry_run"]:
                continue
            if claim_for_processing(doc):
                run_processing(doc.id)
                doc.refresh_from_db()
                self.stdout.write(self.style.SUCCESS(f"  -> {doc.status}"))
            else:
                self.stdout.write("  skipped (claimed by another worker meanwhile)")
