from django.db import transaction
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from academics.models import faculty_manages_subject
from core.permissions import IsAdminOrFaculty
from core.exceptions import NotFound, Forbidden, Conflict
from .models import Job

class JobView(APIView):
    permission_classes = [IsAdminOrFaculty]
    def resolve(self, user, job_id):
        from documents.models import Document
        from assessments.models import AssessmentAttempt
        job = Job.objects.filter(pk=job_id).first()
        if not job: raise NotFound("Job not found.")
        subject = None
        doc = Document.objects.filter(pk=job.payload.get("document_id")).select_related("subject").first() if job.payload.get("document_id") else None
        if doc: subject = doc.subject
        if job.payload.get("attempt_id"):
            a = AssessmentAttempt.objects.filter(pk=job.payload["attempt_id"]).select_related("assessment__subject").first()
            if a: subject = a.assessment.subject
        if subject is None or not faculty_manages_subject(user, subject): raise Forbidden("You do not manage this job.")
        return job
    @extend_schema(responses={200: dict})
    def get(self, request, job_id):
        j = self.resolve(request.user, job_id)
        return Response({"id": str(j.id), "kind": j.kind, "status": j.status, "attempts": j.attempts,
            "error": j.error, "result": j.result, "updated_at": j.updated_at})
    @extend_schema(request=dict, responses={200: dict})
    def post(self, request, job_id):
        with transaction.atomic():
            j = self.resolve(request.user, job_id)
            updated = Job.objects.filter(pk=j.id, status="failed").update(status="pending", attempts=0, available_at=timezone.now(), error="", finished_at=None)
            if not updated: raise Conflict("Only a failed job can be explicitly retried.")
        return Response({"queued": True})
