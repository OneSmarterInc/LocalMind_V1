"""Bounded, account-owned staging for resumable source transfers."""
import hashlib
import re
from datetime import timedelta
from pathlib import Path
from uuid import UUID
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import TemporaryUploadedFile
from django.db import transaction
from django.utils import timezone
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from academics.models import Subject
from core.exceptions import Conflict, ValidationFailed
from core.permissions import IsAdminOrFaculty
from core.utils import get_or_404
from .models import Document, LocalAuthoringReceipt, LocalBookUpload, LocalBookUploadChunk
from .services.documents import _require_manage

CHUNK_BYTES = 1024 * 1024


def authorize(actor, subject_id):
    get_user_model().objects.select_for_update().get(pk=actor.pk)
    subject = get_or_404(Subject.objects.select_for_update(), pk=subject_id)
    _require_manage(actor, subject)
    if subject.status != 'active':
        raise Conflict('This subject is no longer active.')
    return subject


class BookTransferView(APIView):
    permission_classes = [IsAdminOrFaculty]

    @transaction.atomic
    def post(self, request):
        data = request.data
        try:
            operation = UUID(str(data['id']))
            subject_id = UUID(str(data['subject_id']))
        except (KeyError, ValueError, TypeError):
            raise ValidationFailed('Invalid transfer operation or subject.')
        subject = authorize(request.user, subject_id)
        size, name, sha = data.get('size'), data.get('name'), data.get('sha256')
        if type(size) is not int or not 0 < size <= settings.LOCALMIND['MAX_UPLOAD_MB'] * CHUNK_BYTES:
            raise ValidationFailed('Invalid source file size.')
        if not isinstance(name, str) or not 1 <= len(name) <= 300 or Path(name).name != name or Path(name).suffix.lower() not in ('.pdf', '.docx'):
            raise ValidationFailed('Choose a PDF or DOCX source file.')
        if not isinstance(sha, str) or not re.fullmatch('[0-9a-f]{64}', sha):
            raise ValidationFailed('Invalid source checksum.')
        receipt = LocalAuthoringReceipt.objects.filter(actor=request.user, operation_id=operation).first()
        if receipt:
            document = get_or_404(Document.objects.visible_to(request.user), pk=receipt.response.get('document_id'))
            if document.subject_id != subject.pk or document.content_hash != sha or document.file_size != size:
                raise Conflict('This operation already belongs to another source.')
            return Response({'received': size, 'chunk_bytes': CHUNK_BYTES, 'completed': True})
        # Staging is limited per account; expired work can be sent again from
        # the durable original on the device. Never delete completed documents.
        LocalBookUpload.objects.filter(actor=request.user, updated_at__lt=timezone.now()-timedelta(days=7)).delete()
        upload = LocalBookUpload.objects.filter(actor=request.user, operation_id=operation).first()
        if upload:
            if (upload.subject_id, upload.original_name, upload.sha256, upload.size) != (subject.pk, name, sha, size):
                raise Conflict('The transfer metadata changed. Keep the original operation unchanged.')
            upload.save(update_fields=['updated_at'])
        else:
            if LocalBookUpload.objects.filter(actor=request.user).count() >= 4:
                raise Conflict('Finish or cancel an existing book transfer before starting another.')
            upload = LocalBookUpload.objects.create(actor=request.user, subject=subject, operation_id=operation,
                                                    original_name=name, sha256=sha, size=size)
        return Response({'received': upload.received, 'chunk_bytes': CHUNK_BYTES, 'completed': False})


class BookChunkView(APIView):
    permission_classes = [IsAdminOrFaculty]
    parser_classes = [MultiPartParser]

    @transaction.atomic
    def post(self, request, operation_id):
        get_user_model().objects.select_for_update().get(pk=request.user.pk)
        upload = get_or_404(LocalBookUpload.objects.select_for_update(), actor=request.user, operation_id=operation_id)
        authorize(request.user, upload.subject_id)
        try:
            offset = int(request.data.get('offset', ''))
        except (ValueError, TypeError):
            raise ValidationFailed('Invalid chunk offset.')
        chunk = request.FILES.get('chunk')
        if chunk is None or not 0 < chunk.size <= CHUNK_BYTES:
            raise ValidationFailed('A chunk must contain between 1 byte and 1 MB.')
        raw = chunk.read()
        if hashlib.sha256(raw).hexdigest() != request.data.get('sha256'):
            raise ValidationFailed('Chunk checksum mismatch. Retry this part.')
        if offset < upload.received:
            old = upload.chunks.filter(offset=offset).first()
            if old and bytes(old.data) == raw:
                return Response({'received': upload.received})
            raise Conflict('This chunk differs from the saved part.')
        if offset != upload.received or offset + len(raw) > upload.size:
            raise Conflict('Resume from the saved transfer position.', code='TRANSFER_OFFSET', details={'received': upload.received})
        if upload.chunks.count() >= 1024:
            raise ValidationFailed('Too many chunks in this transfer. Remove its staged copy and retry.')
        LocalBookUploadChunk.objects.create(upload=upload, offset=offset, data=raw)
        upload.received += len(raw)
        upload.save(update_fields=['received', 'updated_at'])
        return Response({'received': upload.received})

    @transaction.atomic
    def delete(self, request, operation_id):
        get_user_model().objects.select_for_update().get(pk=request.user.pk)
        # Owners can clean their temporary bytes even after subject revocation.
        LocalBookUpload.objects.filter(actor=request.user, operation_id=operation_id).delete()
        return Response(status=204)


def assembled_file(actor, operation, subject, expected_hash, stack):
    upload = get_or_404(LocalBookUpload.objects.select_for_update(), actor=actor, operation_id=operation)
    if upload.subject_id != subject.pk or upload.sha256 != expected_hash:
        raise Conflict('The staged file does not match this book.')
    if upload.received != upload.size:
        raise Conflict('The source transfer is not complete.', code='TRANSFER_INCOMPLETE')
    output = TemporaryUploadedFile(upload.original_name, 'application/octet-stream', upload.size, None)
    stack.callback(output.close)
    position = 0
    for chunk in upload.chunks.order_by('offset').iterator(chunk_size=1):
        if chunk.offset != position:
            raise Conflict('The staged source is incomplete. Retry its transfer.')
        output.write(bytes(chunk.data))
        position += len(chunk.data)
    if position != upload.size:
        raise Conflict('The staged source size is inconsistent.')
    output.seek(0)
    return output, upload
