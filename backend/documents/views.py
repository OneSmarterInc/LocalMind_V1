from django.db.models import Count
from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from academics.models import Subject
from core.exceptions import APIError
from core.permissions import IsAdminOrFaculty
from core.utils import get_or_404
from learning.models import Chapter, Module

from .models import Document, DocumentStatus
from .serializers import (
    AvailabilitySerializer, ChapterSerializer, ContentEditSerializer, DocumentDetailSerializer, DocumentSerializer,
    ModuleSerializer, OutlineInSerializer, UploadSerializer,
)
from .services import documents as svc


def _docs_for(user):
    return Document.objects.visible_to(user).select_related("subject", "uploaded_by", "published_by")


def _doc(user, document_id):
    return get_or_404(_docs_for(user).prefetch_related("chapters__modules"), pk=document_id)


class DocumentListUploadView(ListAPIView):
    """GET lists books the caller manages; POST uploads one to a subject."""

    permission_classes = [IsAdminOrFaculty]
    serializer_class = DocumentSerializer
    parser_classes = [MultiPartParser, FormParser]

    def get_queryset(self):
        qs = _docs_for(self.request.user).annotate(chapter_count=Count("chapters", distinct=True),
                                                    module_count=Count("chapters__modules", distinct=True))
        params = self.request.query_params
        if params.get("subject"):
            qs = qs.filter(subject_id=params["subject"])
        if params.get("status"):
            qs = qs.filter(status=params["status"])
        # The chapter and module counts drop the model's default ordering; a
        # paged list with no order can repeat or skip books between pages.
        return qs.order_by("-created_at", "id")

    def post(self, request):
        serializer = UploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        subject = get_or_404(Subject.objects.visible_to(request.user), pk=data["subject_id"])
        document = svc.upload_document(request.user, subject, data["file"], data.get("title", ""), request)
        return Response(DocumentSerializer(document).data, status=status.HTTP_201_CREATED)


def _detail(user, document_id):
    """The document with its outline and each module's lesson loaded in a
    handful of queries; the book screen polls this while lessons generate."""
    document = _doc(user, document_id)
    return (Document.objects.select_related("subject", "uploaded_by", "published_by")
            .prefetch_related("chapters__modules__lesson", "chapters__modules__auto_quiz_job").get(pk=document.pk))


class DocumentDetailView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def get(self, request, document_id):
        return Response(DocumentDetailSerializer(_detail(request.user, document_id)).data)

    def delete(self, request, document_id):
        """Permanent delete. Replaces the old archive action in the workspace."""
        document = _doc(request.user, document_id)
        label = svc.delete_document(request.user, document, request)
        return Response({"detail": f"{label} was deleted."})


class _Transition(APIView):
    permission_classes = [IsAdminOrFaculty]
    action = None

    def post(self, request, document_id):
        document = _doc(request.user, document_id)
        document = getattr(svc, self.action)(request.user, document, request)
        return Response(DocumentDetailSerializer(document).data)


class ProcessView(APIView):
    """Returns the document in 'processing' (background) or its final state
    when processing ran inline; an inline failure is reported as 422."""

    permission_classes = [IsAdminOrFaculty]

    def post(self, request, document_id):
        document = _doc(request.user, document_id)
        document = svc.start_processing(request.user, document, request)
        if document.status == DocumentStatus.ERROR:
            raise APIError("Document processing failed.", code="PROCESSING_FAILED", status_code=422,
                           details={"document_id": str(document.id), "error": document.error_message})
        return Response(DocumentDetailSerializer(_doc(request.user, document_id)).data)


class MarkReadyView(_Transition):
    action = "mark_ready"


class PublishView(_Transition):
    action = "publish"


class UnpublishView(_Transition):
    action = "unpublish"


class ArchiveView(_Transition):
    action = "archive"


class OutlineView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def get(self, request, document_id):
        document = _doc(request.user, document_id)
        chapters = document.chapters.prefetch_related("modules__lesson", "modules__auto_quiz_job")
        return Response({"document_id": str(document.id), "document_title": document.title, "status": document.status,
                         "outline_source": document.outline_source, "headings": document.extracted_headings,
                         "chapters": ChapterSerializer(chapters, many=True).data})

    def put(self, request, document_id):
        document = _doc(request.user, document_id)
        serializer = OutlineInSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        document = svc.replace_outline(request.user, document, serializer.validated_data, request)
        # What the save dropped because it had no source text, so the screen
        # can say so instead of modules silently vanishing.
        report = getattr(document, "outline_report", None) or {}
        return Response({**DocumentDetailSerializer(_detail(request.user, document_id)).data, "outline_report": report})


class ChapterEditView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def patch(self, request, chapter_id):
        chapter = get_or_404(Chapter.objects.filter(document__in=_docs_for(request.user)).select_related("document__subject"), pk=chapter_id)
        serializer = ContentEditSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        chapter = svc.edit_chapter(request.user, chapter, request=request, **serializer.validated_data)
        return Response(ChapterSerializer(chapter).data)


class ChapterAvailabilityView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def post(self, request, chapter_id):
        chapter = get_or_404(Chapter.objects.filter(document__in=_docs_for(request.user)).select_related("document__subject"), pk=chapter_id)
        serializer = AvailabilitySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        modules = svc.set_chapter_availability(request.user, chapter, serializer.validated_data["availability"], request)
        return Response(ModuleSerializer(modules, many=True).data)


class ModuleLessonView(APIView):
    """GET: the module's lesson and where it is in the queue, for faculty to
    preview. POST: generate it again (for example after a poor result)."""

    permission_classes = [IsAdminOrFaculty]

    def _module(self, request, module_id):
        return get_or_404(Module.objects.filter(chapter__document__in=_docs_for(request.user))
                          .select_related("chapter__document__subject"), pk=module_id)

    def get(self, request, module_id):
        from tutor import lessons
        return Response(lessons.detail_for_faculty(self._module(request, module_id)))

    def post(self, request, module_id):
        from audit import services as audit
        from tutor import lessons
        module = self._module(request, module_id)
        if not lessons.has_text(module):
            raise APIError("This module has no source text, so there is nothing to build a lesson from.",
                           code="EMPTY_SOURCE_TEXT", status_code=400)
        lessons.request_lessons([module], force=True, reason="faculty.regenerate")
        audit.record(request.user, "lesson.regenerate_requested", module, {}, request)
        return Response(lessons.detail_for_faculty(module), status=status.HTTP_202_ACCEPTED)


class ModuleAutoQuizView(APIView):
    """POST: write the module's automatic quiz again (queued in the background)."""

    permission_classes = [IsAdminOrFaculty]

    def post(self, request, module_id):
        from assessments.services import auto_quiz
        from audit import services as audit
        from tutor import lessons
        module = get_or_404(Module.objects.filter(chapter__document__in=_docs_for(request.user)).select_related("chapter__document"), pk=module_id)
        if not lessons.has_text(module):
            raise APIError("This module has no source text, so there is nothing to write a quiz from.", code="EMPTY_SOURCE_TEXT", status_code=400)
        auto_quiz.request_quizzes([module], force=True, reason="faculty.regenerate_quiz")
        audit.record(request.user, "auto_quiz.regenerate_requested", module, {}, request)
        return Response({"module_id": str(module.id), "quiz_status": auto_quiz.state_for(module)}, status=status.HTTP_202_ACCEPTED)


class DocumentAutoQuizzesView(APIView):
    """POST: queue automatic quizzes for every module of a book that lacks one."""

    permission_classes = [IsAdminOrFaculty]

    def post(self, request, document_id):
        from assessments.services import auto_quiz
        from audit import services as audit
        document = _doc(request.user, document_id)
        modules = list(Module.objects.filter(chapter__document=document).select_related("chapter__document"))
        queued = auto_quiz.request_quizzes(modules, reason="faculty.generate_quizzes")
        audit.record(request.user, "auto_quiz.generate_requested", document, {"queued": queued}, request)
        return Response({"queued": queued, **auto_quiz.summary_for_document(document)}, status=status.HTTP_202_ACCEPTED)


class DocumentLessonsView(APIView):
    """POST: queue lessons for every module of a book that lacks a current one
    (``{"force": true}`` regenerates all of them). Returns the book's counts."""

    permission_classes = [IsAdminOrFaculty]

    def post(self, request, document_id):
        from audit import services as audit
        from tutor import lessons
        document = _doc(request.user, document_id)
        force = str(request.data.get("force", "")).lower() in ("1", "true", "yes")
        queued = lessons.request_for_document(document, force=force, reason="faculty.generate_all")
        audit.record(request.user, "lessons.generate_requested", document, {"queued": queued, "force": force}, request)
        return Response({"queued": queued, **lessons.summary_for_document(document)}, status=status.HTTP_202_ACCEPTED)


class ModuleEditView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def get(self, request, module_id):
        module = get_or_404(Module.objects.filter(chapter__document__in=_docs_for(request.user)), pk=module_id)
        return Response(ModuleSerializer(module).data)

    def patch(self, request, module_id):
        module = get_or_404(Module.objects.filter(chapter__document__in=_docs_for(request.user)).select_related("chapter__document__subject"), pk=module_id)
        serializer = ContentEditSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        module = svc.edit_module(request.user, module, request=request, **serializer.validated_data)
        return Response(ModuleSerializer(module).data)


class ModuleAvailabilityView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def post(self, request, module_id):
        module = get_or_404(Module.objects.filter(chapter__document__in=_docs_for(request.user)).select_related("chapter__document__subject"), pk=module_id)
        serializer = AvailabilitySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        module = svc.set_module_availability(request.user, module, serializer.validated_data["availability"], request)
        return Response(ModuleSerializer(module).data)
