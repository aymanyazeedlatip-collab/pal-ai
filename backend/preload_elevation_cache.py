"""
PAL-AI Local Elevation Cache Preloader
======================================

This preloads REAL OpenTopoData SRTM30m elevation values into:
    backend/data/elevation_cache.sqlite

It does NOT build an offline DEM raster and does NOT create synthetic fallback data.
The local FastAPI backend checks this SQLite cache before contacting OpenTopoData,
so preloaded terrain scans load much faster during demonstrations.

Common commands from the project root:
    python backend/preload_elevation_cache.py --demo
    python backend/preload_elevation_cache.py --region12-tiles
    python backend/preload_elevation_cache.py --lat 6.3340 --lng 124.9520 --size-km 10 --name my-demo-site
    python backend/preload_elevation_cache.py --status
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sqlite3
import sys
import time
from dataclasses import dataclass
from typing import Iterable, List, Optional, Tuple

import requests

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "elevation_cache.sqlite")
PROGRESS_PATH = os.path.join(DATA_DIR, "preload_progress.json")

GRID_RESOLUTION = 25                  # Must match frontend/terrain.js
DEG_PER_KM = 0.009                    # Must match frontend/terrain.js
BATCH_SIZE = 100                      # OpenTopoData public API practical batch size
REQUEST_DELAY_SECONDS = 1.10          # Respect public API pacing when fetching online
REQUEST_TIMEOUT_SECONDS = 60
OPENTOPODATA_URL = "https://api.opentopodata.org/v1/srtm30m"

# Same 16 PAL-AI region centers used by the frontend location hierarchy.
REGION_CENTERS = [
    (1, "Region I - Ilocos Region", 17.5, 120.4),
    (2, "Region II - Cagayan Valley", 17.6, 121.7),
    (3, "Region III - Central Luzon", 15.5, 120.9),
    (4, "Region IV-A - CALABARZON", 14.1, 121.2),
    (5, "Region IV-B - MIMAROPA", 12.2, 120.7),
    (6, "Region V - Bicol Region", 13.4, 123.4),
    (7, "Region VI - Western Visayas", 11.0, 122.7),
    (8, "Region VII - Central Visayas", 10.3, 123.9),
    (9, "Region VIII - Eastern Visayas", 11.2, 125.0),
    (10, "Region IX - Zamboanga Peninsula", 7.8, 122.6),
    (11, "Region X - Northern Mindanao", 8.0, 124.7),
    (12, "Region XI - Davao Region", 7.1, 125.6),
    (13, "Region XII - SOCCSKSARGEN", 6.3, 124.9),
    (14, "Region XIII - Caraga", 8.9, 125.7),
    (15, "CAR - Cordillera Administrative Region", 17.3, 121.0),
    (16, "BARMM - Bangsamoro", 7.2, 124.2),
]

# Region XII / SOCCSKSARGEN bounding-box tiling preload.
# This is the faster "old terrain preload" style: instead of caching only one
# point in the center of each region, it preloads many 10 km scan tiles across
# the Region XII demonstration area. It still stores only real OpenTopoData
# SRTM30m elevations in SQLite. No synthetic fallback is generated.
REGION12_BBOX = {
    "north": 7.42,
    "south": 5.40,
    "east": 125.50,
    "west": 123.95,
}


def generate_region12_tiles(tile_km: float = 10.0) -> List["DemoSite"]:
    """Generate 10km tile centers covering Region XII's approximate bbox."""
    tile_km = float(tile_km)
    lat_step_deg = tile_km / 111.0
    tiles: List[DemoSite] = []

    lat = REGION12_BBOX["south"] + (lat_step_deg / 2)
    row = 0
    while lat < REGION12_BBOX["north"]:
        lng_step_deg = tile_km / (111.32 * math.cos(math.radians(lat)))
        lng = REGION12_BBOX["west"] + (lng_step_deg / 2)
        col = 0
        while lng < REGION12_BBOX["east"]:
            tiles.append(DemoSite(
                name=f"region12_tile_r{row:02d}_c{col:02d}",
                lat=round(float(lat), 6),
                lng=round(float(lng), 6),
                size_km=tile_km,
            ))
            lng += lng_step_deg
            col += 1
        lat += lat_step_deg
        row += 1

    return tiles


@dataclass(frozen=True)
class DemoSite:
    name: str
    lat: float
    lng: float
    size_km: float


def log(message: str) -> None:
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}", flush=True)


def round_coord(value: float) -> float:
    return round(float(value), 5)


def cache_key(lat: float, lng: float) -> str:
    return f"elev:{round_coord(lat):.5f}:{round_coord(lng):.5f}"


def ensure_db() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    with sqlite3.connect(DB_PATH, timeout=30) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS elevation_cache (
                cache_key TEXT PRIMARY KEY,
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                elevation REAL NOT NULL,
                source TEXT DEFAULT 'OpenTopoData SRTM30m',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_elevation_lat_lng ON elevation_cache(lat, lng)")
        conn.commit()


def load_progress() -> dict:
    if os.path.exists(PROGRESS_PATH):
        try:
            with open(PROGRESS_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_progress(progress: dict) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(PROGRESS_PATH, "w", encoding="utf-8") as f:
        json.dump(progress, f, indent=2)


def build_grid_points(lat: float, lng: float, size_km: float) -> List[Tuple[float, float]]:
    half = (float(size_km) / 2) * DEG_PER_KM
    step = (float(size_km) * DEG_PER_KM) / GRID_RESOLUTION
    points: List[Tuple[float, float]] = []
    for gy in range(GRID_RESOLUTION + 1):
        for gx in range(GRID_RESOLUTION + 1):
            p_lat = round_coord(float(lat) - half + gy * step)
            p_lng = round_coord(float(lng) - half + gx * step)
            points.append((p_lat, p_lng))
    return points


def get_existing_keys(keys: Iterable[str]) -> set[str]:
    keys = list(keys)
    if not keys:
        return set()
    ensure_db()
    existing: set[str] = set()
    with sqlite3.connect(DB_PATH, timeout=30) as conn:
        for start in range(0, len(keys), 800):
            chunk = keys[start:start + 800]
            placeholders = ",".join(["?"] * len(chunk))
            rows = conn.execute(
                f"SELECT cache_key FROM elevation_cache WHERE cache_key IN ({placeholders})",
                chunk,
            ).fetchall()
            existing.update(row[0] for row in rows)
    return existing


def save_elevations(records: List[Tuple[float, float, float]]) -> int:
    if not records:
        return 0
    ensure_db()
    cleaned = []
    for lat, lng, elevation in records:
        if elevation is None:
            continue
        try:
            elev = float(elevation)
        except Exception:
            continue
        if not math.isfinite(elev):
            continue
        rlat = round_coord(lat)
        rlng = round_coord(lng)
        cleaned.append((cache_key(rlat, rlng), rlat, rlng, elev))
    if not cleaned:
        return 0
    with sqlite3.connect(DB_PATH, timeout=30) as conn:
        conn.executemany("""
            INSERT INTO elevation_cache(cache_key, lat, lng, elevation, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(cache_key) DO UPDATE SET
                elevation = excluded.elevation,
                updated_at = CURRENT_TIMESTAMP
        """, cleaned)
        conn.commit()
    return len(cleaned)


def fetch_batch(points: List[Tuple[float, float]], attempts: int = 2) -> List[Tuple[float, float, Optional[float]]]:
    locations = "|".join(f"{lat:.5f},{lng:.5f}" for lat, lng in points)
    last_error: Optional[Exception] = None
    for attempt in range(1, attempts + 1):
        try:
            response = requests.get(
                OPENTOPODATA_URL,
                params={"locations": locations},
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
            if response.status_code == 200:
                payload = response.json()
                results = payload.get("results", [])
                out = []
                for idx, point in enumerate(points):
                    elevation = None
                    if idx < len(results) and isinstance(results[idx], dict):
                        elevation = results[idx].get("elevation")
                    out.append((point[0], point[1], elevation))
                return out
            last_error = RuntimeError(f"OpenTopoData HTTP {response.status_code}: {response.text[:160]}")
        except Exception as exc:
            last_error = exc
        if attempt < attempts:
            time.sleep(2.5)
    raise RuntimeError(str(last_error) if last_error else "OpenTopoData request failed")


def preload_site(site: DemoSite, force: bool = False) -> dict:
    points = build_grid_points(site.lat, site.lng, site.size_km)
    keys = [cache_key(lat, lng) for lat, lng in points]
    existing = set() if force else get_existing_keys(keys)
    missing_points = [pt for pt, key in zip(points, keys) if key not in existing]

    total = len(points)
    already = total - len(missing_points)
    log(f"{site.name}: {already}/{total} points already cached. Missing: {len(missing_points)}")

    saved_total = 0
    failed_batches = 0
    total_batches = math.ceil(len(missing_points) / BATCH_SIZE) if missing_points else 0

    for start in range(0, len(missing_points), BATCH_SIZE):
        batch_no = (start // BATCH_SIZE) + 1
        chunk = missing_points[start:start + BATCH_SIZE]
        try:
            records = fetch_batch(chunk)
            saved = save_elevations(records)
            saved_total += saved
            log(f"  batch {batch_no}/{total_batches}: saved {saved}/{len(chunk)} real elevation points")
        except Exception as exc:
            failed_batches += 1
            log(f"  batch {batch_no}/{total_batches} failed: {exc}")
        time.sleep(REQUEST_DELAY_SECONDS)

    final_existing = len(get_existing_keys(keys))
    coverage = (final_existing / total) * 100 if total else 0
    log(f"{site.name}: finished with {final_existing}/{total} cached points ({coverage:.1f}%).")
    return {
        "cached_points": final_existing,
        "total_points": total,
        "coverage_pct": round(coverage, 1),
        "new_points_saved": saved_total,
        "failed_batches": failed_batches,
    }


def demo_sites() -> List[DemoSite]:
    # Two common scan sizes per region. This is the old preload approach:
    # targeted local cache, not a giant offline raster.
    sites: List[DemoSite] = []
    for region_id, region_name, lat, lng in REGION_CENTERS:
        safe = region_name.replace(" ", "_").replace("/", "-")
        sites.append(DemoSite(f"R{region_id:02d}_{safe}_5km", lat, lng, 5))
        sites.append(DemoSite(f"R{region_id:02d}_{safe}_10km", lat, lng, 10))
    return sites


def print_status() -> None:
    ensure_db()
    with sqlite3.connect(DB_PATH, timeout=30) as conn:
        row = conn.execute("SELECT COUNT(*), MIN(lat), MAX(lat), MIN(lng), MAX(lng) FROM elevation_cache").fetchone()
    count, min_lat, max_lat, min_lng, max_lng = row
    size_mb = os.path.getsize(DB_PATH) / (1024 * 1024) if os.path.exists(DB_PATH) else 0
    log(f"Database: {DB_PATH}")
    log(f"Cached points: {int(count or 0)}")
    log(f"Database size: {size_mb:.2f} MB")
    log(f"Bounds: lat {min_lat} to {max_lat}, lng {min_lng} to {max_lng}")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Preload real OpenTopoData elevation points into PAL-AI local SQLite cache.")
    parser.add_argument("--demo", action="store_true", help="Preload 32 standard demo sites: 16 regions x 5km and 10km scans.")
    parser.add_argument("--region12-tiles", action="store_true", help="Preload the faster old Region XII tiled terrain cache across an approximate bbox.")
    parser.add_argument("--tile-size-km", type=float, default=10.0, help="Tile size for --region12-tiles. Default: 10 km.")
    parser.add_argument("--lat", type=float, help="Custom site center latitude.")
    parser.add_argument("--lng", type=float, help="Custom site center longitude.")
    parser.add_argument("--size-km", type=float, default=10, help="Custom site scan size in kilometers. Default: 10.")
    parser.add_argument("--name", default="custom_demo_site", help="Custom site name for progress logging.")
    parser.add_argument("--force", action="store_true", help="Re-fetch points even if they already exist in cache.")
    parser.add_argument("--status", action="store_true", help="Show cache status and exit.")
    args = parser.parse_args(argv)

    ensure_db()

    if args.status:
        print_status()
        return 0

    if args.demo:
        sites = demo_sites()
    elif args.region12_tiles:
        sites = generate_region12_tiles(args.tile_size_km)
        log(f"Region XII tiled preload selected: {len(sites)} tiles at {args.tile_size_km:g} km each.")
    elif args.lat is not None and args.lng is not None:
        sites = [DemoSite(args.name, args.lat, args.lng, args.size_km)]
    else:
        parser.error("Choose --demo, --region12-tiles, --status, or provide --lat and --lng for a custom site.")

    progress = load_progress()
    log(f"PAL-AI local elevation cache preloader started. Sites: {len(sites)}")
    log("This uses real OpenTopoData SRTM30m elevation values only. No synthetic fallback is generated.")

    for idx, site in enumerate(sites, start=1):
        progress_key = f"{site.name}_{site.size_km}km"
        if not args.force and progress.get(progress_key, {}).get("coverage_pct", 0) >= 99:
            log(f"[{idx}/{len(sites)}] Skipping {site.name}; already fully cached.")
            continue

        log(f"[{idx}/{len(sites)}] Preloading {site.name} ({site.size_km:g}km) at {site.lat:.5f}, {site.lng:.5f}")
        result = preload_site(site, force=args.force)
        progress[progress_key] = result
        save_progress(progress)

    print_status()
    log("Preload complete. Run PAL-AI locally and terrain scans inside preloaded areas should load much faster.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
