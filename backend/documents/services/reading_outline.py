"""Deterministic reading units. Group source blocks; never ask AI to rewrite them."""
import hashlib
import re
from pathlib import Path
from .outline_policy import _outer_sections, clean_title

CHAPTER = re.compile(r'^(?:chapter|unit|part)\s+(?:\d+|[ivxlcdm]+)\b', re.I)
FRONT = re.compile(r'^(?:dedication|contents|table of contents|preface|foreword|acknowledg(?:e)?ments?|copyright|about the author|introduction: how to use this book)$', re.I)
ATTACH = re.compile(r'^(?:your turn|questions|exercises|activities|activity|summary|references|sources|figure|table|case study)\b', re.I)


def block_text(section):
    return ('#' * min(6, section['level']) + ' ' + section['title'] + '\n' +
            section.get('own_text', section.get('source_text', ''))).strip()


def validate_coverage(outline, sections):
    """Every atomic section occurs once, in order, with its original body text."""
    ordered = sorted(sections, key=lambda s: s['index'])
    lookup = {s['index']: s for s in ordered}
    indices = []
    for chapter in outline['chapters']:
        for module in chapter['modules']:
            refs = module['source_section_indices']
            if module['source_text'] != '\n\n'.join(block_text(lookup[i]) for i in refs):
                raise ValueError('Outline source text does not match its original passages.')
            indices.extend(refs)
    if indices != [s['index'] for s in ordered]:
        raise ValueError('Outline has missing, reordered or duplicated source passages.')
    return {'source_sections': len(ordered), 'covered_sections': len(indices),
            'source_digest': hashlib.sha256('\n\n'.join(block_text(s) for s in ordered).encode()).hexdigest()}


def reading_outline(original_name, sections):
    if not sections:
        raise ValueError('No source sections are available.')
    sections = sorted(sections, key=lambda s: s['index'])
    roots = _outer_sections(sections)
    explicit = [s for s in sections if CHAPTER.match(s['title']) and len(s['title'].split()) <= 16]
    warnings = []
    # Explicit chapter numbering beats flattened display-font headings.
    if len(explicit) >= 2 and len(roots) == len(sections):
        roots = explicit
        if sections[0]['index'] < roots[0]['index']:
            roots = [sections[0], *roots]
    elif len(roots) > 8 and len(roots) == len(sections):
        # No defensible chapter hierarchy: preserve order without inventing 150 chapters.
        roots = [sections[0]]
        warnings.append('No reliable chapter hierarchy was found. Reading units follow source order; review their boundaries.')
    chapters = []
    for pos, root in enumerate(roots):
        end = roots[pos + 1]['index'] if pos + 1 < len(roots) else float('inf')
        rows = [s for s in sections if root['index'] <= s['index'] < end]
        # Work with sibling sections as indivisible units. Deeper examples stay attached.
        children = _outer_sections(rows[1:])
        starts = [0] + [rows.index(c) for c in children]
        units = [rows[a:b] for a, b in zip(starts, starts[1:] + [len(rows)]) if a < b]
        batches, current, words = [], [], 0
        for unit in units:
            size = sum(len(block_text(s).split()) for s in unit)
            attached = bool(ATTACH.match(unit[0]['title']))
            if current and words >= 700 and not attached and words + size > 1400:
                batches.append(current)
                current, words = [], 0
            current.extend(unit)
            words += size
        if current:
            batches.append(current)
        modules = []
        for batch in batches:
            pages = [s.get('start_page') for s in batch if s.get('start_page')]
            ends = [s.get('own_end_page', s.get('end_page')) for s in batch if s.get('own_end_page', s.get('end_page'))]
            title = clean_title(batch[0]['title'])
            if batch[0] is root and len(batch) > 1 and len(root.get('own_text', '').split()) < 150:
                title = clean_title(batch[1]['title'])
            modules.append({'title': title[:300], 'source_heading_index': None,
                            'source_section_indices': [s['index'] for s in batch],
                            'source_text': '\n\n'.join(block_text(s) for s in batch),
                            'start_page': min(pages) if pages else None,
                            'end_page': max(ends) if ends else None})
        title = clean_title(root['title'])
        if len(roots) == 1 and warnings:
            title = Path(original_name).stem
        chapters.append({'title': title[:300], 'source_heading_index': root['index'], 'modules': modules})
    # Keep preliminaries accessible together; no text is discarded as "unimportant".
    front_end = max((i for i, c in enumerate(chapters[:10]) if FRONT.match(c['title'])), default=-1)
    if front_end >= 0:
        front_modules = [m for c in chapters[:front_end + 1] for m in c['modules']]
        merged = {'title': 'Before you begin', 'source_heading_index': None,
                  'source_section_indices': [i for m in front_modules for i in m['source_section_indices']],
                  'source_text': '\n\n'.join(m['source_text'] for m in front_modules),
                  'start_page': front_modules[0].get('start_page'),
                  'end_page': front_modules[-1].get('end_page')}
        chapters = [{'title': 'Before you begin', 'modules': [merged]}] + chapters[front_end + 1:]
    outline = {'document_title': Path(original_name).stem, 'chapters': chapters}
    quality = validate_coverage(outline, sections)
    quality.update({'warnings': warnings, 'method': 'source_reading_units',
                    'content_chapters': len(chapters) - int(chapters[0]['title'] == 'Before you begin'),
                    'introductory_group': chapters[0]['title'] == 'Before you begin',
                    'coverage_note': 'All extracted sections are assigned once. Check the original for OCR and extraction errors.'})
    outline['_quality'] = quality
    return outline


def _norm(value):
    return ''.join(c for c in value.casefold() if c.isalnum())


def apply_pdf_bookmarks(markdown, source):
    """Accept bookmark boundaries only when their titles occur on the named page.

    Change Markdown heading markers only; preserve every original text line.
    Unsupported/ambiguous destinations leave the original extraction unchanged.
    """
    import fitz
    with fitz.open(source) as pdf:
        toc = pdf.get_toc()
        count = len(pdf)
    pages = markdown.split('<!-- page break -->')
    if len(pages) != count or not toc:
        return markdown, False
    top_level = min(row[0] for row in toc)
    bookmarks = [row for row in toc if row[0] == top_level]
    if len(bookmarks) < 2 or any(a[2] >= b[2] for a, b in zip(bookmarks, bookmarks[1:])):
        return markdown, False
    anchors = {}
    for _, title, page in bookmarks:
        if not 1 <= page <= count:
            return markdown, False
        lines = pages[page - 1].splitlines()
        wanted = _norm(re.sub(r'^\d+[.)]\s*', '', title))
        hits = []
        for i, line in enumerate(lines):
            stripped = re.sub(r'^\s*#{1,6}\s+', '', line).strip()
            if not stripped:
                continue
            combined = stripped
            for j in range(i, min(i + 5, len(lines))):
                if j > i:
                    combined += ' ' + re.sub(r'^\s*#{1,6}\s+', '', lines[j]).strip()
                if _norm(combined) == wanted:
                    hits.append((i, j))
                    break
        if len(hits) != 1:
            return markdown, False
        first, last = hits[0]
        previous = next((i for i in range(first - 1, -1, -1) if lines[i].strip()), None)
        if previous is not None and re.fullmatch(r'(?:#{1,6}\s*)?chapter\s+\d+', lines[previous].strip(), re.I):
            first = previous
        anchors[page - 1] = (first, last)
    for page, text in enumerate(pages):
        lines = text.splitlines()
        anchor = anchors.get(page)
        if anchor:
            first, last = anchor
            lines[first] = ' '.join(re.sub(r'^\s*#{1,6}\s+', '', line).strip() for line in lines[first:last + 1])
            for j in range(first + 1, last + 1):
                lines[j] = ''
        for i, line in enumerate(lines):
            match = re.match(r'^(\s*)#{1,6}\s+(.+)$', line)
            if anchor and i == anchor[0]:
                lines[i] = '# ' + (match.group(2) if match else line.strip())
            elif match:
                # Child hierarchy stays relative, but cannot escape the verified chapter.
                level = len(line.lstrip()) - len(line.lstrip().lstrip('#'))
                lines[i] = '#' * max(2, level) + line.lstrip().lstrip('#')
        pages[page] = '\n'.join(lines)
    result = '<!-- page break -->'.join(pages)
    # Safety belt: changing structural markers must never change source characters.
    strip_marks = lambda s: re.sub(r'^\s*#{1,6}\s+', '', s, flags=re.M)
    if _norm(strip_marks(result)) != _norm(strip_marks(markdown)):
        return markdown, False
    return result, True


def apply_layout_hints(markdown, source):
    """Transfer font-derived heading markers to the intact text layer, not its body.

    The layout helper can omit running headers; those omissions must not affect
    source coverage, so only exact, unique title matches supply structural hints.
    """
    from .pdf_structure import structured_text_layer
    pages = markdown.split('<!-- page break -->')
    hints, _, _, _ = structured_text_layer(source, max_pages=len(pages))
    hint_pages = hints.split('<!-- page break -->')
    if len(hint_pages) != len(pages):
        return markdown
    for page, text in enumerate(pages):
        lines = text.splitlines()
        for hint in hint_pages[page].splitlines():
            match = re.match(r'^(#{1,6})\s+(.+)$', hint)
            if not match:
                continue
            hits = []
            for i, line in enumerate(lines):
                if not line.strip() or re.match(r'^\s*#', line):
                    continue
                for j in range(i, min(i + 4, len(lines))):
                    if _norm(' '.join(lines[i:j+1])) == _norm(match.group(2)):
                        hits.append((i, j))
                        break
            if len(hits) == 1:
                first, last = hits[0]
                lines[first] = match.group(1) + ' ' + ' '.join(line.strip() for line in lines[first:last+1])
                for i in range(first+1, last+1):
                    lines[i] = ''
        pages[page] = '\n'.join(lines)
    return '<!-- page break -->'.join(pages)


def suggest_for_document(document):
    """Read-only proposal for an existing book. Never regenerate or delete work."""
    from .parser import load_processed_sections, extract_sections_from_markdown
    sections = load_processed_sections(document)
    if document.file_type == 'pdf' and document.processed_markdown_path:
        markdown = Path(document.processed_markdown_path).read_text(encoding='utf-8')
        markdown, _ = apply_pdf_bookmarks(markdown, document.file.path)
        sections = extract_sections_from_markdown(markdown)
    if not sections:
        raise ValueError('The original extracted source is unavailable. The existing outline has not changed.')
    plan = reading_outline(document.original_name, sections)
    for ci, chapter in enumerate(plan['chapters'], 1):
        chapter['source_heading_index'] = None
        chapter['order'] = ci
        for mi, module in enumerate(chapter['modules'], 1):
            module['order'] = mi
    plan['document_title'] = document.title
    return plan
