from copy import deepcopy
from uuid import uuid4
from datetime import timedelta
from django.test import TestCase, override_settings
from django.utils import timezone
from core.testing import make_student, make_subject, enroll, make_published_document, client_for, MCQ
from learning.models import Module, ModuleProgress, CourseSyncReceipt
from learning.course_sync import packages
from assessments.models import Assessment, AssessmentAttempt

@override_settings(AI_ENABLED=False)
class CourseSyncTests(TestCase):
    def setUp(self):
        self.student=make_student();self.subject=make_subject();enroll(self.student,self.subject)
        doc=make_published_document(self.subject);self.module=Module.objects.filter(chapter__document=doc).first()
        q=deepcopy(MCQ);q['id']='q1'
        self.quiz=Assessment.objects.create(subject=self.subject,module=self.module,kind='module',title='Offline quiz',questions=[q],status='published',results_release='immediate')
        self.client=client_for(self.student)
    def event(self):
        pack=packages(self.student)[str(self.quiz.pk)]
        return {'id':str(uuid4()),'kind':'quiz','grant':pack['grant'],'answers':{'q1':'A'},'started_at':(timezone.now()-timedelta(seconds=120)).isoformat(),'submitted_at':timezone.now().isoformat()}
    def send(self,e):return self.client.post('/api/student/offline/events/',e,format='json')
    def test_replay_only_counts_once_and_server_regrades(self):
        e=self.event();e['score']=0
        a=self.send(e);self.assertEqual(a.status_code,200,a.data);b=self.send(e)
        self.assertEqual(a.data,b.data);self.assertEqual(AssessmentAttempt.objects.count(),1)
        self.assertEqual(a.data['attempt']['percentage'],100);self.assertEqual(ModuleProgress.objects.get().quiz_attempts,1)
        self.assertGreaterEqual(a.data['attempt']['time_taken_seconds'],119)
    def test_held_answers_not_in_bundle_and_score_not_in_response(self):
        self.quiz.results_release='held';self.quiz.save()
        self.assertNotIn('marking',packages(self.student)[str(self.quiz.pk)])
        response=self.send(self.event());self.assertEqual(response.status_code,200,response.data)
        self.assertFalse(response.data['attempt']['results_released']);self.assertIsNone(response.data['attempt']['score'])
        self.assertEqual(AssessmentAttempt.objects.get().score,1)
    def test_other_student_cannot_use_grant(self):
        e=self.event();other=make_student(email='other-course@example.com');enroll(other,self.subject);self.client=client_for(other)
        self.assertEqual(self.send(e).status_code,403);self.assertEqual(AssessmentAttempt.objects.count(),0)
    def test_changed_questions_reject_without_partial_attempt(self):
        e=self.event();self.quiz.questions[0]['correct_answer']='B';self.quiz.save()
        self.assertEqual(self.send(e).status_code,409);self.assertFalse(AssessmentAttempt.objects.exists())
    def test_same_id_different_payload_rejected(self):
        e=self.event();self.assertEqual(self.send(e).status_code,200);e['answers']={'q1':'B'}
        self.assertEqual(self.send(e).status_code,409);self.assertEqual(AssessmentAttempt.objects.count(),1)
    def test_progress_time_replay_does_not_double_count(self):
        e={'id':str(uuid4()),'kind':'time','module_id':str(self.module.pk),'seconds':75}
        self.assertEqual(self.send(e).status_code,200);self.assertEqual(self.send(e).status_code,200)
        self.assertEqual(ModuleProgress.objects.get().learning_seconds,75)
    def test_locked_content_refuses_progress(self):
        self.module.availability='locked';self.module.save()
        r=self.send({'id':str(uuid4()),'kind':'read','module_id':str(self.module.pk)})
        self.assertNotEqual(r.status_code,200);self.assertFalse(CourseSyncReceipt.objects.exists())
    def test_max_attempts_and_closed_deadline(self):
        self.quiz.max_attempts=1;self.quiz.save();self.assertEqual(self.send(self.event()).status_code,200)
        self.assertEqual(self.send(self.event()).status_code,409)
        self.quiz.max_attempts=None;self.quiz.due_at=timezone.now()-timedelta(days=1);self.quiz.save()
        self.assertEqual(self.send(self.event()).status_code,409)
    def test_replayed_held_result_reflects_faculty_release(self):
        self.quiz.results_release='held';self.quiz.save();e=self.event();self.send(e)
        self.quiz.results_released_at=timezone.now();self.quiz.save()
        r=self.send(e);self.assertEqual(r.data['attempt']['score'],1);self.assertEqual(AssessmentAttempt.objects.count(),1)
    def test_lesson_view_is_recorded_independently_of_download(self):
        self.client.get('/api/student/offline/');self.assertFalse(ModuleProgress.objects.exists())
        self.send({'id':str(uuid4()),'kind':'lesson','module_id':str(self.module.pk)})
        self.assertIsNotNone(ModuleProgress.objects.get().lesson_viewed_at)
    def test_invalid_answer_shape_rolls_back(self):
        e=self.event();e['answers']={'q1':{'bad':'value'}}
        self.assertEqual(self.send(e).status_code,400);self.assertFalse(AssessmentAttempt.objects.exists())
    def test_bundle_carries_history_beyond_first_page_without_held_keys(self):
        self.quiz.results_release='held';self.quiz.save()
        for n in range(1,28):
            AssessmentAttempt.objects.create(assessment=self.quiz,student=self.student,attempt_number=n,status='evaluated',score=1,percentage=100,passed=True,total_questions=1)
        response=self.client.get('/api/student/offline/')
        scores=response.data['entries']['/student/scores/'];self.assertEqual(len(scores),27)
        self.assertTrue(all(r['score'] is None for r in scores))
        self.assertNotIn('marking',response.data['entries']['/student/offline/quizzes/'][str(self.quiz.pk)])
