"""Student content API. Only published, enrolled, open content is reachable."""
from rest_framework.response import Response
from rest_framework.views import APIView

from academics.models import Subject
from core.permissions import IsStudent
from core.utils import get_or_404

from . import services
from .models import Module, ProgressStatus


def _module_payload(module, progress, include_source):
    data = {
        "id": str(module.id), "chapter_id": str(module.chapter_id), "title": module.title, "order": module.order,
        "availability": module.availability, "start_page": module.start_page, "end_page": module.end_page,
        "progress": {
            "status": progress.status if progress else ProgressStatus.NOT_STARTED,
            "started_at": progress.started_at if progress else None,
            "completed_at": progress.completed_at if progress else None,
            "best_quiz_percentage": progress.best_quiz_percentage if progress else None,
            "quiz_attempts": progress.quiz_attempts if progress else 0,
        },
    }
    if include_source:
        data["source_text"] = module.source_text
    return data


class StudentSubjectDocumentsView(APIView):
    permission_classes = [IsStudent]

    def get(self, request, subject_id):
        subject = get_or_404(Subject.objects.visible_to(request.user), pk=subject_id)
        docs = list(services.student_documents(request.user, subject).prefetch_related("chapters__modules"))
        # One progress lookup for every module of every book, not one per book.
        rows = services.progress_map(request.user, [m for doc in docs for ch in doc.chapters.all() for m in ch.modules.all()])
        out = []
        for doc in docs:
            modules = [m for ch in doc.chapters.all() for m in ch.modules.all() if not m.source_missing]
            completed = sum(1 for m in modules if rows.get(m.id) and rows[m.id].status == ProgressStatus.COMPLETED)
            out.append({"id": str(doc.id), "title": doc.title, "subject_id": str(doc.subject_id), "published_at": doc.published_at,
                        "content_version": doc.content_version, "chapter_count": len(doc.chapters.all()),
                        "module_count": len(modules), "open_module_count": sum(1 for m in modules if m.is_open),
                        "completed_modules": completed,
                        "progress_percent": round(completed / len(modules) * 100, 1) if modules else 0.0})
        return Response(out)


class StudentDocumentView(APIView):
    permission_classes = [IsStudent]

    def get(self, request, document_id):
        doc = get_or_404(services.student_documents(request.user).prefetch_related("chapters__modules"), pk=document_id)
        modules = [m for ch in doc.chapters.all() for m in ch.modules.all() if not m.source_missing]
        rows = services.progress_map(request.user, modules)
        chapters = []
        for ch in doc.chapters.all():
            ch_modules = [m for m in ch.modules.all() if not m.source_missing]
            if not ch_modules:
                continue
            chapters.append({"id": str(ch.id), "title": ch.title, "order": ch.order,
                             "status": services.chapter_status(rows, ch_modules),
                             "modules": [_module_payload(m, rows.get(m.id), include_source=False) for m in ch_modules]})
        return Response({"id": str(doc.id), "title": doc.title, "subject_id": str(doc.subject_id),
                         "content_version": doc.content_version, "chapters": chapters})


class StudentModuleView(APIView):
    """Reading a module marks it in progress. Locked modules return MODULE_LOCKED."""

    permission_classes = [IsStudent]

    def get(self, request, module_id):
        module = services.resolve_accessible_module(request.user, module_id)
        services.settle_student_results(request.user)
        if getattr(request, "_offline_prefetch", False):
            # Downloading for offline use is not reading: do not mark the
            # module started or count a view.
            progress = services.progress_map(request.user, [module]).get(module.id)
        else:
            progress = services.record_module_view(request.user, module)
        payload = _module_payload(module, progress, include_source=True)
        payload["chapter_title"] = module.chapter.title
        payload["document_id"] = str(module.chapter.document_id)
        payload["document_title"] = module.chapter.document.title
        # Position in the book ("Module 4 of 6") and who teaches it, for the module page.
        ordered = list(Module.objects.filter(chapter__document_id=module.chapter.document_id, source_missing=False)
                       .order_by("chapter__order", "order").values_list("id", flat=True))
        payload["module_number"] = ordered.index(module.id) + 1 if module.id in ordered else None
        payload["module_count"] = len(ordered)
        from academics.views import subject_faculty_names
        payload["faculty_names"] = subject_faculty_names([module.chapter.document.subject_id]).get(module.chapter.document.subject_id, [])
        return Response(payload)
