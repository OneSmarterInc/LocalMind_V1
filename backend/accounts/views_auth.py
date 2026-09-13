import logging
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from audit import services as audit
from core.exceptions import APIError

from .models import AccountStatus, Role
from .serializers import ChangePasswordSerializer, LoginSerializer, RefreshSerializer, UserSerializer
from .services.passwords import change_password

logger = logging.getLogger("localmind.auth")

ROLE_FROM_PATH = {"admin": Role.ADMIN, "faculty": Role.FACULTY, "student": Role.STUDENT}


def recent_login_failures(email: str) -> int:
    """Failed logins for this email inside the lockout window, counted after
    its most recent successful login. Read from the audit log, which every
    worker shares, so the limit holds with several gunicorn workers."""
    from audit.models import AuditLog

    cfg = settings.LOCALMIND
    since = timezone.now() - timedelta(minutes=cfg.get("LOGIN_LOCKOUT_MINUTES", 15))
    last_ok = (AuditLog.objects.filter(action="auth.login", actor_email=email, created_at__gte=since)
               .order_by("-created_at").values_list("created_at", flat=True).first())
    return AuditLog.objects.filter(action="auth.login_failed", summary__email=email,
                                   created_at__gte=last_ok or since).count()


def _tokens_for(user):
    refresh = RefreshToken.for_user(user)
    refresh["role"] = user.role
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


class RoleLoginView(APIView):
    """POST /api/auth/login/<role>/ — the requested role must match the account."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request, role):
        expected_role = ROLE_FROM_PATH.get(role)
        if expected_role is None:
            raise APIError("Unknown login role.", code="INVALID_ROLE", status_code=404)

        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].strip().lower()
        password = serializer.validated_data["password"]

        # Per-account lockout. The IP throttle alone lets one machine try a
        # whole class list of accounts, and lets many machines try one.
        limit = settings.LOCALMIND.get("LOGIN_MAX_FAILURES", 10)
        if limit and recent_login_failures(email) >= limit:
            audit.record(None, "auth.login_locked", None, {"email": email, "role": role}, request)
            raise APIError(
                "Too many failed sign-in attempts for this account. Wait a few minutes and try again, "
                "or ask an administrator to reset the password.",
                code="TOO_MANY_ATTEMPTS", status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                details={"retry_after_minutes": settings.LOCALMIND.get("LOGIN_LOCKOUT_MINUTES", 15)},
            )

        user = authenticate(request, username=email, password=password)
        if user is None or user.role != expected_role:
            # authenticate() already refuses inactive users; give the same
            # answer for wrong-role and wrong-password so nothing is leaked.
            logger.warning("Failed %s login for %s", role, email)
            audit.record(None, "auth.login_failed", None, {"email": email, "role": role}, request)
            raise APIError("Invalid email or password.", code="INVALID_CREDENTIALS", status_code=status.HTTP_401_UNAUTHORIZED)

        from activity.services import open_session
        session = open_session(user, request)
        audit.record(user, "auth.login", user, {"role": role}, request)
        return Response({
            **_tokens_for(user),
            "user": UserSerializer(user).data,
            "must_change_password": user.must_change_password,
            "session_id": str(session.id) if session else None,
        })


class RefreshView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        serializer = RefreshSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            refresh = RefreshToken(serializer.validated_data["refresh"])
            user_id = refresh["user_id"]
            from .models import User
            user = User.objects.get(pk=user_id)
            if user.status != AccountStatus.ACTIVE:
                raise APIError("This account is not active.", code="ACCOUNT_INACTIVE", status_code=401)
            refresh.blacklist()
            return Response(_tokens_for(user))
        except (TokenError, KeyError):
            raise APIError("Refresh token is invalid or expired.", code="INVALID_REFRESH", status_code=401)


class LogoutView(APIView):
    allow_password_change = True

    def post(self, request):
        token = request.data.get("refresh")
        if token:
            try:
                RefreshToken(token).blacklist()
            except TokenError:
                pass
        from activity.services import close_session
        close_session(request.user, request.data.get("session_id"))
        audit.record(request.user, "auth.logout", request.user, {}, request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    allow_password_change = True

    def get(self, request):
        return Response(UserSerializer(request.user).data)


class ChangePasswordView(APIView):
    """Reachable while must_change_password is set; everything else is blocked."""

    allow_password_change = True

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = change_password(
            request.user,
            serializer.validated_data["current_password"],
            serializer.validated_data["new_password"],
            request=request,
        )
        return Response({**_tokens_for(user), "user": UserSerializer(user).data, "must_change_password": False})
