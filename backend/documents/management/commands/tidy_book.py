"""Fold textbook boxes and tiny modules into their sections in an existing book.

    python manage.py tidy_book --list                          # books and their module counts
    python manage.py tidy_book --document <id> --dry-run       # what would change
    python manage.py tidy_book --document <id>                 # do it

New uploads are tidied automatically (OUTLINE_MERGE_SMALL). This is for books
processed before that. Modules that student work refers to are left alone and
listed. Lessons and automatic quizzes are regenerated for the modules that
receive text.
"""
from django.core.management.base import BaseCommand, CommandError

from documents.models import Document
from documents.services.outline import tidy_existing_document


class Command(BaseCommand):
    help = "Fold textbook boxes and tiny modules into their sections in an existing book."

    def add_arguments(self, parser):
        parser.add_argument("--document", help="Document id.")
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--list", action="store_true", help="List books.")
        parser.add_argument("--keep-titles", action="store_true", help="Do not repair garbled titles.")

    def handle(self, *args, **opts):
        if opts["list"] or not opts["document"]:
            for doc in Document.objects.order_by("created_at"):
                count = sum(c.modules.count() for c in doc.chapters.all())
                self.stdout.write(f"{doc.id}  {doc.status:<12} {count:>3} modules  {doc.title}")
            if not opts["document"]:
                return
        try:
            document = Document.objects.get(pk=opts["document"])
        except (Document.DoesNotExist, ValueError):
            raise CommandError("No such document.")
        report = tidy_existing_document(document, dry_run=opts["dry_run"], titles=not opts["keep_titles"])
        verb = "would" if opts["dry_run"] else "did"
        for row in report.get("adopted", []):
            self.stdout.write(f"new section home: {row['module']!r} becomes {row['heading']!r} (its heading had no text of its own)")
        for row in report["renamed"]:
            self.stdout.write(f"rename {row.get('kind', 'title')}: {row['from']!r} -> {row['to']!r}")
        for row in report["merged"]:
            where = "into the start of" if row["position"] == "prepend" else "into the end of"
            self.stdout.write(f"merge: {row['title']!r} {where} {row['into']!r}")
        for title in report["kept_in_use"]:
            self.stdout.write(f"kept (student work refers to it): {title!r}")
        for title in report.get("chapters_removed", []):
            self.stdout.write(f"removed empty chapter: {title!r}")
        self.stdout.write(self.style.SUCCESS(
            f"{'Dry run: ' if opts['dry_run'] else ''}{verb} merge {len(report['merged'])} module(s), "
            f"rename {len(report['renamed'])} title(s); kept {len(report['kept_in_use'])} in use."))
