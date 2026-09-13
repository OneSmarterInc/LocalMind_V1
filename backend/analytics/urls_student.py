from django.urls import path
from .views import StudentOverviewView, StudentSessionsView, StudentSubjectView

urlpatterns = [
    path("analytics/overview/", StudentOverviewView.as_view(), name="student-analytics-overview"),
    path("analytics/subjects/<uuid:subject_id>/", StudentSubjectView.as_view(), name="student-analytics-subject"),
    path("analytics/sessions/", StudentSessionsView.as_view(), name="student-analytics-sessions"),
]
