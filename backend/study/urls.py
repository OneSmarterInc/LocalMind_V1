from django.urls import path
from .views import AuthoringView, AssetUploadView, PackageDownloadView, ObservationView, AggregateView, AssetPreviewView
urlpatterns = [
    path("authoring/<uuid:document_id>/", AuthoringView.as_view()),
    path("authoring/<uuid:document_id>/assets/", AssetUploadView.as_view()),
    path("authoring/<uuid:document_id>/assets/<uuid:asset_id>/", AssetPreviewView.as_view()),
    path("authoring/<uuid:document_id>/aggregates/", AggregateView.as_view()),
    path("packages/<uuid:document_id>/<int:version>/", PackageDownloadView.as_view()),
    path("observations/", ObservationView.as_view()),
]
