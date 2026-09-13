from rest_framework import serializers
from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = [
            "id", "actor", "actor_email", "actor_role", "action",
            "target_type", "target_id", "target_label", "summary",
            "ip_address", "created_at",
        ]
