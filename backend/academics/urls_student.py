from django.urls import path
from . import views

urlpatterns = [
    path("subjects/", views.StudentSubjectListView.as_view(), name="student-subject-list"),
]
