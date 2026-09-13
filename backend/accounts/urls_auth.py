from django.urls import path
from .views_auth import ChangePasswordView, LogoutView, MeView, RefreshView, RoleLoginView

urlpatterns = [
    path("login/<str:role>/", RoleLoginView.as_view(), name="auth-login"),
    path("refresh/", RefreshView.as_view(), name="auth-refresh"),
    path("logout/", LogoutView.as_view(), name="auth-logout"),
    path("me/", MeView.as_view(), name="auth-me"),
    path("password/change/", ChangePasswordView.as_view(), name="auth-password-change"),
]
