#!/usr/bin/env python3
"""Build a self-contained LocalMind bundle for machines without internet.

Run this ONCE on a machine that has internet, Node and Python:

    python package_offline.py               # bundle for this OS/Python
    python package_offline.py --platform win_amd64 --python 3.12

Output: dist/localmind-offline-<platform>.zip containing the source, the
built web client, the AI model, the Docling models and a wheelhouse of every
Python dependency for the target platform. On the target machine: unzip,
run start.bat (Windows) or ./start.sh (macOS/Linux). No Ollama, no Node, no
network. Only Python 3.11/3.12 needs to be present.
"""
import argparse
import os
import platform
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
WHEELHOUSE = ROOT / "wheelhouse"
OUT = ROOT / "dist"

EXCLUDE_DIRS = {"node_modules", ".git", ".venv", "__pycache__", ".expo", "media", "staticfiles"}
EXCLUDE_FILES = {"db.sqlite3", "db.sqlite3-wal", "db.sqlite3-shm", "db.sqlite3-journal", ".env"}


def run(cmd, cwd=ROOT):
    print("+", " ".join(map(str, cmd)))
    subprocess.check_call(cmd, cwd=cwd)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--platform", default=None, help="pip platform tag for the target, e.g. win_amd64, manylinux2014_x86_64, macosx_11_0_arm64")
    ap.add_argument("--python", default=f"{sys.version_info.major}.{sys.version_info.minor}", help="target Python version, e.g. 3.12")
    ap.add_argument("--skip-web", action="store_true")
    ap.add_argument("--skip-models", action="store_true")
    ap.add_argument("--skip-wheels", action="store_true")
    args = ap.parse_args()

    if not args.skip_web:
        run(["npm", "install"], cwd=FRONTEND)
        run(["npx", "expo", "export", "--platform", "web"], cwd=FRONTEND)

    py = sys.executable
    if not args.skip_models:
        run([py, "manage.py", "fetch_model", "--docling"], cwd=BACKEND)

    if not args.skip_wheels:
        if WHEELHOUSE.exists():
            shutil.rmtree(WHEELHOUSE)
        WHEELHOUSE.mkdir()
        cmd = [py, "-m", "pip", "download", "-r", str(BACKEND / "requirements.txt"), "-d", str(WHEELHOUSE),
               "--extra-index-url", "https://abetlen.github.io/llama-cpp-python/whl/cpu"]
        if args.platform:
            cmd += ["--platform", args.platform, "--python-version", args.python, "--only-binary=:all:"]
        run(cmd)

    OUT.mkdir(exist_ok=True)
    tag = args.platform or f"{platform.system().lower()}_{platform.machine().lower()}"
    target = OUT / f"localmind-offline-{tag}.zip"
    print(f"Writing {target} ...")
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as zf:
        for base in (BACKEND, FRONTEND / "dist", ROOT / "docs", WHEELHOUSE):
            if not base.exists():
                continue
            for path in base.rglob("*"):
                rel = path.relative_to(ROOT)
                if any(part in EXCLUDE_DIRS for part in rel.parts[:-1]) or path.name in EXCLUDE_FILES or path.is_dir():
                    continue
                zf.write(path, str(rel))
        for name in ("run_localmind.py", "start.bat", "start.sh", "README.md"):
            zf.write(ROOT / name, name)
    print(f"Done: {target} ({target.stat().st_size // (1 << 20)} MB)")


if __name__ == "__main__":
    main()
