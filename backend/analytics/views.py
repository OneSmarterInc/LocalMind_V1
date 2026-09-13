from rest_framework.response import Response
from rest_framework.views import APIView

from ai import gateway as ai_gateway
from core.permissions import IsAdmin, IsAdminOrFaculty, IsStudent

from . import services as svc


class _Base(APIView):
    def window(self):
        return svc.parse_window(self.request.query_params)


# ----------------------------------------------------------- student ---------

class StudentOverviewView(_Base):
    permission_classes = [IsStudent]

    def get(self, request):
        return Response(svc.student_overview(request.user, self.window(), released_only=True))


class StudentSubjectView(_Base):
    permission_classes = [IsStudent]

    def get(self, request, subject_id):
        subject = svc.resolve_subject(request.user, subject_id)
        return Response(svc.student_subject_detail(request.user, subject, self.window(), released_only=True))


class StudentSessionsView(_Base):
    permission_classes = [IsStudent]

    def get(self, request):
        return Response(svc.user_sessions(request.user, request.user.id, self.window(), request.query_params.get("limit")))


# ---------------------------------------------- faculty and admin (shared) ----

class OverviewView(_Base):
    """Faculty: their subjects. Admin: every non-archived subject, same shape."""
    permission_classes = [IsAdminOrFaculty]

    def get(self, request):
        return Response(svc.faculty_overview(request.user, self.window()))


class SubjectSummaryView(_Base):
    permission_classes = [IsAdminOrFaculty]

    def get(self, request, subject_id):
        subject = svc.resolve_subject(request.user, subject_id)
        return Response(svc.subject_summary(request.user, subject, self.window()))


class SubjectStudentsView(_Base):
    permission_classes = [IsAdminOrFaculty]

    def get(self, request, subject_id):
        subject = svc.resolve_subject(request.user, subject_id)
        return Response(svc.subject_students(request.user, subject, self.window()))


class SubjectModulesView(_Base):
    permission_classes = [IsAdminOrFaculty]

    def get(self, request, subject_id):
        subject = svc.resolve_subject(request.user, subject_id)
        return Response(svc.subject_modules(request.user, subject))


class TeachingActivityView(_Base):
    """Recent attempts, submissions, book and lesson events in the caller's subjects."""
    permission_classes = [IsAdminOrFaculty]

    def get(self, request):
        return Response(svc.teaching_activity(request.user))


class StudentDetailView(_Base):
    """A student's overview as seen by faculty (shared subject required) or admin."""
    permission_classes = [IsAdminOrFaculty]

    def get(self, request, student_id):
        student = svc.resolve_student(request.user, student_id)
        return Response(svc.student_overview(student, self.window()))


class StudentSubjectDetailView(_Base):
    permission_classes = [IsAdminOrFaculty]

    def get(self, request, student_id, subject_id):
        student = svc.resolve_student(request.user, student_id)
        subject = svc.resolve_subject(request.user, subject_id)
        return Response(svc.student_subject_detail(student, subject, self.window()))


class UserSessionsView(_Base):
    permission_classes = [IsAdminOrFaculty]

    def get(self, request, user_id):
        return Response(svc.user_sessions(request.user, user_id, self.window(), request.query_params.get("limit")))


# ------------------------------------------------------------- admin only ----

class AdminOverviewView(_Base):
    permission_classes = [IsAdmin]

    def get(self, request):
        return Response(svc.admin_overview(self.window()))


class AdminSubjectsView(_Base):
    permission_classes = [IsAdmin]

    def get(self, request):
        return Response(svc.admin_subjects(self.window()))


class AdminAIStatusView(APIView):
    """Fresh (uncached) AI status for the admin dashboard, plus the
    component-level offline-readiness report under ``system``."""
    permission_classes = [IsAdmin]

    def get(self, request):
        from core.system_health import system_status

        force = request.query_params.get("refresh") in ("1", "true")
        status = ai_gateway.health(force=force)
        payload = status.as_dict()
        payload["system"] = system_status()
        return Response(payload)
