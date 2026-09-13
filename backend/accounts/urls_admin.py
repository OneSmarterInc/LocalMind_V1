from django.urls import path

from .models import Role
from .views_admin import role_views

urlpatterns = []
for prefix, role in (("faculty", Role.FACULTY), ("students", Role.STUDENT)):
    v = role_views(role)
    urlpatterns += [
        path(f"{prefix}/", v["list"].as_view(), name=f"admin-{prefix}-list"),
        path(f"{prefix}/import/", v["import"].as_view(), name=f"admin-{prefix}-import"),
        path(f"{prefix}/import/template/", v["import_template"].as_view(), name=f"admin-{prefix}-import-template"),
        path(f"{prefix}/<uuid:user_id>/", v["detail"].as_view(), name=f"admin-{prefix}-detail"),
        path(f"{prefix}/<uuid:user_id>/discontinue/", v["discontinue"].as_view(), name=f"admin-{prefix}-discontinue"),
        path(f"{prefix}/<uuid:user_id>/reactivate/", v["reactivate"].as_view(), name=f"admin-{prefix}-reactivate"),
        path(f"{prefix}/<uuid:user_id>/reset-password/", v["reset_password"].as_view(), name=f"admin-{prefix}-reset-password"),
    ]
