"""DocumentService: upload, processing claim, review edits, publication."""
import logging
import threading
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from academics.models import SubjectStatus, faculty_manages_subject
from audit import services as audit
from core.exceptions import Conflict, Forbidden, ValidationFailed
from learning.models import Module, ModuleAvailability

from ..models import Document, DocumentStatus, EDITABLE_STATUSES, REPROCESSABLE_STATUSES
from . import outline as outline_service
from .parser import NoExtractableContent, load_processed_sections, parse_document, release_document_models

logger = logging.getLogger("localmind.documents")

# One document is parsed at a time per process: Docling's layout model plus
# OCR already take most of a laptop's spare RAM, and the embedded LLM needs
# the rest for the outline call that follows.
_processing_lock = threading.Lock()

MAGIC = {".pdf": (b"%PDF",), ".docx": (b"PK\x03\x04",), ".doc": (b"\xd0\xcf\x11\xe0",)}


def _require_manage(actor, subject):
    if not faculty_manages_subject(actor, subject):
        raise Forbidden("You do not manage this subject.", code="SUBJECT_NOT_ASSIGNED")


def validate_upload(uploaded_file):
    cfg = settings.LOCALMIND
    ext = Path(uploaded_file.name or "").suffix.lower()
    if ext not in cfg["ALLOWED_UPLOAD_EXTENSIONS"]:
        raise ValidationFailed("Supported files are PDF (.pdf) and Word (.docx); legacy Word (.doc) where the server can convert it.",
                               code="UNSUPPORTED_FILE_TYPE")
    if ext == ".doc":
        from .parser import legacy_doc_support
        supported, reason = legacy_doc_support()
        if not supported:
            # Refuse now with the fix, rather than store the file and fail in
            # processing minutes later with a converter error.
            raise ValidationFailed(
                f"This server cannot read legacy Word (.doc) files: {reason}. Open the file in Word or LibreOffice "
                "and save it as .docx (or export it as PDF), then upload that.",
                code="LEGACY_WORD_UNSUPPORTED")
    if uploaded_file.size == 0:
        raise ValidationFailed("The uploaded file is empty.", code="EMPTY_FILE")
    if uploaded_file.size > cfg["MAX_UPLOAD_MB"] * 1024 * 1024:
        raise ValidationFailed(f"File is larger than {cfg['MAX_UPLOAD_MB']} MB.", code="FILE_TOO_LARGE")
    head = uploaded_file.read(8)
    uploaded_file.seek(0)
    if not any(head.startswith(m) for m in MAGIC[ext]):
        raise ValidationFailed("File content does not match its extension.", code="FILE_CONTENT_MISMATCH")
    return ext


def file_digest(uploaded_file) -> str:
    """SHA-256 of the upload, read in chunks so a 100 MB book is not held twice
    in memory. Leaves the file rewound for the storage backend."""
    import hashlib

    digest = hashlib.sha256()
    for chunk in uploaded_file.chunks():
        digest.update(chunk)
    uploaded_file.seek(0)
    return digest.hexdigest()


@transaction.atomic
def upload_document(actor, subject, uploaded_file, title="", request=None, *, outline_strategy="source"):
    _require_manage(actor, subject)
    if subject.status != SubjectStatus.ACTIVE:
        raise Conflict("Books can only be uploaded to active subjects.", code="SUBJECT_INACTIVE")
    if outline_strategy not in ("source", "ai"):
        raise ValidationFailed("Choose source headings or AI suggestions.", code="INVALID_OUTLINE_STRATEGY")
    ext = validate_upload(uploaded_file)
    digest = file_digest(uploaded_file)
    # The same book must not sit on a subject twice: it would be parsed twice,
    # produce two sets of modules and two reading paths for the same content.
    # Matching on the hash rather than the filename catches a re-upload that
    # was renamed first, which is the common case.
    existing = Document.objects.filter(subject=subject, content_hash=digest).exclude(content_hash="").first()
    if existing:
        name = existing.title or existing.original_name
        # A copy that failed to parse is the one case where re-uploading is a
        # reasonable instinct, so say what to do instead of just refusing.
        hint = (" That copy failed to process; open it to retry, or delete it first."
                if existing.status == DocumentStatus.ERROR else "")
        raise Conflict(
            f'This book is already on {subject.code} as "{name}".{hint}',
            code="DUPLICATE_DOCUMENT",
            details={"document_id": str(existing.id), "title": name, "status": existing.status},
        )
    document = Document(
        subject=subject, uploaded_by=actor,
        original_name=Path(uploaded_file.name).name[:300],
        title=(title or Path(uploaded_file.name).stem)[:300], outline_strategy=outline_strategy,
        file_type=ext.lstrip("."), file_size=uploaded_file.size, content_hash=digest,
    )
    document.file = uploaded_file  # upload_to uses document.id, which exists already
    document.save()
    audit.record(actor, "document.uploaded", document, {"subject": subject.code, "file": document.original_name}, request)
    return document


# ---------- processing ----------

def _processing_is_stale(document):
    """A document still 'processing' long after it started belongs to a worker
    that was recycled mid-run; nothing will ever finish it, so it may be reclaimed."""
    minutes = settings.LOCALMIND.get("PROCESSING_STALE_MINUTES", 30)
    started = document.processing_started_at or document.updated_at
    return started < timezone.now() - timedelta(minutes=minutes)


def claim_for_processing(document):
    """Atomically move to PROCESSING; returns False if someone else already did
    and is still within the stale window.

    The move is a single conditional UPDATE that names the row's current state, so the database decides
    the winner: of several simultaneous requests exactly one changes a row, and the others see zero rows
    changed and step aside. ``select_for_update`` alone was not enough, because SQLite ignores it and both
    transactions could read the same "not processing yet" row.
    """
    from jobs.services import enabled
    if enabled():
        from jobs.models import Job
        if Job.objects.filter(kind="document_parse", target=str(document.pk), status__in=("pending", "running", "retry")).exists():
            return False
    with transaction.atomic():
        locked = Document.objects.select_for_update().get(pk=document.pk)
        now = timezone.now()
        if locked.status == DocumentStatus.PROCESSING:
            if not _processing_is_stale(locked):
                return False
            # Reclaim only the run we just judged stale, by naming the start time we saw.
            claimed = Document.objects.filter(pk=locked.pk, status=DocumentStatus.PROCESSING,
                                              processing_started_at=locked.processing_started_at).update(
                status=DocumentStatus.PROCESSING, error_message="", processing_started_at=now, updated_at=now)
            if claimed:
                logger.warning("Reclaiming document %s: processing started at %s and never finished", locked.pk, locked.processing_started_at)
        elif locked.status not in REPROCESSABLE_STATUSES:
            raise Conflict(f"A document in state '{locked.status}' cannot be processed.", code="INVALID_STATE")
        else:
            claimed = Document.objects.filter(pk=locked.pk, status=locked.status).update(
                status=DocumentStatus.PROCESSING, error_message="", processing_started_at=now, updated_at=now)
        if not claimed:
            return False
        document.status = DocumentStatus.PROCESSING
        document.processing_started_at = now
    return True


# The pipeline is a fixed sequence of steps rather than a per-item loop: the
# parser hands back the whole book at once and the outline call plans every
# chapter in one request, so honest progress means naming the step in flight
# and, once the outline exists, the number of chapters and modules it will
# create. Each label is written straight to the row so a poll can read it.
PROCESSING_STEPS = 4


def set_progress(document_id, step, stage, detail=""):
    """Publish progress from the worker.

    Uses queryset.update() rather than instance.save(): run_processing does its
    real work outside a transaction, and the final persist runs inside one, so
    an ORM save there would stay invisible until commit.
    """
    Document.objects.filter(pk=document_id).update(
        progress_step=step, progress_total_steps=PROCESSING_STEPS,
        progress_stage=stage[:40], progress_detail=detail[:200], updated_at=timezone.now(),
    )


def clear_progress(document_id):
    Document.objects.filter(pk=document_id).update(
        progress_step=0, progress_total_steps=0, progress_stage="", progress_detail="", updated_at=timezone.now(),
    )


def run_processing(document_id, *, guard=None, run_id=None, raise_errors=False):
    """The unit of work a background worker executes. Safe to call from a
    thread, a process, or (later) a Celery task.

    Order matters for memory: parse (Docling/OCR models resident), release
    those models, then ask the embedded LLM for an outline. The LLM instance
    itself is shared per process and is never unloaded here.
    """
    document = Document.objects.get(pk=document_id)
    if run_id:
        document._processing_artifact_id = run_id
    try:
        set_progress(document_id, 1, "queued", "Waiting for the parser to be free")
        with _processing_lock:
            try:
                set_progress(document_id, 2, "reading", f"Reading {document.original_name}")
                parsed = parse_document(document)
            finally:
                release_document_models()
        set_progress(document_id, 3, "outline", f"Planning an outline from {len(parsed['headings'])} headings")
        outline, source = outline_service.build_proposed_outline(document, parsed["sections"], parsed["headings"])
        chapters = outline.get("chapters") or []
        module_count = sum(len(c.get("modules") or []) for c in chapters)
        set_progress(document_id, 4, "structure",
                     f"Creating {module_count} module{'' if module_count == 1 else 's'} across {len(chapters)} chapter{'' if len(chapters) == 1 else 's'}")
        with transaction.atomic():
            if guard: guard()
            locked = Document.objects.select_for_update().get(pk=document_id)
            if locked.processing_started_at != document.processing_started_at:
                from jobs.services import LeaseLost
                raise LeaseLost("A newer processing run owns this document")
            report = outline_service.persist_outline(document, outline, parsed["sections"], user_edited=False)
            document.processed_markdown_path = parsed["markdown_path"]
            document.extracted_headings = parsed["headings"]
            document.outline_source = source
            document.parse_mode = parsed["parse_mode"]
            document.status = DocumentStatus.UNDER_REVIEW
            document.processed_at = timezone.now()
            document.error_message = ""
            document.save()
        clear_progress(document_id)
        audit.record(None, "document.processed", document, {
            "outline_source": source, "chapters": document.chapters.count(),
            "modules": Module.objects.filter(chapter__document=document).count(),
            "empty_modules_removed": len(report["removed_empty_modules"]),
            "fragments_merged": len((outline.get("_tidy_report") or {}).get("merged_modules", [])),
            "titles_repaired": (outline.get("_tidy_report") or {}).get("renamed", 0)})
        logger.info("Processed document %s (%s)", document_id, source)
        # Lessons for every module start now, in the background, so they are
        # ready by the time faculty publish and students open the Lesson tab.
        from assessments.services import auto_quiz
        from tutor import lessons
        processed = list(Module.objects.filter(chapter__document=document).select_related("chapter__document"))
        lessons.on_content_changed(processed, reason="document.processed")
        # And a quiz for every module, generated after its lesson.
        auto_quiz.on_content_changed(processed, reason="document.processed")
        return True
    except NoExtractableContent as exc:
        # Expected outcome for blank or unreadable files: a clear message, no traceback.
        logger.warning("Processing of document %s produced no content: %s", document_id, exc)
        if guard:
            with transaction.atomic(): guard()
        Document.objects.filter(pk=document_id, processing_started_at=document.processing_started_at).update(
            status=DocumentStatus.ERROR, error_message=str(exc)[:2000], updated_at=timezone.now(),
        )
        clear_progress(document_id)
        audit.record(None, "document.processing_failed", document, {"error": str(exc)[:300], "code": exc.code})
        if raise_errors: raise
        return False
    except Exception as exc:
        logger.exception("Processing failed for document %s", document_id)
        if guard:
            with transaction.atomic(): guard()
        Document.objects.filter(pk=document_id, processing_started_at=document.processing_started_at).update(
            status=DocumentStatus.ERROR, error_message=(str(exc) or "Document processing failed.")[:2000],
            updated_at=timezone.now(),
        )
        clear_progress(document_id)
        audit.record(None, "document.processing_failed", document, {"error": str(exc)[:300]})
        if raise_errors: raise
        return False


def _launch(document_id):
    def target():
        from django.db import connection
        try:
            run_processing(document_id)
        finally:
            connection.close()
    threading.Thread(target=target, name=f"process-{document_id}", daemon=True).start()


def start_processing(actor, document, request=None):
    _require_manage(actor, document.subject)
    from jobs.services import enabled, enqueue
    with transaction.atomic():
        if not claim_for_processing(document):
            raise Conflict("This document already has queued or running processing work.", code="ALREADY_PROCESSING")
        audit.record(actor, "document.processing_started", document, {}, request)
        if enabled() and not getattr(settings, "PROCESS_DOCUMENTS_INLINE", False):
            enqueue("document_parse", str(document.id), {"document_id": str(document.id), "actor_id": str(actor.id)},
                    unique=f"document:{document.id}:{document.processing_started_at.isoformat()}")
    if not enabled() or getattr(settings, "PROCESS_DOCUMENTS_INLINE", False):
        if settings.TESTING or getattr(settings, "PROCESS_DOCUMENTS_INLINE", False):
            run_processing(document.id)
        else:
            _launch(document.id)
    document.refresh_from_db()
    return document


# ---------- review & editing ----------

def _bump_version(document, actor):
    document.content_version += 1
    document.last_edited_by = actor
    document.last_edited_at = timezone.now()
    document.save(update_fields=["content_version", "last_edited_by", "last_edited_at", "updated_at"])


def _outline_fingerprint(document):
    """What students read: chapter and module identity, order, titles and text.
    Used to tell a real outline edit from a save that changed nothing."""
    import hashlib

    rows = [("c", str(c.id), c.order, c.title) for c in document.chapters.order_by("order", "id")]
    rows += [("m", str(m.id), str(m.chapter_id), m.order, m.title,
              hashlib.sha256((m.source_text or "").encode()).hexdigest())
             for m in Module.objects.filter(chapter__document=document).order_by("chapter_id", "order", "id")]
    return hashlib.sha256(repr(rows).encode()).hexdigest()


@transaction.atomic
def replace_outline(actor, document, outline, request=None):
    _require_manage(actor, document.subject)
    if document.status not in EDITABLE_STATUSES:
        raise Conflict(f"The outline cannot be edited while the document is '{document.status}'.", code="INVALID_STATE")
    # A published book stays editable. Structure changes reach students on
    # their next load, which is the point of editing a live book, and the
    # deletion guard in persist_outline still refuses to remove a module that
    # has student progress or a quiz built on it.
    sections = load_processed_sections(document)
    before = _outline_fingerprint(document)
    report = outline_service.persist_outline(document, outline, sections, user_edited=True)
    document.outline_source = "edited"
    if document.status == DocumentStatus.READY:
        document.status = DocumentStatus.UNDER_REVIEW
    document.save(update_fields=["outline_source", "status", "updated_at"])
    # The content version keys every cached lesson, tutor answer and chunk set
    # for the book. A save that changed nothing students read must not throw
    # all of that away: on a CPU host each lesson costs tens of seconds to
    # regenerate.
    changed = _outline_fingerprint(document) != before
    if changed:
        _bump_version(document, actor)
    audit.record(actor, "document.outline_edited", document, {
        "version": document.content_version, "changed": changed,
        "empty_modules_removed": [m["title"] for m in report["removed_empty_modules"]]}, request)
    # New modules and modules whose text changed need a lesson; the rest keep
    # theirs (request_lessons compares each module's text with its lesson's).
    if changed:
        _queue_lessons_after_commit(document, "document.outline_edited")
    document.outline_report = report
    return document


def _queue_lessons_after_commit(document, reason, modules=None):
    def queue():
        from assessments.services import auto_quiz
        from tutor import lessons
        targets = modules if modules is not None else list(
            Module.objects.filter(chapter__document=document).select_related("chapter__document"))
        lessons.on_content_changed(targets, reason=reason)
        auto_quiz.on_content_changed(targets, reason=reason)
    transaction.on_commit(queue)


@transaction.atomic
def edit_chapter(actor, chapter, title=None, source_text=None, request=None):
    document = chapter.document
    _require_manage(actor, document.subject)
    if document.status not in EDITABLE_STATUSES:
        raise Conflict("Content cannot be edited in this state.", code="INVALID_STATE")
    changes = {}
    if title is not None and outline_service.clean_title(title):
        changes["title"] = [chapter.title, outline_service.clean_title(title)]
        chapter.title = outline_service.clean_title(title)
    if source_text is not None:
        changes["source_text"] = True
        chapter.source_text = source_text
    if changes:
        chapter.is_user_edited = True
        chapter.save()
        _bump_version(document, actor)
        audit.record(actor, "chapter.edited", chapter, changes, request)
    return chapter


@transaction.atomic
def edit_module(actor, module, title=None, source_text=None, request=None):
    document = module.chapter.document
    _require_manage(actor, document.subject)
    if document.status not in EDITABLE_STATUSES:
        raise Conflict("Content cannot be edited in this state.", code="INVALID_STATE")
    changes = {}
    if title is not None and outline_service.clean_title(title):
        changes["title"] = [module.title, outline_service.clean_title(title)]
        module.title = outline_service.clean_title(title)
    if source_text is not None:
        if not source_text.strip():
            # A module without text would be removed from the outline on the
            # next save and can never be opened by students, so it is refused
            # here rather than stored.
            raise ValidationFailed("A module needs source text. To take it out of the book, remove the module instead.",
                                   code="EMPTY_SOURCE_TEXT")
        changes["source_text"] = True
        module.source_text = source_text
        module.source_missing = False
        # Hand-edited text is an override. While the module stays mapped to a
        # heading, the next outline save refills it from that section and the
        # edit is silently lost (the outline screen already clears the mapping
        # client-side for the same reason; this makes the API behave the same).
        if module.source_heading_index is not None:
            changes["detached_from_heading"] = module.source_heading_index
            module.source_heading_index = None
    if changes:
        module.is_user_edited = True
        module.save()
        _bump_version(document, actor)
        audit.record(actor, "module.edited", module, changes, request)
        if "source_text" in changes:
            _queue_lessons_after_commit(document, "module.edited", modules=[module])
    return module


@transaction.atomic
def mark_ready(actor, document, request=None):
    _require_manage(actor, document.subject)
    if document.status != DocumentStatus.UNDER_REVIEW:
        raise Conflict("Only documents under review can be marked ready.", code="INVALID_STATE")
    _validate_publishable(document)
    document.status = DocumentStatus.READY
    document.reviewed_by = actor
    document.reviewed_at = timezone.now()
    document.save(update_fields=["status", "reviewed_by", "reviewed_at", "updated_at"])
    audit.record(actor, "document.reviewed", document, {}, request)
    return document


def _validate_publishable(document):
    if not document.chapters.exists():
        raise Conflict("Cannot publish a document with no chapters.", code="EMPTY_OUTLINE")
    # Modules without text are removed when the outline is saved; the only ones
    # left are those student work refers to, which stay hidden from students,
    # so they no longer block publishing.
    if not Module.objects.filter(chapter__document=document, source_missing=False).exists():
        raise Conflict("Cannot publish a document with no modules.", code="NO_MODULES")


@transaction.atomic
def publish(actor, document, request=None):
    _require_manage(actor, document.subject)
    if actor.role == "faculty" and not settings.LOCALMIND["FACULTY_CAN_PUBLISH"]:
        raise Forbidden("Publishing is restricted to administrators.", code="PUBLISH_ADMIN_ONLY")
    if document.status not in (DocumentStatus.UNDER_REVIEW, DocumentStatus.READY, DocumentStatus.UNPUBLISHED):
        raise Conflict(f"A document in state '{document.status}' cannot be published.", code="INVALID_STATE")
    _validate_publishable(document)
    now = timezone.now()
    if document.reviewed_at is None:
        document.reviewed_by, document.reviewed_at = actor, now
    document.status = DocumentStatus.PUBLISHED
    document.published_by, document.published_at, document.unpublished_at = actor, now, None
    document.save()
    audit.record(actor, "document.published", document, {"version": document.content_version}, request)
    # Lessons were queued at processing time; this only fills gaps (auto
    # generation switched on since, or a lesson that gave up after failures).
    _queue_lessons_after_commit(document, "document.published")
    from assessments.services import auto_quiz
    auto_quiz.publish_after_commit(Module.objects.filter(chapter__document=document))
    # Publishing is what makes a book visible to students, so open every module
    # that has source text. Faculty can still lock modules or chapters afterwards
    # to pace the course; a re-publish of a book that already has open modules
    # leaves their locks alone.
    if not Module.objects.filter(chapter__document=document, availability=ModuleAvailability.OPEN).exists():
        from learning import services as learning
        learning.open_modules_for_publish(actor, list(Module.objects.filter(chapter__document=document)), "document.published", target=document, request=request)
    return document


@transaction.atomic
def unpublish(actor, document, request=None):
    _require_manage(actor, document.subject)
    if document.status != DocumentStatus.PUBLISHED:
        raise Conflict("Only published documents can be unpublished.", code="INVALID_STATE")
    document.status = DocumentStatus.UNPUBLISHED
    document.unpublished_at = timezone.now()
    document.save(update_fields=["status", "unpublished_at", "updated_at"])
    audit.record(actor, "document.unpublished", document, {}, request)
    return document


@transaction.atomic
def delete_document(actor, document, request=None):
    """Permanently remove a book and everything built from it.

    Quizzes and assignments point at Chapter and Module with PROTECT, so those
    are cleared first; chapters, modules, lessons, conversations and progress
    then cascade when the document row goes. The uploaded file and the parsed
    markdown are removed from disk too, since nothing else refers to them.
    """
    import shutil

    from assessments.models import Assessment, AssessmentAttempt
    from assignments.models import Assignment, AssignmentSubmission

    _require_manage(actor, document.subject)
    from study.models import ContentBlock, StudyAsset, StudyPackage, StudyQuestion
    if (ContentBlock.objects.filter(module__chapter__document=document).exists() or StudyAsset.objects.filter(document=document).exists()
            or StudyPackage.objects.filter(document=document).exists() or StudyQuestion.objects.filter(document=document).exists()):
        raise Conflict("This book has versioned study material. Archive it instead of deleting its source history.", code="STUDY_HISTORY_IN_USE")
    if document.status == DocumentStatus.PROCESSING:
        raise Conflict("Wait for processing to finish before deleting this book.", code="INVALID_STATE")

    label = document.title or document.original_name
    scope = {"chapter__document": document}
    scope_module = {"module__chapter__document": document}

    assignments = Assignment.objects.filter(**scope) | Assignment.objects.filter(**scope_module)
    AssignmentSubmission.objects.filter(assignment__in=assignments).delete()
    assignments.delete()

    assessments = Assessment.objects.filter(**scope) | Assessment.objects.filter(**scope_module)
    AssessmentAttempt.objects.filter(assessment__in=assessments).delete()
    assessments.delete()

    try:
        if document.file:
            document.file.delete(save=False)
    except Exception:  # a missing file must not block the delete
        logger.warning("Could not remove the stored file for document %s", document.pk)
    processed_dir = Path(settings.MEDIA_ROOT) / "processed" / str(document.id)
    shutil.rmtree(processed_dir, ignore_errors=True)

    audit.record(actor, "document.deleted", document, {"subject": document.subject.code, "title": label}, request)
    document.delete()
    return label


@transaction.atomic
def archive(actor, document, request=None):
    _require_manage(actor, document.subject)
    if document.status == DocumentStatus.ARCHIVED:
        raise Conflict("Already archived.", code="INVALID_STATE")
    if document.status == DocumentStatus.PROCESSING:
        raise Conflict("Wait for processing to finish before archiving.", code="INVALID_STATE")
    document.status = DocumentStatus.ARCHIVED
    document.archived_at = timezone.now()
    document.save(update_fields=["status", "archived_at", "updated_at"])
    audit.record(actor, "document.archived", document, {}, request)
    return document


# ---------- module availability ----------

@transaction.atomic
def set_module_availability(actor, module, availability, request=None):
    document = module.chapter.document
    _require_manage(actor, document.subject)
    if availability not in ModuleAvailability.values:
        raise ValidationFailed(details={"availability": "Must be 'open' or 'locked'."})
    if availability == ModuleAvailability.OPEN and module.source_missing:
        raise Conflict("A module without source text cannot be opened.", code="MODULE_SOURCE_MISSING")
    if module.availability == availability:
        return module
    module.availability = availability
    if availability == ModuleAvailability.OPEN:
        module.opened_by, module.opened_at = actor, timezone.now()
    module.save(update_fields=["availability", "opened_by", "opened_at", "updated_at"])
    if availability == ModuleAvailability.OPEN:
        # Its automatic quiz goes live with it.
        from assessments.services import auto_quiz
        auto_quiz.publish_after_commit([module])
    audit.record(actor, f"module.{'opened' if availability == 'open' else 'locked'}", module, {"document": str(document.id)}, request)
    return module


@transaction.atomic
def set_chapter_availability(actor, chapter, availability, request=None):
    modules = list(chapter.modules.all())
    for module in modules:
        if availability == ModuleAvailability.OPEN and module.source_missing:
            continue
        set_module_availability(actor, module, availability, request)
    return modules
