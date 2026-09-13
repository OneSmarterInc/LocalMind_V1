from django.urls import path
from .views import StudentBooks, DownloadBook
urlpatterns = [path("private-library/", StudentBooks.as_view()), path("private-library/<str:kind>/<uuid:book_id>/download/", DownloadBook.as_view())]
