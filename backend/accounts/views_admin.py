from django.db.models import Count, Q
from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from academics.models import AssignmentStatus, EnrollmentStatus
from core.permissions import IsAdmin
from core.utils import get_or_404

from .models import Role, User
from .serializers import (
    CreateUserSerializer, DiscontinueSerializer, ImportUsersSerializer, UpdateUserSerializer, UserSerializer,
)
from .services import users as user_service
from .services.excel_import import import_users


def _issued(user):
    """The one-time password, returned once in the response that created it.
    Null in shared mode, where the account starts on INITIAL_USER_PASSWORD."""
    return {"initial_password": getattr(user, "issued_password", None),
            "initial_password_mode": user_service.initial_password_mode()}


class _RoleScopedMixin:
    role: str = ""

    def queryset(self):
        qs = User.objects.filter(role=self.role).select_related("faculty_profile", "student_profile")
        if self.role == Role.FACULTY:
            qs = qs.annotate(active_subject_count=Count("subject_links", filter=Q(subject_links__status=AssignmentStatus.ACTIVE)))
        if self.role == Role.STUDENT:
            qs = qs.annotate(active_enrollment_count=Count("enrollments", filter=Q(enrollments__status=EnrollmentStatus.ACTIVE)))
        # Counting joins drop the model's default ordering, and a paged list
        # with no order can repeat or skip people between pages.
        return qs.order_by("full_name", "email", "id")


class UserListCreateView(_RoleScopedMixin, ListAPIView):
    permission_classes = [IsAdmin]
    serializer_class = UserSerializer

    def get_queryset(self):
        qs = self.queryset()
        params = self.request.query_params
        if params.get("status"):
            qs = qs.filter(status=params["status"])
        if params.get("q"):
            q = params["q"]
            qs = qs.filter(Q(email__icontains=q) | Q(full_name__icontains=q))
        return qs

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        return response

    def post(self, request):
        serializer = CreateUserSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = user_service.create_user(
            request.user,
            user_service.NewUser(
                email=data["email"], full_name=data["full_name"], role=self.role,
                profile=data.get("profile", {}), subject_ids=data.get("subject_ids", []),
            ),
            request=request,
        )
        return Response({**UserSerializer(user).data, **_issued(user)}, status=status.HTTP_201_CREATED)


class UserDetailView(_RoleScopedMixin, APIView):
    permission_classes = [IsAdmin]

    def get(self, request, user_id):
        user = get_or_404(self.queryset(), pk=user_id)
        data = UserSerializer(user).data
        if self.role == Role.FACULTY:
            from academics.serializers import FacultySubjectSerializer
            data["subjects"] = FacultySubjectSerializer(user.subject_links.select_related("subject"), many=True).data
        if self.role == Role.STUDENT:
            from academics.serializers import EnrollmentSerializer
            data["enrollments"] = EnrollmentSerializer(user.enrollments.select_related("subject"), many=True).data
        return Response(data)

    def patch(self, request, user_id):
        user = get_or_404(self.queryset(), pk=user_id)
        serializer = UpdateUserSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = user_service.update_user(request.user, user, request=request, **serializer.validated_data)
        return Response(UserSerializer(user).data)

    def delete(self, request, user_id):
        """Permanent delete. Replaces the old discontinue action in the admin UI."""
        user = get_or_404(self.queryset(), pk=user_id)
        reason = (request.data or {}).get("reason", "") if hasattr(request, "data") else ""
        label = user_service.delete_user(request.user, user, reason, request)
        return Response({"detail": f"{label} was deleted."})


class UserDiscontinueView(_RoleScopedMixin, APIView):
    permission_classes = [IsAdmin]

    def post(self, request, user_id):
        user = get_or_404(self.queryset(), pk=user_id)
        serializer = DiscontinueSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = user_service.discontinue_user(request.user, user, serializer.validated_data.get("reason", ""), request)
        return Response(UserSerializer(user).data)


class UserReactivateView(_RoleScopedMixin, APIView):
    permission_classes = [IsAdmin]

    def post(self, request, user_id):
        user = get_or_404(self.queryset(), pk=user_id)
        return Response(UserSerializer(user_service.reactivate_user(request.user, user, request)).data)


class UserResetPasswordView(_RoleScopedMixin, APIView):
    permission_classes = [IsAdmin]

    def post(self, request, user_id):
        user = get_or_404(self.queryset(), pk=user_id)
        user = user_service.reset_password_to_initial(request.user, user, request)
        issued = _issued(user)
        detail = ("Password reset to a new one-time password; the user must change it at next login."
                  if issued["initial_password"] else
                  "Password reset to the onboarding password; the user must change it at next login.")
        return Response({"detail": detail, **issued})


class UserImportTemplateView(_RoleScopedMixin, APIView):
    """The columns this role's sheet may contain, plus a starter workbook.

    Served rather than restated in the client so the screen, the template and
    the parser cannot drift apart. The workbook comes back base64-encoded so
    the browser downloads it through the same authenticated request as
    everything else, with no token in a URL.
    """

    permission_classes = [IsAdmin]

    def get(self, request):
        import base64

        from .services.excel_import import build_template, column_spec

        return Response({
            "columns": column_spec(self.role),
            "filename": f"localmind-{'faculty' if self.role == Role.FACULTY else 'students'}-template.xlsx",
            "content_base64": base64.b64encode(build_template(self.role)).decode(),
        })


class UserImportView(_RoleScopedMixin, APIView):
    permission_classes = [IsAdmin]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        serializer = ImportUsersSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        report = import_users(request.user, serializer.validated_data["file"], self.role, request)
        return Response({**report.as_dict(), "initial_password_mode": user_service.initial_password_mode()})


def role_views(role):
    """Build role-bound view classes so faculty and student endpoints share code."""
    return {
        "list": type(f"{role.title()}ListCreateView", (UserListCreateView,), {"role": role}),
        "detail": type(f"{role.title()}DetailView", (UserDetailView,), {"role": role}),
        "discontinue": type(f"{role.title()}DiscontinueView", (UserDiscontinueView,), {"role": role}),
        "reactivate": type(f"{role.title()}ReactivateView", (UserReactivateView,), {"role": role}),
        "reset_password": type(f"{role.title()}ResetPasswordView", (UserResetPasswordView,), {"role": role}),
        "import": type(f"{role.title()}ImportView", (UserImportView,), {"role": role}),
        "import_template": type(f"{role.title()}ImportTemplateView", (UserImportTemplateView,), {"role": role}),
    }
