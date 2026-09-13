import hashlib
import zipfile
from pathlib import Path
from django.db.models import Q
from django.http import FileResponse
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema, OpenApiTypes
from academics.models import Subject
from core.permissions import IsAdminOrFaculty, IsStudent
from core.exceptions import ValidationFailed, NotFound
from documents.models import Document
from .models import SharedBook

MAX_BYTES = 35 * 1024 * 1024

class UploadSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=300)
    file = serializers.FileField()
    subject_id = serializers.UUIDField(required=False)
    share_confirmed = serializers.BooleanField()

class ActiveSerializer(serializers.Serializer):
    active = serializers.BooleanField()

def subjects_for(user):
    return Subject.objects.active().visible_to(user)

def shared_for(user, manage=False):
    qs = SharedBook.objects.select_related("subject")
    if user.role == "admin":
        return qs
    subjects = subjects_for(user)
    if manage:
        return qs.filter(subject__in=subjects)
    return qs.filter(active=True).filter(Q(subject__isnull=True) | Q(subject__in=subjects))

def record(book, kind):
    course = kind == "course"
    return {
        "id": str(book.id), "kind": kind, "title": book.title or book.original_name,
        "original_name": book.original_name, "file_size": book.file_size,
        "sha256": book.content_hash if course else book.sha256,
        "active": True if course else book.active,
        "subject": book.subject.name if book.subject_id else "All students",
        "subject_id": str(book.subject_id) if book.subject_id else None,
        "version": book.content_version if course else 1,
    }

def check_file(upload):
    if not 0 < upload.size <= MAX_BYTES:
        raise ValidationFailed("Choose a nonempty book of at most 35 MB.")
    suffix = Path(upload.name).suffix.lower()
    if suffix not in (".pdf", ".docx", ".txt", ".md"):
        raise ValidationFailed("Use a text-based PDF, DOCX, TXT or Markdown file.")
    head = upload.read(8); upload.seek(0)
    if suffix == ".pdf" and not head.startswith(b"%PDF-"):
        raise ValidationFailed("This file is not a PDF.")
    if suffix == ".docx":
        try:
            with zipfile.ZipFile(upload) as z:
                infos = z.infolist()
                if len(infos) > 3000 or sum(i.file_size for i in infos) > 100 * 1024 * 1024:
                    raise ValueError("too large")
                if "word/document.xml" not in z.namelist() or "[Content_Types].xml" not in z.namelist():
                    raise ValueError("not a Word document")
        except (zipfile.BadZipFile, ValueError):
            raise ValidationFailed("This is not a supported DOCX file or its expanded content is too large.")
        finally:
            upload.seek(0)
    if suffix in (".txt", ".md"):
        try:
            data = upload.read().decode("utf-8-sig")
            if not data.strip() or "\0" in data:
                raise ValueError("no text")
        except (UnicodeError, ValueError):
            raise ValidationFailed("Text files must contain readable UTF-8 text.")
        finally:
            upload.seek(0)
    digest = hashlib.sha256()
    for chunk in upload.chunks(): digest.update(chunk)
    upload.seek(0)
    return digest.hexdigest()

def no_cache(response):
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response

class StaffBooks(APIView):
    permission_classes = [IsAdminOrFaculty]
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return no_cache(Response([record(b,"shared") for b in shared_for(request.user, True)]))
    @extend_schema(request=UploadSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        data = UploadSerializer(data=request.data); data.is_valid(raise_exception=True); value=data.validated_data
        if not value["share_confirmed"]:
            raise ValidationFailed("Confirm that students may keep an unlocked private copy of this book.")
        subject = None
        if value.get("subject_id"):
            subject = subjects_for(request.user).filter(pk=value["subject_id"]).first()
            if not subject: raise NotFound("Subject not found.")
        elif request.user.role != "admin":
            raise ValidationFailed("Faculty must choose an assigned subject.")
        uploaded = value["file"]
        digest = check_file(uploaded)
        book = SharedBook(title=value["title"], subject=subject, uploaded_by=request.user,
                          original_name=Path(uploaded.name).name[:300], sha256=digest, file_size=uploaded.size)
        # File storage is not transactional: explicitly clean up a failed database save.
        try:
            book.file.save(book.original_name, uploaded, save=False); book.save()
        except Exception:
            if book.file.name: book.file.delete(save=False)
            raise
        return no_cache(Response(record(book,"shared"), status=201))

class StaffBookDetail(APIView):
    permission_classes = [IsAdminOrFaculty]
    @extend_schema(request=ActiveSerializer, responses=OpenApiTypes.OBJECT)
    def patch(self, request, book_id):
        book = shared_for(request.user, True).filter(pk=book_id).first()
        if not book: raise NotFound("Book not found.")
        data=ActiveSerializer(data=request.data); data.is_valid(raise_exception=True)
        book.active=data.validated_data["active"]; book.save(update_fields=["active", "updated_at"])
        return no_cache(Response(record(book,"shared")))

class StudentBooks(APIView):
    permission_classes = [IsStudent]
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        own=[record(b,"shared") for b in shared_for(request.user)]
        # Published faculty books only, with active enrollment. Module progression
        # is intentionally not used for the student's separate, unlocked private copy.
        courses=Document.objects.visible_to(request.user).select_related("subject").exclude(file="")
        own.extend(record(b,"course") for b in courses if Path(b.original_name).suffix.lower() in (".pdf", ".docx", ".txt", ".md"))
        return no_cache(Response(own))

class DownloadBook(APIView):
    permission_classes = [IsStudent]
    @extend_schema(responses=OpenApiTypes.BINARY)
    def get(self, request, kind, book_id):
        if kind == "course":
            book=Document.objects.visible_to(request.user).filter(pk=book_id).first()
        elif kind == "shared":
            book=shared_for(request.user).filter(pk=book_id).first()
        else:
            book=None
        if not book or not book.file: raise NotFound("Book not available.")
        try:
            f=book.file.open("rb")
        except (OSError, ValueError):
            raise NotFound("The book file is unavailable. Contact the person who shared it.")
        response=FileResponse(f, as_attachment=True, filename=Path(book.original_name).name,
                              content_type="application/octet-stream")
        # Metadata is taken from the current DB version, not caller-supplied hashes.
        response["X-Book-SHA256"]=book.content_hash if kind == "course" else book.sha256
        return no_cache(response)
