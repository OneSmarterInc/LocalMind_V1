"""Hooks that feed the monitor without touching the apps it watches.

Both fire after the row's transaction commits, so the background worker
never reads a row the request has not finished writing. Nothing here can
raise into the request: ``services.enqueue`` catches everything.
"""
from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from assessments.models import Assessment
from tutor.models import Message

from . import services


@receiver(post_save, sender=Message, dispatch_uid="ai_monitor.message")
def _on_message(sender, instance: Message, created: bool, **kwargs):
    if created and instance.role == "assistant" and services.enabled():
        transaction.on_commit(lambda: services.enqueue_message(instance))


@receiver(post_save, sender=Assessment, dispatch_uid="ai_monitor.assessment")
def _on_assessment(sender, instance: Assessment, created: bool, **kwargs):
    # Automatic quizzes are sent for checking by assessments.services.auto_quiz
    # itself, which also needs to know when the check is done (to publish or
    # hold the quiz); queueing them here as well would check them twice.
    if created and instance.generator == "ai" and not instance.auto_generated and services.enabled():
        transaction.on_commit(lambda: services.enqueue_assessment(instance))
