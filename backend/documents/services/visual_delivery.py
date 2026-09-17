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


def _targets(document):
    from learning.models import Module
    return [dict(id=str(m.pk), title=m.title, source=m.source_text,
                 start_page=m.start_page, end_page=m.end_page, chapter_title=m.chapter.title,
                 chapter_id=str(m.chapter_id), chapter_order=m.chapter.order, order=m.order)
            for m in Module.objects.filter(chapter__document=document).select_related('chapter')
                                   .order_by('chapter__order', 'order')]


def _assign(document):
    """Every extracted visual paired with the module it lands in, or None.

    This branch computes placement live from the manifest rather than storing a
    copy on each module, so the Pictures tab, the review queue and a module's
    own gallery all read from this one pass.
    """
    if not document.processed_markdown_path:
        return [], []
    base = Path(document.processed_markdown_path).parent
    manifest = extraction_manifest(base)
    visuals = manifest.get('visuals') or []
    if not visuals:
        return [], []
    targets = _targets(document)
    placed, unplaced = [], []
    for visual in visuals:
        target, reason = choose_target(visual, targets)
        (placed if target else unplaced).append((visual, target, reason))
    return placed, unplaced


def _image_path(base, visual):
    filename = str(visual.get('filename') or '')
    if not filename or Path(filename).name != filename:
        return None
    path = (base / 'visuals' / filename).resolve()
    try:
        path.relative_to(Path(settings.MEDIA_ROOT).resolve())
    except ValueError:
        return None
    return path if path.is_file() else None


def _row(visual, base, *, with_image, reason=None, module=None):
    row = {k: visual.get(k) for k in ('id', 'kind', 'page', 'caption', 'caption_origin',
                                      'width', 'height', 'context_text', 'heading_path')}
    if reason:
        row['reason'] = reason
    if module:
        row['module_id'], row['module_title'] = module['id'], module['title']
    if with_image:
        path = _image_path(base, visual)
        if not path:
            return None
        row['data_url'] = 'data:image/png;base64,' + base64.b64encode(path.read_bytes()).decode('ascii')
    return row


def picture_index(document):
    """Chapters and modules with a picture count each, and no image bytes.

    The staff Pictures tab opens on this, so a book with hundreds of figures
    still loads at once; the images are fetched one module at a time.
    """
    placed, _ = _assign(document)
    counts = {}
    for _, target, _reason in placed:
        counts[target['id']] = counts.get(target['id'], 0) + 1
    chapters = {}
    for target in _targets(document):
        chapter = chapters.setdefault(target['chapter_id'], {
            'id': target['chapter_id'], 'title': target['chapter_title'],
            'order': target['chapter_order'], 'modules': []})
        chapter['modules'].append({
            'id': target['id'], 'title': target['title'], 'order': target['order'],
            'start_page': target['start_page'], 'end_page': target['end_page'],
            'count': counts.get(target['id'], 0)})
    return sorted(chapters.values(), key=lambda c: c['order'])


def unassigned_visuals(document, limit=40):
    """Pictures that were extracted but matched no module, with their images.

    Kept rather than discarded: an unplaced figure is a review task, and a
    figure dropped into the wrong lesson is a teaching error.
    """
    _, unplaced = _assign(document)
    if not unplaced:
        return [], 0
    base = Path(document.processed_markdown_path).parent
    rows = []
    for visual, _target, reason in unplaced[:limit]:
        row = _row(visual, base, with_image=True, reason=reason)
        if row:
            rows.append(row)
    return rows, len(unplaced)


def extracted_total(document):
    if not document.processed_markdown_path:
        return 0
    return len((extraction_manifest(Path(document.processed_markdown_path).parent).get('visuals')) or [])


def extraction_warnings(document):
    if not document.processed_markdown_path:
        return []
    return list(extraction_manifest(Path(document.processed_markdown_path).parent).get('warnings') or [])
