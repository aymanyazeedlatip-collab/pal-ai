@echo off
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo ERROR: Local environment not found.
    echo Run START_HERE_INSTALL_AND_RUN.bat first, then close the server and run this file.
    pause
    exit /b 1
)

echo ============================================================
echo PAL-AI FAST TERRAIN PRELOAD - TUPI DEMO SITE
echo ============================================================
echo This preloads the common Tupi / South Cotabato demo scan using
echo both 5 km and 10 km grids into the local SQLite elevation cache.
echo.
echo No offline DEM raster will be created.
echo No synthetic elevation fallback will be generated.
echo ============================================================
echo.

call ".venv\Scripts\activate.bat"
python "backend\preload_elevation_cache.py" --lat 6.3340 --lng 124.9520 --size-km 5 --name "Tupi_South_Cotabato_5km"
python "backend\preload_elevation_cache.py" --lat 6.3340 --lng 124.9520 --size-km 10 --name "Tupi_South_Cotabato_10km"

echo.
echo Tupi demo terrain preload finished.
pause
