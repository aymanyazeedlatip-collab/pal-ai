@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo PAL-AI PALADIN API KEY SETUP
echo ============================================================
echo.

if not exist "backend\.env" (
    if exist "backend\.env.example" (
        copy /Y "backend\.env.example" "backend\.env" >nul
        echo Created backend\.env from the included template.
    ) else (
        echo LLM_API_KEY= > "backend\.env"
        echo LLM_MODEL=gemini-3.6-flash>> "backend\.env"
        echo GOOGLE_WEATHER_API_KEY=>> "backend\.env"
        echo Created a new backend\.env file.
    )
) else (
    echo Existing backend\.env found. It will be opened without replacing it.
)

echo.
echo In Notepad, paste your Gemini API key after:
echo LLM_API_KEY=
echo.
echo Example format only:
echo LLM_API_KEY=your_private_key_here

echo.
echo Save the file, close Notepad, then restart PAL-AI.
echo Never put the key in frontend\app.js or frontend\index.html.
echo.
start "" notepad "backend\.env"
pause
