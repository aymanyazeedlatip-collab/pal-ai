@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

if not exist "backend\.env" (
    echo TIP: PALADIN needs a Gemini API key for chat and image analysis.
    echo Run CONFIGURE_PALADIN_API_KEY.bat to set it up.
    echo.
)

echo ============================================================
echo PAL-AI LOCAL READY-TO-RUN SETUP
echo ============================================================
echo.

echo [1/4] Checking Python...
where py >nul 2>nul
if %errorlevel%==0 (
    set PY_CMD=py -3
) else (
    where python >nul 2>nul
    if %errorlevel%==0 (
        set PY_CMD=python
    ) else (
        echo ERROR: Python is not installed or not added to PATH.
        echo Please install Python 3.10 or newer, then run this file again.
        pause
        exit /b 1
    )
)

%PY_CMD% --version
if %errorlevel% neq 0 (
    echo ERROR: Python check failed.
    pause
    exit /b 1
)

echo.
echo [2/4] Creating local virtual environment...
if not exist ".venv\Scripts\python.exe" (
    %PY_CMD% -m venv .venv
    if %errorlevel% neq 0 (
        echo ERROR: Could not create virtual environment.
        pause
        exit /b 1
    )
) else (
    echo Existing .venv found. Reusing it.
)

echo.
echo [3/4] Installing required packages...
call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip
if %errorlevel% neq 0 (
    echo ERROR: pip upgrade failed.
    pause
    exit /b 1
)

python -m pip install -r "backend\requirements.txt"
if %errorlevel% neq 0 (
    echo ERROR: Dependency installation failed.
    pause
    exit /b 1
)

echo.
echo [4/4] Starting PAL-AI locally...
echo.
echo Open this link in your browser if it does not open automatically:
echo http://127.0.0.1:8000
echo.
start "" "http://127.0.0.1:8000"
cd backend
python -m uvicorn main:app --host 127.0.0.1 --port 8000

echo.
echo PAL-AI server stopped.
pause
