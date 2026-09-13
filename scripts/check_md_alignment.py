#!/usr/bin/env python3
"""Run pure integrity tests + strict TS checks of dependency-free modules.

This does NOT replace manage.py test, npm run typecheck, the Expo build or a
real phone test. It never installs packages, downloads a model or calls an API.
"""
from pathlib import Path
import ast
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    count = 0
    for tree in ('backend', 'device-spike/scripts', 'scripts'):
        for p in (ROOT / tree).rglob('*.py'):
            if any(x in p.parts for x in ('.venv', 'node_modules')):
                continue
            ast.parse(p.read_text(encoding='utf-8-sig'), filename=str(p))
            count += 1
    print(f'Python syntax parsed: {count} files', flush=True)
    env = dict(os.environ, PYTHONPATH=str(ROOT / 'backend'))
    subprocess.run([sys.executable, '-m', 'unittest', 'documents.tests_md_integrity', '-v'], cwd=ROOT, env=env, check=True)
    exe = 'tsc.cmd' if os.name == 'nt' else 'tsc'
    local = ROOT / 'frontend' / 'node_modules' / '.bin' / exe
    tsc = str(local) if local.exists() else shutil.which(exe)
    node = shutil.which('node')
    if not tsc or not node:
        raise SystemExit('TypeScript or Node is missing. Install the frontend dependencies before running the JS checks.')
    with tempfile.TemporaryDirectory(prefix='lm-md-tests-') as tmp:
        subprocess.run([tsc, '--strict', '--target', 'ES2020', '--module', 'commonjs', '--outDir', tmp,
                        'frontend/src/ui/sourceBlocks.ts', 'device-spike/src/prompts.ts', 'device-spike/src/fixture.ts'], cwd=ROOT, check=True)
        subprocess.run([node, '--test', 'tests/md_alignment.test.cjs'], cwd=ROOT,
                       env=dict(env, LOCALMIND_TEST_BUILD=tmp), check=True)
    print('Pure checks passed. Full Django/Expo/device acceptance is separate.', flush=True)


if __name__ == '__main__':
    main()
