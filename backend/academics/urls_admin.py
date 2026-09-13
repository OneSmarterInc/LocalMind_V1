from django.urls import path
from . import views

urlpatterns = [
    path("subjects/", views.AdminSubjectListCreateView.as_view(), name="admin-subject-list"),
    path("subjects/<uuid:subject_id>/", views.AdminSubjectDetailView.as_view(), name="admin-subject-detail"),
    path("subjects/<uuid:subject_id>/status/", views.AdminSubjectStatusView.as_view(), name="admin-subject-status"),
    path("subjects/<uuid:subject_id>/faculty/", views.AdminSubjectFacultyView.as_view(), name="admin-subject-faculty"),
    path("subjects/<uuid:subject_id>/faculty/<uuid:faculty_id>/", views.AdminSubjectFacultyView.as_view(), name="admin-subject-faculty-remove"),
    path("subjects/<uuid:subject_id>/students/", views.SubjectStudentsView.as_view(), name="admin-subject-students"),
    path("subjects/<uuid:subject_id>/students/<uuid:student_id>/discontinue/", views.SubjectStudentDiscontinueView.as_view(), name="admin-subject-student-discontinue"),
    path("faculty/<uuid:user_id>/subjects/", views.AdminFacultyAssignSubjectsView.as_view(), name="admin-faculty-subjects"),
    path("students/search/", views.StudentSearchView.as_view(), name="admin-student-search"),
]
