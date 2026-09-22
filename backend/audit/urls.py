from django.urls import path

from .views import AuditActionsView, AuditExportView, AuditLogListView, AuditSummaryView

urlpatterns = [
    path("audit-logs/", AuditLogListView.as_view(), name="admin-audit-logs"),
    path("audit-logs/actions/", AuditActionsView.as_view(), name="admin-audit-actions"),
    path("audit-logs/summary/", AuditSummaryView.as_view(), name="admin-audit-summary"),
    path("audit-logs/export/", AuditExportView.as_view(), name="admin-audit-export"),
]
