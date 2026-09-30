"""One login, two devices, one book: only one device may generate and sync."""
import hashlib
import json
import tempfile
from datetime import timedelta
from uuid import uuid4

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone

from assessments.models import Assessment
from core.testing import assign, client_for, make_faculty, make_published_document, make_subject
from documents.models import GenerationClaim
from tutor.models import ModuleLesson

LAPTOP = 'laptop-0000-1111-2222'
PHONE = 'phone-3333-4444-5555'


class GenerationClaimTests(TestCase):
    def setUp(self):
        self.faculty = make_faculty()
        subject = make_subject()
        assign(self.faculty, subject)
        self.doc = make_published_document(subject)
        self.module = self.doc.chapters.first().modules.first()
        self.client = client_for(self.faculty)
        self.claim_url = f'/api/faculty/documents/{self.doc.pk}/generation-claim/'
        self.authoring_url = f'/api/faculty/modules/{self.module.pk}/local-authoring/'
        self.quote = 'Processes are programs in execution.'

    def claim(self, device, **body):
        return self.client.post(self.claim_url, body, format='json', HTTP_X_LOCALMIND_DEVICE=device)

    def quiz(self, device=None):
        rev = self.client.get(self.authoring_url).data['revision']
        body = {'id': str(uuid4()), 'revision': rev, 'reviewed': True, 'kind': 'quiz',
                'questions': [{'question': 'What is a process?', 'options': ['A running program', 'A file', 'A disk', 'A frame'],
                               'answer': 0, 'explanation': 'A process is a program in execution.', 'quote': self.quote}]}
        extra = {'HTTP_X_LOCALMIND_DEVICE': device} if device else {}
        return self.client.post(self.authoring_url, body, format='json', **extra)

    def lesson(self, device):
        rev = self.client.get(self.authoring_url).data['revision']
        body = {'id': str(uuid4()), 'revision': rev, 'reviewed': True, 'kind': 'lesson',
                'lesson': {'introduction': 'Processes.', 'sections': [{'heading': 'Process', 'content': 'A running program.', 'quote': self.quote}],
                           'takeaways': ['A process executes.']}}
        return self.client.post(self.authoring_url, body, format='json', HTTP_X_LOCALMIND_DEVICE=device)

    def test_both_online_second_device_is_told_generation_started_elsewhere(self):
        first = self.claim(LAPTOP, device_label='Web browser on Windows')
        self.assertEqual(first.status_code, 200, first.data)
        self.assertTrue(first.data['claim']['mine'])
        second = self.claim(PHONE, device_label='Android phone')
        self.assertEqual(second.status_code, 409)
        self.assertEqual(second.data['error']['code'], 'GENERATION_CLAIMED_ELSEWHERE')
        self.assertEqual(second.data['error']['details']['claim']['device_label'], 'Web browser on Windows')
        self.assertFalse(second.data['error']['details']['claim']['mine'])
        # Renewal by the owner is a heartbeat, not a conflict.
        self.assertEqual(self.claim(LAPTOP).status_code, 200)

    def test_offline_race_first_device_to_deliver_wins_and_other_is_refused(self):
        # Neither device claimed: both generated offline. The phone reconnects first.
        self.assertEqual(self.quiz(PHONE).status_code, 200)
        refused = self.quiz(LAPTOP)
        self.assertEqual(refused.status_code, 409)
        self.assertEqual(refused.data['error']['code'], 'GENERATION_CLAIMED_ELSEWHERE')
        self.assertEqual(self.lesson(LAPTOP).status_code, 409)
        # Exactly one quiz reached the institution: the phone's.
        self.assertEqual(Assessment.objects.count(), 1)
        self.assertFalse(ModuleLesson.objects.filter(module=self.module, status='ready').exists())
        # The winner keeps writing.
        self.assertEqual(self.lesson(PHONE).status_code, 200)

    def test_offline_start_time_is_kept_but_arrival_order_decides(self):
        early = (timezone.now() - timedelta(hours=3)).isoformat()
        self.assertEqual(self.claim(PHONE, started_at=(timezone.now() - timedelta(minutes=5)).isoformat()).status_code, 200)
        # The laptop started earlier but reached the server later: it does not win.
        self.assertEqual(self.claim(LAPTOP, started_at=early).status_code, 409)

    def test_take_over_moves_ownership_and_old_owner_is_then_refused(self):
        self.assertEqual(self.claim(LAPTOP).status_code, 200)
        moved = self.claim(PHONE, take_over=True, device_label='Android phone')
        self.assertEqual(moved.status_code, 200)
        self.assertEqual(self.quiz(LAPTOP).status_code, 409)
        self.assertEqual(self.quiz(PHONE).status_code, 200)

    @override_settings(LOCALMIND={**__import__('django.conf').conf.settings.LOCALMIND, 'GENERATION_CLAIM_STALE_HOURS': 1})
    def test_stale_owner_loses_the_book_to_the_next_device(self):
        self.assertEqual(self.claim(LAPTOP).status_code, 200)
        GenerationClaim.objects.update(heartbeat_at=timezone.now() - timedelta(hours=2))
        self.assertEqual(self.claim(PHONE).status_code, 200)
        self.assertEqual(GenerationClaim.objects.get().device_id, PHONE)

    def test_release_only_by_owner(self):
        self.assertEqual(self.claim(LAPTOP).status_code, 200)
        self.assertEqual(self.client.delete(self.claim_url, HTTP_X_LOCALMIND_DEVICE=PHONE).status_code, 409)
        self.assertEqual(self.client.delete(self.claim_url, HTTP_X_LOCALMIND_DEVICE=LAPTOP).status_code, 204)
        self.assertEqual(self.claim(PHONE).status_code, 200)

    def test_claims_are_per_login(self):
        other = make_faculty()
        assign(other, self.doc.subject)
        self.assertEqual(self.claim(LAPTOP).status_code, 200)
        response = client_for(other).post(self.claim_url, {}, format='json', HTTP_X_LOCALMIND_DEVICE=PHONE)
        self.assertEqual(response.status_code, 200)

    def test_old_clients_work_alone_but_cannot_write_over_an_owner(self):
        self.assertEqual(self.quiz().status_code, 200)
        self.assertFalse(GenerationClaim.objects.exists())
        self.assertEqual(self.claim(LAPTOP).status_code, 200)
        self.assertEqual(self.quiz().status_code, 409)

    def test_get_reports_owner(self):
        self.assertIsNone(self.client.get(self.claim_url).data['claim'])
        self.claim(LAPTOP, device_label='Web browser on Windows')
        data = self.client.get(self.claim_url, HTTP_X_LOCALMIND_DEVICE=PHONE).data['claim']
        self.assertEqual(data['device_label'], 'Web browser on Windows')
        self.assertFalse(data['mine'])


class OfflineBookClaimTests(TestCase):
    """Both devices imported the same book offline."""
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.media = override_settings(MEDIA_ROOT=self.folder.name)
        self.media.enable()
        self.addCleanup(self.media.disable)
        self.faculty = make_faculty()
        self.subject = make_subject()
        assign(self.faculty, self.subject)
        self.client = client_for(self.faculty)
        self.raw = b'%PDF-1.7\nOffline source fixture\n%%EOF'

    def upload(self, device, label):
        data = {'id': str(uuid4()), 'subject_id': str(self.subject.pk), 'title': 'Local book', 'reviewed': True,
                'sha256': hashlib.sha256(self.raw).hexdigest(),
                'claim': {'device_label': label, 'started_at': timezone.now().isoformat()},
                'sections': [{'id': 's1', 'title': 'First module', 'source': 'Processes are programs in execution.', 'page': 1}]}
        return self.client.post('/api/faculty/local-books/', {'manifest': json.dumps(data),
                                'file': SimpleUploadedFile('book.pdf', self.raw, 'application/pdf')},
                                format='multipart', HTTP_X_LOCALMIND_DEVICE=device)

    def test_first_book_upload_claims_and_duplicate_names_the_owner(self):
        first = self.upload(PHONE, 'Android phone')
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(GenerationClaim.objects.get().device_id, PHONE)
        second = self.upload(LAPTOP, 'Web browser on Windows')
        self.assertEqual(second.status_code, 409)
        self.assertEqual(second.data['error']['code'], 'DUPLICATE_DOCUMENT')
        self.assertEqual(second.data['error']['details']['claim']['device_label'], 'Android phone')


class DeviceLabelTests(TestCase):
    def test_labels_from_user_agent(self):
        from types import SimpleNamespace
        from documents.generation_claims import label_from
        cases = {'okhttp/4.12.0': 'Android app',
                 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36': 'Chrome on Windows',
                 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15': 'Safari on Mac',
                 '': 'Another device'}
        for agent, label in cases.items():
            self.assertEqual(label_from(SimpleNamespace(META={'HTTP_USER_AGENT': agent})), label)
