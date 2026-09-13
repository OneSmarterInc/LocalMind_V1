"""Materialize the previously staged private-library source, never a user database.

Only the three exact transport blobs listed here are accepted. Existing files must
still equal the reviewed base revision. All checks finish before anything is written.
This helper is used only while completing the feature branch, not at app startup.
"""
from pathlib import Path, PurePosixPath
import argparse
import base64
import hashlib
import json
import lzma
import subprocess

BASE = "442ddc1f0ab4a7319c401294f6f331c17e08d9e6"
PARTS = (
    (".changes/private-library-01.b64", "b5c2c5b00c9f628efe336bc9cc6ee0faffe05ddd"),
    (".changes/private-library-02.b64", "32d4814e94227da90d240a462608daa1797e84f3"),
    (".changes/private-library-03.b64", "6ff5aaad2c30ee81a8ccf00c6ecaf91bcfdc1665"),
)
MARKER = ".localmind-private-library"
ALLOWED = ("backend/", "frontend/", "scripts/", "tests/", "docs/")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    marker = root / MARKER
    if marker.exists():
        recorded = json.loads(marker.read_text())
        if recorded.get("base") != BASE or recorded.get("transport") != dict(PARTS):
            raise SystemExit("Unexpected materialization marker. Refusing automatic changes.")
        print("Implementation already materialized; current source will be tested without overwriting it.")
        return
    encoded = []
    for name, expected in PARTS:
        data = (root / name).read_bytes()
        oid = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if oid != expected:
            raise SystemExit(f"Transport checksum mismatch: {name}")
        encoded.append(data.strip())
    compressed = base64.b64decode(b"".join(encoded), validate=True)
    decoder = lzma.LZMADecompressor(memlimit=256 * 1024 * 1024)
    raw = decoder.decompress(compressed, max_length=2 * 1024 * 1024)
    if not decoder.eof or decoder.unused_data:
        raise SystemExit("Source payload exceeds limit or contains trailing data.")
    payload = json.loads(raw)
    if not isinstance(payload, dict) or not 1 <= len(payload) <= 200:
        raise SystemExit("Expected a bounded map of source paths to UTF-8 contents.")
    plan = []
    for name, content in payload.items():
        if not isinstance(name, str) or not isinstance(content, str):
            raise SystemExit("Invalid source entry.")
        parts = PurePosixPath(name).parts
        if "\\" in name or ".." in parts or name.startswith("/") or not (name.startswith(ALLOWED) or name == ".gitignore"):
            raise SystemExit(f"Unexpected source path: {name}")
        target = root / name
        if any(p.is_symlink() for p in (target, *target.parents)):
            raise SystemExit(f"Symlink is not an allowed source target: {name}")
        if name.endswith((".sqlite3", ".gguf", ".pem", ".key")) or ".env" in parts or "node_modules" in parts:
            raise SystemExit(f"Runtime or secret file is not an allowed target: {name}")
        old = subprocess.run(["git", "show", f"{BASE}:{name}"], cwd=root, capture_output=True)
        if old.returncode == 0:
            if not target.is_file() or target.read_bytes() != old.stdout:
                raise SystemExit(f"Existing source changed since the reviewed base: {name}")
        elif target.exists():
            raise SystemExit(f"New source path already exists: {name}")
        body = content.encode("utf-8")
        plan.append((name, target, body))
    digest = hashlib.sha256(raw).hexdigest()
    print(f"Validated {len(plan)} source files; payload SHA-256 {digest}")
    for name, _, body in plan:
        print(f"{name} ({len(body)} bytes)")
    if not args.apply:
        print("Audit only. No source files changed.")
        return
    for _, target, body in plan:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
    marker.write_text(json.dumps({"base": BASE, "transport": dict(PARTS), "payload_sha256": digest,
        "files": {name: hashlib.sha256(body).hexdigest() for name, _, body in plan}}, indent=2) + "\n")
    for name, _ in PARTS:
        (root / name).unlink()
    print("Source materialized. Integration and device acceptance are separate checks.")


if __name__ == "__main__":
    main()
