from django.urls import path
from . import views

urlpatterns = [
    path("assignments/", views.StudentAssignmentListView.as_view(), name="student-assignments"),
    path("assignments/<uuid:assignment_id>/submissions/", views.StudentSubmitView.as_view(), name="student-assignment-submit"),
    path("assignment-submissions/", views.StudentSubmissionsView.as_view(), name="student-assignment-submissions"),
]
