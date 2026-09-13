"""Reference data the client reads instead of hardcoding it."""
from django.urls import path

from .views_meta import ChoicesView

urlpatterns = [path("choices/", ChoicesView.as_view(), name="meta-choices")]
