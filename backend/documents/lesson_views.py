"""Visual-aware faculty/admin lesson preview endpoints."""
from rest_framework.response import Response
from rest_framework.views import APIView
from core.permissions import IsAdminOrFaculty
from .services.visual_delivery import enrich_lesson, module_visuals
from learning.models import Module
from core.utils import get_or_404
from . import views as base_views

# Thumbnails are inlined as data URLs, so the staff report shows a bounded set
# rather than every picture in a 500-visual book.
REPORT_THUMBNAILS = 24


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


class ModuleVisualsView(APIView):
    """Every source picture assigned to one module, for faculty and admin review.

    Faculty could previously only see extracted pictures inside a generated
    lesson, so a book whose lessons had not been written yet looked as though
    nothing had been extracted at all.
    """
    permission_classes = [IsAdminOrFaculty]

    def get(self, request, module_id):
        module = get_or_404(Module.objects.filter(chapter__document__in=base_views._docs_for(request.user))
                            .select_related("chapter__document"), pk=module_id)
        return Response({"module_id": str(module.pk), "visuals": module_visuals(module)})


class DocumentVisualReportView(APIView):
    """Read-only staff report; never expose another subject's private visuals."""
    permission_classes = [IsAdminOrFaculty]

    def get(self, request, document_id):
        document = base_views._doc(request.user, document_id)
        thumbnails, shown = [], 0
        for module in Module.objects.filter(chapter__document=document).select_related("chapter__document").order_by("chapter__order", "order"):
            if shown >= REPORT_THUMBNAILS:
                break
            for row in module_visuals(module)[:REPORT_THUMBNAILS - shown]:
                thumbnails.append({**{k: row.get(k) for k in ("id", "kind", "page", "caption", "width", "height", "data_url")},
                                   "module_id": str(module.pk), "module_title": module.title})
                shown += 1
        return Response({"document_id": str(document.pk), "title": document.title,
                         "report": document.visual_report, "thumbnails": thumbnails,
                         "thumbnail_limit": REPORT_THUMBNAILS})
