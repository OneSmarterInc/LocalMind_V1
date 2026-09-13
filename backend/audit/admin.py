from django.contrib import admin
from .models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "actor_email", "action", "target_type", "target_label")
    list_filter = ("action", "target_type", "actor_role")
    search_fields = ("actor_email", "target_id", "target_label")
    readonly_fields = [f.name for f in AuditLog._meta.fields]
