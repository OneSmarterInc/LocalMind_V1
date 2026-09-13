from django.urls import path
from . import views

urlpatterns = [
    path("modules/<uuid:module_id>/teach/", views.TeachView.as_view(), name="student-teach"),
    path("modules/<uuid:module_id>/ask/", views.AskView.as_view(), name="student-ask"),
    path("conversations/", views.ConversationListView.as_view(), name="student-conversations"),
    path("conversations/<uuid:conversation_id>/", views.ConversationDetailView.as_view(), name="student-conversation"),
    path("quiz-attempts/<uuid:attempt_id>/remediation/", views.RemediationView.as_view(), name="student-remediation"),
]
