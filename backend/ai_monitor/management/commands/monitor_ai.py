"""Operate the AI monitor from the command line.

    python manage.py monitor_ai --status                 # readiness, backlog, counts
    python manage.py monitor_ai --backfill               # evaluate everything not yet evaluated
    python manage.py monitor_ai --backfill --limit 50 --kind tutor_answer --since 2026-09-01
    python manage.py monitor_ai --evaluate <uuid> --kind quiz --judge   # one interaction, judge forced
    python manage.py monitor_ai --purge                  # apply retention
    python manage.py monitor_ai --seed-policies          # (re)create default policy rows
"""
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from ai_monitor import services
from ai_monitor.models import InteractionKind


class Command(BaseCommand):
    help = "Run, backfill, inspect and prune the AI Monitoring & Guard evaluations."

    def add_arguments(self, parser):
        parser.add_argument("--status", action="store_true")
        parser.add_argument("--backfill", action="store_true", help="Evaluate every un-evaluated interaction (oldest first).")
        parser.add_argument("--evaluate", metavar="UUID", help="Evaluate one interaction now.")
        parser.add_argument("--kind", choices=InteractionKind.values, help="Restrict to tutor answers or quizzes.")
        parser.add_argument("--since", help="ISO date/datetime; only interactions created after it.")
        parser.add_argument("--limit", type=int, default=0)
        parser.add_argument("--judge", action="store_true", help="Force the judge model on every evaluation.")
        parser.add_argument("--purge", action="store_true", help="Delete evaluations past AI_MONITOR_RETENTION_DAYS (open incidents kept).")
        parser.add_argument("--retention-days", type=int)
        parser.add_argument("--seed-policies", action="store_true")

    def handle(self, *args, **opts):
        if not any(opts[k] for k in ("status", "backfill", "evaluate", "purge", "seed_policies")):
            opts["status"] = True
        if opts["seed_policies"]:
            services.ensure_default_policies()
            self.stdout.write(self.style.SUCCESS("Default policies present."))
        if opts["status"]:
            state = services.status()
            for key, value in state.items():
                self.stdout.write(f"{key:>20}: {value}")
            overview = services.overview(30)
            self.stdout.write(f"{'last 30 days':>20}: {overview['evaluated']} evaluated, {overview['incidents']} incidents "
                              f"({overview['high_severity_incidents']} high/critical), coverage {overview['coverage_percent']}%")
        if opts["evaluate"]:
            if not opts["kind"]:
                raise CommandError("--evaluate needs --kind tutor_answer|quiz")
            ev = services.evaluate(opts["kind"], opts["evaluate"], force_judge=opts["judge"])
            self._print(ev)
        if opts["backfill"]:
            since = None
            if opts["since"]:
                since = parse_datetime(opts["since"]) or parse_datetime(opts["since"] + "T00:00:00")
                if since is None:
                    raise CommandError("--since must be an ISO date or datetime")
                if timezone.is_naive(since):
                    since = timezone.make_aware(since, timezone.utc)
            pairs = services.backlog(opts["kind"], since, opts["limit"] or None)
            self.stdout.write(f"Backfilling {len(pairs)} interaction(s)...")
            issues = 0
            for n, (kind, pk) in enumerate(pairs, start=1):
                ev = services.evaluate(kind, pk, force_judge=opts["judge"])
                issues += ev.verdict == "issue"
                self._print(ev, prefix=f"[{n}/{len(pairs)}] ")
            self.stdout.write(self.style.SUCCESS(f"Done: {len(pairs)} evaluated, {issues} with issues, {services.backlog_count()} still pending."))
        if opts["purge"]:
            evals, incidents = services.purge(opts["retention_days"])
            self.stdout.write(self.style.SUCCESS(f"Purged {evals} evaluation(s) and {incidents} resolved incident(s)."))

    def _print(self, ev, prefix=""):
        flag = self.style.WARNING if ev.verdict == "issue" else self.style.SUCCESS if ev.verdict == "pass" else self.style.NOTICE
        self.stdout.write(prefix + flag(f"{ev.interaction_kind} {ev.interaction_id}: {ev.verdict} {ev.issue_type} {ev.severity} "
                                        f"conf={ev.confidence:.2f} judge={'yes' if ev.judge_invoked else 'no'} "
                                        f"incident={'yes' if services.Incident.objects.filter(evaluation=ev).exists() else 'no'}"))
        if ev.stage == "failed":
            self.stdout.write(self.style.ERROR(f"    evaluator failed: {ev.error}"))
