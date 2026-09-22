from rest_framework import serializers

from .categories import category_of, is_failure
from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    # Name at read time: the row keeps the email it was written with, but a
    # renamed or deleted account should still read sensibly on the screen.
    actor_name = serializers.SerializerMethodField()
    category = serializers.SerializerMethodField()
    failed = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = [
            "id", "actor", "actor_email", "actor_name", "actor_role", "action",
            "category", "failed", "target_type", "target_id", "target_label",
            "summary", "ip_address", "created_at",
        ]

    def get_actor_name(self, obj):
        user = obj.actor
        return ((getattr(user, "full_name", "") or "").strip() or None) if user else None

    def get_category(self, obj):
        return category_of(obj.action)

    def get_failed(self, obj):
        return is_failure(obj.action)
