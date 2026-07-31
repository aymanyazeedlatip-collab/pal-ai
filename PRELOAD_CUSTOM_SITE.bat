@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo ERROR: Local environment not found.
    echo Run START_HERE_INSTALL_AND_RUN.bat first, then close the server and run this file.
    pause
    exit /b 1
)

echo ============================================================
echo PAL-AI CUSTOM ELEVATION CACHE PRELOADER
echo ============================================================
echo Use this for the exact location you will demonstrate.
echo It is faster and more reliable than only using the 32 demo sites.
echo.
set /p LAT=Enter center latitude: 
set /p LNG=Enter center longitude: 
set /p SIZEKM=Enter scan size in km, example 5 or 10: 
set /p SITENAME=Enter site name, no spaces preferred: 

if "%SIZEKM%"=="" set SIZEKM=10
if "%SITENAME%"=="" set SITENAME=custom_demo_site

call ".venv\Scripts\activate.bat"
python "backend\preload_elevation_cache.py" --lat %LAT% --lng %LNG% --size-km %SIZEKM% --name "%SITENAME%"

echo.
echo Custom site preload finished.
pause
