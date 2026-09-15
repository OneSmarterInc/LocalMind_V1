"""Visual-aware faculty/admin lesson preview endpoints."""
from rest_framework.response import Response
from rest_framework.views import APIView
from core.permissions import IsAdminOrFaculty
from .services.visual_delivery import enrich_lesson
from . import views as base_views


def _enrich(response, module):
    if isinstance(response.data, dict):
        response.data = {**response.data, "visual_report": module.chapter.document.visual_report,
                         "lesson": enrich_lesson(response.data.get("lesson"), module)}
        if response.data["lesson"] is not None:
            response.data["lesson"]["visual_review_document"] = str(module.chapter.document_id)
    return response


class ModuleLessonView(base_views.ModuleLessonView):
    def get(self, request, module_id):
        module = self._module(request, module_id)
        return _enrich(super().get(request, module_id), module)

    def post(self, request, module_id):
        module = self._module(request, module_id)
        return _enrich(super().post(request, module_id), module)


class DocumentVisualReportView(APIView):
    """Read-only staff report; never expose another subject's private visuals."""
    permission_classes = [IsAdminOrFaculty]

    def get(self, request, document_id):
        document = base_views._doc(request.user, document_id)
        return Response({"document_id": str(document.pk), "title": document.title,
                         "report": document.visual_report})
