"""Accept a device-extracted book as an unpublished review draft. No AI jobs."""
import json
import re
from uuid import UUID
from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from academics.models import Subject, SubjectStatus
from core.exceptions import Conflict, ValidationFailed
from core.permissions import IsAdminOrFaculty
from core.utils import get_or_404
from learning.models import Chapter, Module
from .models import Document, DocumentStatus, LocalAuthoringReceipt
from .local_authoring import digest, revision, string
from .services.documents import _require_manage, file_digest, upload_document, validate_upload


class LocalBookView(APIView):
    permission_classes = [IsAdminOrFaculty]
    parser_classes = [MultiPartParser]

    @transaction.atomic
    def post(self, request):
        raw = request.data.get('manifest', '')
        if not isinstance(raw, str) or len(raw) > 3_000_000:
            raise ValidationFailed('Invalid book manifest.')
        try:
            data = json.loads(raw)
            operation = UUID(str(data['id']))
            subject_id = UUID(str(data['subject_id']))
        except (ValueError, TypeError, KeyError):
            raise ValidationFailed('A valid book operation and subject are required.')
        if not isinstance(data, dict) or data.get('reviewed') is not True:
            raise ValidationFailed('Review the extracted source before synchronizing the book.')
        get_user_model().objects.select_for_update().get(pk=request.user.pk)
        subject = get_or_404(Subject.objects.select_for_update(), pk=subject_id)
        _require_manage(request.user, subject)
        if subject.status != SubjectStatus.ACTIVE:
            raise Conflict('This subject is no longer active.')
        title = string(data.get('title'), 300, 'book title')
        expected_hash = data.get('sha256')
        if not isinstance(expected_hash, str) or not re.fullmatch(r'[0-9a-f]{64}', expected_hash):
            raise ValidationFailed('A source file checksum is required.')
        sections = data.get('sections')
        if not isinstance(sections, list) or not 1 <= len(sections) <= 10000:
            raise ValidationFailed('A book needs readable modules.')
        checked, ids, total = [], set(), 0
        for section in sections:
            if not isinstance(section, dict):
                raise ValidationFailed('Invalid module.')
            key = string(section.get('id'), 100, 'local module ID')
            if key in ids:
                raise ValidationFailed('Repeated local module ID.')
            ids.add(key)
            source = string(section.get('source'), 3200, 'module source')
            total += len(source)
            page = section.get('page')
            if page is not None and (type(page) is not int or not 1 <= page <= 100000):
                raise ValidationFailed('Invalid source page.')
            checked.append((key, string(section.get('title'), 300, 'module title'), source, page))
        if total > 2_000_000:
            raise ValidationFailed('The extracted source exceeds the supported book size.')
        fingerprint = digest({'kind': 'device-book', 'manifest': data})
        old = LocalAuthoringReceipt.objects.filter(actor=request.user, operation_id=operation).first()
        if old:
            if old.payload_hash != fingerprint:
                raise Conflict('This book operation was already used for different content.')
            # Replay must not restore a receipt for a removed/inaccessible document.
            get_or_404(Document.objects.visible_to(request.user), pk=old.response['document_id'])
            return Response(old.response)
        uploaded = request.FILES.get('file')
        if uploaded is None:
            raise ValidationFailed('The original source file is required.')
        validate_upload(uploaded)
        if file_digest(uploaded) != expected_hash:
            raise ValidationFailed('The original file checksum does not match. The book was not saved.')
        document = None
        try:
            document = upload_document(request.user, subject, uploaded, title, request)
            chapter = Chapter.objects.create(document=document, title=title, order=1)
            mappings = []
            for order, (key, heading, source, page) in enumerate(checked, 1):
                module = Module.objects.create(chapter=chapter, title=heading, order=order,
                                               source_text=source, start_page=page, end_page=page)
                mappings.append({'local_id': key, 'module_id': str(module.pk),
                                 'revision': revision(module)})
            document.status = DocumentStatus.UNDER_REVIEW
            document.parse_mode = 'device-local'
            document.outline_source = 'device_extracted'
            document.save(update_fields=['status', 'parse_mode', 'outline_source', 'updated_at'])
            output = {'document_id': str(document.pk), 'modules': mappings, 'status': document.status}
            LocalAuthoringReceipt.objects.create(actor=request.user, operation_id=operation,
                                                  payload_hash=fingerprint, response=output)
            return Response(output)
        except Exception:
            # File storage is outside the DB transaction; remove this operation's
            # newly created original if any later validation/write fails.
            if document is not None:
                document.file.delete(save=False)
            raise
