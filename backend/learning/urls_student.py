from django.urls import path
from . import views
from .offline import StudentOfflineBundleView

urlpatterns = [
    path("subjects/<uuid:subject_id>/documents/", views.StudentSubjectDocumentsView.as_view(), name="student-subject-documents"),
    path("documents/<uuid:document_id>/", views.StudentDocumentView.as_view(), name="student-document"),
    path("modules/<uuid:module_id>/", views.StudentModuleView.as_view(), name="student-module"),
    path("offline/", StudentOfflineBundleView.as_view(), name="student-offline-bundle"),
]
