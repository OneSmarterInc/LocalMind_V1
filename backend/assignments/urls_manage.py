from django.urls import path
from . import views

urlpatterns = [
    path("assignments/", views.AssignmentListCreateView.as_view(), name="assignments-list"),
    path("assignments/generate/", views.AssignmentGenerateView.as_view(), name="assignments-generate"),
    path("assignments/<uuid:assignment_id>/", views.AssignmentDetailView.as_view(), name="assignments-detail"),
    path("assignments/<uuid:assignment_id>/status/", views.AssignmentStatusView.as_view(), name="assignments-status"),
    path("assignments/<uuid:assignment_id>/submissions/", views.AssignmentSubmissionsView.as_view(), name="assignments-submissions"),
    path("assignments/<uuid:assignment_id>/release-results/", views.AssignmentReleaseResultsView.as_view(), name="assignments-release-results"),
    path("assignment-submissions/<uuid:submission_id>/evaluate/", views.SubmissionEvaluateView.as_view(), name="assignment-submission-evaluate"),
]
