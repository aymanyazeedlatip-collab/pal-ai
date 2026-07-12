"""
PAL-AI Elevation Cache Pre-loader
==================================

What this does:
- Goes through a list of municipalities you define below.
- For each one, generates the same grid of points your app would generate
  for a normal scan, and requests them from your LIVE Vercel backend.
- Your backend's /api/elevation-batch endpoint will fetch real data from
  OpenTopoData and save it into your Redis cache automatically (that's the
  caching code you already added to main.py — this script doesn't need to
  know anything about Redis, it just calls your normal API).
- Saves progress to preload_progress.json so if you stop this script
  (or it crashes, or your computer restarts) you can just run it again
  and it will skip everything already finished.

How to run it:
    python preload_cache.py

How to run it in the BACKGROUND while you keep working:
  Mac / Linux:
    python preload_cache.py > preload_log.txt 2>&1 &
    (the "&" puts it in the background; check preload_log.txt anytime to
    see progress; the "2>&1" makes sure errors get logged too)

  Windows (Command Prompt):
    start /min cmd /c "python preload_cache.py > preload_log.txt 2>&1"
    (this opens a minimized window running the script; you can also just
    open a second Command Prompt window, run the plain command, and
    minimize that window instead — either works)

  Either way, you can just leave a terminal window open and minimized,
  and keep using your computer normally for other things.
"""

import json
import math
import os
import time
import requests

# ─────────────────────────────────────────────────────────────
# 1. Your live backend URL (Render, not Vercel — Vercel only serves
#    the frontend now). No trailing slash.
# ─────────────────────────────────────────────────────────────
TERRAIN_API = "https://pal-ai-tupinhs.onrender.com"

# ─────────────────────────────────────────────────────────────
# 2. Region 12 (SOCCSKSARGEN) approximate bounding box.
#    These numbers are an approximation of the region's outer edges —
#    good enough to guarantee full coverage, but it WILL also include
#    some tiles over water or just outside the region's real border.
#    Those tiles just come back with low/zero coverage and are skipped
#    automatically — harmless, just a bit of wasted time.
#
#    If you want to double check / adjust these, go to Google Maps,
#    find the northernmost, southernmost, easternmost, and westernmost
#    points of the region, right-click each, and copy the lat/lng.
# ─────────────────────────────────────────────────────────────
REGION_BBOX = {
    "north": 7.42,   # top edge (northern North Cotabato)
    "south": 5.40,   # bottom edge (southern Sarangani)
    "east": 125.50,  # right edge (Sarangani/Gen San coast)
    "west": 123.95,  # left edge (western Sultan Kudarat/Cotabato)
}

TILE_SIZE_KM = 10  # size of each scan tile — matches a normal 10km app scan

# ─────────────────────────────────────────────────────────────
# Should match your app's terrain.js settings — don't change these
# unless you also changed GRID_RESOLUTION in terrain.js.
# ─────────────────────────────────────────────────────────────
GRID_RESOLUTION = 25
DEG_PER_KM = 0.009
BATCH_SIZE = 100
SECONDS_BETWEEN_BATCHES = 1.1

PROGRESS_FILE = "preload_progress.json"


def generate_region_tiles(bbox, tile_km):
    """
    Fills the entire bounding box with non-overlapping tile_km x tile_km
    tiles, so every bit of land inside the box gets covered — not just
    hand-picked town centers.
    """
    lat_step_deg = tile_km / 111.0
    tiles = []

    lat = bbox["south"] + (lat_step_deg / 2)
    row = 0

    while lat < bbox["north"]:
        # Longitude degrees-per-km shrinks as you move away from the equator,
        # so we recompute it for each row to keep tiles roughly square.
        lng_step_deg = tile_km / (111.32 * math.cos(math.radians(lat)))
        lng = bbox["west"] + (lng_step_deg / 2)
        col = 0

        while lng < bbox["east"]:
            tiles.append({
                "name": f"region12_r{row}_c{col}",
                "lat": round(lat, 6),
                "lng": round(lng, 6),
                "size_km": tile_km,
            })
            lng += lng_step_deg
            col += 1

        lat += lat_step_deg
        row += 1

    return tiles


MUNICIPALITIES = generate_region_tiles(REGION_BBOX, TILE_SIZE_KM)


def log(message):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] {message}", flush=True)


def load_progress():
    if os.path.exists(PROGRESS_FILE):
        try:
            with open(PROGRESS_FILE, "r") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_progress(progress):
    with open(PROGRESS_FILE, "w") as f:
        json.dump(progress, f, indent=2)


def build_grid_points(lat, lng, size_km):
    half = (size_km / 2) * DEG_PER_KM
    step = (size_km * DEG_PER_KM) / GRID_RESOLUTION

    points = []
    for gy in range(GRID_RESOLUTION + 1):
        for gx in range(GRID_RESOLUTION + 1):
            p_lat = lat - half + gy * step
            p_lng = lng - half + gx * step
            points.append((p_lat, p_lng))

    return points


def preload_municipality(town):
    name = town["name"]
    points = build_grid_points(town["lat"], town["lng"], town["size_km"])

    total_batches = (len(points) + BATCH_SIZE - 1) // BATCH_SIZE
    real_count = 0

    log(f"Starting '{name}' — {len(points)} points, {total_batches} batches")

    for batch_index in range(total_batches):
        start = batch_index * BATCH_SIZE
        chunk = points[start:start + BATCH_SIZE]

        locations = "|".join(f"{lat:.5f},{lng:.5f}" for lat, lng in chunk)
        url = f"{TERRAIN_API}/api/elevation-batch"

        try:
            response = requests.get(
                url, params={"locations": locations}, timeout=70)

            try:
                data = response.json()
            except ValueError:
                # The server didn't send back JSON — show exactly what it did send
                # so it's obvious whether this is a wrong URL, a 404 page, etc.
                snippet = response.text[:300].replace("\n", " ")
                raise RuntimeError(
                    f"Server returned status {response.status_code}, non-JSON body. "
                    f"First 300 chars: {snippet!r}"
                )

            results = data.get("results", [])

            batch_real = sum(
                1 for r in results
                if isinstance(r, dict) and isinstance(r.get("elevation"), (int, float))
            )
            real_count += batch_real

            log(f"  '{name}' batch {batch_index + 1}/{total_batches}: "
                f"{batch_real}/{len(chunk)} real points")

            if data.get("error"):
                log(
                    f"  Note: backend reported an error on this batch: {data['error']}")

        except Exception as e:
            log(f"  Batch {batch_index + 1} failed, will still continue: {e}")

        # Same pacing your frontend uses, to stay in OpenTopoData's good graces.
        time.sleep(SECONDS_BETWEEN_BATCHES)

    coverage_pct = (real_count / len(points)) * 100 if points else 0
    log(f"Finished '{name}': {real_count}/{len(points)} real points ({coverage_pct:.1f}% coverage)")

    return coverage_pct


def main():
    progress = load_progress()

    for town in MUNICIPALITIES:
        name = town["name"]

        if progress.get(name, {}).get("done"):
            log(f"Skipping '{name}' — already completed previously")
            continue

        try:
            coverage_pct = preload_municipality(town)
            progress[name] = {"done": True,
                              "coverage_pct": round(coverage_pct, 1)}
        except Exception as e:
            log(f"'{name}' failed entirely, will retry next run: {e}")
            progress[name] = {"done": False, "error": str(e)}

        save_progress(progress)

    log("All municipalities processed. Check preload_progress.json for a summary.")


if __name__ == "__main__":
    main()
