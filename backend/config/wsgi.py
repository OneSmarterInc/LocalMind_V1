import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
application = get_wsgi_application()

# Web processes (gunicorn, waitress via run_localmind.py, runserver) pick up
# lesson jobs left unfinished by a restart. Management commands and the test
# runner never import this module, so they never start the worker.
from tutor.lessons import resume_on_startup  # noqa: E402

resume_on_startup()
