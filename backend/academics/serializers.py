from rest_framework import serializers

from accounts.serializers import UserSerializer
from .models import Enrollment, FacultySubject, Subject


class SubjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Subject
        fields = ["id", "name", "code", "description", "status", "created_at", "updated_at", "discontinued_at", "archived_at"]
        read_only_fields = ["id", "status", "created_at", "updated_at", "discontinued_at", "archived_at"]


class SubjectCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    code = serializers.CharField(max_length=32)
    description = serializers.CharField(required=False, allow_blank=True)


class SubjectUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200, required=False)
    description = serializers.CharField(required=False, allow_blank=True)


class SubjectStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["active", "discontinued", "archived"])


class FacultySubjectSerializer(serializers.ModelSerializer):
    subject = SubjectSerializer(read_only=True)
    faculty = UserSerializer(read_only=True)

    class Meta:
        model = FacultySubject
        fields = ["id", "faculty", "subject", "status", "assigned_at", "discontinued_at"]


class FacultySubjectBriefSerializer(serializers.ModelSerializer):
    faculty_id = serializers.UUIDField(read_only=True)
    email = serializers.EmailField(source="faculty.email", read_only=True)
    full_name = serializers.CharField(source="faculty.full_name", read_only=True)

    class Meta:
        model = FacultySubject
        fields = ["id", "faculty_id", "email", "full_name", "status", "assigned_at", "discontinued_at"]


class EnrollmentSerializer(serializers.ModelSerializer):
    subject = SubjectSerializer(read_only=True)
    student_id = serializers.UUIDField(read_only=True)
    student_email = serializers.EmailField(source="student.email", read_only=True)
    student_name = serializers.CharField(source="student.full_name", read_only=True)

    class Meta:
        model = Enrollment
        fields = ["id", "student_id", "student_email", "student_name", "subject", "status",
                  "enrolled_at", "discontinued_at", "completed_at"]


class AssignFacultySerializer(serializers.Serializer):
    faculty_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)


class EnrollStudentsSerializer(serializers.Serializer):
    student_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)
