"""Assign source figures after processing, without guessing across modules."""
from __future__ import annotations

import logging
from pathlib import Path

from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver
from learning.models import Module
from .models import Document, EDITABLE_STATUSES
from .services.visual_context import choose_target
from .services.visuals import extract_source_visuals, extraction_manifest, EXTRACTOR_VERSION

logger = logging.getLogger("localmind.documents.visuals")


def _signature(modules):
    return [(str(m.pk), str(m.chapter_id), m.title, m.source_text, m.source_heading_index, m.start_page, m.end_page, m.source_missing)
            for m in modules]


def sync_document_visuals(document_id):
    """Refresh cached extraction + context assignment, with a stale-write guard.

    Original image occurrences live in the extraction manifest. Unmatched ones
    are preserved for review, not attached to chapter one. Saving an outline
    reuses the PNGs; it does not render the entire book again.
    """
    try:
        document = Document.objects.get(pk=document_id)
    except Document.DoesNotExist:
        return None
    modules = list(Module.objects.filter(chapter__document=document).select_related("chapter").order_by("pk"))
    if not modules or not document.processed_markdown_path or not document.file:
        return None
    snapshot = _signature(modules)
    report = {"version": EXTRACTOR_VERSION, "status": "ready", "total": 0, "assigned": 0,
              "unassigned": [], "warnings": [], "content_version": document.content_version}
    try:
        processed_dir = Path(document.processed_markdown_path).parent
        visuals = extract_source_visuals(Path(document.file.path), processed_dir)
        manifest = extraction_manifest(processed_dir)
        report.update(total=len(visuals), warnings=manifest.get("warnings", []), source_hash=manifest.get("source_hash", ""))
    except Exception as exc:
        # Do not silently serve stale pictures as though they described new text.
        logger.exception("Source visual extraction failed for %s", document_id)
        visuals = []
        report.update(status="error", warnings=[f"Source pictures could not be prepared ({type(exc).__name__}). Retry visual extraction; the source text is unchanged."])
    targets = [{"id": str(m.pk), "title": m.title, "chapter_title": m.chapter.title, "source": m.source_text,
                "start_page": m.start_page, "end_page": m.end_page}
               for m in modules if not m.source_missing]
    by_module = {str(m.pk): [] for m in modules}
    for visual in visuals:
        target, reason = choose_target(visual, targets)
        if target is None:
            report["unassigned"].append({"id": visual["id"], "caption": visual.get("caption"),
                                         "page": visual.get("page"), "reason": reason})
        else:
            by_module[target["id"]].append({**visual, "assignment_reason": reason})
            report["assigned"] += 1
    with transaction.atomic():
        locked = Document.objects.select_for_update().get(pk=document_id)
        current = list(Module.objects.filter(chapter__document=document).select_related("chapter").order_by("pk"))
        if (locked.processed_markdown_path != document.processed_markdown_path or
                locked.content_version != document.content_version or _signature(current) != snapshot):
            logger.info("Discarded stale source-visual assignment for %s", document_id)
            return None
        for module in current:
            Module.objects.filter(pk=module.pk).update(source_visuals=by_module[str(module.pk)])
        Document.objects.filter(pk=document_id).update(visual_report=report)
    return report


@receiver(post_save, sender=Document)
def document_visuals_after_processing(sender, instance, update_fields=None, **kwargs):
    if instance.status not in EDITABLE_STATUSES or not instance.processed_markdown_path:
        return
    watched = {"processed_markdown_path", "processed_at", "outline_source", "content_version"}
    if update_fields is not None and not (watched & set(update_fields)):
        return
    transaction.on_commit(lambda: sync_document_visuals(instance.pk))
