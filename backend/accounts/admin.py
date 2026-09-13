from django.contrib import admin
from .models import FacultyProfile, StudentProfile, User


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ("email", "full_name", "role", "status", "must_change_password", "created_at")
    list_filter = ("role", "status")
    search_fields = ("email", "full_name")
    readonly_fields = ("password", "created_at", "updated_at", "password_changed_at")


admin.site.register(FacultyProfile)
admin.site.register(StudentProfile)
