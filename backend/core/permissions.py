"""Role and account-state permissions.

Every protected endpoint passes through IsAuthenticated, AccountActive and
PasswordChangeCompleted (configured globally). Role permissions are added per
view. Object-level academic access (subject assignment, enrollment) is enforced
by the scoped querysets in each app's services rather than by these classes.
"""
from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied


class _CodedDenied(PermissionDenied):
    def __init__(self, code, detail):
        super().__init__(detail=detail)
        self.code = code


class AccountActive(permissions.BasePermission):
    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return True  # IsAuthenticated handles anonymous users
        if not user.is_active:
            raise _CodedDenied("ACCOUNT_INACTIVE", "This account is not active.")
        return True


class PasswordChangeCompleted(permissions.BasePermission):
    """Blocks every endpoint except those marked allow_password_change=True."""

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return True
        if getattr(view, "allow_password_change", False):
            return True
        if user.must_change_password:
            raise _CodedDenied(
                "PASSWORD_CHANGE_REQUIRED",
                "You must change your password before continuing.",
            )
        return True


PORTAL_ROLES = {"/api/admin/": ("admin",), "/api/faculty/": ("admin", "faculty"), "/api/student/": ("student",)}


def portal_allows(request) -> bool:
    """The URL prefix is a portal. A token is only honoured on the portal for
    its role (admins may also use the faculty portal, since they manage every
    subject). Shared views mounted under two prefixes therefore behave as two
    distinct portal endpoints."""
    path = request.path
    for prefix, roles in PORTAL_ROLES.items():
        if path.startswith(prefix):
            return request.user.role in roles
    return True


class _RolePermission(permissions.BasePermission):
    """Role gate that also re-applies the account-state gates, so a view that
    sets permission_classes=[IsStudent] cannot accidentally drop them."""

    roles: tuple[str, ...] = ()

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        AccountActive().has_permission(request, view)
        PasswordChangeCompleted().has_permission(request, view)
        return user.role in self.roles and portal_allows(request)


class IsAdmin(_RolePermission):
    roles = ("admin",)


class IsFaculty(_RolePermission):
    roles = ("faculty",)


class IsStudent(_RolePermission):
    roles = ("student",)


class IsAdminOrFaculty(_RolePermission):
    roles = ("admin", "faculty")
