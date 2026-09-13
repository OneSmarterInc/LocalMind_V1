from django.urls import path

from . import views

urlpatterns = [
    path("monitor/subjects/", views.SubjectsView.as_view(), name="faculty-monitor-subjects"),
    path("monitor/impact/users/", views.UserImpactView.as_view(), name="faculty-monitor-impact-users"),
    path("monitor/incidents/", views.IncidentListView.as_view(), name="faculty-monitor-incidents"),
    path("monitor/incidents/<uuid:incident_id>/", views.IncidentDetailView.as_view(), name="faculty-monitor-incident"),
    path("monitor/incidents/<uuid:incident_id>/review/", views.IncidentReviewView.as_view(), name="faculty-monitor-incident-review"),
    path("monitor/evaluations/", views.EvaluationListView.as_view(), name="faculty-monitor-evaluations"),
    path("monitor/evaluations/<uuid:evaluation_id>/", views.EvaluationDetailView.as_view(), name="faculty-monitor-evaluation"),
    path("monitor/evaluations/<uuid:evaluation_id>/feedback/", views.EvaluationFeedbackView.as_view(), name="faculty-monitor-evaluation-feedback"),
]
