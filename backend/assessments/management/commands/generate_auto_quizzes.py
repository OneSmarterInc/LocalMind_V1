"""Queue, run or report automatic module quizzes.

    python manage.py generate_auto_quizzes --status
    python manage.py generate_auto_quizzes --queue                # every module without one (books uploaded before this feature)
    python manage.py generate_auto_quizzes --queue --document <id>
    python manage.py generate_auto_quizzes --run --limit 5         # generate in this process (needs the model)
    python manage.py generate_auto_quizzes --remove-short --dry-run # automatic quizzes on modules below AUTO_QUIZ_MIN_CHARS
    python manage.py generate_auto_quizzes --remove-short           # delete those nobody has attempted

The web process generates them by itself, in turn with lessons; this is for books
uploaded before automatic quizzes existed and for checking on the queue.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count

from assessments.models import AutoQuizJob
from assessments.services import auto_quiz


class Command(BaseCommand):
    help = "Queue, run or report automatic module quizzes."

    def add_arguments(self, parser):
        parser.add_argument("--status", action="store_true")
        parser.add_argument("--queue", action="store_true")
        parser.add_argument("--document")
        parser.add_argument("--run", action="store_true")
        parser.add_argument("--limit", type=int, default=None)
        parser.add_argument("--remove-short", action="store_true",
                            help="Delete unattempted automatic quizzes on modules shorter than AUTO_QUIZ_MIN_CHARS.")
        parser.add_argument("--dry-run", action="store_true", help="With --remove-short: only list them.")

    def handle(self, *args, **opts):
        if opts["remove_short"]:
            self._remove_short(opts["dry_run"])
            if not (opts["status"] or opts["queue"] or opts["run"]):
                return
        if not (opts["status"] or opts["queue"] or opts["run"]):
            opts["status"] = True
        if opts["queue"]:
            from learning.models import Module
            modules = Module.objects.select_related("chapter__document")
            if opts["document"]:
                modules = modules.filter(chapter__document_id=opts["document"])
                if not modules.exists():
                    raise CommandError("No modules for that document.")
            self.stdout.write(f"Queued {auto_quiz.request_quizzes(list(modules), reason='command')} quiz(zes).")
        if opts["run"]:
            out = auto_quiz.run_pending(limit=opts["limit"], wait_for_students=False)
            self.stdout.write(f"Generated: {out['ready']} ready, {out['failed']} failed, {out['discarded']} discarded.")
        if opts["status"]:
            counts = dict(AutoQuizJob.objects.values_list("status").annotate(n=Count("id")))
            for s in ("pending", "generating", "ready", "failed", "dismissed"):
                self.stdout.write(f"{s:>10}: {counts.get(s, 0)}")

    def _remove_short(self, dry_run):
        """Automatic quizzes written before AUTO_QUIZ_MIN_CHARS existed, on
        modules too short to deserve one. Quizzes students have attempted are
        kept (their scores refer to them) and listed so faculty can close them."""
        from assessments.models import Assessment

        limit = auto_quiz.min_chars()
        removed = kept = 0
        for quiz in (Assessment.objects.filter(auto_generated=True, module__isnull=False)
                     .exclude(status="superseded").select_related("module")):
            if len((quiz.module.source_text or "").strip()) >= limit:
                continue
            label = f"{quiz.title} ({len(quiz.module.source_text.strip())} characters)"
            if quiz.attempts.exists():
                kept += 1
                self.stdout.write(f"kept (has attempts): {label}")
                continue
            removed += 1
            self.stdout.write(f"{'would delete' if dry_run else 'deleted'}: {label}")
            if not dry_run:
                AutoQuizJob.objects.filter(module=quiz.module).delete()
                quiz.delete()
        verb = "Would delete" if dry_run else "Deleted"
        self.stdout.write(f"{verb} {removed} automatic quiz(zes) on modules under {limit} characters; kept {kept} with attempts.")

