"""Ingest reviewed device-generated work; this endpoint never invokes AI."""
from .services.visual_delivery import module_visuals, enrich_lesson

import hashlib
import json
import unicodedata
from uuid import UUID
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView
from core.exceptions import Conflict, ValidationFailed
from core.permissions import IsAdminOrFaculty
from core.utils import get_or_404
from learning.models import Module
from tutor.models import ModuleLesson
from tutor.lessons import source_hash
from .models import Document, LocalAuthoringReceipt


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True).encode()).hexdigest()


def revision(module):
    row = ModuleLesson.objects.filter(module=module).first()
    return digest({'source': module.source_text, 'document_version': module.chapter.document.content_version,
                   'lesson_version': row.version if row else 0})


def string(value, limit, name):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValidationFailed(f'Invalid {name}.')
    return value.strip()


def quotation(value, source):
    quote = string(value, 1200, 'quotation')
    norm = lambda s: ' '.join(unicodedata.normalize('NFKC', s).split()).lower()
    if len(quote) < 8 or norm(quote) not in norm(source):
        raise ValidationFailed('A quotation does not match the stored module source.')
    return quote


def checked_lesson(raw, module):
    if not isinstance(raw, dict):
        raise ValidationFailed('Invalid lesson.')
    sections = raw.get('sections')
    if not isinstance(sections, list) or not 1 <= len(sections) <= 300:
        raise ValidationFailed('A lesson needs complete explanatory sections.')
    out = []
    for section in sections:
        if not isinstance(section, dict):
            raise ValidationFailed('Invalid lesson section.')
        out.append({'heading': string(section.get('heading'), 160, 'heading'),
                    'explanation': string(section.get('content'), 1800, 'explanation'),
                    'source_reference': quotation(section.get('quote'), module.source_text)})
    takeaways = raw.get('takeaways')
    if not isinstance(takeaways, list) or not 1 <= len(takeaways) <= 300:
        raise ValidationFailed('Invalid lesson takeaways.')
    return {'title': module.title,
            'learning_objectives': [string(t, 400, 'takeaway') for t in takeaways],
            'sections': out, 'key_terms': [], 'summary': string(raw.get('introduction'), 1200, 'introduction')}


def checked_questions(raw, module):
    if not isinstance(raw, list) or not 1 <= len(raw) <= 30:
        raise ValidationFailed('Provide 1–30 complete questions.')
    questions = []
    for q in raw:
        if not isinstance(q, dict):
            raise ValidationFailed('Invalid question.')
        options = q.get('options')
        if not isinstance(options, list) or len(options) != 4 or type(q.get('answer')) is not int or not 0 <= q['answer'] <= 3:
            raise ValidationFailed('Invalid choices or answer key.')
        options = [string(o, 350, 'choice') for o in options]
        if len({o.casefold() for o in options}) != 4:
            raise ValidationFailed('Repeated choices are not valid.')
        questions.append({'type': 'mcq', 'question': string(q.get('question'), 600, 'question'),
                          'options': [{'key': chr(65+i), 'text': o} for i, o in enumerate(options)],
                          'correct_answer': chr(65+q['answer']),
                          'explanation': string(q.get('explanation'), 1000, 'explanation'),
                          'source_reference': quotation(q.get('quote'), module.source_text)})
    return questions


class LocalAuthoringView(APIView):
    permission_classes = [IsAdminOrFaculty]

    def module(self, actor, module_id):
        return get_or_404(Module.objects.filter(chapter__document__in=Document.objects.visible_to(actor))
                          .select_related('chapter__document__subject'), pk=module_id)

    def get(self, request, module_id):
        module = self.module(request.user, module_id)
        from assessments.models import AutoQuizJob
        lesson = ModuleLesson.objects.filter(module=module, status='ready').first()
        job = AutoQuizJob.objects.filter(module=module).select_related('assessment').first()
        quiz = job.assessment if job else None
        from .shared_status import for_module
        shared_quiz, lesson_by = for_module(module)
        quiz_by = None
        if quiz is None and shared_quiz:
            # A quiz synchronized from another faculty device is an ordinary
            # quiz, not an automatic one. Without this, other faculty saw no
            # institution quiz and generated the same module again.
            from assessments.models import Assessment
            quiz = Assessment.objects.filter(pk=shared_quiz['id']).first()
            quiz_by = shared_quiz['by']
        current_lesson = lesson and lesson.source_hash == source_hash(module.source_text)
        return Response({'module_id': str(module.pk), 'title': module.title, 'source': module.source_text,
                         'revision': revision(module), 'document_id': str(module.chapter.document_id),
                         'source_visuals': module_visuals(module),
                         'institution': {'lesson': enrich_lesson(lesson.lesson, module) if current_lesson else None,
                                         'lesson_by': lesson_by if current_lesson else None,
                                         'quiz': {'id': str(quiz.pk), 'status': quiz.status, 'questions': quiz.questions} if quiz else None,
                                         'quiz_by': quiz_by}})


    @transaction.atomic
    def post(self, request, module_id):
        data = request.data
        if not isinstance(data, dict) or len(json.dumps(data)) > 1_000_000:
            raise ValidationFailed('Invalid or oversized authoring operation.')
        try:
            operation = UUID(str(data.get('id')))
        except (TypeError, ValueError):
            raise ValidationFailed('A stable operation UUID is required.')
        get_user_model().objects.select_for_update().get(pk=request.user.pk)
        module = self.module(request.user, module_id)
        Document.objects.select_for_update().get(pk=module.chapter.document_id)
        # Reload after the document lock: another faculty device may have edited it.
        module = self.module(request.user, module_id)
        fingerprint = digest({'module': str(module_id), 'payload': data})
        old = LocalAuthoringReceipt.objects.filter(actor=request.user, operation_id=operation).first()
        if old:
            if old.payload_hash != fingerprint:
                raise Conflict('This operation ID was already used for different content.')
            return Response(old.response)
        if data.get('revision') != revision(module):
            raise Conflict('The module or its lesson changed. Keep your local draft and review the newer version.', code='AUTHORING_VERSION_CHANGED')
        if not module.source_text.strip() or module.source_missing:
            raise ValidationFailed('This module has no usable source.')
        if data.get('reviewed') is not True:
            raise ValidationFailed('Review this generated content before sharing it with the institution.')
        kind = data.get('kind')
        if kind == 'lesson':
            lesson = checked_lesson(data.get('lesson'), module)
            row, _ = ModuleLesson.objects.get_or_create(module=module)
            row.lesson = lesson
            row.status = 'ready'
            row.source_hash = source_hash(module.source_text)
            row.model_name = 'device-local'
            row.generator = 'ai'
            row.version += 1
            row.generated_at = timezone.now()
            row.claimed_at = row.next_attempt_at = None
            row.last_error = ''
            row.save()
            output = {'lesson_id': str(row.pk), 'version': row.version}
        elif kind == 'quiz':
            from assessments.services.assessments import create_manual
            from assessments.models import Generator
            questions = checked_questions(data.get('questions'), module)
            quiz = create_manual(request.user, module_id=module.pk, questions=questions, request=request)
            quiz.generator = Generator.AI
            quiz.save(update_fields=['generator'])
            # Always a draft. Existing publication/result-release rules still apply.
            output = {'quiz_id': str(quiz.pk), 'status': quiz.status}
        else:
            raise ValidationFailed('Unknown authoring operation.')
        from audit import services as audit
        audit.record(request.user, 'authoring.device_received', module, {'kind': kind, 'operation': str(operation)}, request)
        output.update({'recorded': True, 'revision': revision(module)})
        LocalAuthoringReceipt.objects.create(actor=request.user, operation_id=operation, payload_hash=fingerprint, response=output)
        return Response(output)


class LocalQuizView(APIView):
    permission_classes = [IsAdminOrFaculty]
    module = LocalAuthoringView.module
    """A reviewed multi-module quiz, with replay protection and no model calls."""
    @transaction.atomic
    def post(self, request):
        data = request.data
        if not isinstance(data, dict) or len(json.dumps(data)) > 1_000_000:
            raise ValidationFailed('Invalid quiz draft.')
        try:
            operation = UUID(str(data.get('id')))
            sources = data['sources']
            if not isinstance(sources, list) or not 1 <= len(sources) <= 30:
                raise ValueError()
            ids = [UUID(str(item['module_id'])) for item in sources]
            if len(set(ids)) != len(ids):
                raise ValueError()
        except (KeyError, TypeError, ValueError):
            raise ValidationFailed('Choose 1–30 distinct source modules.')
        get_user_model().objects.select_for_update().get(pk=request.user.pk)
        modules = [self.module(request.user, key) for key in ids]
        # Match the document lock used by source editing and single-module authoring.
        list(Document.objects.select_for_update().filter(pk__in={m.chapter.document_id for m in modules}).order_by('pk'))
        modules = [self.module(request.user, key) for key in ids]
        fingerprint = digest({'selection_quiz': data})
        old = LocalAuthoringReceipt.objects.filter(actor=request.user, operation_id=operation).first()
        if old:
            if old.payload_hash != fingerprint:
                raise Conflict('This operation ID was already used for different content.')
            return Response(old.response)
        if data.get('reviewed') is not True:
            raise ValidationFailed('Review the quiz before sharing.')
        if len({m.chapter.document.subject_id for m in modules}) != 1:
            raise ValidationFailed('Select modules from one subject.')
        for module, snapshot in zip(modules, sources):
            if snapshot.get('revision') != revision(module):
                raise Conflict('A source changed. Keep the draft and prepare a new quiz from the updated source.', code='AUTHORING_VERSION_CHANGED')
            if module.source_missing or not module.source_text.strip():
                raise ValidationFailed('A selected module has no source.')
        raw = data.get('questions')
        if not isinstance(raw, list) or not 1 <= len(raw) <= 30:
            raise ValidationFailed('Provide 1–30 complete questions.')
        by_id = {str(m.pk): m for m in modules}
        questions = []
        for item in raw:
            if not isinstance(item, dict) or item.get('module_id') not in by_id:
                raise ValidationFailed('Question source is not selected.')
            questions.extend(checked_questions([item], by_id[item['module_id']]))
        if len({q['question'].casefold() for q in questions}) != len(questions):
            raise ValidationFailed('Repeated questions are not valid.')
        from assessments.services.assessments import create_manual
        from assessments.models import Generator
        quiz = create_manual(request.user, module_ids=ids, title=string(data.get('title'), 300, 'title'), questions=questions, request=request)
        quiz.generator = Generator.AI
        quiz.save(update_fields=['generator'])
        output = {'quiz_id': str(quiz.pk), 'status': quiz.status, 'recorded': True}
        LocalAuthoringReceipt.objects.create(actor=request.user, operation_id=operation, payload_hash=fingerprint, response=output)
        return Response(output)
