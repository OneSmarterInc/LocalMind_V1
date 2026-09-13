from django.urls import path
from . import views

urlpatterns = [
    path("subjects/", views.FacultySubjectListView.as_view(), name="faculty-subject-list"),
    path("subjects/<uuid:subject_id>/students/", views.SubjectStudentsView.as_view(), name="faculty-subject-students"),
    path("subjects/<uuid:subject_id>/students/<uuid:student_id>/discontinue/", views.SubjectStudentDiscontinueView.as_view(), name="faculty-subject-student-discontinue"),
    path("students/search/", views.StudentSearchView.as_view(), name="faculty-student-search"),
]
