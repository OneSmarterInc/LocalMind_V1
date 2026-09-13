@echo off
rem LocalMind one-click start for Windows. First run creates the virtual
rem environment and installs from wheelhouse\ (offline) or PyPI (online).
setlocal
cd /d "%~dp0"
if not exist backend\.venv (
  echo Creating Python environment...
  python -m venv backend\.venv || goto :fail
  call backend\.venv\Scripts\activate.bat
  python -m pip install --upgrade pip >nul
  if exist wheelhouse (
    pip install --no-index --find-links wheelhouse -r backend\requirements.txt || goto :fail
  ) else (
    pip install -r backend\requirements.txt --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu || goto :fail
  )
) else (
  call backend\.venv\Scripts\activate.bat
)
python run_localmind.py %*
goto :eof
:fail
echo Setup failed. Python 3.11 or 3.12 must be installed and on PATH.
pause
