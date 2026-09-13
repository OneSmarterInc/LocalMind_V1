#!/usr/bin/env bash
# LocalMind one-click start for macOS/Linux. First run creates the virtual
# environment and installs from wheelhouse/ (offline) or PyPI (online).
set -e
cd "$(dirname "$0")"
if [ ! -d backend/.venv ]; then
  echo "Creating Python environment..."
  python3 -m venv backend/.venv
  . backend/.venv/bin/activate
  pip install --upgrade pip >/dev/null
  if [ -d wheelhouse ]; then
    pip install --no-index --find-links wheelhouse -r backend/requirements.txt
  else
    pip install -r backend/requirements.txt --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu
  fi
else
  . backend/.venv/bin/activate
fi
exec python run_localmind.py "$@"
