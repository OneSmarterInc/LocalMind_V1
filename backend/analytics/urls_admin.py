from django.urls import path
from .views import AdminAIStatusView, AdminOverviewView, AdminSubjectsView

urlpatterns = [
    path("analytics/platform/", AdminOverviewView.as_view(), name="admin-analytics-platform"),
    path("analytics/platform/subjects/", AdminSubjectsView.as_view(), name="admin-analytics-platform-subjects"),
    path("ai/status/", AdminAIStatusView.as_view(), name="admin-ai-status"),
]
