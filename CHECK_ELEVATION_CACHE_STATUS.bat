@echo off
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo ERROR: Local environment not found.
    echo Run START_HERE_INSTALL_AND_RUN.bat first.
    pause
    exit /b 1
)

call ".venv\Scripts\activate.bat"
python "backend\preload_elevation_cache.py" --status
pause
