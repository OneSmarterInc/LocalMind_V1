import time
from django.core.management.base import BaseCommand
from django.db import close_old_connections
from jobs.services import run_one

class Command(BaseCommand):
    help = "Run persistent jobs. Keep a single worker on a local CPU/model installation."
    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true")
        parser.add_argument("--poll-seconds", type=float, default=2)
    def handle(self, *args, **options):
        try:
            while True:
                close_old_connections()
                result = run_one()
                if result: self.stdout.write(result)
                if options["once"]: return
                if result is None: time.sleep(max(0.25, options["poll_seconds"]))
        except KeyboardInterrupt:
            self.stdout.write("Worker stopped. Unfinished jobs remain durable and are reclaimed after their lease expires.")
