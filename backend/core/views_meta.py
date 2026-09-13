"""Model choices, published so the client never has to restate them.

Every filter chip in the app used to carry its own copy of a status list. That
list drifted the moment a TextChoices class changed, and nothing failed loudly
when it did. These views read the enums straight off the models, so a status
added or renamed in Django appears in the UI on the next request with the label
Django already declares for it.
"""
from rest_framework.response import Response
from rest_framework.views import APIView

from academics.models import SubjectStatus
from accounts.models import AccountStatus, Role
from assessments.models import AssessmentKind, AssessmentStatus, AttemptStatus
from assignments.models import AssignmentStatus, SubmissionStatus
from documents.models import DocumentStatus

# Lifecycle states that still exist on old rows but can no longer be reached:
# subjects and books are deleted instead of archived, and accounts are deleted
# instead of discontinued. They stay in the models so historic rows keep their
# meaning; they are simply not offered as filters. This is the one place that
# decision lives, rather than a hardcoded array in each screen.
RETIRED = {
    "subject_status": {SubjectStatus.ARCHIVED},
    "document_status": {DocumentStatus.ARCHIVED},
    "account_status": {AccountStatus.DISCONTINUED},
    "quiz_status": {AssessmentStatus.SUPERSEDED},
}


def _choices(enum, key):
    retired = RETIRED.get(key, set())
    return [
        {"value": value, "label": label}
        for value, label in enum.choices
        if value not in {str(r) for r in retired}
    ]


class ChoicesView(APIView):
    """GET /api/meta/choices/ — every enum the client renders as a filter."""

    def get(self, request):
        sets = {
            "subject_status": SubjectStatus,
            "document_status": DocumentStatus,
            "quiz_status": AssessmentStatus,
            "quiz_kind": AssessmentKind,
            "attempt_status": AttemptStatus,
            "assignment_status": AssignmentStatus,
            "submission_status": SubmissionStatus,
            "account_status": AccountStatus,
            "role": Role,
        }
        return Response({key: _choices(enum, key) for key, enum in sets.items()})
