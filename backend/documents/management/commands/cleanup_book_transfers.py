from datetime import timedelta
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from documents.models import LocalBookUpload


class Command(BaseCommand):
    help = 'Remove incomplete book transfers idle for more than seven days; retain books and authoring receipts.'

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(days=7)
        actors = list(LocalBookUpload.objects.filter(updated_at__lt=cutoff).values_list('actor_id', flat=True).distinct())
        count = 0
        for actor_id in actors:
            with transaction.atomic():
                # Transfers use the same actor-first lock order. A renewed
                # transfer cannot be deleted between inspection and deletion.
                if not get_user_model().objects.select_for_update().filter(pk=actor_id).first():
                    continue
                rows = LocalBookUpload.objects.filter(actor_id=actor_id, updated_at__lt=cutoff)
                count += rows.count()
                rows.delete()
        self.stdout.write(f'Removed {count} expired book transfers.')
