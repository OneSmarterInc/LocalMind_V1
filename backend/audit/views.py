import csv
import io
from datetime import timedelta

from django.db.models import Count, Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsAdmin
from .categories import CATEGORIES, category_q, failure_q
from .models import AuditLog
from .serializers import AuditLogSerializer

EXPORT_LIMIT = 10_000


def filtered(params, *, skip=()):
    """The audit rows matching the screen's filters.

    `skip` leaves named filters out, so the category counts can be computed
    for the current date range and search without the category chip itself.
    """
    qs = AuditLog.objects.select_related("actor")
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
    q = (params.get("q") or "").strip()
    if q:
        qs = qs.filter(Q(actor_email__icontains=q) | Q(actor__full_name__icontains=q) | Q(target_label__icontains=q))
    role = params.get("role")
    if role == "system":
        qs = qs.filter(actor_email="")
    elif role:
        qs = qs.filter(actor_role=role)
    if "category" not in skip:
        category = params.get("category")
        if category == "failures":
            qs = qs.filter(failure_q())
        elif category in CATEGORIES or category == "other":
            qs = qs.filter(category_q(category))
    return qs


class AuditLogListView(ListAPIView):
    permission_classes = [IsAdmin]
    serializer_class = AuditLogSerializer

    def get_queryset(self):
        return filtered(self.request.query_params)


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


class AuditSummaryView(APIView):
    """Headline numbers and per-category counts for the audit screen.

    `today_since` is the start of the viewer's day as an ISO timestamp; the
    server runs in UTC and "today" should mean the administrator's today.
    The category counts follow the same date, search and role filters as the
    list, so a chip's number matches what clicking it shows.
    """

    permission_classes = [IsAdmin]

    def get(self, request):
        now = timezone.now()
        day = parse_datetime(request.query_params.get("today_since") or "")
        if day is None:
            day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        elif timezone.is_naive(day):
            day = timezone.make_aware(day)
        week = now - timedelta(days=7)
        today = AuditLog.objects.filter(created_at__gte=day)
        base = filtered(request.query_params, skip=("category",))
        counts = {name: base.filter(category_q(name)).count() for name in CATEGORIES}
        counts["other"] = base.filter(category_q("other")).count()
        return Response({
            "events_today": today.count(),
            "people_today": today.exclude(actor_email="").values("actor_email").distinct().count(),
            "published_week": AuditLog.objects.filter(action="document.published", created_at__gte=week).count(),
            "failures_week": AuditLog.objects.filter(failure_q(), created_at__gte=week).count(),
            "total": base.count(),
            "failures": base.filter(failure_q()).count(),
            "categories": counts,
        })


class AuditExportView(APIView):
    """The filtered audit rows as CSV text, newest first, capped at EXPORT_LIMIT.

    Returned inside JSON (filename, csv, count, truncated) because the app's API
    client authenticates and parses JSON; the screen turns it into a download.
    """

    permission_classes = [IsAdmin]

    def get(self, request):
        qs = filtered(request.query_params)
        total = qs.count()
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(["time_utc", "actor_name", "actor_email", "actor_role", "action",
                         "target_type", "target_label", "target_id", "ip_address", "summary"])
        for log in qs[:EXPORT_LIMIT].iterator(chunk_size=500):
            name = (getattr(log.actor, "full_name", "") or "") if log.actor else ""
            writer.writerow([
                log.created_at.isoformat(), name, log.actor_email, log.actor_role, log.action,
                log.target_type, log.target_label, log.target_id, log.ip_address or "",
                "; ".join(f"{k}={v}" for k, v in (log.summary or {}).items()),
            ])
        stamp = timezone.now().strftime("%Y%m%d-%H%M")
        return Response({
            "filename": f"audit-log-{stamp}.csv",
            "csv": buffer.getvalue(),
            "count": min(total, EXPORT_LIMIT),
            "truncated": total > EXPORT_LIMIT,
        })
