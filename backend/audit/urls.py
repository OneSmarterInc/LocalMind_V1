from django.urls import path

from .views import AuditActionsView, AuditLogListView

urlpatterns = [
    path("audit-logs/", AuditLogListView.as_view(), name="admin-audit-logs"),
    path("audit-logs/actions/", AuditActionsView.as_view(), name="admin-audit-actions"),
]
