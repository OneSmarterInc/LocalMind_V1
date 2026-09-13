"""Everything a student needs to keep learning without a connection.

``GET /api/student/offline/`` returns the responses of the student's own GET
endpoints, precomputed and keyed by the exact path the app requests:

    {"version": "<hash>", "generated_at": "...", "entries": {
        "/student/subjects/": [...],
        "/student/modules/<id>/": {...},
        "/student/modules/<id>/teach/": {...},
        ...}}

The app stores the entries and, when the server cannot be reached, answers
those same requests from storage, so every student screen works offline
without a separate offline code path. The entries are produced by calling the
real views, so their shape can never drift from what the screens expect.

Only content the student may see is included: their subjects, the published
books in them, and the modules that are open, each with its text, stored
lesson, quizzes, and latest tutor conversation. Building the bundle has no
side effects: modules are not marked as read.
"""
import hashlib
import json
from urllib.parse import urlencode

from django.test import RequestFactory
from django.urls import Resolver404, resolve
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsStudent

from . import services
from .models import ModuleAvailability


def entry_key(path: str, query: dict | None = None) -> str:
    """The cache key the app uses: path plus sorted, non-empty query."""
    items = sorted((k, str(v)) for k, v in (query or {}).items() if v not in (None, ""))
    return f"{path}?{urlencode(items)}" if items else path


class StudentOfflineBundleView(APIView):
    permission_classes = [IsStudent]

    def _fetch(self, request, path, query=None):
        """Run the real GET view for ``path`` as this student. Returns the data,
        or None when the view refuses (a module locked meanwhile, say)."""
        factory = RequestFactory()
        inner = factory.get(f"/api{path}", data=query or {})
        inner._force_auth_user = request.user
        inner._force_auth_token = getattr(request, "auth", None)
        inner._offline_prefetch = True
        try:
            match = resolve(f"/api{path}")
        except Resolver404:
            return None
        response = match.func(inner, *match.args, **match.kwargs)
        if getattr(response, "status_code", 500) != 200:
            return None
        return getattr(response, "data", None)

    def get(self, request):
        with services.settle_once():
            return self._build(request)

    def _build(self, request):
        entries = {}

        def put(path, query=None):
            data = self._fetch(request, path, query)
            if data is not None:
                entries[entry_key(path, query)] = data
            return data

        student = request.user
        put("/student/subjects/")
        all_quizzes = put("/student/quizzes/") or []
        put("/student/scores/")
        put("/student/assignments/")
        put("/student/analytics/overview/")
        subjects = {d.subject_id for d in services.student_documents(student)}
        for subject_id in subjects:
            put(f"/student/subjects/{subject_id}/documents/")
            put(f"/student/analytics/subjects/{subject_id}/")
        open_modules = services.student_module_queryset(student).filter(availability=ModuleAvailability.OPEN)
        document_ids = set()
        for module in open_modules.select_related("chapter"):
            document_ids.add(module.chapter.document_id)
            put(f"/student/modules/{module.id}/")
            put(f"/student/modules/{module.id}/teach/")
            # The module filter of that view is exactly module_id == this
            # module, so the answer is taken from the full list already built
            # instead of running the view again for every module.
            entries[entry_key("/student/quizzes/", {"module": str(module.id)})] = [
                row for row in all_quizzes if str(row.get("module_id")) == str(module.id)]
            conversations = put("/student/conversations/", {"module": str(module.id)})
            rows = conversations.get("results", conversations) if isinstance(conversations, dict) else conversations
            if rows:
                put(f"/student/conversations/{rows[0]['id']}/")
        for document_id in document_ids:
            put(f"/student/documents/{document_id}/")

        body = json.dumps(entries, sort_keys=True, default=str)
        return Response({
            "version": hashlib.sha256(body.encode()).hexdigest()[:32],
            "generated_at": timezone.now(),
            "entries": json.loads(body),
        })
