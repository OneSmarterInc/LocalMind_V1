import ipaddress

from django.db import connection
from rest_framework.exceptions import AuthenticationFailed, NotAuthenticated
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from ai import gateway as ai_gateway
from core.system_health import system_status
from core.utils import client_ip


def may_see_internals(request) -> bool:
    """Administrators (bearer token) and requests from this machine itself.

    The detailed health report names filesystem paths, model files, provider
    URLs and error text, which is useful to an operator and to nobody else. The
    loopback exception keeps `curl http://127.0.0.1:8000/api/health/?full=1` on
    the host working; `client_ip` honours TRUSTED_PROXY_COUNT, so a request
    arriving through nginx is judged by the real client address, not nginx's.
    """
    try:
        user = request.user
    except (AuthenticationFailed, NotAuthenticated):
        user = None
    if user is not None and getattr(user, "is_authenticated", False) and getattr(user, "role", "") == "admin" \
            and user.is_active and not user.must_change_password:
        return True
    address = client_ip(request)
    try:
        return bool(address) and ipaddress.ip_address(address).is_loopback
    except ValueError:
        return False


class HealthView(APIView):
    """Liveness plus a cached view of the AI host.

    ``status`` stays ``ok`` when the AI is not ready because the application
    keeps serving reading, quizzes and grading through its fallbacks;
    ``ai.ready`` is the field to alert on. ``?full=1`` adds the component-level
    offline-readiness report (database, storage, AI runtime, model file,
    document processing, web client, offline mode).
    """
    permission_classes = [AllowAny]
    throttle_classes = []

    def get(self, request):
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        ai = ai_gateway.health().as_dict()
        internal = may_see_internals(request)
        if not internal:
            # Enough for a load balancer, Docker HEALTHCHECK or uptime monitor
            # to alert on; model paths, provider URLs and errors stay private.
            ai = {key: ai.get(key) for key in ("enabled", "provider", "reachable", "ready")}
        payload = {"status": "ok", "service": "LocalMind", "database": "ok", "ai": ai}
        if request.query_params.get("full") in ("1", "true"):
            if internal:
                payload["system"] = system_status()
            else:
                payload["detail"] = ("The component report is available to administrators "
                                     "(GET /api/admin/ai/status/) and on the server itself.")
        return Response(payload)
