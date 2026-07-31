@echo off
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo ERROR: Local environment not found.
    echo Run START_HERE_INSTALL_AND_RUN.bat first, then close the server and run this file.
    pause
    exit /b 1
)

echo ============================================================
echo PAL-AI DEMO ELEVATION CACHE PRELOADER
echo ============================================================
echo This preloads real OpenTopoData elevation values into a local
echo SQLite cache so 3D Terrain scans load faster during demos.
echo.
echo This does NOT build the full offline DEM raster.
echo It only preloads targeted demo grids.
echo.
echo Recommended: run this once while connected to the internet.
echo ============================================================
echo.

call ".venv\Scripts\activate.bat"
python "backend\preload_elevation_cache.py" --demo

echo.
echo Preload finished. You can now run RUN_LOCAL_ONLY_AFTER_SETUP.bat.
pause
