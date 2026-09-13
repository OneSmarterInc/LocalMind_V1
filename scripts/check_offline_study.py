#!/usr/bin/env python3
"""Executable contracts, not a substitute for Django, Expo or real phone acceptance."""
from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile
ROOT = Path(__file__).resolve().parents[1]
def main():
    env = dict(os.environ, PYTHONPATH=str(ROOT / "backend"))
    subprocess.run([sys.executable, "-m", "unittest", "study.tests_contracts", "-v"], cwd=ROOT, env=env, check=True)
    exe = "tsc.cmd" if os.name == "nt" else "tsc"
    local = ROOT / "frontend/node_modules/.bin" / exe
    tsc = str(local) if local.exists() else shutil.which(exe)
    node = shutil.which("node")
    if not tsc or not node: raise SystemExit("Install Node and TypeScript/frontend dependencies first.")
    subprocess.run([tsc, "--strict", "--target", "es2022", "--module", "commonjs", "--outDir", ".test-build", "src/core.ts"], cwd=ROOT / "student-runtime", check=True)
    subprocess.run([node, "--test", "tests/core.test.cjs"], cwd=ROOT / "student-runtime", check=True)
    with tempfile.TemporaryDirectory(prefix="lm-draft-") as tmp:
        subprocess.run([tsc, "--strict", "--target", "es2022", "--module", "commonjs", "--outDir", tmp, "frontend/src/hooks/draftPersistence.ts"], cwd=ROOT, check=True)
        subprocess.run([node, "--test", "tests/draft_persistence.test.cjs"], cwd=ROOT, env=dict(env, LOCALMIND_DRAFT_BUILD=tmp), check=True)
    print("Offline study pure checks passed; full integration and native acceptance are separate.")
if __name__ == "__main__": main()
