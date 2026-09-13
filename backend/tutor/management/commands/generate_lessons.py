"""Queue and generate lessons from the command line.

    python manage.py generate_lessons --status              # what is queued, ready, failed
    python manage.py generate_lessons --queue               # queue every module without a current lesson
    python manage.py generate_lessons --queue --document <id> --force
    python manage.py generate_lessons --run --limit 10      # generate in this process (needs the model)

The web process does all of this by itself; the command is for an upgrade
(queue lessons for books processed before background generation existed), for
running generation on a quiet night, and for checking on the queue.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count

from tutor import lessons
from tutor.models import ModuleLesson


class Command(BaseCommand):
    help = "Queue, run or report background lesson generation."

    def add_arguments(self, parser):
        parser.add_argument("--status", action="store_true", help="Print counts by status.")
        parser.add_argument("--queue", action="store_true", help="Queue modules that lack a current lesson.")
        parser.add_argument("--document", help="Limit --queue to one document id.")
        parser.add_argument("--force", action="store_true", help="With --queue: regenerate lessons that are already ready.")
        parser.add_argument("--run", action="store_true", help="Generate queued lessons in this process.")
        parser.add_argument("--limit", type=int, default=None, help="With --run: stop after this many.")

    def handle(self, *args, **opts):
        if not (opts["status"] or opts["queue"] or opts["run"]):
            opts["status"] = True
        if opts["queue"]:
            from documents.models import Document
            from learning.models import Module

            if opts["document"]:
                try:
                    document = Document.objects.get(pk=opts["document"])
                except (Document.DoesNotExist, ValueError):
                    raise CommandError("No such document.")
                queued = lessons.request_for_document(document, force=opts["force"], reason="command")
            else:
                modules = list(Module.objects.select_related("chapter__document"))
                queued = lessons.request_lessons(modules, force=opts["force"], reason="command")
            self.stdout.write(f"Queued {queued} lesson(s).")
        if opts["run"]:
            outcome = lessons.run_pending(limit=opts["limit"], wait_for_students=False)
            self.stdout.write(f"Generated: {outcome['ready']} ready, {outcome['failed']} failed, {outcome['discarded']} discarded.")
        if opts["status"]:
            counts = dict(ModuleLesson.objects.values_list("status").annotate(n=Count("id")))
            for status in ("pending", "generating", "ready", "failed"):
                self.stdout.write(f"{status:>10}: {counts.get(status, 0)}")
