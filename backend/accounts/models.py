import uuid

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.utils import timezone


class Role(models.TextChoices):
    ADMIN = "admin", "Admin"
    FACULTY = "faculty", "Faculty"
    STUDENT = "student", "Student"


class AccountStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    DISCONTINUED = "discontinued", "Discontinued"
    LOCKED = "locked", "Locked"


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create(self, email, password, role, **extra):
        if not email:
            raise ValueError("Email is required.")
        email = self.normalize_email(email).lower()
        user = self.model(email=email, role=role, **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, role=Role.STUDENT, **extra):
        return self._create(email, password, role, **extra)

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault("full_name", "Administrator")
        extra["is_superuser"] = True
        extra["must_change_password"] = False
        return self._create(email, password, Role.ADMIN, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    """Single identity table. Role and lifecycle status live here so every
    permission check is one row read. Role-specific attributes live on the
    profile models below.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=200)
    role = models.CharField(max_length=20, choices=Role.choices, db_index=True)
    status = models.CharField(
        max_length=20, choices=AccountStatus.choices, default=AccountStatus.ACTIVE, db_index=True
    )
    must_change_password = models.BooleanField(default=True)
    password_changed_at = models.DateTimeField(null=True, blank=True)
    discontinued_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="created_users"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Institution/organisation hook for later multi-tenancy. Nullable, unused today.
    organization_key = models.CharField(max_length=64, blank=True, db_index=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["full_name"]

    class Meta:
        db_table = "users"
        ordering = ["full_name", "email"]

    def __str__(self):
        return f"{self.full_name} <{self.email}>"

    # Django's auth backend and admin rely on these.
    @property
    def is_active(self):
        return self.status == AccountStatus.ACTIVE

    @property
    def is_staff(self):
        return self.role == Role.ADMIN

    @property
    def is_admin(self):
        return self.role == Role.ADMIN

    @property
    def is_faculty(self):
        return self.role == Role.FACULTY

    @property
    def is_student(self):
        return self.role == Role.STUDENT

    def mark_password_changed(self):
        self.must_change_password = False
        self.password_changed_at = timezone.now()


class FacultyProfile(models.Model):
    user = models.OneToOneField(User, primary_key=True, on_delete=models.CASCADE, related_name="faculty_profile")
    employee_id = models.CharField(max_length=64, blank=True, db_index=True)
    department = models.CharField(max_length=120, blank=True)
    designation = models.CharField(max_length=120, blank=True)
    phone = models.CharField(max_length=32, blank=True)

    def __str__(self):
        return f"Faculty profile for {self.user.email}"

    class Meta:
        db_table = "faculty_profiles"


class StudentProfile(models.Model):
    user = models.OneToOneField(User, primary_key=True, on_delete=models.CASCADE, related_name="student_profile")
    roll_number = models.CharField(max_length=64, blank=True, db_index=True)
    program = models.CharField(max_length=120, blank=True)
    batch = models.CharField(max_length=64, blank=True)
    phone = models.CharField(max_length=32, blank=True)

    def __str__(self):
        return f"Student profile for {self.user.email}"

    class Meta:
        db_table = "student_profiles"
