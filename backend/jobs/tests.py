"""Persistent-queue integration and grading request/worker separation."""
from datetime import timedelta
from unittest.mock import patch
from django.test import TestCase, TransactionTestCase, override_settings
from django.db import connection, transaction
from django.utils import timezone
from core.testing import make_student, make_faculty, make_subject, assign, enroll, make_published_document, MCQ, SUBJ
from learning.models import Module
from assessments.models import Assessment, AssessmentAttempt
from assessments.services import assessments as assessments
from core.exceptions import Conflict
from .models import Job
from . import services as jobs

class QueueTests(TestCase):
    def test_enqueuing_in_rolled_back_transaction_creates_no_job(self):
        try:
            with transaction.atomic():
                jobs.enqueue("document_parse","x",{"document_id":"x"});raise RuntimeError("rollback")
        except RuntimeError:pass
        self.assertEqual(Job.objects.count(),0)
    def test_duplicate_action_has_one_job(self):
        a=jobs.enqueue("document_parse","x",{"document_id":"x"});b=jobs.enqueue("document_parse","x",{"document_id":"x"})
        self.assertEqual(a.id,b.id);self.assertEqual(Job.objects.count(),1)
    def test_only_one_claim_wins(self):
        jobs.enqueue("document_parse","x",{});self.assertIsNotNone(jobs.claim());self.assertIsNone(jobs.claim())
    def test_expired_claim_is_fenced(self):
        jobs.enqueue("document_parse","x",{});old=jobs.claim()
        Job.objects.filter(pk=old.id).update(lease_until=timezone.now()-timedelta(seconds=1))
        new=jobs.claim();self.assertNotEqual(old.lease_token,new.lease_token)
        with transaction.atomic():
            with self.assertRaises(jobs.LeaseLost):jobs.assert_owned(old)
        with transaction.atomic():jobs.assert_owned(new)
    def test_expired_final_attempt_is_explicitly_failed(self):
        jobs.enqueue("document_parse","x",{},max_attempts=1);j=jobs.claim()
        Job.objects.filter(pk=j.id).update(lease_until=timezone.now()-timedelta(seconds=1))
        self.assertIsNone(jobs.claim());j.refresh_from_db();self.assertEqual(j.status,"failed")
    def test_unknown_job_kind_rejected(self):
        with self.assertRaises(ValueError):jobs.enqueue("arbitrary_shell_command","x",{})
    def test_renewal_refuses_expired_owner(self):
        jobs.enqueue("document_parse","x",{});j=jobs.claim();Job.objects.filter(pk=j.id).update(lease_until=timezone.now()-timedelta(seconds=1))
        self.assertFalse(jobs.renew(j))

@override_settings(DURABLE_JOBS=True)
class GradeWorkerTests(TransactionTestCase):
    def setUp(self):
        self.student=make_student();self.faculty=make_faculty();self.subject=make_subject();assign(self.faculty,self.subject);enroll(self.student,self.subject)
        self.doc=make_published_document(self.subject);self.module=Module.objects.filter(chapter__document=self.doc).first()
        self.quiz=assessments.create_manual(self.faculty,module_id=self.module.id,questions=[SUBJ]);assessments.set_status(self.faculty,self.quiz,"published")
        self.attempt,_=assessments.start_attempt(self.student,self.quiz.id)
    def submit(self):return assessments.submit_attempt(self.student,self.attempt.id,{"q1":"a program in execution"})
    def test_submission_returns_without_a_model_call(self):
        with patch("assessments.services.assessments._grade") as grade:self.submit();grade.assert_not_called()
        self.assertEqual(Job.objects.get().status,"pending");self.attempt.refresh_from_db();self.assertEqual(self.attempt.status,"submitted");self.assertIsNone(self.attempt.percentage)
    def test_job_contains_source_snapshot(self):
        source=self.module.source_text;self.submit();self.module.source_text="new source";self.module.save()
        self.assertEqual(Job.objects.get().payload["source_text"],source)
    def test_model_call_is_outside_database_transaction(self):
        self.submit()
        def grade(*args,**kwargs):
            self.assertFalse(connection.in_atomic_block);return 1.0,[{"question_id":"q1","type":"subjective","is_correct":True,"score_awarded":1.0}],False
        with patch("assessments.services.assessments._grade",side_effect=grade):self.assertEqual(jobs.run_one(heartbeat=False),"done")
        self.attempt.refresh_from_db();self.assertEqual(self.attempt.status,"evaluated");self.assertEqual(self.attempt.percentage,100)
    def test_unavailable_model_never_creates_false_zero(self):
        self.submit()
        with patch("assessments.services.assessments._grade",return_value=(0,[],True)):self.assertEqual(jobs.run_one(heartbeat=False),"retry")
        self.attempt.refresh_from_db();self.assertEqual(self.attempt.status,"submitted");self.assertIsNone(self.attempt.percentage);self.assertIsNone(self.attempt.passed)
    def test_duplicate_submission_refused(self):
        self.submit()
        with self.assertRaises(Conflict):self.submit()
        self.assertEqual(Job.objects.count(),1)
    def test_manual_reevaluation_does_not_grade_empty_results(self):
        self.submit();self.attempt.refresh_from_db()
        with self.assertRaises(Conflict):assessments.re_evaluate(self.faculty,self.attempt)
        self.attempt.refresh_from_db();self.assertIsNone(self.attempt.percentage)
