"""Mounted under both /api/admin/ and /api/faculty/; scoping happens in views."""
from django.urls import path
from . import views

urlpatterns = [
    path("documents/", views.DocumentListUploadView.as_view(), name="documents-list"),
    path("documents/<uuid:document_id>/", views.DocumentDetailView.as_view(), name="documents-detail"),
    path("documents/<uuid:document_id>/process/", views.ProcessView.as_view(), name="documents-process"),
    path("documents/<uuid:document_id>/outline/", views.OutlineView.as_view(), name="documents-outline"),
    path("documents/<uuid:document_id>/ready/", views.MarkReadyView.as_view(), name="documents-ready"),
    path("documents/<uuid:document_id>/publish/", views.PublishView.as_view(), name="documents-publish"),
    path("documents/<uuid:document_id>/unpublish/", views.UnpublishView.as_view(), name="documents-unpublish"),
    path("documents/<uuid:document_id>/archive/", views.ArchiveView.as_view(), name="documents-archive"),
    path("documents/<uuid:document_id>/lessons/", views.DocumentLessonsView.as_view(), name="documents-lessons"),
    path("documents/<uuid:document_id>/auto-quizzes/", views.DocumentAutoQuizzesView.as_view(), name="documents-auto-quizzes"),
    path("chapters/<uuid:chapter_id>/", views.ChapterEditView.as_view(), name="chapters-edit"),
    path("chapters/<uuid:chapter_id>/availability/", views.ChapterAvailabilityView.as_view(), name="chapters-availability"),
    path("modules/<uuid:module_id>/", views.ModuleEditView.as_view(), name="modules-edit"),
    path("modules/<uuid:module_id>/availability/", views.ModuleAvailabilityView.as_view(), name="modules-availability"),
    path("modules/<uuid:module_id>/lesson/", views.ModuleLessonView.as_view(), name="modules-lesson"),
    path("modules/<uuid:module_id>/auto-quiz/", views.ModuleAutoQuizView.as_view(), name="modules-auto-quiz"),
]
