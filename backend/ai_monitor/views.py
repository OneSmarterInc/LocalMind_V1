"""Admin Incident Center and faculty review endpoints.

Everything is mounted twice: under ``/api/admin/monitor/`` (admins, full
access) and ``/api/faculty/monitor/`` (faculty, read and label only, scoped to
their subjects and to academic-content issue types). The services decide the
scope from the caller's role; the views only parse parameters.
"""
from django.utils.dateparse import parse_datetime
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from core.exceptions import ValidationFailed
from core.permissions import IsAdmin, IsAdminOrFaculty
from core.utils import get_or_404

from . import services as svc
from .models import IncidentStatus, InteractionKind, IssueType, Policy, Severity, Verdict
from .serializers import (EvaluationDetailSerializer, EvaluationSummarySerializer, FeedbackSerializer, IncidentDetailSerializer,
                          IncidentSerializer, PolicySerializer)


def _days(request) -> int:
    raw = request.query_params.get("days", "30")
    try:
        return max(1, min(365, int(raw)))
    except ValueError:
        raise ValidationFailed(details={"days": "Must be an integer between 1 and 365."})


def _apply_filters(qs, params, *, prefix=""):
    """Shared filter parsing for incident and evaluation lists."""
    def col(name):
        return f"{prefix}{name}"

    if params.get("severity") in Severity.values:
        qs = qs.filter(**{"severity": params["severity"]})
    if params.get("issue_type") in IssueType.values:
        qs = qs.filter(**{"issue_type": params["issue_type"]})
    if params.get("kind") in InteractionKind.values:
        qs = qs.filter(**{col("interaction_kind"): params["kind"]})
    if params.get("model"):
        qs = qs.filter(**{col("app_model_name"): params["model"]})
    if params.get("subject"):
        qs = qs.filter(subject_id=params["subject"])
    if params.get("user"):
        qs = qs.filter(user_id=params["user"])
    for key, lookup in (("since", "created_at__gte"), ("until", "created_at__lte")):
        if params.get(key):
            value = parse_datetime(params[key].strip()) or parse_datetime(params[key].replace(" ", "+"))
            if value is None:
                raise ValidationFailed(details={key: "Must be an ISO-8601 datetime."})
            qs = qs.filter(**{lookup: value})
    return qs


# ---------------------------------------------------------- dashboards ------

class OverviewView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        days = _days(request)
        return Response({**svc.overview(days), "models": svc.model_health(days), "status": svc.status()})


class TrendsView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        return Response(svc.trends(_days(request)))


class SubjectsView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def get(self, request):
        return Response({"subjects": svc.subject_health(request.user, _days(request))})


class UserImpactView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def get(self, request):
        return Response({"users": svc.user_impact(request.user, _days(request))})


class StatusView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        return Response(svc.status())


# ----------------------------------------------------------- incidents ------

class IncidentListView(ListAPIView):
    permission_classes = [IsAdminOrFaculty]
    serializer_class = IncidentSerializer

    def get_queryset(self):
        params = self.request.query_params
        qs = _apply_filters(svc.incidents_for(self.request.user), params, prefix="evaluation__")
        status = params.get("status")
        if status in IncidentStatus.values:
            qs = qs.filter(status=status)
        elif status == "active":
            qs = qs.filter(status__in=(IncidentStatus.OPEN, IncidentStatus.ESCALATED, IncidentStatus.NEEDS_INVESTIGATION))
        if params.get("assigned_to"):
            qs = qs.filter(assigned_to_id=params["assigned_to"])
        return qs


class IncidentDetailView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def get(self, request, incident_id):
        incident = get_or_404(svc.incidents_for(request.user), pk=incident_id)
        return Response(IncidentDetailSerializer(incident).data)


class IncidentReviewView(APIView):
    """POST {action, note?, assigned_to?}. Actions: confirm, false_positive,
    needs_investigation, escalate, close, reopen (faculty: the first three)."""
    permission_classes = [IsAdminOrFaculty]

    def post(self, request, incident_id):
        incident = get_or_404(svc.incidents_for(request.user), pk=incident_id)
        action = str(request.data.get("action") or "").strip()
        note = str(request.data.get("note") or "")
        incident = svc.review_incident(request.user, incident, action, note=note, request=request)
        if request.user.is_admin and "assigned_to" in request.data:
            incident = svc.assign_incident(request.user, incident, request.data.get("assigned_to"), request)
        return Response(IncidentDetailSerializer(incident).data)


class IncidentAssignView(APIView):
    permission_classes = [IsAdmin]

    def post(self, request, incident_id):
        incident = get_or_404(svc.incidents_for(request.user), pk=incident_id)
        incident = svc.assign_incident(request.user, incident, request.data.get("assigned_to"), request)
        return Response(IncidentDetailSerializer(incident).data)


# --------------------------------------------------------- evaluations ------

class EvaluationListView(ListAPIView):
    permission_classes = [IsAdminOrFaculty]
    serializer_class = EvaluationSummarySerializer

    def get_queryset(self):
        params = self.request.query_params
        qs = _apply_filters(svc.evaluations_for(self.request.user), params)
        if params.get("verdict") in Verdict.values:
            qs = qs.filter(verdict=params["verdict"])
        if params.get("stage"):
            qs = qs.filter(stage=params["stage"])
        if params.get("judged") in ("1", "true"):
            qs = qs.filter(judge_invoked=True)
        return qs


class EvaluationDetailView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def get(self, request, evaluation_id):
        evaluation = get_or_404(svc.evaluations_for(request.user), pk=evaluation_id)
        return Response(EvaluationDetailSerializer(evaluation).data)


class EvaluationFeedbackView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def post(self, request, evaluation_id):
        evaluation = get_or_404(svc.evaluations_for(request.user), pk=evaluation_id)
        row = svc.add_feedback(request.user, evaluation, str(request.data.get("label") or ""), str(request.data.get("note") or ""), request)
        return Response(FeedbackSerializer(row).data, status=201)


class ReevaluateView(APIView):
    """Re-run the pipeline on an interaction, always consulting the judge."""
    permission_classes = [IsAdmin]
    throttle_scope = "ai"

    def post(self, request, evaluation_id):
        evaluation = get_or_404(svc.evaluations_for(request.user), pk=evaluation_id)
        fresh = svc.evaluate(evaluation.interaction_kind, evaluation.interaction_id, force_judge=True)
        return Response(EvaluationDetailSerializer(fresh).data)


class EvaluateView(APIView):
    """POST {kind, id}: evaluate an interaction on demand (used for backfill
    from the UI and for testing the pipeline on a known message)."""
    permission_classes = [IsAdmin]
    throttle_scope = "ai"

    def post(self, request):
        kind = str(request.data.get("kind") or "")
        interaction_id = str(request.data.get("id") or "")
        if not interaction_id:
            raise ValidationFailed(details={"id": "Required."})
        force = bool(request.data.get("force_judge", False))
        return Response(EvaluationDetailSerializer(svc.evaluate(kind, interaction_id, force_judge=force)).data, status=201)


class BacklogView(APIView):
    """POST {limit?}: evaluate up to `limit` un-evaluated interactions inline."""
    permission_classes = [IsAdmin]
    throttle_scope = "ai"

    def get(self, request):
        return Response({"pending": svc.backlog_count()})

    def post(self, request):
        try:
            limit = max(1, min(200, int(request.data.get("limit", 25))))
        except (TypeError, ValueError):
            raise ValidationFailed(details={"limit": "Must be an integer."})
        done = []
        for kind, pk in svc.backlog(limit=limit):
            done.append(EvaluationSummarySerializer(svc.evaluate(kind, pk)).data)
        return Response({"evaluated": len(done), "remaining": svc.backlog_count(), "results": done})


# ------------------------------------------------------------- policies -----

class PolicyListView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        svc.ensure_default_policies()
        return Response(PolicySerializer(Policy.objects.select_related("updated_by").order_by("issue_type"), many=True).data)


class PolicyDetailView(APIView):
    permission_classes = [IsAdmin]

    def patch(self, request, issue_type):
        allowed = {k: v for k, v in request.data.items() if k in ("enabled", "min_confidence", "min_severity", "description")}
        row = svc.update_policy(request.user, issue_type, request=request, **allowed)
        return Response(PolicySerializer(row).data)
