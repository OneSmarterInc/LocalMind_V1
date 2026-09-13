"""Download the embedded GGUF model once, with internet access, so the app can
run offline afterwards.

    python manage.py fetch_model                # default repo/file from settings
    python manage.py fetch_model --url https://.../model.gguf
    python manage.py fetch_model --from /path/to/model.gguf   # copy a file you already have

The file goes to AI_MODEL_PATH (or backend/models/<AI_MODEL_FILE>). Ship that
folder with the application; nothing else is needed on the target machine.
"""
import shutil
import sys
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from ai.llamacpp import library_available, model_path


class Command(BaseCommand):
    help = "Download (or copy) the GGUF model used by the embedded offline AI provider."

    def add_arguments(self, parser):
        parser.add_argument("--url", help="Direct download URL for the .gguf (overrides repo/file settings).")
        parser.add_argument("--from", dest="source", help="Copy an existing local .gguf instead of downloading.")
        parser.add_argument("--force", action="store_true", help="Replace an existing file.")
        parser.add_argument("--docling", action="store_true", help="Also download Docling's PDF layout and table models for offline parsing.")
        parser.add_argument("--skip-llm", action="store_true", help="Only handle the Docling models.")
        parser.add_argument("--monitor", action="store_true",
                            help="Also download the AI monitor's dedicated judge model (AI_MONITOR_MODEL_REPO / AI_MONITOR_MODEL_DOWNLOAD_FILE) "
                                 "into backend/models/. Skipped when no AI_MONITOR_MODEL_FILE is configured.")

    def handle(self, *args, **options):
        from django.conf import settings

        cfg = settings.AI
        if options["docling"]:
            self._fetch_docling(settings)
        if options["monitor"]:
            self._fetch_monitor(settings, options["force"])
        if options["skip_llm"]:
            return
        target = model_path()
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and not options["force"]:
            self.stdout.write(self.style.SUCCESS(f"Model already present at {target} ({target.stat().st_size // (1024 * 1024)} MB). Use --force to replace."))
            self._check_library()
            return

        if options["source"]:
            src = Path(options["source"]).expanduser()
            if not src.exists():
                raise CommandError(f"{src} does not exist.")
            self.stdout.write(f"Copying {src} -> {target}")
            shutil.copyfile(src, target)
        else:
            url = options["url"] or f"https://huggingface.co/{cfg['MODEL_REPO']}/resolve/main/{cfg['MODEL_FILE']}"
            self._download(url, target)

        self.stdout.write(self.style.SUCCESS(f"Model ready at {target} ({target.stat().st_size // (1024 * 1024)} MB)."))
        self._check_library()

    def _download(self, url: str, target: Path):
        import requests

        self.stdout.write(f"Downloading {url}")
        tmp = target.with_suffix(".part")
        try:
            with requests.get(url, stream=True, timeout=60, allow_redirects=True) as r:
                if r.status_code >= 400:
                    raise CommandError(f"Download failed with HTTP {r.status_code}. Check AI_MODEL_REPO / AI_MODEL_FILE or pass --url.")
                total = int(r.headers.get("content-length") or 0)
                done = 0
                with open(tmp, "wb") as fh:
                    for chunk in r.iter_content(chunk_size=1 << 20):
                        fh.write(chunk)
                        done += len(chunk)
                        if total:
                            sys.stdout.write(f"\r  {done * 100 // total:3d}%  {done // (1 << 20)} / {total // (1 << 20)} MB")
                            sys.stdout.flush()
            sys.stdout.write("\n")
        except requests.RequestException as exc:
            tmp.unlink(missing_ok=True)
            raise CommandError(f"Download failed: {exc}")
        if tmp.stat().st_size < 50 * (1 << 20):
            tmp.unlink(missing_ok=True)
            raise CommandError("Downloaded file is too small to be a model; the URL probably returned an error page.")
        tmp.replace(target)

    def _fetch_monitor(self, settings, force: bool):
        from ai_monitor.judge import judge_model_path

        mon = settings.AI_MONITOR
        target = judge_model_path()
        if target is None:
            self.stdout.write(self.style.WARNING(
                "AI_MONITOR_MODEL_FILE is not set, so the judge shares the application model and there is nothing to download. "
                f"To use a dedicated evaluator set AI_MONITOR_MODEL_FILE={mon['MODEL_DOWNLOAD_FILE']} in .env and run this again."))
            return
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and not force:
            self.stdout.write(self.style.SUCCESS(f"Judge model already present at {target} ({target.stat().st_size // (1024 * 1024)} MB)."))
            return
        url = f"https://huggingface.co/{mon['MODEL_REPO']}/resolve/main/{mon['MODEL_DOWNLOAD_FILE']}"
        self._download(url, target)
        self.stdout.write(self.style.SUCCESS(f"Judge model ready at {target} ({target.stat().st_size // (1024 * 1024)} MB)."))

    def _fetch_docling(self, settings):
        from pathlib import Path as _P

        folder = _P(settings.AI.get("DOCLING_ARTIFACTS") or _P(settings.BASE_DIR) / "models" / "docling")
        folder.mkdir(parents=True, exist_ok=True)
        try:
            from docling.utils.model_downloader import download_models
        except ImportError as exc:
            raise CommandError(f"docling is not installed ({exc}); PDF parsing needs it. pip install -r requirements.txt")
        self.stdout.write(f"Downloading Docling layout and table models into {folder}...")
        # The parser uses Docling's default OCR engine (RapidOCR). EasyOCR is
        # not installed and newer Docling releases refuse to download its
        # models without the package, so it is switched off explicitly.
        # Older releases do not know the flag, hence the fallback.
        kwargs = dict(output_dir=folder, progress=True, with_layout=True, with_tableformer=True, with_code_formula=False,
                      with_picture_classifier=False)
        try:
            download_models(**kwargs, with_easyocr=False)
        except TypeError:
            download_models(**kwargs)
        # Older installs deliberately skipped TableFormer. This marker is
        # written only after the layout + table downloader succeeds; the
        # readiness screen asks those installs to refresh their assets once.
        (folder / "localmind-table-models.ready").write_text("layout+tableformer\n", encoding="utf-8")
        self.stdout.write(self.style.SUCCESS(f"Docling layout and table models downloaded to {folder}"))

    def _check_library(self):
        ok, err = library_available()
        if ok:
            self.stdout.write("llama-cpp-python: installed")
        else:
            self.stdout.write(self.style.WARNING(
                f"{err}\nInstall it with:  pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu"))
            