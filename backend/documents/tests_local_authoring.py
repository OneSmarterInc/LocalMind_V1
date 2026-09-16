from uuid import uuid4
from unittest.mock import patch
from django.test import TestCase
from core.testing import make_faculty, make_student, make_admin, make_subject, assign, client_for, make_published_document
from documents.models import LocalAuthoringReceipt
from tutor.models import ModuleLesson
from assessments.models import Assessment

class LocalAuthoringTests(TestCase):
    def setUp(self):
        self.faculty = make_faculty()
        subject = make_subject()
        assign(self.faculty, subject)
        self.doc = make_published_document(subject)
        self.module = self.doc.chapters.first().modules.first()
        self.client = client_for(self.faculty)
        self.url = f'/api/faculty/modules/{self.module.pk}/local-authoring/'
        self.base = self.client.get(self.url).data['revision']
        self.quote = 'Processes are programs in execution.'
    def event(self, kind='lesson'):
        data = {'id': str(uuid4()), 'revision': self.base, 'reviewed': True, 'kind': kind}
        if kind == 'lesson':
            data['lesson'] = {'introduction': 'Understand processes.', 'sections': [{'heading': 'Processes', 'content': 'A process is a running program.', 'quote': self.quote}], 'takeaways': ['A process runs a program.']}
        else:
            data['questions'] = [{'question': 'What is a process?', 'options': ['A running program', 'A file', 'A disk', 'A frame'], 'answer': 0, 'explanation': 'A process is a program in execution.', 'quote': self.quote}]
        return data
    def post(self, data):
        return self.client.post(self.url, data, format='json')
    def test_lesson_replay_and_changed_operation(self):
        data = self.event()
        with patch('ai.gateway.gateway.complete', side_effect=AssertionError('No server inference'), create=True):
            first = self.post(data)
            self.assertEqual(first.status_code, 200, first.data)
            self.assertEqual(self.post(data).data, first.data)
        self.assertEqual(ModuleLesson.objects.get(module=self.module).version, 1)
        data['lesson']['introduction'] = 'Changed'
        self.assertEqual(self.post(data).status_code, 409)
        self.assertEqual(LocalAuthoringReceipt.objects.count(), 1)
    def test_stale_source_or_lesson_preserves_existing_work(self):
        self.assertEqual(self.post(self.event()).status_code, 200)
        self.assertEqual(self.post(self.event()).status_code, 409)
        self.base = self.client.get(self.url).data['revision']
        data = self.event()
        self.module.source_text += ' A new definition.'
        self.module.save()
        self.assertEqual(self.post(data).status_code, 409)
        self.assertEqual(ModuleLesson.objects.get(module=self.module).version, 1)
    def test_invalid_output_rolls_back(self):
        for bad in ['invented quotation', '']:
            data = self.event()
            data['lesson']['sections'][0]['quote'] = bad
            self.assertEqual(self.post(data).status_code, 400)
        data = self.event()
        data['reviewed'] = False
        self.assertEqual(self.post(data).status_code, 400)
        self.assertFalse(ModuleLesson.objects.exists())
        self.assertFalse(LocalAuthoringReceipt.objects.exists())
    def test_quiz_is_draft_and_replay_does_not_duplicate(self):
        data = self.event('quiz')
        first = self.post(data)
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(self.post(data).data, first.data)
        quiz = Assessment.objects.get()
        self.assertEqual(quiz.status, 'draft')
        self.assertEqual(quiz.questions[0]['correct_answer'], 'A')
    def test_invalid_quiz_does_not_create_receipt(self):
        for answer in [True, -1, 4, 'A']:
            data = self.event('quiz')
            data['questions'][0]['answer'] = answer
            self.assertEqual(self.post(data).status_code, 400)
        self.assertFalse(Assessment.objects.exists())
        self.assertFalse(LocalAuthoringReceipt.objects.exists())
    def test_permissions_rechecked_on_replay(self):
        data = self.event()
        self.assertEqual(self.post(data).status_code, 200)
        from academics.models import FacultySubject
        FacultySubject.objects.filter(faculty=self.faculty).delete()
        self.assertEqual(self.post(data).status_code, 404)
        for actor in [make_student(), make_faculty()]:
            response = client_for(actor).post(self.url, self.event(), format='json')
            self.assertIn(response.status_code, [403, 404])
        self.assertEqual(client_for(make_admin()).get(self.url).status_code, 200)

class LocalSelectionQuizTests(TestCase):
    setUp = LocalAuthoringTests.setUp
    event = LocalAuthoringTests.event
    def selection(self):
        data = self.event('quiz')
        return {'id':data['id'], 'title':'Device selection', 'reviewed':True,
                'sources':[{'module_id':str(self.module.pk),'revision':self.base}],
                'questions':[{**q,'module_id':str(self.module.pk)} for q in data['questions']]}
    def test_selection_replay_and_stale_source(self):
        data=self.selection()
        with patch('assessments.services.assessments.generate',side_effect=AssertionError('Server AI must not run')):
            result=self.client.post('/api/faculty/local-quizzes/',data,format='json')
            self.assertEqual(result.status_code,200,result.data)
            self.assertEqual(self.client.post('/api/faculty/local-quizzes/',data,format='json').data,result.data)
        self.assertEqual(Assessment.objects.count(),1)
        self.assertEqual(result.data['status'],'draft')
        data['id']=str(uuid4());data['sources'][0]['revision']='stale'
        self.assertEqual(self.client.post('/api/faculty/local-quizzes/',data,format='json').status_code,409)
        self.assertEqual(Assessment.objects.count(),1)
    def test_selection_invalid_quote_and_unselected_source(self):
        data=self.selection();data['questions'][0]['quote']='This sentence is not in the source.'
        self.assertEqual(self.client.post('/api/faculty/local-quizzes/',data,format='json').status_code,400)
        data=self.selection();data['questions'][0]['module_id']=str(uuid4())
        self.assertEqual(self.client.post('/api/faculty/local-quizzes/',data,format='json').status_code,400)
        self.assertEqual(Assessment.objects.count(),0)
    def test_selection_denies_unassigned_faculty(self):
        other=client_for(make_faculty())
        self.assertEqual(other.post('/api/faculty/local-quizzes/',self.selection(),format='json').status_code,404)
    def test_selection_retains_multiple_module_relationships(self):
        other_doc=make_published_document(self.doc.subject,modules=(('Second source','Threads share a process address space.'),))
        second=other_doc.chapters.first().modules.first()
        rev=self.client.get(f'/api/faculty/modules/{second.pk}/local-authoring/').data['revision']
        data=self.selection();data['sources'].append({'module_id':str(second.pk),'revision':rev})
        data['questions'].append({**data['questions'][0],'module_id':str(second.pk),'question':'What do threads share?','quote':'Threads share a process address space.'})
        response=self.client.post('/api/faculty/local-quizzes/',data,format='json')
        self.assertEqual(response.status_code,200,response.data)
        quiz=Assessment.objects.get(pk=response.data['quiz_id'])
        self.assertEqual(quiz.source_modules.count(),2)
