"""Disposable REAL Django server for browser tests. Never uses the user's DB.

Only inference is stubbed in the normal browser suite. Set LM_E2E_REAL_MODEL=1
for the separate smoke that keeps the real bundled browser inference runtime.
"""
import json, os, shutil, subprocess, sys, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
if os.environ.get('RUN_LOCALMIND_BROWSER_TESTS')!='1':
    raise SystemExit('Test server requires RUN_LOCALMIND_BROWSER_TESTS=1.')
with tempfile.TemporaryDirectory(prefix='localmind-browser-') as folder:
    work=Path(folder);web=work/'web'
    shutil.copytree(ROOT/'frontend/dist',web)
    if os.environ.get('LM_E2E_REAL_MODEL')!='1':
        shutil.copyfile(ROOT/'tests/fixtures/private-model-stub.js',web/'private-assets/runtime-loader.js')
    os.environ.update(DJANGO_SETTINGS_MODULE='config.settings',DJANGO_DEBUG='true',
        DJANGO_SECRET_KEY='localmind-disposable-browser-test-only-secret',
        DATABASE_URL=f'sqlite:///{work / "db.sqlite3"}',WEB_DIST=str(web),
        AI_ENABLED='false',AI_MONITOR_MODE='off',DURABLE_JOBS='false',
        AUTO_GENERATE_LESSONS='false',AUTO_GENERATE_QUIZZES='false',API_DOCS_ENABLED='false')
    sys.path.insert(0,str(ROOT/'backend'))
    import django
    django.setup()
    from django.conf import settings
    settings.MEDIA_ROOT=work/'media'
    settings.PRIVATE_LIBRARY_ROOT=work/'private-books'
    # Every callable sees these settings in this same process; no user .env is changed.
    from django.core.management import call_command
    call_command('migrate',interactive=False,verbosity=0)
    from core.testing import make_admin,make_faculty,make_student,make_subject,assign,enroll,make_published_document
    from django.core.files.base import ContentFile
    import io,hashlib
    from docx import Document as Word
    from reportlab.pdfgen.canvas import Canvas
    password='Disposable-Browser-Test-2026!'
    admin=make_admin(email='browser-admin@example.edu',password=password)
    faculty=make_faculty(email='browser-faculty@example.edu',password=password)
    student=make_student(email='browser-student@example.edu',password=password)
    outsider=make_student(email='browser-other@example.edu',password=password)
    subject=make_subject(code='WEBTEST',name='Browser test biology')
    assign(faculty,subject);enroll(student,subject)
    source=('Photosynthesis happens in the chloroplasts of green leaves. Chlorophyll absorbs sunlight. '
            'Plants take in carbon dioxide through stomata and release oxygen. Water enters the plant through roots. '
            'Sunlight supplies energy to produce glucose. Glucose can be stored as starch. ')*5
    doc=make_published_document(subject,title='Faculty Biology',modules=(('Leaf science',source),('Open practice',source)))
    out=io.BytesIO();word=Word();word.add_heading('Leaf science',1);word.add_paragraph(source)
    word.add_heading('Open practice',1);word.add_paragraph(source);word.save(out);raw=out.getvalue()
    doc.original_name='faculty-biology.docx';doc.file_type='docx';doc.file_size=len(raw);doc.content_hash=hashlib.sha256(raw).hexdigest();doc.uploaded_by=faculty
    doc.file.save(doc.original_name,ContentFile(raw),save=True)
    from learning.models import Module
    module=Module.objects.filter(chapter__document=doc).order_by('order').first()
    results=ROOT/'frontend/test-results';results.mkdir(exist_ok=True)
    pdf=io.BytesIO();canvas=Canvas(pdf);canvas.drawString(40,760,'Photosynthesis happens in the chloroplasts of green leaves.');canvas.save()
    (results/'private-fixture.pdf').write_bytes(pdf.getvalue())
    (results/'fixture.json').write_text(json.dumps({'module':str(module.id),'document':str(doc.id),'subject':str(subject.id),'source':source,'password':password}))
    # runserver stays in this process so temporary storage settings are retained.
    call_command('runserver','127.0.0.1:8765',use_reloader=False,verbosity=0)
