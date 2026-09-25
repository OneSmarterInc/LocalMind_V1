import json
from django.conf import settings
from django.db import transaction
from django.http import HttpResponse
from drf_spectacular.utils import extend_schema
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from rest_framework.throttling import AnonRateThrottle
from core.permissions import IsAdminOrFaculty
from core.exceptions import NotFound, ValidationFailed
from . import services, contracts as c, observations
from .models import ContentBlock, StudyQuestion, StudyPackage, AuthoringState


class StudyErrorsMixin:
    def handle_exception(self, exc):
        if isinstance(exc, (ValueError, TypeError, KeyError)):
            exc = ValidationFailed(str(exc))
        elif isinstance(exc, (ContentBlock.DoesNotExist, StudyQuestion.DoesNotExist, AuthoringState.DoesNotExist)):
            exc = NotFound("The requested authoring record does not exist.")
        return super().handle_exception(exc)


class AuthoringView(StudyErrorsMixin, APIView):
    permission_classes = [IsAdminOrFaculty]

    @extend_schema(responses={200: dict})
    def get(self, request, document_id):
        return Response(services.authoring_snapshot(services.document_for(request.user, document_id)))

    @extend_schema(request=dict, responses={200: dict, 201: dict, 202: dict})
    def post(self, request, document_id):
        doc = services.document_for(request.user, document_id)
        c.require(isinstance(request.data, dict), "Expected an action object")
        action = request.data.get("action")
        data = request.data.get("data", {})
        c.require(isinstance(data, dict), "Action data must be an object")
        if action == "sync_source":
            return Response(services.sync_source(request.user, doc))
        if action == "save_block":
            b = services.save_block(request.user, doc, data.get("module_id"), data.get("block"), data.get("id"), data.get("expected_revision"))
            return Response({"id": str(b.id), "revision": b.current_revision})
        if action == "retire_block":
            services.retire_block(doc, data.get("id"), data.get("revision"))
            return Response({"retired": True})
        if action == "remove_question":
            services.remove_question(doc, data.get("id"))
            return Response({"removed": True})
        if action == "accept_source_review":
            c.require(data.get("review_confirmed") is True, "Confirm the source changes were reviewed")
            services.accept_source_review(doc, data.get("digest"))
            return Response({"reviewed": True})
        if action == "reorder_blocks":
            services.reorder_blocks(doc, data.get("module_id"), data.get("ids"))
            return Response({"saved": True})
        if action == "save_question":
            q = services.save_question(request.user, doc, data.get("body"), data.get("references"), data.get("id"))
            return Response({"id": str(q.id), "digest": services.question_digest(q)}, status=201)
        if action == "approve_question":
            q = StudyQuestion.objects.get(pk=data.get("id"), document=doc)
            services.approve_question(request.user, q, data.get("digest"))
            return Response({"approved": True})
        if action == "save_aid":
            aid = services.save_aid(request.user, doc, data.get("block_id"), data.get("aid"))
            return Response({"id": str(aid.id)})
        if action in ("import_word_figures", "import_figures"):
            from jobs.services import enqueue
            job = enqueue("study_figures", str(doc.id), {"document_id": str(doc.id), "actor_id": str(request.user.id)})
            return Response({"job_id": str(job.id)}, status=202)
        if action == "generate_bank":
            from jobs.services import enqueue
            c.require(type(data.get("count", 3)) is int and 1 <= data.get("count", 3) <= 5, "Use 1-5 questions")
            c.require(data.get("question_type", "mcq") in ("mcq", "short"), "Use mcq or short")
            block = ContentBlock.objects.get(pk=data.get("block_id"), module__chapter__document=doc, active=True)
            job = enqueue("study_bank", str(block.id), {"document_id": str(doc.id), "block_id": str(block.id), "revision": block.current_revision,
                "count": data.get("count", 3), "question_type": data.get("question_type", "mcq"), "actor_id": str(request.user.id)})
            return Response({"job_id": str(job.id)}, status=202)
        if action == "publish":
            c.require(data.get("review_confirmed") is True, "Confirm that you reviewed this publication")
            p = services.publish_package(request.user, doc)
            return Response({"version": p.version, "digest": p.digest, "download": f"/api/study/packages/{doc.id}/{p.version}/"}, status=201)
        if action == "save_policy":
            c.policy(data.get("policy"))
            from documents.models import Document
            with transaction.atomic():
                Document.objects.select_for_update().get(pk=doc.id)
                s = AuthoringState.objects.get(document=doc); s.policy = data["policy"]; s.policy_proposal = {}; s.save()
            return Response({"saved": True})
        if action == "propose_policy":
            from jobs.services import enqueue
            job = enqueue("study_policy", str(doc.id), {"document_id": str(doc.id), "actor_id": str(request.user.id)})
            return Response({"job_id": str(job.id)}, status=202)
        raise ValidationFailed("Unknown study-authoring action.")


class AssetUploadView(StudyErrorsMixin, APIView):
    permission_classes = [IsAdminOrFaculty]
    @extend_schema(request=dict, responses={201: dict})
    def post(self, request, document_id):
        doc = services.document_for(request.user, document_id)
        upload = request.FILES.get("file")
        c.require(upload is not None and upload.size <= 8 * 1024 * 1024, "Upload one PNG/JPEG smaller than 8 MB")
        a = services.add_asset(doc, upload.read(), source_location="Faculty upload", caption=str(request.data.get("caption", "")))
        return Response({"id": str(a.id), "digest": a.digest}, status=201)


class PackageDownloadView(StudyErrorsMixin, APIView):
    # Explicit study publication is public content. No student authentication,
    # grades, conversations or enrollment records are included.
    permission_classes = [AllowAny]
    authentication_classes = []
    @extend_schema(responses={200: dict})
    def get(self, request, document_id, version):
        p = StudyPackage.objects.filter(document_id=document_id, version=version).first()
        if p is None: raise NotFound("Published package not found.")
        res = HttpResponse(p.envelope, content_type="application/json")
        res["Content-Disposition"] = f'attachment; filename="localmind-{document_id}-v{version}.json"'
        res["ETag"] = f'"{p.digest}"'
        res["Cache-Control"] = "public, max-age=31536000, immutable"
        return res


class ObservationThrottle(AnonRateThrottle):
    rate = "20/minute"


class ObservationView(StudyErrorsMixin, APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ObservationThrottle]
    @extend_schema(request=dict, responses={200: dict})
    def post(self, request):
        if not getattr(settings, "STUDY_OBSERVATIONS_ENABLED", False):
            raise NotFound("Optional observation collection is disabled.")
        c.require(isinstance(request.data, dict) and set(request.data) == {"events"}, "Only an events batch is accepted")
        c.require(len(json.dumps(request.data)) <= 65536, "Observation batch is too large")
        return Response({"accepted": observations.accept_batch(request.data["events"])})


class AggregateView(StudyErrorsMixin, APIView):
    permission_classes = [IsAdminOrFaculty]
    @extend_schema(responses={200: dict})
    def get(self, request, document_id):
        doc = services.document_for(request.user, document_id)
        return Response({"counts_are": "events_not_people_or_grades", "rows": observations.aggregate(doc)})


class AssetPreviewView(StudyErrorsMixin, APIView):
    permission_classes = [IsAdminOrFaculty]
    @extend_schema(responses={200: dict})
    def get(self, request, document_id, asset_id):
        import base64
        from .models import StudyAsset
        doc = services.document_for(request.user, document_id)
        asset = StudyAsset.objects.filter(pk=asset_id, document=doc).first()
        if asset is None: raise NotFound("Figure asset not found.")
        with asset.file.open("rb") as f: raw = f.read(2 * 1024 * 1024 + 1)
        c.require(len(raw) <= 2 * 1024 * 1024, "Figure exceeds the size limit")
        return Response({"png_base64": base64.b64encode(raw).decode(), "caption": asset.caption, "source": asset.source_location})
