from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsAdminOrFaculty, IsStudent
from core.utils import get_or_404

from . import services as svc
from .models import AssignmentSubmission
from .serializers import (
    AssignmentSerializer, CreateSerializer, EvaluateSerializer, GenerateSerializer, ReleaseResultsSerializer,
    StatusSerializer, SubmissionSerializer, SubmitSerializer, _Fields,
)


class AssignmentListCreateView(ListAPIView):
    permission_classes = [IsAdminOrFaculty]
    serializer_class = AssignmentSerializer

    def get_queryset(self):
        qs = svc.manageable(self.request.user)
        p = self.request.query_params
        for key in ("subject", "module", "chapter"):
            if p.get(key):
                qs = qs.filter(**{f"{key}_id": p[key]})
        if p.get("status"):
            qs = qs.filter(status=p["status"])
        return qs

    def post(self, request):
        s = CreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        return Response(AssignmentSerializer(svc.create(request.user, request=request, **s.validated_data)).data, status=status.HTTP_201_CREATED)


class AssignmentGenerateView(APIView):
    permission_classes = [IsAdminOrFaculty]
    throttle_scope = "ai"

    def post(self, request):
        s = GenerateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        a, warning = svc.generate(request.user, request=request, **s.validated_data)
        data = AssignmentSerializer(a).data
        data["generation_warning"] = warning or None
        return Response(data, status=status.HTTP_201_CREATED)


class AssignmentDetailView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def get(self, request, assignment_id):
        return Response(AssignmentSerializer(get_or_404(svc.manageable(request.user), pk=assignment_id)).data)

    def patch(self, request, assignment_id):
        a = get_or_404(svc.manageable(request.user), pk=assignment_id)
        s = _Fields(data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        return Response(AssignmentSerializer(svc.update(request.user, a, request=request, **s.validated_data)).data)

    def delete(self, request, assignment_id):
        a = get_or_404(svc.manageable(request.user), pk=assignment_id)
        label = svc.delete(request.user, a, request)
        return Response({"detail": f"{label} was deleted."})


class AssignmentStatusView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def post(self, request, assignment_id):
        a = get_or_404(svc.manageable(request.user), pk=assignment_id)
        s = StatusSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        return Response(AssignmentSerializer(svc.set_status(request.user, a, s.validated_data["status"], request)).data)


class AssignmentSubmissionsView(ListAPIView):
    permission_classes = [IsAdminOrFaculty]
    serializer_class = SubmissionSerializer

    def get_queryset(self):
        a = get_or_404(svc.manageable(self.request.user), pk=self.kwargs["assignment_id"])
        qs = a.submissions.select_related("student", "assignment")
        if self.request.query_params.get("status"):
            qs = qs.filter(status=self.request.query_params["status"])
        return qs


class SubmissionEvaluateView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def post(self, request, submission_id):
        sub = get_or_404(AssignmentSubmission.objects.filter(assignment__in=svc.manageable(request.user)).select_related("assignment__subject", "student"), pk=submission_id)
        s = EvaluateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        return Response(SubmissionSerializer(svc.evaluate(request.user, sub, request=request, **s.validated_data)).data)


class AssignmentReleaseResultsView(APIView):
    """Release held marks: the whole assignment, or one submission."""

    permission_classes = [IsAdminOrFaculty]

    def post(self, request, assignment_id):
        a = get_or_404(svc.manageable(request.user), pk=assignment_id)
        s = ReleaseResultsSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        released = svc.release_results(request.user, a, s.validated_data.get("submission_id"), request)
        return Response({"released": released, "pending": svc.pending_release_count(a)})


class StudentAssignmentListView(APIView):
    permission_classes = [IsStudent]

    def get(self, request):
        qs = svc.student_visible(request.user)
        for key in ("subject", "module"):
            if request.query_params.get(key):
                qs = qs.filter(**{f"{key}_id": request.query_params[key]})
        subs = {}
        for sub in AssignmentSubmission.objects.filter(student=request.user, assignment__in=qs).order_by("attempt_number"):
            subs[sub.assignment_id] = sub
        out = []
        for a in qs:
            row = {k: v for k, v in AssignmentSerializer(a).data.items() if k != "submission_count"}
            latest = subs.get(a.id)
            row["my_submission"] = (
                (SubmissionSerializer(latest).data if latest.results_visible else svc.withhold_submission(latest))
                if latest else None
            )
            out.append(row)
        return Response(out)


class StudentSubmitView(APIView):
    permission_classes = [IsStudent]

    def post(self, request, assignment_id):
        s = SubmitSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        sub = svc.submit(request.user, assignment_id, request=request, **s.validated_data)
        data = SubmissionSerializer(sub).data if sub.results_visible else svc.withhold_submission(sub)
        return Response(data, status=status.HTTP_201_CREATED)


class StudentSubmissionsView(ListAPIView):
    """Own submissions, with score and feedback withheld until released."""

    permission_classes = [IsStudent]
    serializer_class = SubmissionSerializer

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()))
        rows = [SubmissionSerializer(x).data if x.results_visible else svc.withhold_submission(x) for x in page]
        return self.get_paginated_response(rows)

    def get_queryset(self):
        return AssignmentSubmission.objects.filter(student=self.request.user).select_related("assignment", "student")
