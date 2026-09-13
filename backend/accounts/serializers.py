from rest_framework import serializers

from .models import FacultyProfile, Role, StudentProfile, User


class FacultyProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = FacultyProfile
        fields = ["employee_id", "department", "designation", "phone"]


class StudentProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentProfile
        fields = ["roll_number", "program", "batch", "phone"]


class UserSerializer(serializers.ModelSerializer):
    profile = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "email", "full_name", "role", "status", "must_change_password",
            "password_changed_at", "discontinued_at", "created_at", "updated_at", "profile",
        ]
        read_only_fields = fields

    def get_profile(self, user) -> dict:
        if user.role == Role.FACULTY and hasattr(user, "faculty_profile"):
            return FacultyProfileSerializer(user.faculty_profile).data
        if user.role == Role.STUDENT and hasattr(user, "student_profile"):
            return StudentProfileSerializer(user.student_profile).data
        return None


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)


class RefreshSerializer(serializers.Serializer):
    refresh = serializers.CharField()


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, trim_whitespace=False)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False, min_length=1)


class CreateUserSerializer(serializers.Serializer):
    email = serializers.EmailField()
    full_name = serializers.CharField(max_length=200)
    profile = serializers.DictField(child=serializers.CharField(allow_blank=True), required=False)
    subject_ids = serializers.ListField(child=serializers.UUIDField(), required=False)


class UpdateUserSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=200, required=False)
    profile = serializers.DictField(child=serializers.CharField(allow_blank=True), required=False)


class DiscontinueSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, max_length=500)


class ImportUsersSerializer(serializers.Serializer):
    file = serializers.FileField()

    def validate_file(self, value):
        name = (value.name or "").lower()
        if not name.endswith(".xlsx"):
            raise serializers.ValidationError("Only .xlsx workbooks are supported.")
        if value.size > 10 * 1024 * 1024:
            raise serializers.ValidationError("Workbook exceeds the 10 MB limit.")
        return value
