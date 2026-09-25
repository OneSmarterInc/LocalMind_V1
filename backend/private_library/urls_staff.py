from django.urls import path
from .views import StaffBooks, StaffBookDetail
urlpatterns = [path("private-library/", StaffBooks.as_view()), path("private-library/<uuid:book_id>/", StaffBookDetail.as_view())]
