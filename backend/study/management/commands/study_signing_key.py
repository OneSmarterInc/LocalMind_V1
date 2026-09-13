"""Create a private signing key outside the repository and print its public key."""
import base64
import json
import hashlib
import re
import os
from pathlib import Path
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument("path")
        parser.add_argument("--key-id", required=True)
    def handle(self, *args, **options):
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", options["key_id"]):
            raise CommandError("Use a short key ID containing letters, numbers, dots, underscores or hyphens.")
        path = Path(options["path"]).expanduser().resolve()
        if path.is_relative_to(Path(settings.BASE_DIR).parent.resolve()):
            raise CommandError("Store the private key outside the project so it cannot be committed.")
        key = Ed25519PrivateKey.generate()
        pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as f: f.write(pem)
        except FileExistsError:
            raise CommandError("Key already exists; it was not overwritten.")
        public = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        self.stdout.write(json.dumps({"key_id": options["key_id"], "public_key": base64.b64encode(public).decode(), "fingerprint_sha512_prefix": ":".join(f"{b:02x}" for b in hashlib.sha512(public).digest()[:16])}))
        self.stdout.write("Private key created. Protect it with operating-system permissions and an offline backup. Never distribute it with a package.")
