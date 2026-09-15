"""Keep cropped source visuals synchronized with generated course modules."""
from __future__ import annotations

import logging
from pathlib import Path

from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from learning.models import Module

from .models import Document, EDITABLE_STATUSES
from .services.visuals import extract_source_visuals

logger = logging.getLogger("localmind.documents.visuals")


def _visuals_for_module(module, visuals):
    start = module.start_page
    end = module.end_page or start
    if not start:
        return []
    return [v for v in visuals if start <= int(v.get("page") or 0) <= end]


def sync_document_visuals(document_id):
    """Extract only cropped visual regions and attach them to source modules."""
    try:
        document = Document.objects.get(pk=document_id)
    except Document.DoesNotExist:
        return

    modules = list(Module.objects.filter(chapter__document=document).order_by("chapter__order", "order"))
    if not modules:
        return

    if not document.processed_markdown_path or not document.file:
        Module.objects.filter(pk__in=[m.pk for m in modules]).update(source_visuals=[])
        return

    source = Path(document.file.path)
    processed_dir = Path(document.processed_markdown_path).parent
    try:
        visuals = extract_source_visuals(source, processed_dir)
    except Exception:
        # Visual extraction must never make an otherwise readable textbook fail.
        logger.exception("Source visual extraction failed for document %s", document_id)
        return

    with transaction.atomic():
        for module in modules:
            selected = _visuals_for_module(module, visuals)
            Module.objects.filter(pk=module.pk).update(source_visuals=selected)
    logger.info("Attached %s cropped source visuals across %s modules for %s", len(visuals), len(modules), document_id)


@receiver(post_save, sender=Document)
def document_visuals_after_processing(sender, instance, update_fields=None, **kwargs):
    """Refresh source visuals after processing and after outline edits.

    The parser first creates modules and then stores ``processed_markdown_path``.
    Outline saves may later move page ranges between modules, including while a
    book is published or unpublished. In both cases an on-commit refresh keeps
    each crop attached to the module whose source pages actually contain it.
    Unrelated document saves do not rerun PDF rendering.
    """
    if instance.status not in EDITABLE_STATUSES or not instance.processed_markdown_path:
        return
    watched = {"processed_markdown_path", "processed_at", "outline_source"}
    if update_fields is not None and not (watched & set(update_fields)):
        return
    transaction.on_commit(lambda: sync_document_visuals(instance.pk))
