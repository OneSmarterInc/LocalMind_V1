from copy import deepcopy
from pathlib import Path
import tempfile
import fitz
from django.test import SimpleTestCase, TestCase
from .services.parser import extract_sections_from_markdown
from .services.reading_outline import reading_outline, validate_coverage, apply_pdf_bookmarks
from .services.outline import persist_outline
from .models import Document
from core.testing import make_subject


class ReadingOutlineTests(SimpleTestCase):
    def test_flat_heading_flood_does_not_become_chapter_flood(self):
        sections = extract_sections_from_markdown('\n'.join(f'## Topic {n}\n' + ('Source sentence. ' * 80) for n in range(150)))
        plan = reading_outline('book.pdf', sections)
        self.assertEqual(len(plan['chapters']), 1)
        self.assertLess(len(plan['chapters'][0]['modules']), 150)
        self.assertTrue(plan['_quality']['warnings'])
        self.assertEqual(plan['_quality']['covered_sections'], 150)

    def test_nested_examples_exercises_and_introduction_retained_once(self):
        md = '# Chapter 1 Plants\nIntro.\n## Energy\n' + 'Energy source. '*300 + '\n### Case\nExample.\n## Your turn\nExercise.\n# Chapter 2 Animals\nAnimal source.'
        sections = extract_sections_from_markdown(md)
        plan = reading_outline('book.docx', sections)
        text = '\n'.join(m['source_text'] for c in plan['chapters'] for m in c['modules'])
        for value in ['Intro.', 'Example.', 'Exercise.', 'Animal source.']:
            self.assertEqual(text.count(value), 1)
        self.assertEqual(len(plan['chapters']), 2)
        self.assertEqual(plan['_quality']['covered_sections'], len(sections))

    def test_coverage_rejects_loss_duplication_and_changed_text(self):
        rows = extract_sections_from_markdown('# A\nAlpha\n## B\nBeta')
        plan = reading_outline('b.md', rows)
        for corruption in ['drop','duplicate','text']:
            bad = deepcopy(plan)
            module = bad['chapters'][0]['modules'][0]
            if corruption == 'drop': module['source_section_indices'].pop()
            elif corruption == 'duplicate': bad['chapters'][0]['modules'].append(deepcopy(module))
            else: module['source_text'] += ' invented'
            with self.assertRaises(ValueError): validate_coverage(bad, rows)

    def test_no_mutation_and_repeatable(self):
        rows=extract_sections_from_markdown('# A\nOriginal\n## B\nText');before=deepcopy(rows)
        self.assertEqual(reading_outline('b',rows),reading_outline('b',rows))
        self.assertEqual(rows,before)

    def test_bookmark_titles_verified_against_destination_and_wrapping(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'sample.pdf';pdf=fitz.open()
            pdf.new_page();pdf.new_page()
            pdf.set_toc([[1,'1. First chapter',1],[1,'2. Second chapter',2]])
            pdf.save(path);pdf.close()
            md='## CHAPTER 1\n## First\nchapter\nIntro\n## Case\nCase text\n<!-- page break -->\n## CHAPTER 2\n## Second chapter\nEnd'
            fixed,ok=apply_pdf_bookmarks(md,path)
            self.assertTrue(ok)
            rows=extract_sections_from_markdown(fixed)
            self.assertEqual(len(reading_outline('b',rows)['chapters']),2)
            self.assertIn('Case text',fixed)
            unchanged,ok=apply_pdf_bookmarks(md.replace('Second chapter','Wrong title'),path)
            self.assertFalse(ok)
            self.assertIn('Wrong title',unchanged)


class ReadingPersistenceTests(TestCase):
    def test_grouped_text_and_page_ranges_survive_persistence(self):
        rows=extract_sections_from_markdown('# Chapter 1\nIntroduction\n<!-- page break -->\n## Topic\nBody')
        plan=reading_outline('b.pdf',rows)
        doc=Document.objects.create(subject=make_subject(),original_name='b.pdf',file_type='pdf')
        persist_outline(doc,plan,rows)
        module=doc.chapters.first().modules.first()
        self.assertEqual(module.source_text,plan['chapters'][0]['modules'][0]['source_text'])
        self.assertEqual((module.start_page,module.end_page),(1,2))

class ReadingPageCoverageTests(SimpleTestCase):
    def test_parent_end_page_does_not_leak_into_first_module(self):
        md = '# Chapter 1\nIntro\n## First\n' + 'First detail. '*650 + '\n<!-- page break -->\n## Second\n' + 'Second detail. '*650
        sections = extract_sections_from_markdown(md)
        plan = reading_outline('b.pdf', sections)
        modules = plan['chapters'][0]['modules']
        self.assertEqual(len(modules), 2)
        self.assertEqual(modules[0]['end_page'], 1)
        self.assertEqual(modules[1]['start_page'], 2)

    def test_plain_pdf_probe_does_not_silently_stop_at_page_400(self):
        from .services.parser import _pdf_text_layer
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'long.pdf';pdf=fitz.open()
            for i in range(402):
                pdf.new_page().insert_text((40,40), f'Unique source on page {i+1}')
            pdf.save(path);pdf.close()
            text,_=_pdf_text_layer(path)
            self.assertIn('Unique source on page 402', text)
            self.assertEqual(text.count('<!-- page break -->'), 401)

class ReadingPreviewTests(TestCase):
    def setUp(self):
        from core.testing import make_admin, client_for
        from .services.outline_policy import source_hierarchy_outline
        self.admin=make_admin();self.client=client_for(self.admin)
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        path=Path(self.temp.name)/'document.md';path.write_text('# Chapter 1\nIntro\n## A\nAlpha\n## B\nBeta')
        self.doc=Document.objects.create(subject=make_subject(),original_name='b.docx',file_type='docx',
            status='under_review',processed_markdown_path=str(path),outline_source='source_hierarchy')
        rows=extract_sections_from_markdown(path.read_text())
        persist_outline(self.doc,source_hierarchy_outline('b.docx',rows),rows)
        self.url=f'/api/faculty/documents/{self.doc.pk}/outline/'

    def test_preview_does_not_change_existing_rows_then_explicit_save_applies(self):
        from learning.models import Module
        before=list(Module.objects.filter(chapter__document=self.doc).values_list('id','source_text'))
        response=self.client.get(self.url+'?suggest=reading')
        self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(before,list(Module.objects.filter(chapter__document=self.doc).values_list('id','source_text')))
        payload={'chapters':response.data['chapters'],'expected_content_version':response.data['content_version']}
        saved=self.client.put(self.url,payload,format='json')
        self.assertEqual(saved.status_code,200,saved.data)
        self.assertEqual(Module.objects.filter(chapter__document=self.doc).count(),1)
        text=Module.objects.get(chapter__document=self.doc).source_text
        self.assertIn('Alpha',text);self.assertIn('Beta',text);self.assertIn('Intro',text)

    def test_stale_preview_is_rejected(self):
        response=self.client.get(self.url+'?suggest=reading')
        Document.objects.filter(pk=self.doc.pk).update(content_version=self.doc.content_version+1)
        result=self.client.put(self.url,{'chapters':response.data['chapters'],'expected_content_version':response.data['content_version']},format='json')
        self.assertEqual(result.status_code,409)
        self.assertEqual(result.data['error']['code'],'OUTLINE_CHANGED')

    def test_student_activity_survives_attempt_to_replace_outline(self):
        from core.testing import make_student
        from learning.models import Module,ModuleProgress
        module=Module.objects.filter(chapter__document=self.doc).first()
        ModuleProgress.objects.create(module=module,student=make_student())
        before=list(Module.objects.filter(chapter__document=self.doc).values_list('id','source_text'))
        response=self.client.get(self.url+'?suggest=reading')
        result=self.client.put(self.url,{'chapters':response.data['chapters']},format='json')
        self.assertEqual(result.status_code,409,result.data)
        self.assertEqual(before,list(Module.objects.filter(chapter__document=self.doc).values_list('id','source_text')))
        self.assertTrue(ModuleProgress.objects.filter(module=module).exists())
