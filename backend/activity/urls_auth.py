from django.urls import path
from .views import HeartbeatView

urlpatterns = [path("heartbeat/", HeartbeatView.as_view(), name="auth-heartbeat")]
