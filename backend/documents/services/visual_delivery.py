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


def _placement_map(document):
    """``{visual id: module id}`` for one document, computed once.

    ``choose_target`` scores every extracted figure against every module in the
    book. That ran on EVERY read: opening a module re-scored the whole book's
    figures before returning, for every student, every time. On a 126-module
    book that is the slowest thing on the page and none of it changes between
    requests. Keyed on the manifest's mtime so re-extraction invalidates it by
    itself; the process-local default cache is enough because a stale entry
    only costs one recompute.
    """
    from django.core.cache import cache
    from django.db.models import Count, Max
    from learning.models import Module
    base = Path(document.processed_markdown_path).parent
    manifest_path = base / "visuals" / "manifest.json"
    try:
        stamp = manifest_path.stat().st_mtime_ns
    except OSError:
        return {}, {}, set()
    manifest = extraction_manifest(base)
    visuals = manifest.get("visuals") or []
    if not visuals:
        return {}, {}, set()
    # Placement depends on the modules as much as on the manifest: a module
    # added, retitled, re-paged or re-outlined moves figures around. Keying on
    # the manifest alone would have served a stale map until re-extraction, so
    # the modules' count and latest edit are part of the key. Both come from
    # one cheap aggregate.
    fingerprint = Module.objects.filter(chapter__document=document).aggregate(n=Count("id"), last=Max("updated_at"))
    key = (f"lm:visual-placement:{document.pk}:{document.content_version}:{stamp}"
           f":{fingerprint['n']}:{fingerprint['last'].timestamp() if fingerprint['last'] else 0}")
    cached = cache.get(key)
    if cached is None:
        targets = _targets(document)
        placement, by_page = {}, set()
        for visual in visuals:
            visual_id = str(visual.get('id'))
            target, _reason = choose_target(visual, targets)
            if target is not None:
                placement[visual_id] = target['id']
                continue
            # Fall back to the page the figure was printed on.
            #
            # ``choose_target`` scores a figure against the module text and
            # declines when it is not confident. Everything it declined was
            # then dropped, so a student opening a module saw only the
            # confidently-scored figures, while staff reading the same book
            # from the device library saw every figure in the section. That is
            # the whole "faculty see images, students do not" report: the
            # picture was extracted and nothing was broken, it was simply never
            # offered to the reader.
            #
            # A figure printed on page 84 belongs to whichever module covers
            # page 84. That is weaker evidence than a text match, so it is used
            # only where the text match failed, only when the page falls inside
            # exactly one module's range, and the row is marked so staff can
            # tell the two apart. A page claimed by several modules, or a
            # figure with no page, stays unplaced and keeps appearing in the
            # staff review queue — which is where a genuinely ambiguous figure
            # belongs.
            covering = _by_page(visual, targets)
            if covering is not None:
                placement[visual_id] = covering['id']
                by_page.add(visual_id)
        # Ids only: never the image bytes, which would put the whole book's
        # figures in memory for the sake of one module's page.
        cached = {'placement': placement, 'by_page': sorted(by_page)}
        cache.set(key, cached, 60 * 30)
    return cached['placement'], {str(v.get('id')): v for v in visuals}, set(cached['by_page'])


def module_visuals(module):
    """Caller must authorize module access. Reads never run extraction or an LLM."""
    document = module.chapter.document
    if not document.processed_markdown_path:
        return []
    base = Path(document.processed_markdown_path).parent
    placement, by_id, by_page = _placement_map(document)
    if not placement:
        return []
    rows = []
    for visual_id, target_id in placement.items():
        if target_id != str(module.pk):
            continue
        visual = by_id.get(visual_id)
        if visual is None:
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
                     # How this figure reached this module: matched against the
                     # module's text, or assigned because it was printed on one
                     # of the module's pages. Staff screens can label the second
                     # kind; students simply see the figure.
                     'placement': 'page' if visual_id in by_page else 'text',
                     'data_url': 'data:image/png;base64,' + base64.b64encode(raw).decode('ascii')})
    # Reading order. A dictionary's insertion order is the manifest's order,
    # which is close but not guaranteed once page fallbacks are mixed in.
    rows.sort(key=lambda r: (r.get('page') if isinstance(r.get('page'), int) else 10 ** 6, str(r.get('id'))))
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


def _by_page(visual, targets):
    """The one module whose page range covers this figure's page, or None.

    Deliberately strict: exactly one covering module, or nothing. Two modules
    claiming the same page means the outline cannot tell us where the figure
    goes, and guessing there would put a figure in the wrong lesson, which is a
    teaching error rather than a missing picture.
    """
    page = visual.get('page')
    if not isinstance(page, int):
        return None
    covering = [t for t in targets
                if isinstance(t.get('start_page'), int) and isinstance(t.get('end_page'), int)
                and t['start_page'] <= page <= t['end_page']]
    return covering[0] if len(covering) == 1 else None


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
        if target is None:
            # Same page fallback the delivery path uses. Without it the staff
            # Pictures tab and the review queue disagreed with what a student
            # actually sees: a figure assigned by page would be counted as
            # unplaced here and still be shown to the reader.
            target = _by_page(visual, targets)
            if target is not None:
                reason = 'Placed by page number'
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
