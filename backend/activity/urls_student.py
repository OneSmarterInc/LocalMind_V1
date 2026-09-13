from django.urls import path
from .views import ModuleTimeView

urlpatterns = [path("modules/<uuid:module_id>/time/", ModuleTimeView.as_view(), name="student-module-time")]
