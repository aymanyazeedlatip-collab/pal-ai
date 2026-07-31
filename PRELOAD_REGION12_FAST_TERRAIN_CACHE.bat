@echo off
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo ERROR: Local environment not found.
    echo Run START_HERE_INSTALL_AND_RUN.bat first, then close the server and run this file.
    pause
    exit /b 1
)

echo ============================================================
echo PAL-AI FAST TERRAIN PRELOAD - REGION XII / SOCCSKSARGEN
echo ============================================================
echo This brings back the older fast terrain preload style.
echo It preloads many 10 km terrain scan tiles across the Region XII
echo demonstration area into the local SQLite elevation cache.
echo.
echo No offline DEM raster will be created.
echo No synthetic elevation fallback will be generated.
echo.
echo This can take a long time on the first run, but it resumes and
echo skips tiles that are already cached.
echo ============================================================
echo.

call ".venv\Scripts\activate.bat"
python "backend\preload_elevation_cache.py" --region12-tiles --tile-size-km 10

echo.
echo Region XII fast terrain preload finished.
echo You can now run RUN_LOCAL_ONLY_AFTER_SETUP.bat.
pause
