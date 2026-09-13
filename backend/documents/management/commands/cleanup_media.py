"""Report (and with --delete, remove) files under MEDIA_ROOT/documents that no
Document row references. Archived documents keep their files; only
directories whose UUID matches no row at all are considered orphans."""
import shutil
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from documents.models import Document


class Command(BaseCommand):
    help = "List or delete media directories not referenced by any Document."

    def add_arguments(self, parser):
        parser.add_argument("--delete", action="store_true")

    def handle(self, *args, **opts):
        root = Path(settings.MEDIA_ROOT) / "documents"
        if not root.exists():
            self.stdout.write("No documents media directory; nothing to do.")
            return
        known = {str(pk) for pk in Document.objects.values_list("id", flat=True)}
        orphans = [d for d in root.iterdir() if d.is_dir() and d.name not in known]
        if not orphans:
            self.stdout.write("No orphaned media.")
            return
        for d in orphans:
            size = sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
            self.stdout.write(f"{'deleting' if opts['delete'] else 'orphan'}: {d.name} ({size // 1024} KB)")
            if opts["delete"]:
                shutil.rmtree(d)
        self.stdout.write(self.style.SUCCESS(f"{len(orphans)} orphaned director{'y' if len(orphans) == 1 else 'ies'} {'deleted' if opts['delete'] else 'found (use --delete to remove)'}."))
