"""Executable content regressions; these tests do not need Django or an LLM.

From the repository root:
    PYTHONPATH=backend python -m unittest documents.tests_md_integrity -v
They are also discovered by Django's normal test runner.
"""
import io
import tempfile
import unittest
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from assessments.services.answer_keys import normalize_correct_answer, require_question_counts
from documents.services import parser
from documents.services.outline_policy import source_hierarchy_outline, _ai_plan_covers_source
from documents.services.word_numbering import WordNumbering, format_counter

NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'


def archive(numbering='', body='', styles=''):
    data = io.BytesIO()
    with ZipFile(data, 'w') as z:
        z.writestr('word/numbering.xml', f'<w:numbering xmlns:w="{NS}">{numbering}</w:numbering>')
        z.writestr('word/styles.xml', f'<w:styles xmlns:w="{NS}">{styles}</w:styles>')
        z.writestr('word/document.xml', f'<w:document xmlns:w="{NS}"><w:body>{body}</w:body></w:document>')
    return data.getvalue()


def para(text, num='7', level=0, style=None):
    ppr = f'<w:pStyle w:val="{style}"/>' if style else (f'<w:numPr><w:ilvl w:val="{level}"/><w:numId w:val="{num}"/></w:numPr>' if num is not None else '')
    return f'<w:p xmlns:w="{NS}"><w:pPr>{ppr}</w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>'


def definitions(kind='decimal', start=1, nested=False, restart=None):
    child = ''
    if nested:
        child = f'<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1.%2)"/>'
        if restart is not None:
            child += f'<w:lvlRestart w:val="{restart}"/>'
        child += '</w:lvl>'
    return (f'<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:start w:val="{start}"/>'
            f'<w:numFmt w:val="{kind}"/><w:lvlText w:val="%1."/></w:lvl>{child}</w:abstractNum>'
            '<w:num w:numId="7"><w:abstractNumId w:val="2"/></w:num>')


class PreambleTests(unittest.TestCase):
    def test_intro_is_present(self):
        rows = parser.extract_sections_from_markdown('Opening context.\n\n# Chapter\nBody.')
        self.assertEqual(rows[0]['title'], 'Introduction')
        self.assertEqual(rows[0]['source_text'], 'Opening context.')

    def test_old_heading_indices_do_not_change(self):
        rows = parser.extract_sections_from_markdown('Opening.\n# C\n## M\nBody.')
        self.assertEqual([s['index'] for s in rows], [-1, 0, 1])

    def test_blank_preamble_not_added(self):
        self.assertEqual(len(parser.extract_sections_from_markdown('\n\n# C\nBody.')), 1)

    def test_preamble_pages(self):
        rows = parser.extract_sections_from_markdown('Page one.\n<!-- page break -->\nPage two.\n# C\nBody.')
        self.assertEqual((rows[0]['start_page'], rows[0]['end_page']), (1, 2))

    def test_headingless_text_stays_one_section(self):
        rows = parser.extract_sections_from_markdown('Just a short paragraph.')
        self.assertEqual(rows[0]['source_text'], 'Just a short paragraph.')

    def test_sibling_boundary_stays_correct(self):
        rows = parser.extract_sections_from_markdown('# C\n## A\nFirst.\n### A1\nChild.\n## B\nSecond.')
        self.assertIn('Child.', rows[1]['source_text'])
        self.assertNotIn('Second.', rows[1]['source_text'])

    def test_short_chapter_introduction_is_teachable(self):
        rows = parser.extract_sections_from_markdown('# C\nBrief but important.\n## A\nMain text.')
        outline = source_hierarchy_outline('test.docx', rows)
        self.assertEqual(outline['chapters'][0]['modules'][0]['source_text'], 'Brief but important.')

    def test_no_module_without_source_in_single_heading_document(self):
        rows = parser.extract_sections_from_markdown('# C\nMain text.')
        outline = source_hierarchy_outline('test.docx', rows)
        self.assertEqual(outline['chapters'][0]['modules'][0]['source_heading_index'], 0)

    def test_skipped_level_before_first_module_keeps_its_text(self):
        rows = parser.extract_sections_from_markdown('# C\nChapter intro.\n### Before\nEarly text.\n## Main\nMain text.')
        outline = source_hierarchy_outline('test.docx', rows)
        self.assertEqual([m['title'] for m in outline['chapters'][0]['modules']], ['C: Overview', 'Before', 'Main'])

    def test_several_leading_levels_before_first_chapter_are_not_lost(self):
        rows = parser.extract_sections_from_markdown('### Notice\nNotice text.\n## Preface\nPreface text.\n# Main\nMain text.')
        outline = source_hierarchy_outline('test.docx', rows)
        self.assertEqual([c['title'] for c in outline['chapters']], ['Notice', 'Preface', 'Main'])
        self.assertEqual([c['modules'][0]['source_heading_index'] for c in outline['chapters']], [0, 1, 2])

    def test_ai_plan_must_not_drop_a_chapter(self):
        rows = parser.extract_sections_from_markdown('# A\nAlpha.\n# B\nBeta.')
        plan = {'chapters': [{'source_heading_index': 0, 'modules': []}]}
        self.assertFalse(_ai_plan_covers_source(plan, rows))

    def test_ai_plan_must_not_drop_chapter_introduction(self):
        rows = parser.extract_sections_from_markdown('# C\nIntro.\n## M\nMaterial.')
        plan = {'chapters': [{'source_heading_index': 0, 'modules': [{'source_heading_index': 1}]}]}
        self.assertFalse(_ai_plan_covers_source(plan, rows))

    def test_ai_plan_covers_disjoint_complete_modules(self):
        rows = parser.extract_sections_from_markdown('# C\n## A\nAlpha.\n## B\nBeta.')
        plan = {'chapters': [{'source_heading_index': 0, 'modules': [{'source_heading_index': 1}, {'source_heading_index': 2}]}]}
        self.assertTrue(_ai_plan_covers_source(plan, rows))

    def test_overlapping_modules_rejected(self):
        rows = parser.extract_sections_from_markdown('# C\n## A\nAlpha.\n## B\nBeta.')
        plan = {'chapters': [{'source_heading_index': 0, 'modules': [{'source_heading_index': 0}, {'source_heading_index': 1}]}]}
        self.assertFalse(_ai_plan_covers_source(plan, rows))


class NumberingTests(unittest.TestCase):
    def numbering(self, xml=None, styles=''):
        with ZipFile(io.BytesIO(archive(xml or definitions(), styles=styles))) as z:
            return WordNumbering(z)

    def test_decimal_start_and_increment(self):
        n = self.numbering(definitions(start=3))
        self.assertEqual(n.prefix(ET.fromstring(para('First'))), '3. ')
        self.assertEqual(n.prefix(ET.fromstring(para('Second'))), '4. ')

    def test_start_override(self):
        xml = definitions().replace('</w:num>', '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="8"/></w:lvlOverride></w:num>')
        self.assertEqual(self.numbering(xml).prefix(ET.fromstring(para('Text'))), '8. ')

    def test_separate_list_instances(self):
        n = self.numbering(definitions() + '<w:num w:numId="8"><w:abstractNumId w:val="2"/></w:num>')
        self.assertEqual(n.prefix(ET.fromstring(para('Text'))), '1. ')
        self.assertEqual(n.prefix(ET.fromstring(para('Text', num='8'))), '1. ')
        self.assertEqual(n.prefix(ET.fromstring(para('Text'))), '2. ')

    def test_nested_list_restart(self):
        n = self.numbering(definitions(nested=True))
        got = [n.prefix(ET.fromstring(para('Text', level=i))) for i in [0, 1, 1, 0, 1]]
        self.assertEqual(got, ['1. ', '  1.a) ', '  1.b) ', '2. ', '  2.a) '])

    def test_nested_never_restart(self):
        n = self.numbering(definitions(nested=True, restart=0))
        got = [n.prefix(ET.fromstring(para('Text', level=i))) for i in [0, 1, 0, 1]]
        self.assertEqual(got[-1], '  2.b) ')

    def test_inherited_style(self):
        styles = '<w:style w:styleId="Base"><w:pPr><w:numPr><w:numId w:val="7"/></w:numPr></w:pPr></w:style><w:style w:styleId="Child"><w:basedOn w:val="Base"/></w:style>'
        self.assertEqual(self.numbering(styles=styles).prefix(ET.fromstring(para('T', style='Child'))), '1. ')

    def test_bullets_not_given_numbers(self):
        self.assertEqual(self.numbering(definitions(kind='bullet')).prefix(ET.fromstring(para('T'))), '- ')

    def test_zero_numid_disables_list(self):
        self.assertIsNone(self.numbering().prefix(ET.fromstring(para('T', num='0'))))

    def test_absent_list_stays_plain(self):
        self.assertIsNone(self.numbering().prefix(ET.fromstring(para('T', num=None))))

    def test_missing_metadata_rejected(self):
        with self.assertRaisesRegex(ValueError, 'metadata'):
            self.numbering().prefix(ET.fromstring(para('T', num='99')))

    def test_nondecimal_label_formats(self):
        self.assertEqual(format_counter(27, 'lowerLetter'), 'aa')
        self.assertEqual(format_counter(14, 'upperRoman'), 'XIV')
        self.assertEqual(format_counter(3, 'decimalZero'), '03')

    def test_unsupported_format_reported(self):
        with self.assertRaisesRegex(ValueError, 'Unsupported'):
            format_counter(1, 'chicago')

    def test_real_docx_path_retains_numbering(self):
        data = archive(definitions(), para('Collect data') + para('Analyze data'))
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'steps.docx'; p.write_bytes(data)
            out = parser._convert_docx(p)
        self.assertIn('1. Collect data', out)
        self.assertIn('2. Analyze data', out)

    def test_real_docx_path_preserves_word_headings(self):
        styles = '<w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>'
        data = archive(definitions(), para('Introduction', style='Heading1') + para('Body', num=None), styles)
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'headings.docx'; p.write_bytes(data)
            self.assertIn('# Introduction', parser._convert_docx(p))

    def test_word_table_remains_markdown_table(self):
        table = ET.fromstring(f'<w:tbl xmlns:w="{NS}"><w:tr><w:tc>{para("A | B", num=None)}</w:tc></w:tr><w:tr><w:tc>{para("Value", num=None)}</w:tc></w:tr></w:tbl>')
        self.assertEqual(parser._docx_table_to_markdown(table), ['| A \\| B |', '| --- |', '| Value |'])


class AnswerTests(unittest.TestCase):
    options = [{'key': key, 'text': text} for key, text in zip('ABCD', ['Cloud storage', 'A local database', 'File transfer', 'Spreadsheet'])]

    def test_bare_key(self):
        self.assertEqual(normalize_correct_answer('b', self.options), 'B')

    def test_decorated_keys(self):
        for value in ['Option B', '(b)', '[B]', 'Answer: B.', 'choice B']:
            with self.subTest(value=value):
                self.assertEqual(normalize_correct_answer(value, self.options), 'B')

    def test_exact_text(self):
        self.assertEqual(normalize_correct_answer(' a LOCAL  database ', self.options), 'B')

    def test_no_first_letter_guess(self):
        with self.assertRaises(ValueError):
            normalize_correct_answer('Because the source says so', self.options)

    def test_invalid_key(self):
        with self.assertRaises(ValueError):
            normalize_correct_answer('E', self.options)

    def test_empty_answer(self):
        with self.assertRaises(ValueError):
            normalize_correct_answer('', self.options)

    def test_ambiguous_answer(self):
        options = [{'key': k, 'text': t} for k,t in zip('ABCD', ['B', 'Second', 'Third', 'Fourth'])]
        with self.assertRaises(ValueError):
            normalize_correct_answer('B', options)

    def test_exact_counts_succeed(self):
        require_question_counts([{'type': 'mcq'}, {'type': 'subjective'}], 1, 1)

    def test_partial_counts_rejected(self):
        with self.assertRaisesRegex(ValueError, 'No quiz was saved'):
            require_question_counts([{'type': 'mcq'}], 2, 0)

    def test_excess_counts_rejected(self):
        with self.assertRaises(ValueError):
            require_question_counts([{'type': 'mcq'}, {'type': 'mcq'}], 1, 0)

    def test_invalid_counts_rejected(self):
        for count in [-1, True, 1.5]:
            with self.subTest(count=count), self.assertRaises(ValueError):
                require_question_counts([], count, 0)


if __name__ == '__main__':
    unittest.main()
