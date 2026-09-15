import base64

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsStudent
from documents.services.visuals import visual_path

from . import services as svc


def _msg(m):
    return {"id": str(m.id), "role": m.role, "content": m.content, "grounded": m.grounded, "source_reference": m.source_reference,
            "created_at": m.created_at}


def _lesson_visuals(student, module_id):
    """Return only cropped source visuals for the accessible module.

    Data URLs keep the normal authenticated lesson request self-contained on
    web/native/offline caches; the client never needs an unauthenticated media
    URL. The extractor rejects full-page regions before these files exist.
    """
    module = svc._module(student, module_id)
    document = module.chapter.document
    output = []
    for visual in module.source_visuals or []:
        path = visual_path(document, module, str(visual.get("id") or ""))
        if path is None or not path.is_file():
            continue
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        output.append({
            "id": visual.get("id"),
            "kind": visual.get("kind", "figure"),
            "page": visual.get("page"),
            "caption": visual.get("caption", "Source visual"),
            "width": visual.get("width"),
            "height": visual.get("height"),
            "data_url": f"data:image/png;base64,{encoded}",
        })
    return output


def _with_source_visuals(student, module_id, data):
    if not data.get("lesson"):
        return data
    lesson = dict(data["lesson"])
    lesson["source_visuals"] = _lesson_visuals(student, module_id)
    return {**data, "lesson": lesson}


class TeachView(APIView):
    """The stored lesson for a module. ``status`` is ready (``lesson`` is the
    tutor's lesson), preparing (``lesson`` is null; ask again shortly) or
    unavailable (``lesson`` is a plain lesson built from the source text).
    Current clients GET. POST is what clients built before background
    lessons send, and it always carries a lesson (a plain one from the text
    while the tutor's is being prepared), because those clients cannot
    handle a null lesson and installed phone apps cannot be updated at once."""

    permission_classes = [IsStudent]

    def get(self, request, module_id):
        return Response(_with_source_visuals(request.user, module_id, svc.teach(request.user, module_id, request)))

    def post(self, request, module_id):
        data = svc.teach(request.user, module_id, request, legacy=True)
        return Response(_with_source_visuals(request.user, module_id, data))


class AskView(APIView):
    permission_classes = [IsStudent]
    throttle_scope = "ai"

    def post(self, request, module_id):
        conv, msg, suggestions = svc.ask(request.user, module_id, request.data.get("question"), request.data.get("conversation_id"), request)
        return Response({"conversation_id": str(conv.id), "message": _msg(msg), "follow_up_suggestions": suggestions}, status=status.HTTP_201_CREATED)


class ConversationListView(APIView):
    permission_classes = [IsStudent]

    def get(self, request):
        rows = svc.conversations(request.user, request.query_params.get("module"))
        return Response([{"id": str(c.id), "module_id": str(c.module_id), "module_title": c.module.title, "title": c.title,
                          "last_message_at": c.last_message_at, "created_at": c.created_at} for c in rows])


class ConversationDetailView(APIView):
    permission_classes = [IsStudent]

    def get(self, request, conversation_id):
        conv = svc.get_conversation(request.user, conversation_id)
        return Response({"id": str(conv.id), "module_id": str(conv.module_id), "title": conv.title,
                         "messages": [_msg(m) for m in conv.messages.all()]})


class RemediationView(APIView):
    permission_classes = [IsStudent]
    throttle_scope = "ai"

    def post(self, request, attempt_id):
        return Response(svc.remediation(request.user, attempt_id, request))
