PAL-AI Calibrated Local Build — Ready to Run
============================================

FIRST TIME ON A LAPTOP
----------------------
1. Extract the ZIP folder first. Do not run the files inside the ZIP.
2. Double-click:

   START_HERE_INSTALL_AND_RUN.bat

   This creates the local Python environment, installs dependencies, starts the server,
   and opens PAL-AI at:

   http://127.0.0.1:8000

3. After the first setup succeeds, close the PAL-AI server window if you want to preload terrain data.


FASTER 3D TERRAIN DEMO LOADING
------------------------------
This build brings back the local elevation preload system, but NOT the full offline DEM raster.

The terrain endpoint now checks this file first:

   backend/data/elevation_cache.sqlite

If the requested elevation point is already cached, PAL-AI returns it instantly from SQLite.
If it is missing, PAL-AI fetches the real point from OpenTopoData and saves it for next time.
No synthetic terrain fallback is used.

Recommended before client demo:

1. Double-click:

   PRELOAD_DEMO_ELEVATION_CACHE.bat

   This preloads 32 standard demo grids:
   16 regions x 2 scan sizes: 5km and 10km.

2. For the exact client demo location, double-click:

   PRELOAD_CUSTOM_SITE.bat

   Enter the exact latitude, longitude, and scan size you will use in the demo.
   This is the most important step if you want the terrain scan to load fast.

3. Check cache size/status with:

   CHECK_ELEVATION_CACHE_STATUS.bat


NORMAL RUN AFTER SETUP
----------------------
After setup has already been completed, run:

   RUN_LOCAL_ONLY_AFTER_SETUP.bat

Then open:

   http://127.0.0.1:8000


IMPORTANT NOTES
---------------
- Preloading needs internet because it downloads real OpenTopoData SRTM30m points.
- After points are cached, scans inside those same preloaded grids load much faster.
- If you choose a different location, different scan size, or slightly different center point, PAL-AI may still need to fetch missing points.
- This package does not include the full Philippines offline DEM raster file.


FAST TERRAIN PRELOAD OPTIONS
============================

This build brings back the older fast terrain preload approach without adding
the offline DEM raster system.

Recommended for your demo:
1. Run START_HERE_INSTALL_AND_RUN.bat once to install dependencies.
2. Close the server window.
3. Run PRELOAD_TUPI_FAST_TERRAIN_CACHE.bat for the common Tupi demo site.
4. If you need broader Region XII coverage, run PRELOAD_REGION12_FAST_TERRAIN_CACHE.bat.
5. Run RUN_LOCAL_ONLY_AFTER_SETUP.bat.

Notes:
- The preload cache stores real OpenTopoData SRTM30m elevation values in:
  backend\data\elevation_cache.sqlite
- No synthetic elevation fallback is generated.
- No full Philippines offline DEM raster is included.
- The Region XII tiled preload can take a long time on first run, but it resumes
  and skips already cached tiles on later runs.

PALADIN CHATBOT AND IMAGE ANALYSIS SETUP
========================================
PALADIN requires a private Gemini API key for text chat and rice-leaf image analysis.

Fast setup:
1. Double-click CONFIGURE_PALADIN_API_KEY.bat.
2. Paste the key into backend\.env after LLM_API_KEY=.
3. Save the file and restart PAL-AI.

Detailed instructions are in:
   PALADIN_API_KEY_SETUP.txt

The updated image analysis checks visible leaf health and discoloration in addition
to possible pests, diseases, and nutrient or environmental stress. Results are
AI-assisted and require field verification before treatment.
