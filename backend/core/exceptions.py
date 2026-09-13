"""Structured API errors.

Every non-2xx response has the shape
    {"error": {"code": "...", "message": "...", "details": {...}}}
Views and services raise APIError (or its subclasses); DRF's own exceptions
are translated to the same envelope in exception_handler.
"""
import logging

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404
from rest_framework import exceptions as drf_exceptions
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

logger = logging.getLogger("localmind.api")


class APIError(Exception):
    status_code = status.HTTP_400_BAD_REQUEST
    code = "BAD_REQUEST"
    message = "The request could not be processed."

    def __init__(self, message=None, *, code=None, status_code=None, details=None):
        self.message = message or self.message
        self.code = code or self.code
        self.status_code = status_code or self.status_code
        self.details = details or {}
        super().__init__(self.message)

    def to_response(self):
        payload = {"error": {"code": self.code, "message": self.message}}
        if self.details:
            payload["error"]["details"] = self.details
        return Response(payload, status=self.status_code)


class ValidationFailed(APIError):
    code = "VALIDATION_ERROR"
    message = "Validation failed."


class NotFound(APIError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "NOT_FOUND"
    message = "The requested resource was not found."


class Forbidden(APIError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "FORBIDDEN"
    message = "You do not have permission to perform this action."


class Conflict(APIError):
    status_code = status.HTTP_409_CONFLICT
    code = "CONFLICT"
    message = "The request conflicts with the current state of the resource."


class AIUnavailable(APIError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "AI_UNAVAILABLE"
    message = "The AI service is currently unavailable."


def _drf_code(exc):
    if isinstance(exc, drf_exceptions.NotAuthenticated):
        return "AUTHENTICATION_REQUIRED"
    if isinstance(exc, drf_exceptions.AuthenticationFailed):
        return "AUTHENTICATION_FAILED"
    if isinstance(exc, drf_exceptions.PermissionDenied):
        return getattr(exc, "code", None) or "FORBIDDEN"
    if isinstance(exc, drf_exceptions.NotFound):
        return "NOT_FOUND"
    if isinstance(exc, drf_exceptions.ValidationError):
        return "VALIDATION_ERROR"
    if isinstance(exc, drf_exceptions.Throttled):
        return "RATE_LIMITED"
    if isinstance(exc, drf_exceptions.MethodNotAllowed):
        return "METHOD_NOT_ALLOWED"
    if isinstance(exc, drf_exceptions.UnsupportedMediaType):
        return "UNSUPPORTED_MEDIA_TYPE"
    return "ERROR"


def exception_handler(exc, context):
    if isinstance(exc, APIError):
        return exc.to_response()

    if isinstance(exc, Http404):
        exc = drf_exceptions.NotFound()
    elif isinstance(exc, DjangoPermissionDenied):
        exc = drf_exceptions.PermissionDenied()
    elif isinstance(exc, DjangoValidationError):
        exc = drf_exceptions.ValidationError(exc.message_dict if hasattr(exc, "message_dict") else exc.messages)

    response = drf_exception_handler(exc, context)
    if response is None:
        logger.exception("Unhandled exception in %s", context.get("view"))
        return Response(
            {"error": {"code": "INTERNAL_ERROR", "message": "An unexpected error occurred."}},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    code = _drf_code(exc)
    detail = response.data
    if isinstance(exc, drf_exceptions.ValidationError):
        payload = {"error": {"code": code, "message": "Validation failed.", "details": detail}}
    else:
        message = detail.get("detail", str(detail)) if isinstance(detail, dict) else str(detail)
        payload = {"error": {"code": code, "message": str(message)}}
    response.data = payload
    return response
