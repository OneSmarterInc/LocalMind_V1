from django.db.models import Count, Q
from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Role, User
from core.exceptions import Forbidden
from core.permissions import IsAdmin, IsAdminOrFaculty, IsStudent
from core.utils import get_or_404

from . import services
from .models import AssignmentStatus, Enrollment, EnrollmentStatus, FacultySubject, Subject, faculty_manages_subject
from .serializers import (
    AssignFacultySerializer, EnrollStudentsSerializer, EnrollmentSerializer, FacultySubjectBriefSerializer,
    FacultySubjectSerializer, SubjectCreateSerializer, SubjectSerializer, SubjectStatusSerializer,
    SubjectUpdateSerializer,
)


# ---------- Admin: subjects ----------

class AdminSubjectListCreateView(ListAPIView):
    permission_classes = [IsAdmin]
    serializer_class = SubjectSerializer

    def get_queryset(self):
        qs = Subject.objects.all()
        params = self.request.query_params
        if params.get("status"):
            qs = qs.filter(status=params["status"])
        if params.get("q"):
            qs = qs.filter(Q(name__icontains=params["q"]) | Q(code__icontains=params["q"]))
        return qs

    def post(self, request):
        serializer = SubjectCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        subject = services.create_subject(request.user, request=request, **serializer.validated_data)
        return Response(SubjectSerializer(subject).data, status=status.HTTP_201_CREATED)


class AdminSubjectDetailView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request, subject_id):
        subject = get_or_404(Subject.objects.all(), pk=subject_id)
        data = SubjectSerializer(subject).data
        data["faculty"] = FacultySubjectBriefSerializer(subject.faculty_links.select_related("faculty"), many=True).data
        data["statistics"] = {
            "active_students": subject.enrollments.filter(status=EnrollmentStatus.ACTIVE).count(),
            "discontinued_students": subject.enrollments.filter(status=EnrollmentStatus.DISCONTINUED).count(),
            "active_faculty": subject.faculty_links.filter(status=AssignmentStatus.ACTIVE).count(),
        }
        return Response(data)

    def patch(self, request, subject_id):
        subject = get_or_404(Subject.objects.all(), pk=subject_id)
        serializer = SubjectUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        subject = services.update_subject(request.user, subject, request=request, **serializer.validated_data)
        return Response(SubjectSerializer(subject).data)

    def delete(self, request, subject_id):
        """Permanent delete. Replaces the old archive action in the admin UI."""
        subject = get_or_404(Subject.objects.all(), pk=subject_id)
        label = services.delete_subject(request.user, subject, request)
        return Response({"detail": f"{label} was deleted."}, status=status.HTTP_200_OK)


class AdminSubjectStatusView(APIView):
    permission_classes = [IsAdmin]

    def post(self, request, subject_id):
        subject = get_or_404(Subject.objects.all(), pk=subject_id)
        serializer = SubjectStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        subject = services.set_subject_status(request.user, subject, serializer.validated_data["status"], request)
        return Response(SubjectSerializer(subject).data)


class AdminSubjectFacultyView(APIView):
    """POST assigns faculty to a subject; DELETE with faculty_id discontinues one."""

    permission_classes = [IsAdmin]

    def post(self, request, subject_id):
        subject = get_or_404(Subject.objects.all(), pk=subject_id)
        serializer = AssignFacultySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        links = []
        for faculty_id in serializer.validated_data["faculty_ids"]:
            faculty = get_or_404(User.objects.filter(role=Role.FACULTY), pk=faculty_id)
            links += services.assign_faculty_to_subjects(request.user, faculty, [subject.id], request)
        return Response(FacultySubjectBriefSerializer(links, many=True).data, status=status.HTTP_201_CREATED)

    def delete(self, request, subject_id, faculty_id):
        subject = get_or_404(Subject.objects.all(), pk=subject_id)
        faculty = get_or_404(User.objects.filter(role=Role.FACULTY), pk=faculty_id)
        link = services.unassign_faculty_from_subject(request.user, faculty, subject, request)
        return Response(FacultySubjectBriefSerializer(link).data)


class AdminFacultyAssignSubjectsView(APIView):
    """POST /api/admin/faculty/<id>/subjects/ with subject_ids (mirror of the subject-side endpoint)."""

    permission_classes = [IsAdmin]

    def post(self, request, user_id):
        faculty = get_or_404(User.objects.filter(role=Role.FACULTY), pk=user_id)
        subject_ids = request.data.get("subject_ids") or []
        links = services.assign_faculty_to_subjects(request.user, faculty, subject_ids, request)
        return Response(FacultySubjectSerializer(links, many=True).data, status=status.HTTP_201_CREATED)


# ---------- Shared: subject-scoped enrollment management (admin + faculty) ----------

def _managed_subject(user, subject_id):
    subject = get_or_404(Subject.objects.visible_to(user), pk=subject_id)
    if not faculty_manages_subject(user, subject):
        raise Forbidden("You do not manage this subject.", code="SUBJECT_NOT_ASSIGNED")
    return subject


class SubjectStudentsView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def get(self, request, subject_id):
        subject = _managed_subject(request.user, subject_id)
        qs = subject.enrollments.select_related("student", "subject")
        if request.query_params.get("status"):
            qs = qs.filter(status=request.query_params["status"])
        return Response(EnrollmentSerializer(qs, many=True).data)

    def post(self, request, subject_id):
        subject = _managed_subject(request.user, subject_id)
        serializer = EnrollStudentsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        results = services.enroll_students(request.user, subject, serializer.validated_data["student_ids"], request)
        return Response({"results": results}, status=status.HTTP_201_CREATED)


class SubjectStudentDiscontinueView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def post(self, request, subject_id, student_id):
        subject = _managed_subject(request.user, subject_id)
        student = get_or_404(User.objects.filter(role=Role.STUDENT), pk=student_id)
        enrollment = services.discontinue_enrollment(request.user, subject, student, request)
        return Response(EnrollmentSerializer(enrollment).data)


class StudentSearchView(ListAPIView):
    """Faculty need to find students to enrol; only minimal identity is exposed."""

    permission_classes = [IsAdminOrFaculty]

    def get(self, request):
        q = request.query_params.get("q", "").strip()
        qs = User.objects.filter(role=Role.STUDENT, status="active")
        if q:
            qs = qs.filter(Q(email__icontains=q) | Q(full_name__icontains=q) | Q(student_profile__roll_number__icontains=q))
        # ?subject=<id> leaves out anyone already actively enrolled there, so the
        # picker only ever offers students the caller can actually add. Without
        # it the list happily showed people who were already on the course and
        # enrolling them again did nothing.
        subject_id = request.query_params.get("subject")
        if subject_id:
            enrolled = Enrollment.objects.filter(subject_id=subject_id, status=EnrollmentStatus.ACTIVE).values("student_id")
            qs = qs.exclude(id__in=enrolled)
        qs = qs.select_related("student_profile").order_by("full_name")[:50]
        return Response([
            {"id": str(u.id), "email": u.email, "full_name": u.full_name,
             "roll_number": getattr(getattr(u, "student_profile", None), "roll_number", "")}
            for u in qs
        ])


# ---------- Faculty ----------

class FacultySubjectListView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def get(self, request):
        links = (FacultySubject.objects.filter(faculty=request.user)
                 .select_related("subject")
                 .annotate(active_students=Count("subject__enrollments", filter=Q(subject__enrollments__status=EnrollmentStatus.ACTIVE))))
        if request.user.role == Role.ADMIN:
            subjects = Subject.objects.all().annotate(active_students=Count("enrollments", filter=Q(enrollments__status=EnrollmentStatus.ACTIVE)))
            return Response([{**SubjectSerializer(s).data, "assignment_status": "admin", "active_students": s.active_students} for s in subjects])
        return Response([
            {**SubjectSerializer(link.subject).data, "assignment_status": link.status,
             "assigned_at": link.assigned_at, "active_students": link.active_students}
            for link in links
        ])


# ---------- Student ----------

class StudentSubjectListView(APIView):
    permission_classes = [IsStudent]

    def get(self, request):
        enrollments = list(Enrollment.objects.filter(student=request.user, status=EnrollmentStatus.ACTIVE).select_related("subject"))
        faculty = subject_faculty_names([e.subject_id for e in enrollments])
        return Response([
            {**SubjectSerializer(e.subject).data, "enrollment_id": str(e.id), "enrolled_at": e.enrolled_at,
             "faculty_names": faculty.get(e.subject_id, [])}
            for e in enrollments if e.subject.status == "active"
        ])


def subject_faculty_names(subject_ids):
    """Active faculty names per subject id, in one query (shown to enrolled students)."""
    names = {}
    for link in (FacultySubject.objects.filter(subject_id__in=subject_ids, status=AssignmentStatus.ACTIVE)
                 .select_related("faculty").order_by("faculty__full_name")):
        names.setdefault(link.subject_id, []).append(link.faculty.full_name)
    return names
