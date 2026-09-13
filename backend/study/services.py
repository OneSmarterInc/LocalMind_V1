"""Authoring, explicit review and immutable publication for the private runtime.

Existing classroom records are never rewritten by this module. Reconciliation
preserves exact, unchanged source blocks. It never fuzzy-remaps a question to a
different passage; retired dependencies must be reviewed again.
"""
import base64
import hashlib
import json
from collections import defaultdict, deque
from pathlib import Path

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from academics.models import faculty_manages_subject
from core.exceptions import Conflict, Forbidden, NotFound, ValidationFailed
from documents.models import Document
from learning.models import Module
from . import contracts as c
from .models import AuthoringState, BlockRevision, ContentBlock, StudyAsset, StudyPackage, StudyQuestion, TeachingAid


def document_for(actor, document_id):
    try:
        doc = Document.objects.select_related("subject").get(pk=document_id)
    except (Document.DoesNotExist, ValueError):
        raise NotFound("Book not found.")
    if not faculty_manages_subject(actor, doc.subject):
        raise Forbidden("You do not manage this book's subject.")
    return doc


def source_digest(document):
    return c.digest([
        [str(m.id), m.title, m.source_text, m.source_missing]
        for m in Module.objects.filter(chapter__document=document).order_by("chapter__order", "order", "id")])


def _revision(block):
    return BlockRevision.objects.get(block=block, revision=block.current_revision)


def _block_data(revision):
    return {"kind": revision.kind, "title": revision.title, "text": revision.text, "data": revision.data}


def validate_block(data, document):
    c.require(isinstance(data, dict) and set(data) == {"kind", "title", "text", "data"}, "Expected kind, title, text and data")
    c.require(data["kind"] in c.KINDS, "Unsupported block type")
    c.short_text(data["title"], 300, "block title")
    c.short_text(data["text"], c.MAX_BLOCK_CHARS, "bounded block text")
    c.require(isinstance(data["data"], dict), "Block data must be an object")
    if data["kind"] == "table":
        c.require(set(data["data"]) == {"rows"}, "Table data must contain rows")
        rows = data["data"]["rows"]
        c.require(isinstance(rows, list) and 1 <= len(rows) <= 100, "Invalid table rows")
        c.require(isinstance(rows[0], list) and 1 <= len(rows[0]) <= 20, "Invalid table width")
        for row in rows:
            c.require(isinstance(row, list) and len(row) == len(rows[0]), "Unequal table row lengths")
            for cell in row: c.short_text(cell, 1000, "table cell", optional=True)
        c.require(sum(len(cell) for row in rows for cell in row) <= c.MAX_BLOCK_CHARS, "Split this large table upstream")
    elif data["kind"] == "figure":
        c.require(set(data["data"]) == {"asset_id", "alt"}, "Figure data needs an asset_id and alt description")
        c.identifier(data["data"]["asset_id"])
        c.short_text(data["data"]["alt"], 500, "figure description")
        c.require(StudyAsset.objects.filter(pk=data["data"]["asset_id"], document=document).exists(), "Figure does not belong to this book")
    else:
        c.require(not data["data"], "This block type has no additional data fields")
    return data


def _store_revision(block, data):
    BlockRevision.objects.create(block=block, revision=block.current_revision, digest=c.digest(data), **data)


@transaction.atomic
def sync_source(actor, document):
    # Serialize authoring changes/publications on the same book on PostgreSQL
    # and use the existing IMMEDIATE transaction configuration on SQLite.
    Document.objects.select_for_update().get(pk=document.pk)
    current_digest = source_digest(document)
    state, _ = AuthoringState.objects.get_or_create(document=document, defaults={"policy": c.default_policy()})
    if state.source_digest == current_digest:
        return {"unchanged": True, "added": 0, "retired": 0}
    if state.source_digest and ContentBlock.objects.filter(module__chapter__document=document, active=True, origin="authored").exists():
        raise Conflict("The classroom source changed after blocks were edited. Review the changes; automatic replacement would discard authored material.", code="STUDY_SOURCE_CONFLICT")
    report = {"unchanged": False, "added": 0, "retired": 0}
    for module in Module.objects.filter(chapter__document=document).order_by("chapter__order", "order", "id"):
        candidates = c.blocks_from_markdown(module.source_text, module.title) if not module.source_missing else []
        existing = list(ContentBlock.objects.filter(module=module, active=True).order_by("position", "id"))
        by_digest = defaultdict(deque)
        for block in existing: by_digest[_revision(block).digest].append(block)
        kept = set()
        for pos, data in enumerate(candidates):
            validate_block(data, document)
            same = by_digest[c.digest(data)]
            if same:
                block = same.popleft()
                block.position = pos; block.save(update_fields=["position", "updated_at"])
            else:
                block = ContentBlock.objects.create(module=module, position=pos)
                _store_revision(block, data); report["added"] += 1
            kept.add(block.id)
        for block in existing:
            if block.id not in kept:
                block.active = False; block.save(update_fields=["active", "updated_at"]); report["retired"] += 1
    state.source_digest = current_digest
    state.save(update_fields=["source_digest", "updated_at"])
    return report


@transaction.atomic
def save_block(actor, document, module_id, data, block_id=None, expected_revision=None):
    Document.objects.select_for_update().get(pk=document.pk)
    validate_block(data, document)
    try:
        module = Module.objects.get(pk=module_id, chapter__document=document)
    except Module.DoesNotExist:
        raise NotFound("Module not found in this book.")
    if block_id:
        block = ContentBlock.objects.select_for_update().get(pk=block_id, module=module, active=True)
        if type(expected_revision) is not int or block.current_revision != expected_revision:
            raise Conflict("This block changed. Reload before saving.", code="STUDY_REVISION_CONFLICT")
        if _revision(block).digest == c.digest(data): return block
        block.current_revision += 1; block.origin = "authored"; block.save()
    else:
        position = (ContentBlock.objects.filter(module=module, active=True).aggregate(n=Max("position"))["n"] or 0) + 1
        block = ContentBlock.objects.create(module=module, position=position, origin="authored")
    _store_revision(block, data)
    return block


def resolve_refs(document, refs):
    c.require(isinstance(refs, list) and 1 <= len(refs) <= 3, "Reference 1-3 bounded source blocks")
    result = []
    seen = set()
    for ref in refs:
        c.require(isinstance(ref, dict) and set(ref) == {"id", "revision"}, "Invalid source reference")
        bid = c.identifier(ref["id"])
        c.require(bid not in seen and type(ref["revision"]) is int and ref["revision"] > 0, "Duplicate/invalid reference")
        seen.add(bid)
        try:
            block = ContentBlock.objects.get(pk=bid, active=True, module__chapter__document=document)
        except ContentBlock.DoesNotExist:
            raise ValueError("A source block was removed or belongs to another book")
        c.require(block.current_revision == ref["revision"], "A source block changed; review this question or teaching aid again")
        result.append(_revision(block))
    return result


def question_digest(q):
    return c.digest({"body": q.body, "references": q.references})


def question_valid(q):
    try:
        c.validate_question(q.body)
        revisions = resolve_refs(q.document, q.references)
        if q.body["type"] == "short":
            c.require(len("\n\n".join(r.text for r in revisions)) <= c.MAX_BLOCK_CHARS, "Short-answer references exceed the device budget; split the question upstream")
        quote = " ".join(q.body["quote"].split()).casefold()
        c.require(any(quote in " ".join(r.text.split()).casefold() for r in revisions), "The supporting quote is not in the referenced block")
        # The device judges against at most one block. Broader banks can still
        # reference several blocks, but the runtime refuses unbounded prompts.
        return True, ""
    except (ValueError, TypeError, KeyError) as exc:
        return False, str(exc)


@transaction.atomic
def save_question(actor, document, body, refs, question_id=None):
    Document.objects.select_for_update().get(pk=document.pk)
    c.validate_question(body); resolve_refs(document, refs)
    if question_id:
        q = StudyQuestion.objects.get(pk=question_id, document=document)
        q.body = body; q.references = refs; q.approved_digest = ""; q.approved_by = None; q.review = {}
    else:
        q = StudyQuestion(document=document, body=body, references=refs)
    valid, reason = question_valid(q)
    if not valid: raise ValidationFailed(reason)
    q.save()
    return q


@transaction.atomic
def approve_question(actor, q, expected_digest):
    Document.objects.select_for_update().get(pk=q.document_id)
    q.refresh_from_db()
    if expected_digest != question_digest(q): raise Conflict("This question changed. Review the current version.")
    valid, reason = question_valid(q)
    if not valid: raise ValidationFailed(reason)
    q.approved_digest = question_digest(q); q.approved_by = actor
    q.save(update_fields=["approved_digest", "approved_by", "updated_at"])
    return q


@transaction.atomic
def save_aid(actor, document, block_id, data):
    Document.objects.select_for_update().get(pk=document.pk)
    c.require(isinstance(data, dict) and set(data) == {"revision", "simpler_text", "examples", "diagnostics", "prerequisites"}, "Invalid teaching aid fields")
    block = ContentBlock.objects.get(pk=block_id, module__chapter__document=document, active=True)
    c.require(type(data["revision"]) is int and data["revision"] == block.current_revision, "The source block changed")
    c.short_text(data["simpler_text"], c.MAX_BLOCK_CHARS, "simpler explanation", optional=True)
    for name in ("examples", "diagnostics", "prerequisites"):
        c.require(isinstance(data[name], list) and len(data[name]) <= 3, "Use at most three linked teaching assets")
    examples = resolve_refs(document, data["examples"]) if data["examples"] else []
    c.require(all(r.kind == "worked_example" for r in examples), "Examples must link to worked-example blocks")
    if data["prerequisites"]: resolve_refs(document, data["prerequisites"])
    c.require(all(ref["id"] != str(block.id) for ref in data["prerequisites"] + data["examples"]), "A block cannot be its own teaching aid")
    diagnostics = []
    for qid in data["diagnostics"]:
        q = StudyQuestion.objects.get(pk=c.identifier(qid), document=document)
        valid, reason = question_valid(q)
        c.require(valid and q.approved_digest == question_digest(q), reason or "Approve the diagnostic question first")
        c.require(any(r["id"] == str(block.id) for r in q.references), "Diagnostic question must reference this block")
        diagnostics.append({"id": str(q.id), "digest": question_digest(q)})
    aid, _ = TeachingAid.objects.update_or_create(block=block, defaults={"block_revision": block.current_revision,
        "simpler_text": data["simpler_text"], "example_ids": data["examples"], "diagnostic_ids": diagnostics,
        "prerequisite_ids": data["prerequisites"], "reviewed_by": actor})
    return aid


def add_asset(document, raw, source_location="", caption=""):
    raw = c.png_bytes(raw)
    sha = hashlib.sha256(raw).hexdigest()
    existing = StudyAsset.objects.filter(document=document, digest=sha).first()
    if existing: return existing
    asset = StudyAsset(document=document, digest=sha, source_location=source_location[:300], caption=caption[:500])
    asset.file.save(f"{document.id}/{sha}.png", ContentFile(raw), save=False)
    asset.save()
    return asset


def import_word_figures(document):
    """Extract raster figure candidates upstream; faculty assigns and explains them.
    Do not guess which module an image belongs to from its filename.
    """
    import zipfile
    if document.file_type != "docx": raise ValidationFailed("This extractor accepts Word DOCX; upload reviewed PNG/JPEG figures for other sources.")
    out, skipped = [], []
    with zipfile.ZipFile(document.file.path) as z:
        names = [n for n in z.namelist() if n.startswith("word/media/")]
        if len(names) > 200: raise ValidationFailed("The document has more than 200 figure candidates; split it upstream.")
        for name in names:
            if z.getinfo(name).file_size > 8 * 1024 * 1024:
                skipped.append({"source": name, "reason": "Image exceeds 8 MB"}); continue
            try:
                asset = add_asset(document, z.read(name), source_location=name)
                out.append(str(asset.id))
            except (ValueError, OSError) as exc:
                skipped.append({"source": name, "reason": str(exc)})
    return {"assets": out, "skipped": skipped, "review_required": True}


def authoring_snapshot(document):
    state = AuthoringState.objects.filter(document=document).first()
    blocks = []
    for b in ContentBlock.objects.filter(module__chapter__document=document, active=True).select_related("module"):
        r = _revision(b)
        aid = TeachingAid.objects.filter(block=b).first()
        blocks.append({"id": str(b.id), "module_id": str(b.module_id), "module_title": b.module.title,
            "revision": b.current_revision, "position": b.position, **_block_data(r),
            "aids": {"revision": aid.block_revision, "simpler_text": aid.simpler_text, "examples": aid.example_ids,
                "diagnostics": [d["id"] for d in aid.diagnostic_ids], "prerequisites": aid.prerequisite_ids} if aid else None})
    questions = []
    for q in StudyQuestion.objects.filter(document=document).order_by("created_at", "id"):
        valid, reason = question_valid(q)
        questions.append({"id": str(q.id), "body": q.body, "references": q.references, "digest": question_digest(q),
            "approved": valid and q.approved_digest == question_digest(q), "error": reason, "review": q.review})
    return {"document_id": str(document.id), "title": document.title,
        "source_current": bool(state and state.source_digest == source_digest(document)), "source_digest": source_digest(document), "blocks": blocks,
        "modules": [{"id": str(m.id), "title": m.title} for m in Module.objects.filter(chapter__document=document).order_by("chapter__order", "order", "id")],
        "questions": questions, "policy": state.policy if state else c.default_policy(),
        "policy_proposal": state.policy_proposal if state else {},
        "assets": [{"id": str(a.id), "caption": a.caption, "source": a.source_location} for a in document.study_assets.all()],
        "packages": [{"version": p.version, "digest": p.digest, "created_at": p.created_at} for p in document.study_packages.all()]}


def payload_for(document, version):
    state = AuthoringState.objects.get(document=document)
    c.require(state.source_digest == source_digest(document), "Source text changed. Reconcile and review blocks before publication.")
    snap = authoring_snapshot(document)
    c.require(bool(snap["blocks"]), "Import or author content blocks first")
    c.require(all(q["approved"] for q in snap["questions"]), "Every question must have current source references and explicit approval")
    c.require(bool(snap["questions"]), "Approve at least one practice question before publishing")
    c.require(len(snap["blocks"]) <= 5000 and len(snap["questions"]) <= 10000 and len(snap["modules"]) <= 1000, "Split this course into smaller experimental packages")
    blocks = snap["blocks"]
    for block in blocks:
        block.pop("module_title", None); block.pop("position", None)
        validate_block({k: block[k] for k in ("kind", "title", "text", "data")}, document)
        aid = TeachingAid.objects.filter(block_id=block["id"]).first()
        block["aids"] = {"simpler_text": "", "examples": [], "diagnostics": [], "prerequisites": []}
        if aid:
            c.require(aid.block_revision == block["revision"], "A teaching aid refers to an old source revision")
            if aid.example_ids: resolve_refs(document, aid.example_ids)
            if aid.prerequisite_ids: resolve_refs(document, aid.prerequisite_ids)
            for ref in aid.diagnostic_ids:
                q = StudyQuestion.objects.get(pk=ref["id"], document=document)
                c.require(ref["digest"] == q.approved_digest == question_digest(q), "A diagnostic question changed; review its teaching aid")
            block["aids"] = {"simpler_text": aid.simpler_text, "examples": aid.example_ids,
                "diagnostics": [d["id"] for d in aid.diagnostic_ids], "prerequisites": aid.prerequisite_ids}
        if block["kind"] == "figure":
            asset = StudyAsset.objects.get(pk=block["data"].pop("asset_id"), document=document)
            with asset.file.open("rb") as f: raw = f.read(2 * 1024 * 1024 + 1)
            c.require(hashlib.sha256(raw).hexdigest() == asset.digest, "Figure bytes changed after review")
            block["data"]["png_base64"] = base64.b64encode(raw).decode()
    # Cyclic prerequisites would make the fifth teaching move an endless loop.
    graph = {b["id"]: [r["id"] for r in b["aids"]["prerequisites"]] for b in blocks}
    seen, visiting = set(), set()
    def visit(bid):
        c.require(len(visiting) < 64, "Prerequisites must not exceed 64 levels")
        c.require(bid not in visiting, "Prerequisite relationships contain a cycle")
        if bid in seen: return
        visiting.add(bid)
        for nxt in graph[bid]: visit(nxt)
        visiting.remove(bid); seen.add(bid)
    for bid in graph: visit(bid)
    modules = [{"id": str(m.id), "title": m.title, "chapter_title": m.chapter.title,
        "blocks": [b["id"] for b in blocks if b["module_id"] == str(m.id)]}
        for m in Module.objects.filter(chapter__document=document).select_related("chapter").order_by("chapter__order", "order", "id")]
    return {"format": c.FORMAT, "package_id": str(document.id), "version": version, "title": document.title,
        "created_at": timezone.now().isoformat(), "modules": [m for m in modules if m["blocks"]], "blocks": blocks,
        "questions": [{"id": q["id"], "body": q["body"], "references": q["references"]} for q in snap["questions"]],
        "policy": c.policy(state.policy), "prompts": {kind: "Explain the stored block in simple language. Do not add outside facts." for kind in c.KINDS}}


@transaction.atomic
def publish_package(actor, document):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    Document.objects.select_for_update().get(pk=document.pk)
    if actor.role != "admin" and not settings.LOCALMIND.get("FACULTY_CAN_PUBLISH", True):
        raise Forbidden("Only an administrator may publish study packages.")
    # No key generation at publication; provisioning and trusting a key is an explicit step.
    path = getattr(settings, "STUDY_SIGNING_KEY_PATH", "")
    key_id = getattr(settings, "STUDY_SIGNING_KEY_ID", "")
    if not path or not key_id: raise Conflict("Configure an external Ed25519 signing key before publishing.", code="STUDY_SIGNING_NOT_CONFIGURED")
    key = serialization.load_pem_private_key(Path(path).read_bytes(), password=None)
    c.require(isinstance(key, Ed25519PrivateKey), "Signing key must be Ed25519")
    version = (StudyPackage.objects.filter(document=document).aggregate(n=Max("version"))["n"] or 0) + 1
    envelope = c.sign_payload(payload_for(document, version), key, key_id)
    return StudyPackage.objects.create(document=document, version=version, envelope=c.canonical(envelope),
        digest=hashlib.sha256(envelope["payload"].encode()).hexdigest(), published_by=actor)


@transaction.atomic
def retire_block(document, block_id, expected_revision):
    Document.objects.select_for_update().get(pk=document.pk)
    block = ContentBlock.objects.get(pk=block_id, module__chapter__document=document, active=True)
    c.require(type(expected_revision) is int and block.current_revision == expected_revision, "Block changed; reload before retiring it")
    block.active = False
    block.save(update_fields=["active", "updated_at"])
    # Published packages hold their own immutable snapshots. Draft dependencies
    # deliberately become invalid until an author replaces or removes them.


@transaction.atomic
def remove_question(document, question_id):
    Document.objects.select_for_update().get(pk=document.pk)
    StudyQuestion.objects.get(pk=question_id, document=document).delete()


@transaction.atomic
def accept_source_review(document, expected_digest):
    Document.objects.select_for_update().get(pk=document.pk)
    current = source_digest(document)
    if current != expected_digest:
        raise Conflict("The classroom source changed again. Review the current revision.")
    state = AuthoringState.objects.get(document=document)
    state.source_digest = current
    state.save(update_fields=["source_digest", "updated_at"])


@transaction.atomic
def reorder_blocks(document, module_id, ids):
    Document.objects.select_for_update().get(pk=document.pk)
    blocks = list(ContentBlock.objects.filter(module_id=module_id, module__chapter__document=document, active=True))
    c.require(isinstance(ids, list) and len(ids) == len(blocks) and set(ids) == {str(b.id) for b in blocks}, "Order must contain every current block exactly once")
    for position, bid in enumerate(ids):
        ContentBlock.objects.filter(pk=bid).update(position=position, updated_at=timezone.now())


def import_pdf_figures(document):
    """Layout-detected PDF figure candidates, never student-side parsing.

    Requires pre-fetched Docling assets. No VLM descriptions and no network
    fallback are enabled. Faculty must place each candidate and author its
    explanation; detection is not a guarantee that every diagram was found.
    """
    import io
    import gc
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling_core.types.doc import PictureItem
    from documents.services.parser import docling_artifacts_dir
    from documents.services.documents import _processing_lock
    artifacts = docling_artifacts_dir()
    if artifacts is None:
        raise ValidationFailed("Fetch local Docling assets before extracting PDF figures: python manage.py fetch_model --docling")
    options = PdfPipelineOptions(artifacts_path=str(artifacts))
    options.generate_picture_images = True
    options.images_scale = 1.5
    options.do_ocr = False
    options.do_picture_description = False
    options.enable_remote_services = False
    out, skipped = [], []
    with _processing_lock:
        converter = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})
        result = None
        try:
            result = converter.convert(Path(document.file.path))
            candidates = [item for item, _ in result.document.iterate_items() if isinstance(item, PictureItem)]
            c.require(len(candidates) <= 200, "More than 200 detected figures; split the document upstream")
            for index, item in enumerate(candidates, 1):
                page = item.prov[0].page_no if item.prov else "unknown"
                source = f"Page {page}, detected picture {index}"
                try:
                    image = item.get_image(result.document)
                    c.require(image is not None, "Figure image could not be extracted")
                    output = io.BytesIO(); image.save(output, format="PNG")
                    asset = add_asset(document, output.getvalue(), source_location=source)
                    out.append(str(asset.id))
                except (ValueError, OSError) as exc:
                    skipped.append({"source": source, "reason": str(exc)})
        finally:
            del converter, result
            gc.collect()
    return {"assets": out, "skipped": skipped, "review_required": True,
            "note": "Detection may miss diagrams; compare with the original and upload missing figures manually."}


def import_figures(document):
    if document.file_type == "docx": return import_word_figures(document)
    if document.file_type == "pdf": return import_pdf_figures(document)
    raise ValidationFailed("Use PDF/DOCX or upload reviewed PNG/JPEG figures manually.")
