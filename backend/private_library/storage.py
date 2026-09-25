from pathlib import Path
from django.conf import settings
from django.core.files.storage import FileSystemStorage, Storage
from django.utils.deconstruct import deconstructible

@deconstructible
class PrivateBookStorage(Storage):
    """Resolve private storage on each operation, including in overridden tests.

    No public URL is provided. Downloads must pass through the authenticated view.
    """
    def backend(self):
        root = Path(getattr(settings, "PRIVATE_LIBRARY_ROOT", Path(settings.BASE_DIR) / "private-books"))
        return FileSystemStorage(location=root, file_permissions_mode=0o600, directory_permissions_mode=0o700)
    def _open(self, name, mode="rb"): return self.backend().open(name, mode)
    def _save(self, name, content): return self.backend().save(name, content)
    def exists(self, name): return self.backend().exists(name)
    def delete(self, name): return self.backend().delete(name)
    def size(self, name): return self.backend().size(name)
    def path(self, name): return self.backend().path(name)
    def url(self, name): raise ValueError("Private books have no public storage URL.")

def private_storage():
    return PrivateBookStorage()

def upload_path(instance, name):
    return f"{instance.id}/source{Path(name).suffix.lower()}"
