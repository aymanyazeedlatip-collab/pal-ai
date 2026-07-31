@echo off
cd /d "%~dp0"

if not exist "backend\.env" (
    echo TIP: PALADIN needs a Gemini API key for chat and image analysis.
    echo Run CONFIGURE_PALADIN_API_KEY.bat to set it up.
    echo.
)

if not exist ".venv\Scripts\activate.bat" (
    echo ERROR: Local environment not found.
    echo Run START_HERE_INSTALL_AND_RUN.bat first.
    pause
    exit /b 1
)

call ".venv\Scripts\activate.bat"
echo Starting PAL-AI at http://127.0.0.1:8000
start "" "http://127.0.0.1:8000"
cd backend
python -m uvicorn main:app --host 127.0.0.1 --port 8000
pause
