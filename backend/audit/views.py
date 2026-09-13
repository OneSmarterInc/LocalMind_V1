from django.db.models import Count
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsAdmin
from .models import AuditLog
from .serializers import AuditLogSerializer


class AuditLogListView(ListAPIView):
    permission_classes = [IsAdmin]
    serializer_class = AuditLogSerializer

    def get_queryset(self):
        qs = AuditLog.objects.select_related("actor")
        params = self.request.query_params
        if params.get("action"):
            qs = qs.filter(action=params["action"])
        if params.get("target_type"):
            qs = qs.filter(target_type=params["target_type"])
        if params.get("target_id"):
            qs = qs.filter(target_id=params["target_id"])
        if params.get("actor"):
            qs = qs.filter(actor_id=params["actor"])
        if params.get("actor_email"):
            qs = qs.filter(actor_email__icontains=params["actor_email"])
        if params.get("since"):
            qs = qs.filter(created_at__gte=params["since"])
        if params.get("until"):
            qs = qs.filter(created_at__lte=params["until"])
        return qs


class AuditActionsView(APIView):
    """The action names actually present in the log, with counts.

    The audit filter used to be a free-text box that only matched an exact
    action string, so it was useless unless you already knew that publishing a
    book records "document.published". Serving the distinct values lets the
    screen offer them as a list, and the list stays correct as new actions are
    recorded without anyone editing the frontend.
    """

    permission_classes = [IsAdmin]

    def get(self, request):
        rows = AuditLog.objects.values("action").annotate(count=Count("id")).order_by("action")
        return Response({
            "actions": [{"value": r["action"], "count": r["count"]} for r in rows],
            "targets": sorted({t for t in AuditLog.objects.values_list("target_type", flat=True).distinct() if t}),
        })
