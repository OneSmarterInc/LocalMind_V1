"""Role-scoped real upload, lesson, review and offline figure regression tests."""
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from core.testing import make_admin, make_faculty, make_student, make_subject, assign, enroll, client_for
from learning.models import Module, ModuleProgress
from tutor.models import ModuleLesson
from tutor.lessons import source_hash
from .models import Document
from .services.documents import run_processing, edit_module
from .signals import sync_document_visuals
from .tests_visual_reference import reference_docx


class VisualCourseIntegrationTests(TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        setting = override_settings(MEDIA_ROOT=Path(self.tmp.name), LESSONS={'AUTO_GENERATE':False})
        setting.enable(); self.addCleanup(setting.disable)
        self.admin, self.faculty, self.other = make_admin(), make_faculty(), make_faculty()
        self.student, self.outsider = make_student(), make_student()

    def upload(self, actor):
        subject = make_subject(code='VIS'+str(Document.objects.count()))
        assign(self.faculty, subject); enroll(self.student, subject)
        path=Path(self.tmp.name)/'reference.docx';reference_docx(path)
        prefix = 'faculty'  # One content API admits both staff roles.
        response=client_for(actor).post(f'/api/{prefix}/documents/',
            {'subject_id':str(subject.pk), 'file':SimpleUploadedFile('reference.docx',path.read_bytes()), 'title':'Visual source'}, format='multipart')
        self.assertEqual(response.status_code,201,response.data)
        with self.captureOnCommitCallbacks(execute=True):
            self.assertTrue(run_processing(response.data['id']))
        document=Document.objects.get(pk=response.data['id'])
        return document, list(Module.objects.filter(chapter__document=document).order_by('order'))

    def ready(self, document, modules):
        Document.objects.filter(pk=document.pk).update(status='published')
        Module.objects.filter(chapter__document=document).update(availability='open')
        for module in modules:
            # Structured source-backed inference output; no network/model required.
            lesson={'title':module.title,'learning_objectives':['Understand the figure'],'summary':'Source lesson',
                    'sections':[{'heading':module.title,'explanation':module.source_text,'source_reference':module.source_text},
                                {'heading':'Separate idea','explanation':'An unrelated explanation.','source_reference':''}], 'key_terms':[]}
            ModuleLesson.objects.update_or_create(module=module, defaults={'status':'ready','source_hash':source_hash(module.source_text),'lesson':lesson})

    def test_real_docx_upload_for_both_staff_roles_attaches_correct_occurrences(self):
        for actor in (self.admin,self.faculty):
            document, modules=self.upload(actor)
            self.assertEqual(len(modules),2)
            self.assertEqual(document.visual_report['assigned'],2)
            self.assertEqual(document.visual_report['unassigned'],[])
            for module in modules:
                self.assertEqual(len(module.source_visuals),1)
                self.assertEqual(module.source_visuals[0]['heading_path'][-1],module.title)
            self.assertEqual(modules[0].source_visuals[0]['filename'],modules[1].source_visuals[0]['filename'])
            self.assertNotEqual(modules[0].source_visuals[0]['id'],modules[1].source_visuals[0]['id'])

    def test_all_roles_get_section_images_without_read_time_ai_and_offline_keeps_bytes(self):
        document, modules=self.upload(self.faculty); self.ready(document, modules)
        module=modules[0]
        with patch('tutor.lessons.gateway') as gateway:
            for actor,prefix,path in ((self.admin,'faculty','lesson'),(self.faculty,'faculty','lesson'),(self.student,'student','teach')):
                response=client_for(actor).get(f'/api/{prefix}/modules/{module.pk}/{path}/')
                self.assertEqual(response.status_code,200,response.data)
                lesson=response.data['lesson']
                self.assertEqual(len(lesson['source_visuals']),1)
                visual=lesson['source_visuals'][0]
                self.assertTrue(visual['data_url'].startswith('data:image/png;base64,'))
                self.assertEqual(lesson['sections'][0]['visual_ids'],[visual['id']])
                self.assertEqual(lesson['sections'][1]['visual_ids'],[])
                self.assertNotIn('filename', visual)
                self.assertNotIn('context_text', visual)
            offline=client_for(self.student).get('/api/student/offline/')
            self.assertEqual(offline.status_code,200)
            stored=offline.data['entries'][f'/student/modules/{module.pk}/teach/']['lesson']
            self.assertEqual(stored['source_visuals'][0]['data_url'],visual['data_url'])
            gateway.assert_not_called()

    def test_unauthorized_and_locked_modules_do_not_return_pictures(self):
        document,modules=self.upload(self.faculty);self.ready(document,modules);module=modules[0]
        for actor,prefix,path in ((self.other,'faculty','lesson'),(self.outsider,'student','teach')):
            response=client_for(actor).get(f'/api/{prefix}/modules/{module.pk}/{path}/')
            self.assertNotEqual(response.status_code,200)
            self.assertNotIn('source_visuals',str(response.data))
        Module.objects.filter(pk=module.pk).update(availability='locked')
        self.assertNotEqual(client_for(self.student).get(f'/api/student/modules/{module.pk}/teach/').status_code,200)

    def test_picture_report_is_staff_scoped(self):
        document,_=self.upload(self.faculty)
        url=f'/api/faculty/documents/{document.pk}/visuals/'
        self.assertEqual(client_for(self.admin).get(url).data['report']['assigned'],2)
        self.assertEqual(client_for(self.faculty).get(url).status_code,200)
        self.assertNotEqual(client_for(self.other).get(url).status_code,200)
        self.assertNotEqual(client_for(self.student).get(url).status_code,200)

    def test_edit_preserves_history_and_reports_unmatched_image_not_first_module_fallback(self):
        document,modules=self.upload(self.faculty);module=modules[0]
        progress=ModuleProgress.objects.create(student=self.student,module=module)
        with self.captureOnCommitCallbacks(execute=True):
            edit_module(self.faculty,module,title='New topic',source_text='This separate topic explains foreign currency markets and international banking.')
        module.refresh_from_db();document.refresh_from_db()
        self.assertEqual(module.source_visuals,[])
        self.assertEqual(len(document.visual_report['unassigned']),1)
        self.assertTrue(ModuleProgress.objects.filter(pk=progress.pk).exists())
        self.assertEqual(Module.objects.filter(chapter__document=document).count(),2)

    def test_stale_visual_assignment_cannot_overwrite_newer_module_edit(self):
        document,modules=self.upload(self.faculty)
        old=list(modules[0].source_visuals)
        def change(*args):
            Module.objects.filter(pk=modules[0].pk).update(title='Edited during extraction')
            return []
        with patch('documents.signals.extract_source_visuals',side_effect=change):
            self.assertIsNone(sync_document_visuals(document.pk))
        modules[0].refresh_from_db();self.assertEqual(modules[0].source_visuals,old)
