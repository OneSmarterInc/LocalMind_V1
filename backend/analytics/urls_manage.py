from django.urls import path
from .views import (OverviewView, StudentDetailView, TeachingActivityView, StudentSubjectDetailView, SubjectModulesView, SubjectStudentsView,
                    SubjectSummaryView, UserSessionsView)

urlpatterns = [
    path("analytics/overview/", OverviewView.as_view(), name="manage-analytics-overview"),
    path("analytics/activity/", TeachingActivityView.as_view(), name="manage-analytics-activity"),
    path("analytics/subjects/<uuid:subject_id>/", SubjectSummaryView.as_view(), name="manage-analytics-subject"),
    path("analytics/subjects/<uuid:subject_id>/students/", SubjectStudentsView.as_view(), name="manage-analytics-subject-students"),
    path("analytics/subjects/<uuid:subject_id>/modules/", SubjectModulesView.as_view(), name="manage-analytics-subject-modules"),
    path("analytics/students/<uuid:student_id>/", StudentDetailView.as_view(), name="manage-analytics-student"),
    path("analytics/students/<uuid:student_id>/subjects/<uuid:subject_id>/", StudentSubjectDetailView.as_view(), name="manage-analytics-student-subject"),
    path("analytics/users/<uuid:user_id>/sessions/", UserSessionsView.as_view(), name="manage-analytics-user-sessions"),
]
