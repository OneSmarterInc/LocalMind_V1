"""Read-only lesson imagery. Existing outlining remains the source of module boundaries."""
import base64
import logging
from pathlib import Path

from django.conf import settings

from .visual_context import choose_target, place_in_lesson
from .visuals import extract_source_visuals, extraction_manifest

logger = logging.getLogger(__name__)


def prepare_visuals(document):
    """Add a separate image manifest; never rewrite source text or the outline."""
    if not document.processed_markdown_path or not document.file:
        return []
    return extract_source_visuals(Path(document.file.path), Path(document.processed_markdown_path).parent)


def module_visuals(module):
    """Caller must authorize module access. Reads never run extraction or an LLM."""
    document = module.chapter.document
    if not document.processed_markdown_path:
        return []
    from learning.models import Module
    base = Path(document.processed_markdown_path).parent
    manifest = extraction_manifest(base)
    if not manifest.get('visuals'):
        return []
    targets = [dict(id=str(m.pk), title=m.title, source=m.source_text,
                    start_page=m.start_page, end_page=m.end_page, chapter_title=m.chapter.title)
               for m in Module.objects.filter(chapter__document=document).select_related('chapter')]
    rows = []
    for visual in manifest['visuals']:
        target, _ = choose_target(visual, targets)
        if target is None or target['id'] != str(module.pk):
            continue
        filename = str(visual.get('filename') or '')
        if not filename or Path(filename).name != filename:
            continue
        path = (base / 'visuals' / filename).resolve()
        try:
            path.relative_to(Path(settings.MEDIA_ROOT).resolve())
            raw = path.read_bytes()
        except (ValueError, OSError):
            continue
        rows.append({**{k: visual.get(k) for k in ('id', 'kind', 'page', 'caption', 'caption_origin',
                                                  'width', 'height', 'context_text', 'heading_path')},
                     'data_url': 'data:image/png;base64,' + base64.b64encode(raw).decode('ascii')})
    return rows


def enrich_lesson(lesson, module):
    if not lesson:
        return lesson
    return place_in_lesson(lesson, module_visuals(module))
