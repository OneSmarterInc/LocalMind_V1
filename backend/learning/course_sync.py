"""Version-bound course downloads and idempotent ingestion of device work."""
import hashlib
import json
from uuid import UUID
from datetime import timedelta
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.core import signing
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.contrib.auth import get_user_model
from rest_framework.response import Response
from rest_framework.views import APIView
from core.permissions import IsStudent
from core.exceptions import Conflict, Forbidden, ValidationFailed
from assessments.services import assessments as quizzes
from assessments.serializers import AssessmentStudentSerializer, AttemptSerializer
from assessments.models import AssessmentAttempt, AttemptStatus
from . import services
from .models import CourseSyncReceipt

SALT = 'localmind.course-offline.v1'

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()

def revision(quiz):
    return digest({'questions': quiz.questions, 'version': quiz.version, 'pass': quiz.pass_percentage,
                   'release': quiz.results_release, 'release_at': quiz.results_release_at,
                   'due': quiz.due_at, 'from': quiz.available_from, 'limit': quiz.time_limit_minutes})

def packages(student):
    out = {}
    for quiz in quizzes.student_visible(student):
        if not quiz.questions or any(q['type'] != 'mcq' for q in quiz.questions):
            continue
        data = {'quiz': AssessmentStudentSerializer(quiz).data, 'questions': quizzes.student_questions(quiz),
                'grant': signing.dumps({'student': str(student.pk), 'quiz': str(quiz.pk), 'revision': revision(quiz)}, salt=SALT),
                'attempts_used': quiz.attempts.filter(student=student).count()}
        # Held/scheduled keys are never distributed for local marking.
        if quiz.results_release == 'immediate':
            data['marking'] = quiz.questions
        out[str(quiz.pk)] = data
    return out

def result(attempt):
    return AttemptSerializer(attempt).data if attempt.results_visible else quizzes.withhold(attempt)

class CourseSyncView(APIView):
    permission_classes = [IsStudent]

    @transaction.atomic
    def post(self, request):
        data = request.data
        if not isinstance(data, dict) or len(json.dumps(data)) > 100000:
            raise ValidationFailed('Invalid or oversized sync event.')
        try:
            event_id = UUID(str(data.get('id')))
        except (ValueError, TypeError):
            raise ValidationFailed('A stable event UUID is required.')
        # Serialize all device replays for this student; receipt and effects commit together.
        get_user_model().objects.select_for_update().get(pk=request.user.pk)
        fingerprint = digest(data)
        old = CourseSyncReceipt.objects.filter(student=request.user, event_id=event_id).first()
        if old:
            if old.payload_hash != fingerprint:
                raise Conflict('This event ID was already used with different data.')
            if old.attempt_id:
                attempt = AssessmentAttempt.objects.select_related('assessment').get(pk=old.attempt_id, student=request.user)
                return Response({'attempt': result(attempt), 'server_id': str(attempt.pk)})
            if old.response.get('server_id'):
                raise Conflict('This previously received attempt was removed by the institution.')
            return Response(old.response)
        kind = data.get('kind')
        attempt = None
        if kind in ('read', 'lesson', 'time'):
            try:
                module_id = UUID(str(data.get('module_id')))
            except (ValueError, TypeError):
                raise ValidationFailed('A valid module ID is required.')
            module = services.resolve_accessible_module(request.user, module_id)
            if kind in ('read','lesson'):
                progress = services.record_module_view(request.user, module)
                if kind == 'lesson':
                    progress.lesson_viewed_at = timezone.now()
                    progress.save(update_fields=['lesson_viewed_at','updated_at'])
                response = {'recorded': True, 'kind':kind, 'module_id':str(module.pk)}
            else:
                seconds = data.get('seconds')
                if isinstance(seconds, bool) or not isinstance(seconds, int) or not 0 <= seconds <= 900:
                    raise ValidationFailed('Seconds must be an integer between 0 and 900.')
                from activity.services import record_learning_time
                response = {'learning_seconds': record_learning_time(request.user, module, seconds)}
        elif kind == 'quiz':
            if not isinstance(data.get('grant'), str):
                raise Forbidden('Invalid downloaded quiz authorization.')
            try:
                grant = signing.loads(data['grant'], salt=SALT)
            except (signing.BadSignature, TypeError):
                raise Forbidden('Invalid downloaded quiz authorization.')
            if grant.get('student') != str(request.user.pk):
                raise Forbidden('This quiz download belongs to another student.')
            quiz = quizzes._accessible_for_student(request.user, grant.get('quiz'))
            if revision(quiz) != grant.get('revision'):
                raise Conflict('The downloaded quiz or its rules changed. Answers remain on your device for review.', code='OFFLINE_VERSION_CHANGED')
            answers = data.get('answers')
            allowed = {q['id']: {o['key'] for o in q['options']} for q in quiz.questions if q['type'] == 'mcq'}
            if len(allowed) != len(quiz.questions) or not isinstance(answers, dict) or any(k not in allowed or not isinstance(v, str) or v not in allowed[k] | {''} for k, v in answers.items()):
                raise ValidationFailed('Answers must match this downloaded MCQ version.')
            server_id = data.get('server_attempt_id')
            if server_id:
                try:
                    server_id = UUID(str(server_id))
                except (ValueError, TypeError):
                    raise ValidationFailed('Invalid server attempt ID.')
                attempt = AssessmentAttempt.objects.select_for_update().filter(pk=server_id, student=request.user, assessment=quiz).first()
                if not attempt or attempt.status != AttemptStatus.IN_PROGRESS:
                    raise Conflict('The server attempt is no longer open. Local answers are retained.')
            else:
                attempt, created = quizzes.start_attempt(request.user, quiz.pk, request)
                if not created:
                    raise Conflict('Another attempt is already open on the server. Local answers are retained.', code='OFFLINE_ATTEMPT_CONFLICT')
            started = parse_datetime(str(data.get('started_at', '')))
            submitted = parse_datetime(str(data.get('submitted_at', '')))
            if not started or not submitted or timezone.is_naive(started) or timezone.is_naive(submitted) or submitted < started:
                raise ValidationFailed('Valid device start and submission timestamps are required.')
            elapsed = min(int((submitted-started).total_seconds()), 24*3600)
            if not server_id:
                attempt.started_at = timezone.now()-timedelta(seconds=elapsed)
                attempt.save(update_fields=['started_at'])
            attempt = quizzes.submit_attempt(request.user, attempt.pk, answers, request)
            # Device timestamps are evidence, never authorization to bypass deadlines.
            attempt.evaluation_notes = {**attempt.evaluation_notes, 'offline_event_id': str(event_id),
                                       'device_started_at': str(data.get('started_at', ''))[:50],
                                       'device_submitted_at': str(data.get('submitted_at', ''))[:50]}
            attempt.save(update_fields=['evaluation_notes', 'updated_at'])
            response = {'attempt': result(attempt), 'server_id': str(attempt.pk)}
        else:
            raise ValidationFailed('Unknown sync event kind.')
        response = json.loads(json.dumps(response, cls=DjangoJSONEncoder))
        CourseSyncReceipt.objects.create(student=request.user, event_id=event_id, payload_hash=fingerprint, response=response, attempt=attempt)
        return Response(response)
