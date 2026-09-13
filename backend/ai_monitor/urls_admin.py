from django.urls import path

from . import views

urlpatterns = [
    path("monitor/overview/", views.OverviewView.as_view(), name="admin-monitor-overview"),
    path("monitor/trends/", views.TrendsView.as_view(), name="admin-monitor-trends"),
    path("monitor/subjects/", views.SubjectsView.as_view(), name="admin-monitor-subjects"),
    path("monitor/impact/users/", views.UserImpactView.as_view(), name="admin-monitor-impact-users"),
    path("monitor/status/", views.StatusView.as_view(), name="admin-monitor-status"),
    path("monitor/incidents/", views.IncidentListView.as_view(), name="admin-monitor-incidents"),
    path("monitor/incidents/<uuid:incident_id>/", views.IncidentDetailView.as_view(), name="admin-monitor-incident"),
    path("monitor/incidents/<uuid:incident_id>/review/", views.IncidentReviewView.as_view(), name="admin-monitor-incident-review"),
    path("monitor/incidents/<uuid:incident_id>/assign/", views.IncidentAssignView.as_view(), name="admin-monitor-incident-assign"),
    path("monitor/evaluations/", views.EvaluationListView.as_view(), name="admin-monitor-evaluations"),
    path("monitor/evaluations/<uuid:evaluation_id>/", views.EvaluationDetailView.as_view(), name="admin-monitor-evaluation"),
    path("monitor/evaluations/<uuid:evaluation_id>/feedback/", views.EvaluationFeedbackView.as_view(), name="admin-monitor-evaluation-feedback"),
    path("monitor/evaluations/<uuid:evaluation_id>/reevaluate/", views.ReevaluateView.as_view(), name="admin-monitor-evaluation-reevaluate"),
    path("monitor/evaluate/", views.EvaluateView.as_view(), name="admin-monitor-evaluate"),
    path("monitor/backlog/", views.BacklogView.as_view(), name="admin-monitor-backlog"),
    path("monitor/policies/", views.PolicyListView.as_view(), name="admin-monitor-policies"),
    path("monitor/policies/<str:issue_type>/", views.PolicyDetailView.as_view(), name="admin-monitor-policy"),
]
