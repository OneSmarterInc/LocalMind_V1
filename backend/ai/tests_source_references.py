from unittest import TestCase
from .source_references import prepare


class SourceReferencesTests(TestCase):
    def test_restore_nested_quotes_without_changing_prose_or_source(self):
        source = 'A process is a program in execution.\nThe scheduler selects the next process.'
        schema = {'properties': {'questions': {'items': {'properties': {
            'quote': {'type': 'string'}, 'question': {'type': 'string'}}}}}}
        prompt, wire, restore = prepare(source, schema)
        self.assertIn('[Q1] A process is a program in execution.', prompt)
        self.assertIn('[Q2] The scheduler selects the next process.', prompt)
        self.assertEqual(wire['properties']['questions']['items']['properties']['quote']['enum'], ['Q1', 'Q2'])
        self.assertEqual(schema['properties']['questions']['items']['properties']['quote'], {'type': 'string'})
        self.assertEqual(restore({'questions': [{'quote': 'Q2', 'question': 'Q1'}]}),
                         {'questions': [{'quote': 'The scheduler selects the next process.', 'question': 'Q1'}]})

    def test_lesson_reference_restores_an_exact_source_substring(self):
        source = ('Long source phrase ' * 30) + '.'
        _, _, restore = prepare(source, {'properties': {'source_reference': {'type': 'string'}}})
        quote = restore({'source_reference': 'Q1'})['source_reference']
        self.assertIn(quote, source)
        self.assertLessEqual(len(quote), 240)
        self.assertFalse(quote.endswith(' '))

    def test_later_source_sentences_are_available(self):
        source = '\n'.join(f'Source sentence number {n}.' for n in range(40))
        _, wire, restore = prepare(source, {'properties': {'quote': {'type': 'string'}}})
        self.assertEqual(len(wire['properties']['quote']['enum']), 40)
        self.assertEqual(restore({'quote': 'Q40'}), {'quote': 'Source sentence number 39.'})

    def test_no_candidate_keeps_original_contract(self):
        schema = {'properties': {'quote': {'type': 'string'}}}
        prompt, wire, restore = prepare('x', schema)
        self.assertEqual(prompt, 'x')
        self.assertEqual(wire, schema)
        self.assertEqual(restore({'quote': 'x'}), {'quote': 'x'})
