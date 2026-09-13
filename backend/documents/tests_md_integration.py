"""Django/ORM regression tests for the MD-alignment changes.

Run after installing backend requirements:
    python manage.py test documents.tests_md_integration
These are NOT included in the dependency-free check command.
"""
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase, SimpleTestCase

from core.exceptions import ValidationFailed
from core.testing import make_subject
from learning.models import Module
from documents.models import Document
from documents.services.outline import build_proposed_outline, persist_outline
from documents.services.parser import extract_sections_from_markdown, _extract_headings
from assessments.services.generation import normalize_questions, generate_questions, QuizGenerationFailed
from ai.gateway import AIResult


class OutlineIntegrationTests(TestCase):
    def document(self, **kwargs):
        return Document.objects.create(subject=make_subject(), original_name='book.docx', title='Book', file_type='docx', **kwargs)

    @patch('documents.services.outline.gateway')
    def test_author_mode_never_asks_model_to_regroup(self, gw):
        doc = self.document()
        sections = extract_sections_from_markdown('# Original name\nSmall introduction.\n## Actual module\nContent.')
        result, source = build_proposed_outline(doc, sections, _extract_headings(sections))
        gw.assert_not_called()
        self.assertEqual(source, 'source_hierarchy')
        self.assertEqual(result['chapters'][0]['title'], 'Original name')
        self.assertEqual(result['chapters'][0]['modules'][-1]['title'], 'Actual module')

    @patch('documents.services.outline.gateway')
    def test_opt_in_incomplete_ai_plan_falls_back_to_complete_source(self, gw):
        doc = self.document(outline_strategy='ai')
        sections = extract_sections_from_markdown('# First\nFirst text.\n# Second\nSecond text.')
        gw.return_value.generate.return_value = AIResult(ok=True, data={
            'document_title': 'Incomplete', 'chapters': [{'title': 'First', 'source_heading_index': 0, 'modules': []}]})
        result, source = build_proposed_outline(doc, sections, _extract_headings(sections))
        self.assertEqual(source, 'source_hierarchy')
        self.assertEqual(len(result['chapters']), 2)
        gw.return_value.generate.assert_called_once()

    def test_preamble_persists_without_negative_database_heading_id(self):
        doc = self.document()
        sections = extract_sections_from_markdown('Important opening context.\n# Chapter\nMaterial.')
        outline, _ = build_proposed_outline(doc, sections, _extract_headings(sections))
        persist_outline(doc, outline, sections)
        intro = Module.objects.get(chapter__document=doc, title='Introduction')
        self.assertIsNone(intro.source_heading_index)
        self.assertEqual(intro.source_text, 'Important opening context.')
        chapter = doc.chapters.get(title='Chapter')
        self.assertEqual(chapter.source_heading_index, 0)

    def test_empty_edit_is_rejected_without_deleting_existing_content(self):
        doc = self.document()
        sections = extract_sections_from_markdown('# Chapter\nStored source.')
        outline, _ = build_proposed_outline(doc, sections, _extract_headings(sections))
        persist_outline(doc, outline, sections)
        module = Module.objects.get(chapter__document=doc)
        with self.assertRaises(ValidationFailed) as error:
            persist_outline(doc, {'chapters': [{'id': str(module.chapter_id), 'title': 'Chapter', 'modules': [
                {'id': str(module.id), 'title': module.title, 'source_heading_index': None, 'source_text': '   '}]}]}, sections, user_edited=True)
        self.assertEqual(error.exception.code, 'EMPTY_SOURCE_TEXT')
        module.refresh_from_db()
        self.assertEqual(module.source_text, 'Stored source.')

    def test_existing_hidden_module_can_be_round_tripped_unchanged(self):
        doc = self.document()
        sections = extract_sections_from_markdown('# C\n## A\nAlpha.\n## B\nBeta.')
        outline, _ = build_proposed_outline(doc, sections, _extract_headings(sections))
        persist_outline(doc, outline, sections)
        a, b = list(Module.objects.filter(chapter__document=doc).order_by('order'))
        a.source_text = ''; a.source_missing = True; a.source_heading_index = None; a.save()
        payload = {'chapters': [{'id': str(a.chapter_id), 'title': 'C', 'modules': [
            {'id': str(a.id), 'title': 'A', 'source_heading_index': None},
            {'id': str(b.id), 'title': 'B', 'source_heading_index': b.source_heading_index}]}]}
        # Hidden legacy modules with actual references are kept; no new empty
        # content can be introduced. Simulate the reference guard for this case.
        with patch('documents.services.outline._module_is_referenced', return_value=True):
            persist_outline(doc, payload, sections, user_edited=True)
        a.refresh_from_db(); self.assertTrue(a.source_missing)


class QuestionIntegrityIntegrationTests(SimpleTestCase):
    def test_manual_decorated_answer_key_is_canonical(self):
        q = {'question': 'Where is the information stored?', 'options': [
            {'key': key, 'text': text} for key, text in zip('ABCD', ['The database', 'A heading', 'The title', 'An answer'])],
            'correct_answer': 'Option A'}
        self.assertEqual(normalize_questions([q])[0]['correct_answer'], 'A')

    def test_unknown_answer_text_is_not_guessed_from_first_letter(self):
        q = {'question': 'Where is the information stored?', 'options': [
            {'key': key, 'text': text} for key, text in zip('ABCD', ['The database', 'A heading', 'The title', 'An answer'])],
            'correct_answer': 'Any data store would do'}
        with self.assertRaises(ValidationFailed):
            normalize_questions([q])

    @patch('assessments.services.generation.gateway')
    def test_generator_rejects_partial_count(self, gw):
        module = SimpleNamespace(pk='test', chapter_id=None, title='Local storage', source_text='A device can store data in a local database. ' * 20)
        gw.return_value.generate.return_value = AIResult(ok=True, data={'mcq_questions': [
            {'question': 'Where can a device keep its data?', 'options': ['Local database', 'Screen heading', 'A caption', 'The keyboard'],
             'answer': 'A', 'explanation': 'A local database stores data.', 'quote': 'local database'}]})
        with self.assertRaises(QuizGenerationFailed):
            generate_questions([module], num_mcqs=2, num_subjective=0)
