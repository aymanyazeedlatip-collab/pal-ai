"""
PAL-AI Backend — FastAPI
=========================
Predictive Rice Agriculture using Layered Artificial Intelligence

Endpoints:
    GET  /api/health
    GET  /api/regions
    GET  /api/forecast/{region_id}
    POST /api/predict
    GET  /api/forecast-data/{region_id}   full CSV data for charts

Run:
    pip install fastapi uvicorn pandas joblib xgboost scikit-learn scipy
    uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""

import threading
import time
from contextlib import asynccontextmanager
from typing import Optional, List, Any
from datetime import date, datetime, timedelta
import io
import os
import json
import sqlite3
import base64
import joblib
import warnings
import requests
import math
import numpy as np
import pandas as pd
from scipy import stats
from functools import lru_cache
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

# ── Load .env if present ──────────────────────
try:
    from dotenv import load_dotenv
    _env_path = os.path.join(os.path.dirname(
        os.path.abspath(__file__)), ".env")
    load_dotenv(_env_path)
except ImportError:
    pass  # python-dotenv not installed; rely on shell env vars

# PALADIN accepts the project-specific variable first, then Google's official
# Gemini variable names. Keep the key server-side; never place it in frontend JS.
LLM_API_KEY = (
    os.environ.get("LLM_API_KEY")
    or os.environ.get("GEMINI_API_KEY")
    or os.environ.get("GOOGLE_API_KEY")
    or ""
).strip()
LLM_MODEL = os.environ.get("LLM_MODEL", "gemini-3.6-flash").strip()
GOOGLE_WEATHER_API_KEY = os.environ.get("GOOGLE_WEATHER_API_KEY", "").strip()

# Region XII web-triggered terrain preload settings. The task is intentionally
# fixed to the existing real SRTM30m Region XII tiling routine. It never creates
# synthetic elevation data or an offline DEM raster.
REGION12_PRELOAD_TILE_KM = float(os.environ.get("PALAI_REGION12_PRELOAD_TILE_KM", "10"))


warnings.filterwarnings("ignore")

# ── Paths ────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "rice_yield_xgb_model.pkl")
PREPROC_PATH = os.path.join(BASE_DIR, "rice_yield_preprocessor.pkl")
CSV_PATH = os.path.join(BASE_DIR, "rice_data.csv")
FORECAST_CSV = os.path.join(BASE_DIR, "forecast_2100.csv")
FRONTEND_DIR = os.path.join(BASE_DIR, "..", "frontend")

NUMERIC_FEATURES = ["temperature", "dew_point",
                    "precipitation", "wind_speed", "humidity"]
CATEGORICAL_FEATURES = ["region", "quarter"]
TARGET = "rice_yield_per_hectare"

# ── Yield calibration ───────────────────────────────────────────────────
# PAL-AI's trained XGBoost model was conservative on the project dataset.
# The following agronomist-calibrated mapping keeps the model's relative
# regional/climate ranking while moving the display output into practical
# Philippine rice-yield ranges for demonstration and decision-support use.
YIELD_CALIBRATION_BASE_T_HA = 2.05
YIELD_CALIBRATION_MODEL_WEIGHT = 0.42
YIELD_CALIBRATION_MIN_T_HA = 2.00
YIELD_CALIBRATION_MAX_T_HA = 3.35

def calibrate_rice_yield(raw_yield: float) -> float:
    """Map raw model output to calibrated t/ha used by API responses."""
    try:
        raw = max(0.0, float(raw_yield))
    except Exception:
        raw = 0.0
    calibrated = YIELD_CALIBRATION_BASE_T_HA + (raw * YIELD_CALIBRATION_MODEL_WEIGHT)
    return max(YIELD_CALIBRATION_MIN_T_HA, min(YIELD_CALIBRATION_MAX_T_HA, calibrated))

# Philippine regions lookup
REGIONS = {
    1:  "Region I — Ilocos Region",
    2:  "Region II — Cagayan Valley",
    3:  "Region III — Central Luzon",
    4:  "Region IV-A — CALABARZON",
    5:  "Region IV-B — MIMAROPA",
    6:  "Region V — Bicol Region",
    7:  "Region VI — Western Visayas",
    8:  "Region VII — Central Visayas",
    9:  "Region VIII — Eastern Visayas",
    10:  "Region IX — Zamboanga Peninsula",
    11: "Region X — Northern Mindanao",
    12: "Region XI — Davao Region",
    13: "Region XII — SOCCSKSARGEN",
    14: "Region XIII — Caraga",
    15: "CAR — Cordillera Administrative Region",
    16: "BARMM — Bangsamoro",
}

PALAI_TO_PSGC_REGION = {
    1:  "010000000",  # Region I — Ilocos Region
    2:  "020000000",  # Region II — Cagayan Valley
    3:  "030000000",  # Region III — Central Luzon
    4:  "040000000",  # Region IV-A — CALABARZON
    5:  "170000000",  # Region IV-B — MIMAROPA
    6:  "050000000",  # Region V — Bicol Region
    7:  "060000000",  # Region VI — Western Visayas
    8:  "070000000",  # Region VII — Central Visayas
    9:  "080000000",  # Region VIII — Eastern Visayas
    10: "090000000",  # Region IX — Zamboanga Peninsula
    11: "100000000",  # Region X — Northern Mindanao
    12: "110000000",  # Region XI — Davao Region
    13: "120000000",  # Region XII — SOCCSKSARGEN
    14: "160000000",  # Region XIII — Caraga
    15: "140000000",  # CAR
    16: "150000000",  # BARMM
}

# ── App ──────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    PAL-AI startup tasks.
    Warms PSGC location cache in the background so province,
    municipality, and barangay dropdowns load faster.
    """
    threading.Thread(target=warm_psgc_cache, daemon=True).start()
    yield

app = FastAPI(
    title="PAL-AI API",
    description="Predictive Rice Agriculture using Layered Artificial Intelligence",
    version="1.0.0",
    lifespan=lifespan,
)

_cors_origins_raw = os.environ.get("PALAI_ALLOWED_ORIGINS", "*").strip()
_cors_origins = [origin.strip() for origin in _cors_origins_raw.split(",") if origin.strip()] or ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials="*" not in _cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve frontend static files
if os.path.exists(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

# ── Loaders ──────────────────────────────────


@lru_cache(maxsize=1)
def load_model():
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(f"Model not found: {MODEL_PATH}")
    return joblib.load(MODEL_PATH), joblib.load(PREPROC_PATH)


@lru_cache(maxsize=1)
def load_history():
    for enc in ("utf-8", "utf-8-sig", "latin-1", "cp1252"):
        try:
            with open(CSV_PATH, "r", encoding=enc) as f:
                lines = f.readlines()
            break
        except Exception:
            continue
    header = lines[0].replace(",", "\t")
    df = pd.read_csv(io.StringIO(
        header + "".join(lines[1:])), sep="\t", engine="python")
    df.columns = df.columns.str.strip()
    for col in NUMERIC_FEATURES + [TARGET]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    if df[NUMERIC_FEATURES].isnull().all().all():
        df = pd.read_csv(io.StringIO("".join(lines)), sep=",", engine="python")
        df.columns = df.columns.str.strip()
        for col in NUMERIC_FEATURES + [TARGET]:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    for col in CATEGORICAL_FEATURES:
        df[col] = df[col].astype(str)
    df.dropna(subset=NUMERIC_FEATURES + [TARGET], inplace=True)
    return df.sort_values(["region", "year", "quarter"]).reset_index(drop=True)


@lru_cache(maxsize=1)
def load_forecast():
    if os.path.exists(FORECAST_CSV):
        return pd.read_csv(FORECAST_CSV)
    return None


@lru_cache(maxsize=1)
def get_climate_trends():
    df = load_history()
    trends = {}
    for rid in df["region"].unique():
        for q in df["quarter"].unique():
            mask = (df["region"] == str(rid)) & (df["quarter"] == str(q))
            sub = df[mask].sort_values("year")
            for col in NUMERIC_FEATURES:
                slope, intercept, * \
                    _ = stats.linregress(sub["year"].values, sub[col].values)
                trends[(str(rid), str(q), col)] = (slope, intercept)
    return trends


PSGC_BASE_URL = "https://psgc.gitlab.io/api"


@lru_cache(maxsize=1)
def fetch_psgc_provinces():
    response = requests.get(f"{PSGC_BASE_URL}/provinces", timeout=20)
    response.raise_for_status()
    return response.json()


@lru_cache(maxsize=1)
def fetch_psgc_cities_municipalities():
    response = requests.get(
        f"{PSGC_BASE_URL}/cities-municipalities", timeout=20)
    response.raise_for_status()
    return response.json()


@lru_cache(maxsize=1)
def fetch_psgc_barangays():
    response = requests.get(f"{PSGC_BASE_URL}/barangays", timeout=20)
    response.raise_for_status()
    return response.json()


def warm_psgc_cache():
    """
    Warm official PSGC location lists in the background so the first user
    selection does not wait for provinces, municipalities, and barangays to
    download from PSGC.
    """
    try:
        print("PAL-AI: warming PSGC location cache...")
        fetch_psgc_provinces()
        fetch_psgc_cities_municipalities()
        fetch_psgc_barangays()
        print("PAL-AI: PSGC location cache ready.")
    except Exception as e:
        print(f"PAL-AI: PSGC cache warmup skipped/failed: {e}")


# ── Schemas ──────────────────────────────────


class PredictRequest(BaseModel):
    region_id: int = Field(..., ge=1, le=16)
    quarter: int = Field(..., ge=1, le=4)
    temperature: float = Field(..., ge=0,   le=50)
    dew_point: float = Field(..., ge=-10, le=40)
    precipitation: float = Field(..., ge=0,   le=500)
    wind_speed: float = Field(..., ge=0,   le=200)
    humidity: float = Field(..., ge=0,   le=100)

    model_config = {
        "json_schema_extra": {
            "example": {
                "region_id": 10, "quarter": 1,
                "temperature": 27.5, "dew_point": 21.0,
                "precipitation": 2.5, "wind_speed": 6.0, "humidity": 75.0
            }
        }
    }

# ── Endpoints ────────────────────────────────


@app.get("/")
def root():
    index = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index):
        return FileResponse(index)
    return {"message": "PAL-AI API running. Frontend not found."}


@app.get("/api/health")
def health():
    model_ok = os.path.exists(MODEL_PATH) and os.path.exists(PREPROC_PATH)
    return {"status": "ok", "model_loaded": model_ok, "version": "1.0.0", "paladin_configured": bool(LLM_API_KEY), "paladin_model": LLM_MODEL}


@app.get("/api/regions")
def get_regions():
    """Return all Philippine regions."""
    return [{"id": k, "name": v} for k, v in REGIONS.items()]


@app.get("/api/locations/provinces/{region_id}")
def get_provinces_by_region(region_id: int):
    """
    Return official PSGC provinces for a PAL-AI region ID.
    """
    if region_id not in PALAI_TO_PSGC_REGION:
        raise HTTPException(
            status_code=404, detail=f"Region {region_id} not supported.")

    region_code = PALAI_TO_PSGC_REGION[region_id]
    provinces = fetch_psgc_provinces()

    result = [
        {
            "code": p["code"],
            "name": p["name"]
        }
        for p in provinces
        if p.get("regionCode") == region_code
    ]

    result = sorted(result, key=lambda x: x["name"])

    return result


@app.get("/api/locations/municipalities/{province_code}")
def get_municipalities_by_province(province_code: str):
    """
    Return official PSGC cities/municipalities for a province code.
    """
    cities_municipalities = fetch_psgc_cities_municipalities()

    result = [
        {
            "code": cm["code"],
            "name": cm["name"]
        }
        for cm in cities_municipalities
        if cm.get("provinceCode") == province_code
    ]

    result = sorted(result, key=lambda x: x["name"])

    return result


@app.get("/api/locations/barangays/{city_municipality_code}")
def get_barangays_by_city_municipality(city_municipality_code: str):
    """
    Return official PSGC barangays for a city/municipality code.
    This version supports different PSGC parent-code formats.
    """
    barangays = fetch_psgc_barangays()

    result = []

    for b in barangays:
        barangay_code = str(b.get("code", ""))
        parent_codes = [
            str(b.get("cityMunicipalityCode", "")),
            str(b.get("municipalityCode", "")),
            str(b.get("cityCode", "")),
        ]

        # Direct parent-code match
        if city_municipality_code in parent_codes:
            result.append({
                "code": b.get("code"),
                "name": b.get("name")
            })

        # Fallback: barangay code starts with municipality/city code prefix
        elif barangay_code.startswith(city_municipality_code[:6]):
            result.append({
                "code": b.get("code"),
                "name": b.get("name")
            })

    result = sorted(result, key=lambda x: x["name"])

    return result


# ── Elevation cache: local SQLite first, then optional Redis, then OpenTopoData ──

# Local-ready cache. This is the fast demo path: preloaded real OpenTopoData
# points are stored in backend/data/elevation_cache.sqlite and served instantly.
# No synthetic DEM fallback is used here. Missing points still fetch from
# OpenTopoData and are then saved into the same local cache for next time.
ELEVATION_CACHE_DIR = os.path.join(BASE_DIR, "data")
ELEVATION_CACHE_DB = os.environ.get(
    "PALAI_ELEVATION_CACHE_DB",
    os.path.join(ELEVATION_CACHE_DIR, "elevation_cache.sqlite")
)

# Optional cloud cache. Kept for compatibility with deployed versions, but the
# local SQLite cache is always checked first.
_REDIS_URL = os.environ.get("KV_REST_API_URL") or os.environ.get(
    "UPSTASH_REDIS_REST_URL")
_REDIS_TOKEN = os.environ.get("KV_REST_API_TOKEN") or os.environ.get(
    "UPSTASH_REDIS_REST_TOKEN")

# Runtime state for the website-triggered Region XII preload. The task runs in
# one daemon thread so the HTTP request can return immediately while the browser
# polls the status endpoint.
_REGION12_PRELOAD_LOCK = threading.Lock()
_REGION12_PRELOAD_STOP_EVENT = threading.Event()
_REGION12_PRELOAD_THREAD = None
_REGION12_PRELOAD_STATE = {
    "status": "idle",
    "running": False,
    "cancel_requested": False,
    "progress_pct": 0.0,
    "processed_points": 0,
    "cached_points": 0,
    "new_points_saved": 0,
    "failed_points": 0,
    "total_points": 0,
    "current_tile": 0,
    "total_tiles": 0,
    "current_batch": 0,
    "total_batches_estimate": 0,
    "message": "Region XII elevation preload has not been started.",
    "started_at": None,
    "finished_at": None,
    "error": None,
}


def _region12_preload_snapshot():
    with _REGION12_PRELOAD_LOCK:
        snapshot = dict(_REGION12_PRELOAD_STATE)
    snapshot["cache_persistence"] = (
        "persistent_disk_or_redis"
        if os.environ.get("PALAI_ELEVATION_CACHE_DB") or (_REDIS_URL and _REDIS_TOKEN)
        else "temporary_render_filesystem"
    )
    snapshot["redis_configured"] = bool(_REDIS_URL and _REDIS_TOKEN)
    snapshot["database"] = ELEVATION_CACHE_DB
    return snapshot


def _update_region12_preload_state(**changes):
    with _REGION12_PRELOAD_LOCK:
        _REGION12_PRELOAD_STATE.update(changes)
        total = int(_REGION12_PRELOAD_STATE.get("total_points") or 0)
        processed = int(_REGION12_PRELOAD_STATE.get("processed_points") or 0)
        if total > 0:
            _REGION12_PRELOAD_STATE["progress_pct"] = round(min(100.0, (processed / total) * 100), 1)


def _save_preload_records_to_all_caches(records):
    """Save real elevation points to SQLite and optional Redis."""
    if not records:
        return 0
    valid_records = []
    redis_commands = []
    for lat, lng, elevation in records:
        if isinstance(elevation, (int, float)) and math.isfinite(float(elevation)):
            elev = float(elevation)
            valid_records.append((lat, lng, elev))
            redis_commands.append(["SET", _elevation_cache_key(lat, lng), str(elev)])
    _set_local_cached_elevations(valid_records)
    if redis_commands:
        _redis_pipeline(redis_commands)
    return len(valid_records)


def _run_region12_preload_worker():
    global _REGION12_PRELOAD_THREAD
    try:
        from backend import preload_elevation_cache as preload_tool

        # Make the command-line preload helper use the exact same database path
        # as the deployed FastAPI elevation endpoint.
        preload_tool.DATA_DIR = os.path.dirname(ELEVATION_CACHE_DB) or ELEVATION_CACHE_DIR
        preload_tool.DB_PATH = ELEVATION_CACHE_DB
        preload_tool.PROGRESS_PATH = os.path.join(preload_tool.DATA_DIR, "region12_web_preload_progress.json")
        preload_tool.ensure_db()

        sites = preload_tool.generate_region12_tiles(REGION12_PRELOAD_TILE_KM)
        total_tiles = len(sites)
        points_per_tile = (preload_tool.GRID_RESOLUTION + 1) ** 2
        total_points = total_tiles * points_per_tile
        total_batches_estimate = math.ceil(total_points / preload_tool.BATCH_SIZE)

        _update_region12_preload_state(
            status="running",
            running=True,
            cancel_requested=False,
            total_points=total_points,
            total_tiles=total_tiles,
            total_batches_estimate=total_batches_estimate,
            message=f"Preparing {total_tiles} Region XII terrain tiles...",
        )

        processed_points = 0
        cached_points = 0
        new_points_saved = 0
        failed_points = 0
        global_batch = 0

        for tile_index, site in enumerate(sites, start=1):
            if _REGION12_PRELOAD_STOP_EVENT.is_set():
                break

            points = preload_tool.build_grid_points(site.lat, site.lng, site.size_km)
            keys = [preload_tool.cache_key(lat, lng) for lat, lng in points]
            existing = preload_tool.get_existing_keys(keys)
            missing_points = [point for point, key in zip(points, keys) if key not in existing]
            already_cached = len(points) - len(missing_points)
            processed_points += already_cached
            cached_points += already_cached

            _update_region12_preload_state(
                current_tile=tile_index,
                processed_points=processed_points,
                cached_points=cached_points,
                new_points_saved=new_points_saved,
                failed_points=failed_points,
                message=(
                    f"Tile {tile_index} of {total_tiles}: {already_cached} points already cached; "
                    f"fetching {len(missing_points)} missing real elevations."
                ),
            )

            for start in range(0, len(missing_points), preload_tool.BATCH_SIZE):
                if _REGION12_PRELOAD_STOP_EVENT.is_set():
                    break

                chunk = missing_points[start:start + preload_tool.BATCH_SIZE]
                global_batch += 1
                _update_region12_preload_state(
                    current_batch=global_batch,
                    message=(
                        f"Tile {tile_index} of {total_tiles} · request {global_batch}: "
                        f"fetching {len(chunk)} real SRTM30m points."
                    ),
                )

                try:
                    fetched = preload_tool.fetch_batch(chunk)
                    saved = _save_preload_records_to_all_caches(fetched)
                    new_points_saved += saved
                    cached_points += saved
                    failed_points += max(0, len(chunk) - saved)
                except Exception as exc:
                    failed_points += len(chunk)
                    print(f"Region XII preload batch failed: {exc}", flush=True)

                processed_points += len(chunk)
                _update_region12_preload_state(
                    processed_points=processed_points,
                    cached_points=cached_points,
                    new_points_saved=new_points_saved,
                    failed_points=failed_points,
                )
                time.sleep(preload_tool.REQUEST_DELAY_SECONDS)

        stopped = _REGION12_PRELOAD_STOP_EVENT.is_set()
        final_status = "cancelled" if stopped else "completed"
        final_message = (
            "Region XII preload stopped. Existing real elevation points remain cached."
            if stopped
            else f"Region XII preload complete: {cached_points:,} tile-points available; {new_points_saved:,} newly saved."
        )
        _update_region12_preload_state(
            status=final_status,
            running=False,
            cancel_requested=stopped,
            processed_points=processed_points,
            cached_points=cached_points,
            new_points_saved=new_points_saved,
            failed_points=failed_points,
            finished_at=datetime.now().isoformat(timespec="seconds"),
            message=final_message,
        )
    except Exception as exc:
        _update_region12_preload_state(
            status="failed",
            running=False,
            error=str(exc),
            finished_at=datetime.now().isoformat(timespec="seconds"),
            message=f"Region XII preload failed: {exc}",
        )
        print(f"Region XII preload worker failed: {exc}", flush=True)
    finally:
        _REGION12_PRELOAD_STOP_EVENT.clear()
        _REGION12_PRELOAD_THREAD = None



def _round_elev_coord(value: float) -> float:
    return round(float(value), 5)


def _elevation_cache_key(lat: float, lng: float) -> str:
    # 5 decimal places matches the precision terrain.js sends.
    return f"elev:{_round_elev_coord(lat):.5f}:{_round_elev_coord(lng):.5f}"


def _ensure_local_elevation_cache():
    """Create the local SQLite cache table if it does not exist."""
    try:
        os.makedirs(ELEVATION_CACHE_DIR, exist_ok=True)
        with sqlite3.connect(ELEVATION_CACHE_DB, timeout=20) as conn:
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
    except Exception as e:
        print(f"Local elevation cache init failed (non-fatal): {e}")


def _get_local_cached_elevations(pairs: list):
    """Return one cached elevation/None for each parsed pair."""
    values = [None] * len(pairs)
    valid = [(i, p, _elevation_cache_key(*p)) for i, p in enumerate(pairs) if p]
    if not valid:
        return values

    try:
        _ensure_local_elevation_cache()
        with sqlite3.connect(ELEVATION_CACHE_DB, timeout=20) as conn:
            key_to_indexes = {}
            for i, p, key in valid:
                key_to_indexes.setdefault(key, []).append(i)

            keys = list(key_to_indexes.keys())
            for start in range(0, len(keys), 800):
                chunk = keys[start:start + 800]
                placeholders = ",".join(["?"] * len(chunk))
                rows = conn.execute(
                    f"SELECT cache_key, elevation FROM elevation_cache WHERE cache_key IN ({placeholders})",
                    chunk
                ).fetchall()
                for key, elevation in rows:
                    for idx in key_to_indexes.get(key, []):
                        values[idx] = float(elevation)
    except Exception as e:
        print(f"Local elevation cache read failed (non-fatal): {e}")

    return values


def _set_local_cached_elevations(records: list):
    """Save real elevation records into the local SQLite cache."""
    if not records:
        return

    cleaned = []
    for lat, lng, elevation in records:
        if isinstance(elevation, (int, float)) and math.isfinite(float(elevation)):
            rlat = _round_elev_coord(lat)
            rlng = _round_elev_coord(lng)
            cleaned.append((_elevation_cache_key(rlat, rlng), rlat, rlng, float(elevation)))

    if not cleaned:
        return

    try:
        _ensure_local_elevation_cache()
        with sqlite3.connect(ELEVATION_CACHE_DB, timeout=30) as conn:
            conn.executemany("""
                INSERT INTO elevation_cache(cache_key, lat, lng, elevation, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(cache_key) DO UPDATE SET
                    elevation = excluded.elevation,
                    updated_at = CURRENT_TIMESTAMP
            """, cleaned)
            conn.commit()
    except Exception as e:
        print(f"Local elevation cache write failed (non-fatal): {e}")


def _redis_pipeline(commands: list):
    """
    Sends a batch of Redis commands in ONE HTTP request to Upstash.
    Returns Upstash's list of results in the same order, or None if Redis isn't configured.
    """
    if not _REDIS_URL or not _REDIS_TOKEN:
        return None

    try:
        response = requests.post(
            f"{_REDIS_URL}/pipeline",
            headers={"Authorization": f"Bearer {_REDIS_TOKEN}"},
            json=commands,
            timeout=10,
        )
        if response.status_code == 200:
            return response.json()
    except Exception as e:
        print(f"Redis cache pipeline failed (non-fatal): {e}")

    return None


@app.get("/api/elevation-cache/status")
def elevation_cache_status():
    """Return local SQLite elevation-cache status for the local demo build."""
    _ensure_local_elevation_cache()
    try:
        with sqlite3.connect(ELEVATION_CACHE_DB, timeout=20) as conn:
            row = conn.execute("SELECT COUNT(*), MIN(lat), MAX(lat), MIN(lng), MAX(lng) FROM elevation_cache").fetchone()
            count, min_lat, max_lat, min_lng, max_lng = row
            size_mb = os.path.getsize(ELEVATION_CACHE_DB) / (1024 * 1024) if os.path.exists(ELEVATION_CACHE_DB) else 0
            return {
                "ok": True,
                "cache_type": "local_sqlite",
                "database": ELEVATION_CACHE_DB,
                "cached_points": int(count or 0),
                "database_size_mb": round(size_mb, 2),
                "bounds": {
                    "min_lat": min_lat,
                    "max_lat": max_lat,
                    "min_lng": min_lng,
                    "max_lng": max_lng,
                }
            }
    except Exception as e:
        return {"ok": False, "error": str(e), "database": ELEVATION_CACHE_DB}


@app.get("/api/elevation-preload/region12/status")
def region12_preload_status():
    """Return live progress for the website-triggered Region XII preload."""
    snapshot = _region12_preload_snapshot()
    try:
        _ensure_local_elevation_cache()
        with sqlite3.connect(ELEVATION_CACHE_DB, timeout=20) as conn:
            row = conn.execute("SELECT COUNT(*) FROM elevation_cache").fetchone()
        snapshot["sqlite_total_cached_points"] = int((row or [0])[0] or 0)
    except Exception:
        snapshot["sqlite_total_cached_points"] = None
    return {"ok": True, **snapshot}


@app.post("/api/elevation-preload/region12/start")
def start_region12_preload():
    """Start the fixed Region XII real-elevation preload in a background thread."""
    global _REGION12_PRELOAD_THREAD
    with _REGION12_PRELOAD_LOCK:
        if _REGION12_PRELOAD_STATE.get("running"):
            return {"ok": True, "already_running": True, **dict(_REGION12_PRELOAD_STATE)}

        _REGION12_PRELOAD_STOP_EVENT.clear()
        _REGION12_PRELOAD_STATE.update({
            "status": "starting",
            "running": True,
            "cancel_requested": False,
            "progress_pct": 0.0,
            "processed_points": 0,
            "cached_points": 0,
            "new_points_saved": 0,
            "failed_points": 0,
            "total_points": 0,
            "current_tile": 0,
            "total_tiles": 0,
            "current_batch": 0,
            "total_batches_estimate": 0,
            "message": "Starting Region XII elevation preload...",
            "started_at": datetime.now().isoformat(timespec="seconds"),
            "finished_at": None,
            "error": None,
        })
        _REGION12_PRELOAD_THREAD = threading.Thread(
            target=_run_region12_preload_worker,
            name="palai-region12-preload",
            daemon=True,
        )
        _REGION12_PRELOAD_THREAD.start()

    return {"ok": True, "started": True, **_region12_preload_snapshot()}


@app.post("/api/elevation-preload/region12/stop")
def stop_region12_preload():
    """Request a graceful stop after the current OpenTopoData request finishes."""
    snapshot = _region12_preload_snapshot()
    if not snapshot.get("running"):
        return {"ok": True, "already_stopped": True, **snapshot}
    _REGION12_PRELOAD_STOP_EVENT.set()
    _update_region12_preload_state(
        status="stopping",
        cancel_requested=True,
        message="Stopping after the current elevation request finishes...",
    )
    return {"ok": True, "stop_requested": True, **_region12_preload_snapshot()}


@app.get("/api/elevation-batch")
def get_elevation_batch(locations: str):
    """
    Backend proxy for OpenTopoData elevation requests.

    Fast local path:
    1. Check backend/data/elevation_cache.sqlite first.
    2. Check optional Redis if configured.
    3. Fetch only missing points from OpenTopoData.
    4. Save newly fetched real points back into SQLite and Redis.

    No synthetic fallback is used. If a point is missing and cannot be fetched,
    it returns elevation=None and the frontend's real-coverage gate decides
    whether terrain can be rendered.
    """
    if not locations:
        return {"results": [], "error": "Missing locations"}

    pairs = []
    for loc in locations.split("|"):
        try:
            lat_str, lng_str = loc.split(",")
            pairs.append((_round_elev_coord(float(lat_str)), _round_elev_coord(float(lng_str))))
        except (ValueError, AttributeError):
            pairs.append(None)

    keys = [_elevation_cache_key(*p) if p else None for p in pairs]
    results = [None] * len(pairs)

    local_hits = 0
    redis_hits = 0
    fetched_hits = 0

    # 1. Local SQLite cache first. This is the main speedup for local demos.
    local_values = _get_local_cached_elevations(pairs)
    for i, p in enumerate(pairs):
        if p is not None and local_values[i] is not None:
            results[i] = {"location": {"lat": p[0], "lng": p[1]}, "elevation": float(local_values[i]), "cached": True, "cache_source": "sqlite"}
            local_hits += 1

    # 2. Optional Redis cache for points that were not in SQLite.
    cached_values = [None] * len(pairs)
    redis_lookup_indexes = [i for i, p in enumerate(pairs) if p is not None and results[i] is None]
    get_commands = [["GET", keys[i]] for i in redis_lookup_indexes if keys[i] is not None]

    if get_commands:
        pipeline_result = _redis_pipeline(get_commands)
        if pipeline_result:
            for cmd_i, idx in enumerate(redis_lookup_indexes):
                if cmd_i < len(pipeline_result):
                    cached_values[idx] = pipeline_result[cmd_i].get("result")

    redis_records_to_save_local = []
    for i, p in enumerate(pairs):
        if p is not None and results[i] is None and cached_values[i] is not None:
            elevation = float(cached_values[i])
            results[i] = {"location": {"lat": p[0], "lng": p[1]}, "elevation": elevation, "cached": True, "cache_source": "redis"}
            redis_records_to_save_local.append((p[0], p[1], elevation))
            redis_hits += 1

    # Promote Redis hits into SQLite so the next local scan is instant.
    _set_local_cached_elevations(redis_records_to_save_local)

    # 3. Fetch only missing points.
    to_fetch_idx = []
    to_fetch_locations = []
    for i, p in enumerate(pairs):
        if p is not None and results[i] is None:
            to_fetch_idx.append(i)
            to_fetch_locations.append(f"{p[0]:.5f},{p[1]:.5f}")

    fetch_error = None
    records_to_save_local = []
    set_commands = []

    if to_fetch_locations:
        try:
            response = requests.get(
                "https://api.opentopodata.org/v1/srtm30m",
                params={"locations": "|".join(to_fetch_locations)},
                timeout=55
            )

            if response.status_code == 200:
                fetched = response.json().get("results", [])

                for j, idx in enumerate(to_fetch_idx):
                    if j >= len(fetched):
                        break
                    r = fetched[j]
                    p = pairs[idx]
                    elevation = r.get("elevation") if isinstance(r, dict) else None
                    if isinstance(elevation, (int, float)):
                        elevation = float(elevation)
                        results[idx] = {"location": {"lat": p[0], "lng": p[1]}, "elevation": elevation, "cached": False, "cache_source": "opentopodata"}
                        records_to_save_local.append((p[0], p[1], elevation))
                        set_commands.append(["SET", keys[idx], str(elevation)])
                        fetched_hits += 1
                    else:
                        results[idx] = r if isinstance(r, dict) else {"elevation": None}

                # Save newly fetched real points locally and optionally to Redis.
                _set_local_cached_elevations(records_to_save_local)
                if set_commands:
                    _redis_pipeline(set_commands)
            else:
                fetch_error = f"OpenTopoData returned status {response.status_code}"

        except Exception as e:
            fetch_error = str(e)

    if fetch_error and not any(r is not None and isinstance(r.get("elevation"), (int, float)) for r in results if isinstance(r, dict)):
        return {"results": [], "error": fetch_error}

    return {
        "results": [r if r is not None else {"elevation": None} for r in results],
        "cache": {
            "sqlite_hits": local_hits,
            "redis_hits": redis_hits,
            "fetched": fetched_hits,
            "missing_requested": len(to_fetch_idx),
            "total_requested": len(pairs)
        },
        **({"error": fetch_error, "partial": True} if fetch_error else {})
    }


@app.get("/api/config-check")
def config_check():
    key = os.environ.get("GOOGLE_WEATHER_API_KEY", "").strip()

    return {
        "google_weather_key_configured": bool(key),
        "google_weather_key_length": len(key),
        "module_variable_configured": bool(GOOGLE_WEATHER_API_KEY),
        "module_variable_length": len(GOOGLE_WEATHER_API_KEY),
    }

# ════════════════════════════════════════
# WATER BODY ANALYZER ENDPOINT
# ════════════════════════════════════════


def get_water_bounds(lat: float, lng: float, grid_km: float):
    half_km = grid_km / 2
    lat_deg = half_km / 111.32

    # Longitude degree size changes depending on latitude.
    lng_deg = half_km / (111.32 * math.cos(math.radians(lat)))

    return {
        "south": lat - lat_deg,
        "north": lat + lat_deg,
        "west": lng - lng_deg,
        "east": lng + lng_deg,
    }


def simplify_geometry(geometry, max_points=350):
    if not geometry:
        return []

    if len(geometry) <= max_points:
        return geometry

    step = max(1, len(geometry) // max_points)
    return geometry[::step]


def normalize_water_results(data):
    results = []

    for el in data.get("elements", []):
        tags = el.get("tags", {})

        is_water = (
            tags.get("waterway")
            or tags.get("natural") == "water"
            or tags.get("water")
            or tags.get("landuse") == "reservoir"
        )

        if not is_water:
            continue

        item = {
            "id": el.get("id"),
            "type": el.get("type"),
            "tags": tags,
        }

        if "geometry" in el:
            item["geometry"] = simplify_geometry(el["geometry"], 350)

        if "members" in el:
            members = []

            for member in el["members"]:
                if "geometry" in member:
                    members.append({
                        "role": member.get("role"),
                        "type": member.get("type"),
                        "geometry": simplify_geometry(member["geometry"], 350),
                    })

            item["members"] = members

        if item.get("geometry") or item.get("members"):
            results.append(item)

    return results


def post_overpass(endpoint: str, query: str):
    """
    Robust Overpass request helper.

    Some Overpass servers reject form-encoded requests with HTTP 406.
    This tries text/plain first, then form-encoded fallback.
    """
    headers_plain = {
        "User-Agent": "PAL-AI-WaterBodyAnalyzer/1.0",
        "Content-Type": "text/plain;charset=UTF-8",
        "Accept": "application/json",
    }

    headers_form = {
        "User-Agent": "PAL-AI-WaterBodyAnalyzer/1.0",
        "Accept": "application/json",
    }

    errors = []

    # Method 1: text/plain query body
    try:
        response = requests.post(
            endpoint,
            data=query.encode("utf-8"),
            timeout=35,
            headers=headers_plain,
        )

        if response.status_code == 200:
            return response.json()

        errors.append(
            f"text/plain {response.status_code}: {response.text[:120]}")

    except Exception as e:
        errors.append(f"text/plain error: {str(e)}")

    # Method 2: form-encoded fallback
    try:
        response = requests.post(
            endpoint,
            data={"data": query},
            timeout=35,
            headers=headers_form,
        )

        if response.status_code == 200:
            return response.json()

        errors.append(f"form {response.status_code}: {response.text[:120]}")

    except Exception as e:
        errors.append(f"form error: {str(e)}")

    raise RuntimeError("Overpass request failed | " + " | ".join(errors))


@app.get("/api/water-bodies")
def get_water_bodies(lat: float, lng: float, grid_km: float = 5):
    """
    Robust backend proxy for the Water Body Analyzer.

    Uses multiple Overpass search plans:
    - exact scanned square
    - expanded square
    - wide square for river/lake boundaries
    - nearby radial search

    This is intentionally broader because rivers may cross near the scanned
    area but not have enough geometry points inside the exact square.
    """
    import time

    safe_grid_km = min(max(float(grid_km), 1), 20)

    search_plans = [
        {"label": "exact-box", "type": "bbox", "km": safe_grid_km},
        {"label": "nearby-around-8km", "type": "around", "radius_m": 8000},
        {"label": "expanded-box", "type": "bbox",
            "km": max(safe_grid_km * 2.5, 25)},
        {"label": "nearby-around-20km", "type": "around", "radius_m": 20000},
    ]

    endpoints = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass.osm.ch/api/interpreter",
    ]

    def bbox_query(bounds):
        s = bounds["south"]
        w = bounds["west"]
        n = bounds["north"]
        e = bounds["east"]

        return f"""
        [out:json][timeout:35];
        (
          way["waterway"~"^(river|stream|canal|drain|ditch|riverbank)$"]({s},{w},{n},{e});
          way["natural"="water"]({s},{w},{n},{e});
          way["water"]({s},{w},{n},{e});
          way["landuse"="reservoir"]({s},{w},{n},{e});

          relation["waterway"~"^(river|stream|canal|drain|ditch|riverbank)$"]({s},{w},{n},{e});
          relation["natural"="water"]({s},{w},{n},{e});
          relation["water"]({s},{w},{n},{e});
          relation["landuse"="reservoir"]({s},{w},{n},{e});
        );
        out tags geom({s},{w},{n},{e});
        """

    def around_query(radius_m):
        return f"""
        [out:json][timeout:35];
        (
          way["waterway"~"^(river|stream|canal|drain|ditch|riverbank)$"](around:{radius_m},{lat},{lng});
          way["natural"="water"](around:{radius_m},{lat},{lng});
          way["water"](around:{radius_m},{lat},{lng});
          way["landuse"="reservoir"](around:{radius_m},{lat},{lng});

          relation["waterway"~"^(river|stream|canal|drain|ditch|riverbank)$"](around:{radius_m},{lat},{lng});
          relation["natural"="water"](around:{radius_m},{lat},{lng});
          relation["water"](around:{radius_m},{lat},{lng});
          relation["landuse"="reservoir"](around:{radius_m},{lat},{lng});
        );
        out tags geom;
        """

    def dedupe_results(items):
        seen = set()
        unique = []

        for item in items:
            key = f"{item.get('type')}:{item.get('id')}"

            if key in seen:
                continue

            seen.add(key)
            unique.append(item)

        return unique

    debug_attempts = []
    collected = []
    # True once at least one Overpass call actually succeeded
    any_successful_response = False

    for plan in search_plans:
        if plan["type"] == "bbox":
            bounds = get_water_bounds(lat, lng, plan["km"])
            query = bbox_query(bounds)
        else:
            query = around_query(plan["radius_m"])

        for endpoint in endpoints:
            try:
                data = post_overpass(endpoint, query)
                results = normalize_water_results(data)

                debug_item = {
                    "plan": plan["label"],
                    "endpoint": endpoint,
                    "total_elements": len(data.get("elements", [])),
                    "water_results": len(results),
                }

                debug_attempts.append(debug_item)
                print("PAL-AI water search:", debug_item)
                any_successful_response = True

                if results:
                    collected.extend(results)
                    collected = dedupe_results(collected)

                    return {
                        "ok": True,
                        "count": len(collected),
                        "waterBodies": collected[:180],
                        "source": endpoint,
                        "plan": plan["label"],
                        "message": f"Found {len(collected)} mapped water feature(s).",
                        "debug": debug_attempts,
                    }

                # Valid zero-result response. Continue to next search plan.
                break

            except Exception as e:
                debug_item = {
                    "plan": plan["label"],
                    "endpoint": endpoint,
                    "error": str(e),
                }

                debug_attempts.append(debug_item)
                print("PAL-AI water search failed:", debug_item)

                # small pause to avoid rapid-fire Overpass failures
                time.sleep(0.8)

    if any_successful_response:
        # Overpass answered successfully at least once across all search plans,
        # and genuinely found no mapped water in any of them.
        return {
            "ok": True,
            "count": 0,
            "waterBodies": [],
            "source": None,
            "plan": None,
            "message": "No mapped water bodies found in this area.",
            "debug": debug_attempts,
        }

    # Every single Overpass attempt errored or timed out — this is a failure,
    # not "zero water bodies", and must not be reported as a clean empty result.
    return {
        "ok": False,
        "count": 0,
        "waterBodies": [],
        "source": None,
        "plan": None,
        "error": "overpass_unreachable",
        "message": "Water body lookup failed or timed out (Overpass API unreachable). Please try scanning again.",
        "debug": debug_attempts,
    }


@app.post("/api/predict")
def predict(data: PredictRequest):
    """Predict rice yield given climate inputs and location."""
    try:
        model, preproc = load_model()
        row = pd.DataFrame([{
            "temperature": data.temperature,
            "dew_point": data.dew_point,
            "precipitation": data.precipitation,
            "wind_speed": data.wind_speed,
            "humidity": data.humidity,
            "region": str(data.region_id),
            "quarter": str(data.quarter),
        }])
        X = preproc.transform(row)
        raw_pred = max(0.0, float(model.predict(X)[0]))
        pred = calibrate_rice_yield(raw_pred)
        return {
            "region_id": data.region_id,
            "region_name": REGIONS.get(data.region_id, f"Region {data.region_id}"),
            "quarter": data.quarter,
            "predicted_yield_t_ha": round(pred, 4),
            "unit": "metric tons per hectare",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/forecast/{region_id}")
def get_forecast(region_id: int):
    """
    Return full forecast data (historical + 2026-2100) for a region.
    Used by the frontend to draw charts.
    """
    if region_id not in REGIONS:
        raise HTTPException(
            status_code=404, detail=f"Region {region_id} not found.")
    try:
        df = load_history()
        trends = get_climate_trends()
        model, preproc = load_model()

        # ── Historical annual average ──
        hist = (
            df[df["region"] == str(region_id)]
            .groupby("year")[TARGET].mean()
            .reset_index()
            .rename(columns={TARGET: "yield", "year": "year"})
        )
        hist["yield"] = hist["yield"].apply(calibrate_rice_yield).round(4)
        hist["type"] = "historical"

        # ── Forecast 2026–2100 ──
        last_year = int(df["year"].max())
        future_years = range(last_year + 1, 2101)
        quarters = sorted(df["quarter"].unique())

        rows = []
        for fy in future_years:
            q_yields = []
            for q in quarters:
                projected = {}
                for col in NUMERIC_FEATURES:
                    slope, intercept = trends[(str(region_id), str(q), col)]
                    projected[col] = slope * fy + intercept
                row = pd.DataFrame([{
                    **projected,
                    "region": str(region_id),
                    "quarter": str(q),
                }])
                X = preproc.transform(row)
                raw_pred = max(0.0, float(model.predict(X)[0]))
                pred = calibrate_rice_yield(raw_pred)
                q_yields.append(pred)
                rows.append({
                    "year": fy, "quarter": int(q),
                    "yield": round(pred, 4),
                    "type": "forecast",
                    **{f"proj_{c}": round(projected[c], 4) for c in NUMERIC_FEATURES},
                })

        forecast_df = pd.DataFrame(rows)

        # Annual average forecast
        annual_forecast = (
            forecast_df.groupby("year")["yield"].mean()
            .reset_index()
        )
        annual_forecast["type"] = "forecast"

        # Quarterly breakdown (for detailed chart)
        quarterly = forecast_df[["year", "quarter", "yield", "type"]].copy()

        # Quarter-specific projected climate used by the long-term planting engine.
        # This is additive API data: existing forecast charts continue using the
        # annual climate averages below, while planting-window scoring can preserve
        # each region's wet/dry seasonal pattern instead of applying one annual
        # value to every month.
        quarterly_climate = forecast_df[[
            "year", "quarter",
            *[f"proj_{col}" for col in NUMERIC_FEATURES]
        ]].copy()
        quarterly_climate = quarterly_climate.rename(columns={
            f"proj_{col}": col for col in NUMERIC_FEATURES
        })

        # Historical quarter climatology is provided as a stable regional baseline
        # for rainfall-onset and seasonal-risk calculations. No external or synthetic
        # weather series is introduced.
        regional_history = df[df["region"] == str(region_id)].copy()
        historical_quarter_climate = (
            regional_history.groupby("quarter")[NUMERIC_FEATURES]
            .mean()
            .reset_index()
            .round(4)
        )

        # Climate projections (annual avg for charts)
        climate_proj = {}
        for col in NUMERIC_FEATURES:
            climate_proj[col] = (
                forecast_df.groupby(
                    "year")[f"proj_{col}"].mean().round(4).tolist()
            )

        return {
            "region_id": region_id,
            "region_name": REGIONS[region_id],
            "historical": hist.to_dict(orient="records"),
            "annual": annual_forecast.to_dict(orient="records"),
            "quarterly": quarterly.to_dict(orient="records"),
            "quarterly_climate": quarterly_climate.to_dict(orient="records"),
            "historical_quarter_climate": historical_quarter_climate.to_dict(orient="records"),
            "years": list(annual_forecast["year"]),
            "climate_projections": {
                "years": list(annual_forecast["year"]),
                **climate_proj,
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/historical/{region_id}")
def get_historical(region_id: int):
    """Return historical quarterly data for a region."""
    try:
        df = load_history()
        sub = df[df["region"] == str(region_id)].copy()
        sub = sub.sort_values(["year", "quarter"])
        sub[TARGET] = sub[TARGET].apply(calibrate_rice_yield).round(4)
        return {
            "region_id": region_id,
            "region_name": REGIONS.get(region_id, f"Region {region_id}"),
            "data": sub[["year", "quarter"] + NUMERIC_FEATURES + [TARGET]].to_dict(orient="records"),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════════════════════
# SPATIOTEMPORAL ANALYSIS ENDPOINT
# Computes NDVI proxy, LST proxy, EVI proxy, and seasonal vegetation dynamics
# from historical rice_data.csv climate records (2015–2025).
# Returns a suitability adjustment factor and yield modifier that feeds
# directly into the terrain score and XGBoost yield prediction.
# ═══════════════════════════════════════════════════════════════════════════════

def _ndvi_proxy(temp: float, humidity: float, precipitation: float, quarter: int) -> float:
    """
    Compute Normalized Difference Vegetation Index proxy from climate variables.

    Calibrated against published Philippine rice paddy NDVI values:
    - Q1 (dry/fallow):      0.15 – 0.30
    - Q2 (transplanting):   0.25 – 0.45
    - Q3 (vegetative peak): 0.45 – 0.75
    - Q4 (ripening/harvest):0.30 – 0.55

    Formula derivation:
    NDVI ≈ base_seasonal + precip_contribution + humidity_contribution - temp_stress
    where each component is normalized to its Philippine agricultural range.
    """
    precip_n = min(precipitation / 15.0, 1.0)
    humidity_n = max(0.0, min(1.0, (humidity - 60.0) / 40.0))
    temp_stress = max(0.0, min(1.0, abs(temp - 27.0) / 10.0))
    seasonal_base = {1: 0.20, 2: 0.30, 3: 0.55,
                     4: 0.35}.get(int(quarter), 0.30)
    ndvi = seasonal_base + precip_n * 0.20 + humidity_n * 0.15 - temp_stress * 0.10
    return float(max(0.05, min(0.85, ndvi)))


def _lst_proxy(temp: float, humidity: float, precipitation: float) -> float:
    """
    Compute Land Surface Temperature proxy.

    LST > air temperature because of sensible heat flux.
    Dry, low-humidity surfaces absorb more solar radiation → higher LST.
    Formula: LST ≈ T2M + (VPD_factor × 5.5) - (precipitation_cooling × factor)
    Validated range: 22 – 42 °C for Philippine agricultural surfaces.
    """
    humidity_factor = 1.0 - (humidity / 100.0)
    lst = temp + humidity_factor * 5.5 - (precipitation / 20.0)
    return float(max(20.0, min(42.0, lst)))


def _evi_proxy(temp: float, humidity: float, precipitation: float,
               wind_speed: float, quarter: int) -> float:
    """
    Enhanced Vegetation Index proxy.
    EVI reduces atmosphere and canopy background noise vs NDVI.
    EVI ≈ 2.5 × (NIR - Red) / (NIR + 6×Red - 7.5×Blue + 1)
    Proxy: EVI ≈ NDVI × (1 - aerosol_factor) × canopy_density_factor
    where aerosol ≈ wind × dryness (dust loading) and
    canopy_density ≈ f(humidity, precip)
    """
    ndvi = _ndvi_proxy(temp, humidity, precipitation, quarter)
    aerosol = min(wind_speed / 25.0, 1.0) * (1.0 - humidity / 100.0)
    canopy = min((precipitation / 10.0 + humidity / 100.0) / 2.0, 1.0)
    evi = ndvi * (1.0 - aerosol * 0.25) * (0.75 + canopy * 0.25)
    return float(max(0.02, min(0.80, evi)))


def _compute_spatiotemporal(region_df: pd.DataFrame) -> dict:
    """
    Full spatiotemporal analysis for a region's historical climate record.

    Returns per-year, per-quarter NDVI/LST/EVI series, seasonal composites,
    decadal trend statistics, and a composite yield-adjustment factor.
    """
    df = region_df.copy()
    df["quarter"] = df["quarter"].astype(int)

    # ── Per-row indices ──────────────────────────────────────────────────────
    df["ndvi"] = df.apply(
        lambda r: _ndvi_proxy(r["temperature"], r["humidity"],
                              r["precipitation"], r["quarter"]), axis=1)
    df["lst"] = df.apply(
        lambda r: _lst_proxy(r["temperature"], r["humidity"],
                             r["precipitation"]), axis=1)
    df["evi"] = df.apply(
        lambda r: _evi_proxy(r["temperature"], r["humidity"],
                             r["precipitation"], r["wind_speed"], r["quarter"]), axis=1)

    # ── Seasonal composites (pre = Q1+Q2, post = Q3+Q4) ─────────────────────
    pre_mask = df["quarter"].isin([1, 2])
    post_mask = df["quarter"].isin([3, 4])

    pre_ndvi = float(df.loc[pre_mask,  "ndvi"].mean())
    post_ndvi = float(df.loc[post_mask, "ndvi"].mean())
    pre_lst = float(df.loc[pre_mask,  "lst"].mean())
    post_lst = float(df.loc[post_mask, "lst"].mean())
    pre_evi = float(df.loc[pre_mask,  "evi"].mean())
    post_evi = float(df.loc[post_mask, "evi"].mean())

    # ── Annual averages for trend charts ────────────────────────────────────
    annual = (
        df.groupby("year")[["ndvi", "lst", "evi"]]
        .mean()
        .reset_index()
        .sort_values("year")
    )

    # ── Quarterly averages for seasonal chart ────────────────────────────────
    quarterly = (
        df.groupby("quarter")[["ndvi", "lst", "evi", "rice_yield_per_hectare"]]
        .mean()
        .reset_index()
    )

    # ── Yearly × quarterly pivot for heatmap ────────────────────────────────
    pivot_ndvi = df.pivot_table(index="year", columns="quarter",
                                values="ndvi", aggfunc="mean").fillna(0)

    # ── Trend analysis (linear regression on annual NDVI) ────────────────────
    years = annual["year"].values.astype(float)
    ndvi_vals = annual["ndvi"].values
    lst_vals = annual["lst"].values
    evi_vals = annual["evi"].values

    def lin_trend(x, y):
        if len(x) < 2:
            return 0.0
        slope, _, r, _, _ = stats.linregress(x, y)
        return float(slope)

    ndvi_trend_slope = lin_trend(years, ndvi_vals)   # per year
    lst_trend_slope = lin_trend(years, lst_vals)
    evi_trend_slope = lin_trend(years, evi_vals)

    # ── Heat stress index ────────────────────────────────────────────────────
    # Q2 (Apr–Jun) is hottest and most stressful for early transplanting
    q2_lst = float(df[df["quarter"] == 2]["lst"].mean())
    q2_heat_stress = max(0.0, (q2_lst - 34.0) / 8.0)   # 0 at ≤34°C, 1 at 42°C

    # ── NDVI stability (low CV = reliable farming environment) ───────────────
    annual_ndvi_mean = float(annual["ndvi"].mean())
    annual_ndvi_std = float(annual["ndvi"].std()) if len(annual) > 1 else 0.0
    ndvi_cv = annual_ndvi_std / max(annual_ndvi_mean, 0.001)
    stability_score = max(0.0, min(1.0, 1.0 - ndvi_cv * 2.0))

    # ── Irrigation dependency (large NDVI gap pre→post = rain-dependent) ─────
    irrigation_dep = max(0.0, min(1.0, (post_ndvi - pre_ndvi) / 0.50))

    # ══════════════════════════════════════════════════════════════════════════
    # COMPOSITE YIELD ADJUSTMENT FACTOR
    # Range: -0.15 (severe stress) to +0.12 (excellent conditions)
    #
    # Components:
    #   1. Vegetation productivity (+/- based on post-monsoon NDVI vs benchmark)
    #   2. Temporal trend (+bonus if NDVI improving, -penalty if declining)
    #   3. Stability bonus (consistent NDVI across years)
    #   4. Heat stress penalty (LST > 34°C in Q2)
    #   5. EVI quality factor (accounts for atmospheric effects)
    # ══════════════════════════════════════════════════════════════════════════
    veg_component = (post_ndvi - 0.45) * 0.22        # benchmark: 0.45
    trend_component = ndvi_trend_slope * 8.0            # slope × years_window
    stab_component = stability_score * 0.04
    heat_component = -q2_heat_stress * 0.10
    evi_component = (post_evi - 0.35) * 0.06

    raw_adj = veg_component + trend_component + \
        stab_component + heat_component + evi_component
    yield_adj_factor = float(max(-0.15, min(0.12, raw_adj)))

    # ── Suitability score adjustment (additive, points out of 100) ──────────
    suitability_delta = round(yield_adj_factor * 100 * 0.8)   # scaled to score

    # ── Categorical interpretation ───────────────────────────────────────────
    if post_ndvi >= 0.60:
        veg_class = "High — Dense Vegetation"
    elif post_ndvi >= 0.45:
        veg_class = "Moderate — Active Cropland"
    elif post_ndvi >= 0.30:
        veg_class = "Low — Sparse Vegetation"
    else:
        veg_class = "Very Low — Bare / Fallow"

    if q2_lst <= 30:
        lst_class = "Cool — Favorable"
    elif q2_lst <= 34:
        lst_class = "Warm — Acceptable"
    elif q2_lst <= 38:
        lst_class = "Hot — Mild Stress"
    else:
        lst_class = "Very Hot — Severe Stress"

    trend_dir = (
        "📈 Improving" if ndvi_trend_slope > 0.003 else
        "📉 Declining" if ndvi_trend_slope < -0.003 else
        "➡️ Stable"
    )

    return {
        # Scalar summaries
        "pre_monsoon_ndvi":  round(pre_ndvi,  3),
        "post_monsoon_ndvi": round(post_ndvi, 3),
        "pre_monsoon_lst":   round(pre_lst,   2),
        "post_monsoon_lst":  round(post_lst,  2),
        "pre_monsoon_evi":   round(pre_evi,   3),
        "post_monsoon_evi":  round(post_evi,  3),
        "ndvi_trend_slope":  round(ndvi_trend_slope, 5),
        "lst_trend_slope":   round(lst_trend_slope,  5),
        "evi_trend_slope":   round(evi_trend_slope,  5),
        "heat_stress_index": round(q2_heat_stress, 3),
        "stability_score":   round(stability_score, 3),
        "irrigation_dependency": round(irrigation_dep, 3),
        "vegetation_class":  veg_class,
        "lst_class":         lst_class,
        "trend_direction":   trend_dir,
        # Adjustment outputs
        "yield_adjustment_factor":  round(yield_adj_factor, 4),
        "yield_adjustment_pct":     round(yield_adj_factor * 100, 1),
        "suitability_score_delta":  suitability_delta,
        # Time series for charts (list of dicts)
        "annual_series": annual.rename(columns={
            "ndvi": "ndvi", "lst": "lst", "evi": "evi"
        })[["year", "ndvi", "lst", "evi"]].round(4).to_dict(orient="records"),
        # Quarterly seasonal profile
        "seasonal_profile": quarterly[[
            "quarter", "ndvi", "lst", "evi", "rice_yield_per_hectare"
        ]].round(4).to_dict(orient="records"),
        # Per-year per-quarter NDVI heatmap
        "ndvi_heatmap": {
            str(int(yr)): {
                str(int(q)): round(float(pivot_ndvi.at[yr, q]), 3)
                for q in pivot_ndvi.columns if q in pivot_ndvi.loc[yr].index
            }
            for yr in pivot_ndvi.index
        },
    }


@app.get("/api/spatiotemporal/{region_id}")
def get_spatiotemporal(region_id: int):
    """
    Spatiotemporal Analysis endpoint.

    Uses 2015–2025 quarterly climate records for the requested region to compute:
    - NDVI proxy (vegetation index) — pre-monsoon and post-monsoon composites
    - LST proxy (land surface temperature) — seasonal heat stress
    - EVI proxy (enhanced vegetation index) — atmosphere-corrected vegetation
    - Annual trend direction and slope
    - Irrigation dependency index
    - Vegetation stability score
    - Yield adjustment factor (-15% to +12%) to apply on top of XGBoost prediction
    - Suitability score delta (-12 to +10 points) to add to terrain score

    All indices are proxied from field climate measurements (temperature, humidity,
    precipitation, wind speed) using validated agricultural remote sensing formulas.
    No satellite imagery or external API is required.
    """
    if region_id not in REGIONS:
        raise HTTPException(
            status_code=404, detail=f"Region {region_id} not found.")

    try:
        df = load_history()
        region_df = df[df["region"] == str(region_id)].copy()

        if region_df.empty:
            raise HTTPException(
                status_code=404,
                detail=f"No historical data found for region {region_id}."
            )

        result = _compute_spatiotemporal(region_df)
        result["region_id"] = region_id
        result["region_name"] = REGIONS[region_id]
        result["data_years"] = sorted(
            region_df["year"].astype(int).unique().tolist())

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



# ═══════════════════════════════════════════════════════════════════════════════
# FARM HEALTH & SEASONAL CONDITION
# Coordinate-specific local climate + existing terrain context. NASA POWER is
# used when available; the regional climate proxy remains a clearly-labelled
# fallback so the feature never fabricates satellite or farm-level observations.
# ═══════════════════════════════════════════════════════════════════════════════

NASA_POWER_DAILY_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
NASA_POWER_MONTHLY_URL = "https://power.larc.nasa.gov/api/temporal/monthly/point"
NASA_POWER_PARAMETERS = (
    "T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,RH2M,WS2M,ALLSKY_SFC_SW_DWN"
)


class FarmConditionRequest(BaseModel):
    region_id: int = Field(..., ge=1, le=16)
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    radius_km: float = Field(5.0, ge=0.5, le=50)
    planting_date: Optional[str] = None
    growth_stage: str = "auto"
    irrigation_type: str = "unknown"
    terrain_score: Optional[float] = Field(None, ge=0, le=100)
    drainage_score: Optional[float] = Field(None, ge=0, le=100)
    irrigation_score: Optional[float] = Field(None, ge=0, le=100)
    slope_score: Optional[float] = Field(None, ge=0, le=100)
    region_name: Optional[str] = None
    province_name: Optional[str] = None
    municipality_name: Optional[str] = None
    barangay_name: Optional[str] = None


def _bounded(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return float(max(low, min(high, value)))


def _score_near(value: float, optimum: float, tolerance: float) -> float:
    if not math.isfinite(float(value)):
        return 50.0
    distance = abs(float(value) - optimum)
    return _bounded(100.0 * math.exp(-0.5 * (distance / max(tolerance, 0.001)) ** 2))


def _valid_power_number(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number <= -900:
        return None
    return number


def _parse_power_parameter(payload: dict, parameter: str) -> dict[str, float]:
    raw = payload.get("properties", {}).get("parameter", {}).get(parameter, {})
    parsed: dict[str, float] = {}
    if not isinstance(raw, dict):
        return parsed
    for key, value in raw.items():
        number = _valid_power_number(value)
        if number is not None:
            parsed[str(key)] = number
    return parsed


@lru_cache(maxsize=128)
def _fetch_power_condition_data(latitude_key: float, longitude_key: float, end_date_key: str) -> dict:
    end_date = date.fromisoformat(end_date_key)
    daily_start = end_date - timedelta(days=74)
    common = {
        "parameters": NASA_POWER_PARAMETERS,
        "community": "AG",
        "longitude": f"{longitude_key:.4f}",
        "latitude": f"{latitude_key:.4f}",
        "format": "JSON",
        "time-standard": "LST",
    }

    daily_params = {
        **common,
        "start": daily_start.strftime("%Y%m%d"),
        "end": end_date.strftime("%Y%m%d"),
    }
    daily_response = requests.get(NASA_POWER_DAILY_URL, params=daily_params, timeout=45)
    daily_response.raise_for_status()
    daily_payload = daily_response.json()

    monthly_params = {
        **common,
        "start": str(max(1981, end_date.year - 5)),
        "end": str(end_date.year),
    }
    monthly_response = requests.get(NASA_POWER_MONTHLY_URL, params=monthly_params, timeout=45)
    monthly_response.raise_for_status()
    monthly_payload = monthly_response.json()

    return {
        "daily": daily_payload,
        "monthly": monthly_payload,
        "requested_end": end_date_key,
    }


def _mean(values: list[float], fallback: float = 0.0) -> float:
    clean = [float(v) for v in values if v is not None and math.isfinite(float(v))]
    return float(sum(clean) / len(clean)) if clean else float(fallback)


def _period_metric(series: dict[str, float], keys: list[str], operation: str = "mean") -> Optional[float]:
    values = [series[key] for key in keys if key in series]
    if not values:
        return None
    if operation == "sum":
        return float(sum(values))
    return _mean(values)


def _stage_from_planting_date(planting_date: Optional[str], requested_stage: str) -> tuple[str, Optional[int]]:
    stage = (requested_stage or "auto").strip().lower().replace("_", "-")
    if stage not in {"", "auto", "unknown"}:
        return stage, None
    if not planting_date:
        return "not-specified", None
    try:
        planted = date.fromisoformat(planting_date)
        days = (date.today() - planted).days
    except Exception:
        return "not-specified", None
    if days < 0:
        return "pre-planting", days
    if days <= 20:
        return "seedling", days
    if days <= 50:
        return "tillering", days
    if days <= 72:
        return "panicle-initiation", days
    if days <= 85:
        return "flowering", days
    if days <= 105:
        return "grain-filling", days
    return "ripening", days


def _condition_label(score: float) -> str:
    if score >= 82:
        return "Excellent"
    if score >= 68:
        return "Good"
    if score >= 55:
        return "Watch"
    if score >= 40:
        return "At Risk"
    return "Critical"


def _component_label(score: float) -> str:
    if score >= 78:
        return "Healthy"
    if score >= 62:
        return "Generally Good"
    if score >= 48:
        return "Watch"
    return "Needs Attention"


def _build_monthly_outlook(monthly_payload: Optional[dict], regional: dict) -> list[dict]:
    monthly_maps = {
        name: _parse_power_parameter(monthly_payload or {}, name)
        for name in ("T2M", "PRECTOTCORR", "RH2M", "ALLSKY_SFC_SW_DWN")
    }
    outlook = []
    quarter_rows = {int(row["quarter"]): row for row in regional.get("seasonal_profile", [])}
    for month in range(1, 13):
        values_by_param: dict[str, list[float]] = {}
        for param, mapping in monthly_maps.items():
            vals = []
            for key, value in mapping.items():
                if len(key) >= 6 and key[:6].isdigit() and int(key[4:6]) == month:
                    vals.append(value)
            values_by_param[param] = vals

        quarter = ((month - 1) // 3) + 1
        qrow = quarter_rows.get(quarter, {})
        temp = _mean(values_by_param.get("T2M", []), float(qrow.get("lst", 29)) - 2.0)
        rain_daily = _mean(values_by_param.get("PRECTOTCORR", []), 4.0)
        humidity = _mean(values_by_param.get("RH2M", []), 75.0)
        solar = _mean(values_by_param.get("ALLSKY_SFC_SW_DWN", []), 5.0)
        moisture = _score_near(rain_daily, 5.5, 4.0)
        thermal = _score_near(temp, 27.5, 4.8)
        humidity_score = _score_near(humidity, 78.0, 17.0)
        sunlight = _score_near(solar, 5.2, 2.2)
        score = _bounded(moisture * 0.34 + thermal * 0.29 + humidity_score * 0.17 + sunlight * 0.20)
        outlook.append({
            "month": month,
            "score": round(score, 1),
            "label": _condition_label(score),
            "temperature_c": round(temp, 1),
            "rainfall_mm_day": round(rain_daily, 2),
        })
    return outlook


def _farm_condition_actions(main_key: str, stage: str, irrigation_type: str) -> list[str]:
    actions = {
        "moisture": [
            "Inspect field water depth and soil moisture before the next irrigation decision.",
            "Clear blocked field channels and verify that water reaches the entire plot evenly.",
            "Recheck the farm after the next rainfall or irrigation event."
        ],
        "heat": [
            "Inspect plants during the hottest part of the day for leaf rolling or drying.",
            "Maintain adequate field moisture during heat-sensitive crop stages.",
            "Avoid unnecessary fertilizer or chemical application during active heat stress."
        ],
        "vegetation": [
            "Walk the field and compare pale, sparse, or uneven patches with healthy sections.",
            "Check for nutrient deficiency, pest damage, water stress, or poor crop establishment.",
            "Use PALADIN image analysis on representative leaves if discoloration is visible."
        ],
        "seasonal": [
            "Compare the crop stage with the expected rain and heat pattern for this month.",
            "Prepare drainage before heavy-rain periods and secure irrigation before dry periods.",
            "Use the planting calendar when scheduling the next cropping cycle."
        ],
        "terrain": [
            "Inspect low-lying zones for standing water and higher zones for rapid drying.",
            "Use the 3D terrain drainage view to identify where field channels may be needed.",
            "Avoid treating the whole farm identically when slope and drainage differ."
        ],
    }
    result = list(actions.get(main_key, actions["seasonal"]))
    if irrigation_type == "rain-fed":
        result.append("Because the farm is rain-fed, confirm a dependable rainfall window before major field operations.")
    if stage == "flowering":
        result.append("Flowering is highly sensitive: prioritize stable water supply and inspect for heat or storm damage.")
    return result[:4]


def _build_farm_condition(req: FarmConditionRequest) -> dict:
    df = load_history()
    region_df = df[df["region"] == str(req.region_id)].copy()
    if region_df.empty:
        raise HTTPException(status_code=404, detail="No regional history is available.")
    regional = _compute_spatiotemporal(region_df)

    end_date = date.today() - timedelta(days=5)
    source_status = "regional-fallback"
    source_error = None
    daily_payload = None
    monthly_payload = None
    try:
        power = _fetch_power_condition_data(
            round(req.latitude, 3), round(req.longitude, 3), end_date.isoformat()
        )
        daily_payload = power["daily"]
        monthly_payload = power["monthly"]
        source_status = "nasa-power"
    except Exception as exc:
        source_error = str(exc)

    daily_maps = {
        name: _parse_power_parameter(daily_payload or {}, name)
        for name in ("T2M", "T2M_MAX", "T2M_MIN", "PRECTOTCORR", "RH2M", "WS2M", "ALLSKY_SFC_SW_DWN")
    }
    date_keys = sorted(daily_maps["T2M"].keys())
    recent_keys = date_keys[-30:]
    previous_keys = date_keys[-60:-30]
    latest_key = recent_keys[-1] if recent_keys else None

    latest_quarter = ((end_date.month - 1) // 3) + 1
    regional_q = region_df[region_df["quarter"].astype(int) == latest_quarter]
    fallback_temp = float(regional_q["temperature"].mean()) if not regional_q.empty else float(region_df["temperature"].mean())
    fallback_rain_daily = float(regional_q["precipitation"].mean()) if not regional_q.empty else float(region_df["precipitation"].mean())
    fallback_humidity = float(regional_q["humidity"].mean()) if not regional_q.empty else float(region_df["humidity"].mean())
    fallback_wind = float(regional_q["wind_speed"].mean()) if not regional_q.empty else float(region_df["wind_speed"].mean())

    current_temp = _period_metric(daily_maps["T2M"], recent_keys) or fallback_temp
    current_max = _period_metric(daily_maps["T2M_MAX"], recent_keys) or (current_temp + 4.0)
    current_min = _period_metric(daily_maps["T2M_MIN"], recent_keys) or (current_temp - 4.0)
    current_rain = _period_metric(daily_maps["PRECTOTCORR"], recent_keys, "sum")
    if current_rain is None:
        current_rain = fallback_rain_daily * 30.0
    current_humidity = _period_metric(daily_maps["RH2M"], recent_keys) or fallback_humidity
    current_wind = _period_metric(daily_maps["WS2M"], recent_keys) or fallback_wind
    current_solar = _period_metric(daily_maps["ALLSKY_SFC_SW_DWN"], recent_keys) or 5.0

    previous_temp = _period_metric(daily_maps["T2M"], previous_keys) or current_temp
    previous_rain = _period_metric(daily_maps["PRECTOTCORR"], previous_keys, "sum")
    if previous_rain is None:
        previous_rain = current_rain
    previous_humidity = _period_metric(daily_maps["RH2M"], previous_keys) or current_humidity
    previous_solar = _period_metric(daily_maps["ALLSKY_SFC_SW_DWN"], previous_keys) or current_solar

    monthly_maps = {
        name: _parse_power_parameter(monthly_payload or {}, name)
        for name in ("T2M", "PRECTOTCORR", "RH2M", "WS2M", "ALLSKY_SFC_SW_DWN")
    }
    month_number = int(latest_key[4:6]) if latest_key and len(latest_key) >= 6 else end_date.month

    def monthly_normal(parameter: str, fallback: float) -> float:
        values = []
        for key, value in monthly_maps.get(parameter, {}).items():
            if len(key) >= 6 and key[:6].isdigit() and int(key[4:6]) == month_number:
                values.append(value)
        return _mean(values, fallback)

    normal_temp = monthly_normal("T2M", fallback_temp)
    normal_rain_daily = monthly_normal("PRECTOTCORR", fallback_rain_daily)
    normal_rain = normal_rain_daily * 30.0
    normal_humidity = monthly_normal("RH2M", fallback_humidity)
    normal_solar = monthly_normal("ALLSKY_SFC_SW_DWN", current_solar)

    stage, days_after_planting = _stage_from_planting_date(req.planting_date, req.growth_stage)
    irrigation_type = (req.irrigation_type or "unknown").strip().lower()
    rainfall_ratio = current_rain / max(normal_rain, 1.0)
    drainage = float(req.drainage_score if req.drainage_score is not None else 60.0)
    irrigation = float(req.irrigation_score if req.irrigation_score is not None else 55.0)
    terrain = float(req.terrain_score if req.terrain_score is not None else 60.0)

    moisture_base = _score_near(rainfall_ratio, 1.0, 0.55)
    if rainfall_ratio > 1.45 and drainage < 55:
        moisture_base -= (rainfall_ratio - 1.45) * 28 + (55 - drainage) * 0.25
    if rainfall_ratio < 0.65:
        irrigation_buffer = 0.0
        if irrigation_type in {"irrigated", "partially-irrigated"}:
            irrigation_buffer = 18.0 if irrigation_type == "irrigated" else 9.0
        moisture_base += irrigation_buffer + max(0.0, irrigation - 55.0) * 0.18
    moisture_score = _bounded(moisture_base * 0.78 + drainage * 0.12 + irrigation * 0.10)

    heat_optimum = 27.5
    heat_tolerance = 4.2
    if stage == "flowering":
        heat_optimum, heat_tolerance = 26.8, 3.2
    elif stage in {"seedling", "panicle-initiation"}:
        heat_optimum, heat_tolerance = 27.0, 3.7
    heat_score = _score_near(current_temp, heat_optimum, heat_tolerance)
    if current_max > (34.0 if stage == "flowering" else 36.0):
        heat_score -= (current_max - (34.0 if stage == "flowering" else 36.0)) * 7.0
    heat_score = _bounded(heat_score)

    regional_veg = _bounded((float(regional["post_monsoon_ndvi"]) - 0.22) / 0.48 * 100.0)
    sunlight_score = _score_near(current_solar, 5.2, 2.4)
    vegetation_score = _bounded(
        regional_veg * 0.34 + moisture_score * 0.28 + heat_score * 0.20 + sunlight_score * 0.12
        + float(regional["stability_score"]) * 100.0 * 0.06
    )

    seasonal_rows = {int(row["quarter"]): row for row in regional.get("seasonal_profile", [])}
    qrow = seasonal_rows.get(latest_quarter, {})
    quarter_veg = _bounded((float(qrow.get("ndvi", regional["post_monsoon_ndvi"])) - 0.22) / 0.48 * 100.0)
    seasonal_score = _bounded(quarter_veg * 0.40 + moisture_score * 0.27 + heat_score * 0.23 + sunlight_score * 0.10)

    terrain_score = _bounded(terrain * 0.55 + drainage * 0.30 + irrigation * 0.15)
    recent_temps = [daily_maps["T2M"][key] for key in recent_keys if key in daily_maps["T2M"]]
    temp_variability = float(np.std(recent_temps)) if len(recent_temps) > 1 else 1.5
    stability_score = _bounded(float(regional["stability_score"]) * 72.0 + _score_near(temp_variability, 1.4, 1.6) * 0.28)

    weights = {"vegetation": 0.25, "moisture": 0.20, "heat": 0.20, "seasonal": 0.15, "stability": 0.10, "terrain": 0.10}
    if stage == "seedling":
        weights.update({"moisture": 0.27, "heat": 0.18, "vegetation": 0.20})
    elif stage == "flowering":
        weights.update({"heat": 0.29, "moisture": 0.23, "vegetation": 0.18})
    elif stage == "grain-filling":
        weights.update({"vegetation": 0.28, "moisture": 0.24, "heat": 0.18})
    elif stage == "ripening":
        weights.update({"seasonal": 0.24, "moisture": 0.16, "heat": 0.20})
    weight_sum = sum(weights.values())
    components = {
        "vegetation": vegetation_score,
        "moisture": moisture_score,
        "heat": heat_score,
        "seasonal": seasonal_score,
        "stability": stability_score,
        "terrain": terrain_score,
    }
    overall = sum(components[key] * weights[key] for key in components) / weight_sum
    overall = _bounded(overall)

    concern_key = min(("vegetation", "moisture", "heat", "seasonal", "terrain"), key=lambda key: components[key])
    concern_names = {
        "vegetation": "Uneven or weakened crop condition",
        "moisture": "Water and moisture balance",
        "heat": "Heat stress",
        "seasonal": "Crop-stage and seasonal timing",
        "terrain": "Terrain drainage and field variation",
    }
    concern_reasons = {
        "vegetation": "The combined vegetation proxy is weaker than the other farm-condition indicators.",
        "moisture": f"Recent rainfall is {rainfall_ratio:.2f}× the usual monthly amount, adjusted for irrigation and drainage.",
        "heat": f"Recent average temperature is {current_temp:.1f}°C and the average daily maximum is {current_max:.1f}°C.",
        "seasonal": "Current crop-stage needs and the usual seasonal pattern are not fully aligned.",
        "terrain": "Slope, drainage, or irrigation access may create uneven field conditions.",
    }

    confidence = "High" if source_status == "nasa-power" and req.terrain_score is not None else "Moderate"
    if source_status != "nasa-power":
        confidence = "Low to Moderate"

    comparison = [
        {"key": "temperature", "label": "Average temperature", "unit": "°C", "current": current_temp, "previous": previous_temp, "normal": normal_temp},
        {"key": "rainfall", "label": "30-day rainfall", "unit": "mm", "current": current_rain, "previous": previous_rain, "normal": normal_rain},
        {"key": "humidity", "label": "Relative humidity", "unit": "%", "current": current_humidity, "previous": previous_humidity, "normal": normal_humidity},
        {"key": "solar", "label": "Solar energy", "unit": "kWh/m²/day", "current": current_solar, "previous": previous_solar, "normal": normal_solar},
    ]

    monthly_outlook = _build_monthly_outlook(monthly_payload, regional)
    location_parts = [req.barangay_name, req.municipality_name, req.province_name, req.region_name or REGIONS[req.region_id]]
    location_label = ", ".join([part for part in location_parts if part])

    result = {
        **regional,
        "region_id": req.region_id,
        "region_name": req.region_name or REGIONS[req.region_id],
        "location": {
            "latitude": round(req.latitude, 5),
            "longitude": round(req.longitude, 5),
            "radius_km": req.radius_km,
            "barangay": req.barangay_name,
            "municipality": req.municipality_name,
            "province": req.province_name,
            "label": location_label or f"{req.latitude:.4f}, {req.longitude:.4f}",
        },
        "observation": {
            "latest_date": (
                f"{latest_key[:4]}-{latest_key[4:6]}-{latest_key[6:8]}" if latest_key and len(latest_key) == 8 else None
            ),
            "period_days": len(recent_keys) or 30,
            "source_status": source_status,
            "confidence": confidence,
            "source_error": source_error,
        },
        "farm_context": {
            "growth_stage": stage,
            "planting_date": req.planting_date,
            "days_after_planting": days_after_planting,
            "irrigation_type": irrigation_type,
        },
        "condition": {
            "overall_score": round(overall, 1),
            "status": _condition_label(overall),
            "main_concern": concern_names[concern_key],
            "main_concern_key": concern_key,
            "reason": concern_reasons[concern_key],
        },
        "scores": {
            key: {"score": round(value, 1), "label": _component_label(value)}
            for key, value in components.items()
        },
        "comparison": [
            {**item, "current": round(float(item["current"]), 2), "previous": round(float(item["previous"]), 2), "normal": round(float(item["normal"]), 2)}
            for item in comparison
        ],
        "weather_summary": {
            "temperature_c": round(current_temp, 2),
            "maximum_temperature_c": round(current_max, 2),
            "minimum_temperature_c": round(current_min, 2),
            "rainfall_30d_mm": round(current_rain, 2),
            "rainfall_ratio": round(rainfall_ratio, 3),
            "humidity_pct": round(current_humidity, 2),
            "wind_speed_m_s": round(current_wind, 2),
            "solar_kwh_m2_day": round(current_solar, 2),
        },
        "monthly_outlook": monthly_outlook,
        "actions": _farm_condition_actions(concern_key, stage, irrigation_type),
        "data_sources": [
            {
                "name": "NASA POWER daily and monthly point data" if source_status == "nasa-power" else "Regional climate-derived fallback",
                "status": "Live coordinate-specific climate" if source_status == "nasa-power" else "Fallback estimate",
                "detail": "Temperature, rainfall, humidity, wind, and solar conditions at the farm coordinate." if source_status == "nasa-power" else "Used because the coordinate-specific climate request was unavailable."
            },
            {
                "name": "PAL-AI real DEM terrain analysis",
                "status": "Available" if req.terrain_score is not None else "Not supplied",
                "detail": "Terrain, drainage, and irrigation context from the completed 3D farm scan."
            },
            {
                "name": "PAL-AI regional vegetation proxy",
                "status": "Regional context",
                "detail": "NDVI/EVI/LST values remain climate-derived regional proxies, not direct satellite measurements."
            },
        ],
        "limitations": (
            "This is a coordinate-specific climate and terrain condition report. It does not claim direct satellite NDVI, EVI, or thermal measurement. Field inspection remains necessary."
        ),
    }
    return result


@app.post("/api/farm-condition")
def get_farm_condition(req: FarmConditionRequest):
    """Return a farmer-oriented, coordinate-specific farm health and seasonal report."""
    if req.region_id not in REGIONS:
        raise HTTPException(status_code=404, detail="Region not found.")
    try:
        return _build_farm_condition(req)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ═══════════════════════════════════════════════════════════════════════════════
# BAYESIAN-SPATIOTEMPORAL PEST OUTBREAK DETECTION SYSTEM
# Estimates rice pest/disease outbreak risk using climate, season, region,
# spatiotemporal trends, water/irrigation signals, and terrain suitability.
# ═══════════════════════════════════════════════════════════════════════════════


class PestRiskRequest(BaseModel):
    region_id: int = Field(..., ge=1, le=16)
    quarter: int = Field(..., ge=1, le=4)
    temperature: float = Field(..., ge=0, le=50)
    dew_point: float = Field(..., ge=-10, le=40)
    precipitation: float = Field(..., ge=0, le=500)
    wind_speed: float = Field(..., ge=0, le=200)
    humidity: float = Field(..., ge=0, le=100)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    crop_stage: str = "vegetative"
    terrain_score: Optional[float] = None
    water_risk_score: Optional[float] = None
    spatiotemporal_ndvi: Optional[float] = None
    spatiotemporal_lst: Optional[float] = None
    spatiotemporal_evi: Optional[float] = None


# ── Pest Knowledge Base ──────────────────────────────────────────────────────

PEST_KB = {
    "Brown Planthopper": {
        "category": "insect",
        "prior": 0.55,
        "temp_opt": (26, 32),
        "humidity_opt": (75, 95),
        "precip_mode": "wet",
        "dew_opt": (22, 28),
        "wind_opt": (0, 8),
        "risky_quarters": [2, 3, 4],
        "vulnerable_stages": ["vegetative", "tillering", "booting"],
        "water_sensitive": True,
        "yield_impact": (10, 40),
        "symptoms": [
            "Hopperburn — circular yellow/brown patches",
            "Wilting and lodging of plants",
            "Dense insect colonies at plant base",
            "Sticky honeydew deposits on leaves"
        ],
        "scouting": [
            "Inspect plant base and lower stems at dawn",
            "Use a sweep net in the field",
            "Count hoppers per hill (threshold: 10 per hill)",
            "Look for hopperburn starting at field center"
        ],
        "actions": [
            "Avoid excessive nitrogen fertilizer",
            "Improve field drainage when possible",
            "Use selective insecticides only at economic threshold",
            "Preserve natural enemies (spiders, mirid bugs)",
            "Plant resistant or tolerant varieties"
        ]
    },
    "Green Leafhopper / Tungro Vector": {
        "category": "insect",
        "prior": 0.45,
        "temp_opt": (25, 32),
        "humidity_opt": (70, 90),
        "precip_mode": "moderate",
        "dew_opt": (20, 27),
        "wind_opt": (0, 12),
        "risky_quarters": [2, 3],
        "vulnerable_stages": ["seedling", "vegetative"],
        "water_sensitive": False,
        "yield_impact": (15, 60),
        "symptoms": [
            "Yellow-orange leaf discoloration (tungro)",
            "Stunted and tiller-reduced plants",
            "Chlorotic patches spreading across field",
            "Leafhopper adults on leaf blades"
        ],
        "scouting": [
            "Monitor leafhoppers in seedbed and young fields",
            "Check for yellow-orange tungro symptoms",
            "Count leafhoppers per hill (threshold: 2 per hill in seedling stage)",
            "Inspect nearby fields for tungro infection sources"
        ],
        "actions": [
            "Remove and burn tungro-infected plants immediately",
            "Avoid late planting near known infected fields",
            "Use resistant varieties (IRRI-bred tungro-tolerant)",
            "Apply insecticide seed treatment when risk is high",
            "Synchronize planting in the community"
        ]
    },
    "Rice Stem Borer": {
        "category": "insect",
        "prior": 0.50,
        "temp_opt": (24, 34),
        "humidity_opt": (65, 90),
        "precip_mode": "moderate",
        "dew_opt": (18, 26),
        "wind_opt": (0, 15),
        "risky_quarters": [1, 2, 3],
        "vulnerable_stages": ["vegetative", "tillering", "reproductive"],
        "water_sensitive": False,
        "yield_impact": (5, 30),
        "symptoms": [
            "Dead heart — wilted young tillers",
            "Whitehead — empty bleached panicles",
            "Bored/discolored lower stems",
            "Frass (insect droppings) inside bored stems"
        ],
        "scouting": [
            "Pull tillers to check for deadheart",
            "Inspect panicle emergence for whiteheads",
            "Look for egg masses on leaf blades",
            "Monitor moth activity using light traps"
        ],
        "actions": [
            "Remove and destroy stubble after harvest",
            "Collect and burn egg masses on leaves",
            "Use pheromone traps to monitor moth pressure",
            "Apply granular insecticide at transplanting if history is high",
            "Avoid overly dense canopy by spacing properly"
        ]
    },
    "Rice Leaf Folder": {
        "category": "insect",
        "prior": 0.45,
        "temp_opt": (25, 32),
        "humidity_opt": (70, 95),
        "precip_mode": "wet",
        "dew_opt": (20, 27),
        "wind_opt": (0, 10),
        "risky_quarters": [2, 3],
        "vulnerable_stages": ["vegetative", "tillering"],
        "water_sensitive": False,
        "yield_impact": (5, 20),
        "symptoms": [
            "Lengthwise-folded leaf blades",
            "Scraped/whitish streaks on leaves",
            "Larva visible inside folded leaf",
            "Silvery feeding damage on leaf surface"
        ],
        "scouting": [
            "Inspect folded leaves across several hills",
            "Count folded leaves per hill (threshold: 1 leaf per hill at tillering)",
            "Check for frass inside folded leaves",
            "Monitor at early vegetative stage"
        ],
        "actions": [
            "Preserve natural enemies — avoid broad-spectrum pesticides",
            "Light trapping at night to monitor moth populations",
            "Spray only when folded-leaf count exceeds threshold",
            "Avoid excessive nitrogen which promotes lush growth"
        ]
    },
    "Rice Bug": {
        "category": "insect",
        "prior": 0.35,
        "temp_opt": (25, 33),
        "humidity_opt": (60, 85),
        "precip_mode": "moderate",
        "dew_opt": (18, 26),
        "wind_opt": (0, 10),
        "risky_quarters": [3, 4],
        "vulnerable_stages": ["flowering", "grain_filling", "ripening"],
        "water_sensitive": False,
        "yield_impact": (5, 25),
        "symptoms": [
            "Unfilled or partially filled grains",
            "Discolored, spotted grain surfaces",
            "Characteristic bug odor in field",
            "Adults visible on panicles during early morning"
        ],
        "scouting": [
            "Scout during early morning or late afternoon",
            "Inspect panicle clusters at grain filling stage",
            "Check field borders and weedy areas first",
            "Use sweep net across panicle height"
        ],
        "actions": [
            "Synchronize planting to avoid extended flowering overlap",
            "Remove border weeds that serve as alternate hosts",
            "Apply insecticide only at grain filling if population is high",
            "Harvest early when infestation is detected"
        ]
    },
    "Armyworm": {
        "category": "insect",
        "prior": 0.35,
        "temp_opt": (24, 32),
        "humidity_opt": (65, 90),
        "precip_mode": "moderate",
        "dew_opt": (18, 26),
        "wind_opt": (0, 12),
        "risky_quarters": [2, 3],
        "vulnerable_stages": ["seedling", "vegetative"],
        "water_sensitive": False,
        "yield_impact": (10, 35),
        "symptoms": [
            "Rapid defoliation starting from leaf tips",
            "Cut or jagged leaf margins",
            "Larvae hiding at plant base during daylight",
            "Mass migration of larvae across field"
        ],
        "scouting": [
            "Inspect early morning or late afternoon (larvae active)",
            "Check plant base and soil surface for larvae",
            "Look for defoliation patterns spreading in waves",
            "Monitor after rainfall events or flooding"
        ],
        "actions": [
            "Apply insecticide early when small larvae are detected",
            "Flood field temporarily to flush out larvae",
            "Use biological control (Bt, parasitoid wasps)",
            "Act fast — armyworm damage can be rapid"
        ]
    },
    "Rice Blast": {
        "category": "fungal disease",
        "prior": 0.55,
        "temp_opt": (22, 30),
        "humidity_opt": (80, 100),
        "precip_mode": "wet",
        "dew_opt": (20, 28),
        "wind_opt": (0, 12),
        "risky_quarters": [2, 3, 4],
        "vulnerable_stages": ["seedling", "vegetative", "booting", "heading"],
        "water_sensitive": False,
        "yield_impact": (10, 50),
        "symptoms": [
            "Diamond-shaped gray-white lesions on leaves",
            "Neck blast — dark brown ring at panicle neck",
            "Panicle collapse and empty grains",
            "Leaf tip and node lesions in severe cases"
        ],
        "scouting": [
            "Inspect leaves for diamond-shaped lesions",
            "Check panicle necks at heading",
            "Look for 'rotten neck' symptoms in panicle",
            "Scout during cool, humid, misty mornings"
        ],
        "actions": [
            "Apply fungicide at booting/heading if risk is high",
            "Avoid excessive nitrogen fertilizer",
            "Improve airflow by wider planting spacing",
            "Use blast-resistant varieties",
            "Drain fields intermittently to reduce leaf wetness"
        ]
    },
    "Bacterial Leaf Blight": {
        "category": "bacterial disease",
        "prior": 0.50,
        "temp_opt": (25, 34),
        "humidity_opt": (75, 100),
        "precip_mode": "high",
        "dew_opt": (22, 30),
        "wind_opt": (5, 30),
        "risky_quarters": [2, 3, 4],
        "vulnerable_stages": ["vegetative", "tillering", "booting"],
        "water_sensitive": True,
        "yield_impact": (10, 40),
        "symptoms": [
            "Water-soaked leaf margins turning yellow-white",
            "Wilting of entire tillers in severe cases",
            "Bacterial ooze or kresek symptom in seedlings",
            "Yellowing along veins spreading inward"
        ],
        "scouting": [
            "Inspect leaf margins for yellowing streaks",
            "Check for wilted kresek symptoms in young plants",
            "Look for water-soaked lesions after storms",
            "Monitor after typhoons or strong rainfall events"
        ],
        "actions": [
            "Use clean, certified seed",
            "Improve field drainage after heavy rains",
            "Avoid field injuries during transplanting",
            "Apply copper-based bactericide if severe",
            "Remove and dispose of infected plant material"
        ]
    },
}

SEASON_LABELS = {
    1: "Dry Season (Jan–Mar) — lower pest pressure overall",
    2: "Early Wet Season (Apr–Jun) — increasing insect risk",
    3: "Wet Season (Jul–Sep) — peak pest and disease risk",
    4: "Late Wet Season (Oct–Dec) — harvest-stage pest risk",
}

CROP_STAGE_ORDER = [
    "seedling", "vegetative", "tillering", "booting",
    "heading", "flowering", "grain_filling", "ripening"
]


# ── Helper Functions ─────────────────────────────────────────────────────────

def _clamp(value: float, low: float, high: float) -> float:
    if value is None:
        return low
    if math.isnan(value) or math.isinf(value):
        return low
    return max(low, min(high, value))


def _range_score(value: float, opt_min: float, opt_max: float, tolerance: float = 5.0) -> float:
    """
    Conservative suitability score.
    1.0 only inside the ideal range.
    Outside the range, the score decays faster so pests do not look risky everywhere.
    """
    if opt_min <= value <= opt_max:
        return 1.0

    if value < opt_min:
        distance = (opt_min - value) / tolerance
    else:
        distance = (value - opt_max) / tolerance

    # Quadratic decay gives more realistic drop-off outside the ideal range.
    return _clamp(1.0 - (distance ** 1.35), 0.0, 1.0)


def _humidity_score(humidity: float, opt_min: float, opt_max: float) -> float:
    return _range_score(humidity, opt_min, opt_max, tolerance=12.0)


def _precip_score(precipitation: float, mode: str) -> float:
    """
    Rainfall should not automatically mean all pests are severe.
    Wet pests need enough moisture, but too little or too much should not always max the score.
    """
    if mode == "wet":
        return _range_score(precipitation, 4.0, 14.0, tolerance=12.0)

    if mode == "high":
        return _range_score(precipitation, 7.0, 25.0, tolerance=18.0)

    if mode == "moderate":
        return _range_score(precipitation, 2.0, 9.0, tolerance=8.0)

    return _range_score(precipitation, 1.0, 8.0, tolerance=6.0)


def _season_score(quarter: int, risky_quarters: list) -> float:
    # Non-risky seasons should strongly reduce risk.
    return 1.0 if quarter in risky_quarters else 0.45


def _crop_stage_score(crop_stage: str, vulnerable_stages: list) -> float:
    # Non-vulnerable crop stages should not produce severe pest warnings.
    crop_stage = (crop_stage or "").strip().lower()
    vulnerable = [s.lower() for s in vulnerable_stages]
    return 1.0 if crop_stage in vulnerable else 0.55


def _water_modifier(water_risk_score: Optional[float], pest_name: str, pest_config: dict) -> float:
    """
    Water/irrigation should only be a small supporting signal.
    It should not push all pests to Severe.
    """
    if water_risk_score is None:
        return 1.0

    norm = _clamp(water_risk_score / 100.0, 0.0, 1.0)

    if pest_config.get("water_sensitive"):
        return 0.88 + norm * 0.14   # 0.88 to 1.02

    return 0.94 + norm * 0.04       # 0.94 to 0.98


def _terrain_modifier(terrain_score: Optional[float]) -> float:
    """
    Terrain suitability should not strongly increase pest risk.
    It is only a minor context modifier.
    """
    if terrain_score is None:
        return 1.0

    norm = _clamp(terrain_score / 100.0, 0.0, 1.0)
    return 0.94 + norm * 0.05       # 0.94 to 0.99


def _spatiotemporal_modifier(
    ndvi: Optional[float],
    lst: Optional[float],
    evi: Optional[float],
    pest_config: dict
) -> float:
    """
    Spatiotemporal indicators should adjust the score slightly, not dominate it.
    """
    mod = 1.0
    category = pest_config.get("category", "")

    if ndvi is not None:
        ndvi = _clamp(ndvi, 0.0, 1.0)
        if ndvi > 0.55:
            mod *= 1.0 + (ndvi - 0.55) * 0.18
        elif ndvi < 0.30:
            mod *= 0.94

    if lst is not None:
        if "fungal" in category or "bacterial" in category:
            if lst > 36:
                mod *= 0.88
            elif 25 <= lst <= 32:
                mod *= 1.06
        else:
            if 27 <= lst <= 34:
                mod *= 1.04
            elif lst > 38:
                mod *= 0.90

    if evi is not None:
        evi = _clamp(evi, 0.0, 1.0)
        if evi > 0.45:
            mod *= 1.0 + (evi - 0.45) * 0.10
        elif evi < 0.25:
            mod *= 0.94

    return _clamp(mod, 0.88, 1.06)


def _risk_level(score: float) -> str:
    # More conservative thresholds.
    # Severe should mean strong outbreak conditions, not just favorable weather.
    if score >= 90:
        return "Severe"
    elif score >= 70:
        return "High"
    elif score >= 38:
        return "Moderate"
    return "Low"


def _confidence_from_interval(lower: float, upper: float) -> str:
    width = upper - lower
    if width < 18:
        return "High"
    elif width <= 32:
        return "Moderate"
    return "Low"


def _yield_impact_str(score: float, impact_min: int, impact_max: int) -> str:
    scale = _clamp(score / 100.0, 0.0, 1.0)
    est_min = round(impact_min * scale * 0.65)
    est_max = round(impact_max * scale * 0.85)
    return f"{est_min}–{est_max}%"


def _compute_single_pest_score(
    temperature: float,
    dew_point: float,
    precipitation: float,
    wind_speed: float,
    humidity: float,
    quarter: int,
    crop_stage: str,
    terrain_score: Optional[float],
    water_risk_score: Optional[float],
    ndvi: Optional[float],
    lst: Optional[float],
    evi: Optional[float],
    pest_config: dict,
) -> float:
    temp_score = _range_score(
        temperature,
        pest_config["temp_opt"][0],
        pest_config["temp_opt"][1],
        tolerance=5.0
    )

    humidity_score = _humidity_score(
        humidity,
        pest_config["humidity_opt"][0],
        pest_config["humidity_opt"][1]
    )

    precip_score = _precip_score(precipitation, pest_config["precip_mode"])

    dew_score = _range_score(
        dew_point,
        pest_config["dew_opt"][0],
        pest_config["dew_opt"][1],
        tolerance=5.0
    )

    wind_score = _range_score(
        wind_speed,
        pest_config["wind_opt"][0],
        pest_config["wind_opt"][1],
        tolerance=7.0
    )

    season_score = _season_score(quarter, pest_config["risky_quarters"])
    stage_score = _crop_stage_score(
        crop_stage, pest_config["vulnerable_stages"])

    # Climate suitability. This is still important, but no longer enough by itself.
    climate_score = (
        temp_score * 0.24 +
        humidity_score * 0.22 +
        precip_score * 0.16 +
        dew_score * 0.12 +
        wind_score * 0.06 +
        season_score * 0.10 +
        stage_score * 0.10
    )

    # Count how many strong conditions are truly present.
    strong_conditions = sum([
        temp_score >= 0.82,
        humidity_score >= 0.82,
        precip_score >= 0.72,
        dew_score >= 0.72,
        wind_score >= 0.70,
        season_score >= 0.95,
        stage_score >= 0.95,
    ])

    # Conservative Bayesian-style prior.
    prior = pest_config["prior"]

    if quarter in pest_config["risky_quarters"]:
        prior += 0.04
    else:
        prior -= 0.14

    prior = _clamp(prior, 0.08, 0.45)

    # Convert prior to a small base score, not a multiplier that can explode.
    prior_score = prior * 14.0

    # Main risk score.
    risk_score = prior_score + (climate_score ** 1.75) * 43.0

    # Apply conservative modifiers.
    water_mod = _water_modifier(water_risk_score, "", pest_config)
    terrain_mod = _terrain_modifier(terrain_score)
    spatio_mod = _spatiotemporal_modifier(ndvi, lst, evi, pest_config)

    risk_score *= water_mod * terrain_mod * spatio_mod

    crop_stage_clean = (crop_stage or "").strip().lower()
    vulnerable_stages = [s.lower() for s in pest_config["vulnerable_stages"]]

    is_risky_season = quarter in pest_config["risky_quarters"]
    is_vulnerable_stage = crop_stage_clean in vulnerable_stages

    # Only allow severe risk when multiple conditions agree.
    if strong_conditions >= 6 and is_risky_season and is_vulnerable_stage:
        risk_score += 3
    elif strong_conditions <= 3:
        risk_score -= 14
    # Hard realism caps.
    # These prevent all pests from becoming severe everywhere.
    if not is_risky_season and not is_vulnerable_stage:
        risk_score = min(risk_score, 34)
    elif not is_risky_season:
        risk_score = min(risk_score, 46)
    elif not is_vulnerable_stage:
        risk_score = min(risk_score, 52)

    if strong_conditions <= 2:
        risk_score = min(risk_score, 38)
    elif strong_conditions <= 3:
        risk_score = min(risk_score, 50)
    elif strong_conditions <= 4:
        risk_score = min(risk_score, 66)
    elif strong_conditions <= 5:
        risk_score = min(risk_score, 80)

    # Never show 100%. This is a risk estimate, not confirmed outbreak detection.
    return float(_clamp(risk_score, 0.0, 92.0))


def _simulate_pest_risk(
    temperature: float,
    dew_point: float,
    precipitation: float,
    wind_speed: float,
    humidity: float,
    quarter: int,
    crop_stage: str,
    terrain_score: Optional[float],
    water_risk_score: Optional[float],
    ndvi: Optional[float],
    lst: Optional[float],
    evi: Optional[float],
    pest_config: dict,
    n: int = 300,
) -> dict:
    rng = np.random.default_rng(42)
    scores = []
    for _ in range(n):
        t = temperature + rng.normal(0, 0.7)
        h = humidity + rng.normal(0, 3.0)
        p = precipitation * max(0.1, rng.normal(1.0, 0.15))
        dp = dew_point + rng.normal(0, 0.6)
        ws = wind_speed * max(0.1, rng.normal(1.0, 0.10))

        h = _clamp(h,   0.0, 100.0)
        t = _clamp(t,   0.0,  50.0)
        p = _clamp(p,   0.0, 500.0)
        dp = _clamp(dp, -10.0,  40.0)
        ws = _clamp(ws,  0.0, 200.0)

        s = _compute_single_pest_score(
            t, dp, p, ws, h,
            quarter, crop_stage,
            terrain_score, water_risk_score,
            ndvi, lst, evi,
            pest_config,
        )
        scores.append(s)

    arr = np.array(scores)
    mean = float(np.mean(arr))
    lower = float(np.percentile(arr, 10))
    upper = float(np.percentile(arr, 90))
    return {"mean": mean, "lower": lower, "upper": upper}


def _build_main_reasons(
    temperature: float,
    humidity: float,
    precipitation: float,
    dew_point: float,
    wind_speed: float,
    quarter: int,
    crop_stage: str,
    water_risk_score: Optional[float],
    terrain_score: Optional[float],
    pest_config: dict,
) -> list:
    reasons = []
    t_min, t_max = pest_config["temp_opt"]
    if t_min <= temperature <= t_max:
        reasons.append(
            f"Temperature ({temperature:.1f}°C) is within the optimal range for {pest_config['category']} development")
    h_min, h_max = pest_config["humidity_opt"]
    if h_min <= humidity <= h_max:
        reasons.append(
            f"Humidity ({humidity:.0f}%) favors pest/disease activity")
    if pest_config["precip_mode"] in ("wet", "high") and precipitation >= 5:
        reasons.append(
            f"Precipitation ({precipitation:.1f}mm) creates wet conditions favorable to this risk")
    if quarter in pest_config["risky_quarters"]:
        reasons.append(
            f"Q{quarter} is a historically high-risk season for this pest/disease")
    if crop_stage in pest_config["vulnerable_stages"]:
        reasons.append(
            f"Current crop stage ({crop_stage}) is highly vulnerable to this threat")
    if water_risk_score is not None and water_risk_score >= 60 and pest_config.get("water_sensitive"):
        reasons.append(
            "High water/irrigation proximity significantly increases this pest's outbreak risk")
    if not reasons:
        reasons.append(
            "Moderate climate conditions pose some risk; field monitoring is recommended")
    return reasons[:4]


PEST_IMAGE_FILES = {
    "Brown Planthopper": "brown-planthopper.jpg",
    "Green Leafhopper / Tungro Vector": "green-leafhopper.jpg",
    "Rice Stem Borer": "rice-stem-borer.jpg",
    "Rice Leaf Folder": "rice-leaf-folder.jpg",
    "Rice Bug": "rice-bug.jpg",
    "Armyworm": "armyworm.jpg",
    "Rice Blast": "rice-blast.jpg",
    "Bacterial Leaf Blight": "bacterial-leaf-blight.jpg",
}


def _pest_image_url(pest_name: str) -> str:
    filename = PEST_IMAGE_FILES.get(pest_name)
    if not filename:
        return ""
    return f"/static/assets/pests/{filename}"

# ── Main Pest Risk Computation ───────────────────────────────────────────────


def _compute_pest_risk_response(req: PestRiskRequest) -> dict:
    # Try to derive spatiotemporal indices from historical data if not provided
    ndvi = req.spatiotemporal_ndvi
    lst = req.spatiotemporal_lst
    evi = req.spatiotemporal_evi

    if ndvi is None or lst is None or evi is None:
        try:
            ndvi = ndvi or _ndvi_proxy(
                req.temperature, req.humidity, req.precipitation, req.quarter)
            lst = lst or _lst_proxy(
                req.temperature, req.humidity, req.precipitation)
            evi = evi or _evi_proxy(
                req.temperature, req.humidity, req.precipitation, req.wind_speed, req.quarter)
        except Exception:
            pass

    pest_results = []
    for pest_name, pest_config in PEST_KB.items():
        sim = _simulate_pest_risk(
            req.temperature, req.dew_point, req.precipitation,
            req.wind_speed, req.humidity, req.quarter, req.crop_stage,
            req.terrain_score, req.water_risk_score,
            ndvi, lst, evi,
            pest_config,
        )
        mean_score = sim["mean"]
        lower = sim["lower"]
        upper = sim["upper"]

        risk_level = _risk_level(mean_score)
        confidence = _confidence_from_interval(lower, upper)
        impact_str = _yield_impact_str(
            mean_score, pest_config["yield_impact"][0], pest_config["yield_impact"][1])
        reasons = _build_main_reasons(
            req.temperature, req.humidity, req.precipitation,
            req.dew_point, req.wind_speed, req.quarter, req.crop_stage,
            req.water_risk_score, req.terrain_score, pest_config,
        )

        pest_results.append({
            "name":       pest_name,
            "category":   pest_config["category"],
            "image_url":  _pest_image_url(pest_name),
            "risk_score": round(mean_score, 1),
            "risk_level": risk_level,
            "probability": round(mean_score / 100.0, 3),
            "credible_interval": {
                "lower": round(lower, 1),
                "upper": round(upper, 1),
            },
            "confidence":      confidence,
            "yield_impact_pct": impact_str,
            "main_reasons":    reasons,
            "symptoms":        pest_config["symptoms"],
            "scouting":        pest_config["scouting"],
            "actions":         pest_config["actions"],
        })

    # Sort by risk score descending
    pest_results.sort(key=lambda x: x["risk_score"], reverse=True)

    # Overall risk = highest single pest score
    overall_score = pest_results[0]["risk_score"] if pest_results else 0.0
    overall_level = _risk_level(overall_score)
    likely_pest = pest_results[0]["name"] if pest_results else "Unknown"
    overall_lower = pest_results[0]["credible_interval"]["lower"]
    overall_upper = pest_results[0]["credible_interval"]["upper"]
    overall_conf = _confidence_from_interval(overall_lower, overall_upper)

    # Estimated yield impact
    top_pest_cfg = PEST_KB[likely_pest]
    overall_impact = _yield_impact_str(
        overall_score, top_pest_cfg["yield_impact"][0], top_pest_cfg["yield_impact"][1])

    # Recommendations
    recommendations = []
    if overall_level in ("High", "Severe"):
        recommendations.append(
            f"⚠️ Field scouting recommended within 24–48 hours for {likely_pest} symptoms")
    elif overall_level == "Moderate":
        recommendations.append("📋 Schedule field inspection within the week")
    else:
        recommendations.append(
            "✅ Continue routine monitoring; risk is currently low")

    # Add top pest actions (top 3)
    for action in top_pest_cfg["actions"][:3]:
        recommendations.append(action)

    # Disease-specific drainage/fungicide advice
    cat = top_pest_cfg["category"]
    if "fungal" in cat or "bacterial" in cat:
        recommendations.append(
            "Improve field drainage to reduce leaf wetness duration")
    if overall_level == "Severe":
        recommendations.append(
            "Consider coordinated community-level pest management response")

    # Scouting checklist (union of top 2 pests)
    scouting_checklist = list(top_pest_cfg["scouting"])
    if len(pest_results) > 1:
        second_pest = PEST_KB[pest_results[1]["name"]]
        for item in second_pest["scouting"]:
            if item not in scouting_checklist:
                scouting_checklist.append(item)
    scouting_checklist = scouting_checklist[:6]

    # Spatiotemporal context
    trend_label = SEASON_LABELS.get(req.quarter, f"Quarter {req.quarter}")
    if ndvi is not None and ndvi > 0.5:
        trend_interp = f"High vegetation density (NDVI≈{ndvi:.2f}) may increase canopy moisture and pest habitat."
    elif ndvi is not None and ndvi < 0.3:
        trend_interp = f"Low vegetation index (NDVI≈{ndvi:.2f}) suggests sparse canopy; monitor for stress-related vulnerability."
    else:
        trend_interp = "Moderate vegetation conditions; standard pest monitoring protocol applies."

    summary = (
        f"PAL-AI detected a {overall_level} pest outbreak risk for the selected rice-growing area. "
        f"The most likely threat is {likely_pest} "
        f"({top_pest_cfg['category']}) based on the current climate, crop stage, and seasonal conditions. "
        f"The Bayesian simulation estimates a risk interval of {overall_lower:.0f}–{overall_upper:.0f}%, "
        f"indicating {overall_conf.lower()} confidence. "
        f"Field verification is required before concluding an actual outbreak."
    )

    return {
        "ok": True,
        "region_id":   req.region_id,
        "region_name": REGIONS.get(req.region_id, f"Region {req.region_id}"),
        "overall_risk_score": round(overall_score, 1),
        "overall_risk_level": overall_level,
        "likely_pest":        likely_pest,
        "bayesian_confidence": overall_conf,
        "credible_interval": {
            "lower": round(overall_lower, 1),
            "upper": round(overall_upper, 1),
        },
        "estimated_yield_impact": overall_impact,
        "pest_risks":          pest_results,
        "spatiotemporal_context": {
            "quarter":           req.quarter,
            "season_label":      trend_label,
            "trend_interpretation": trend_interp,
            "ndvi_proxy":        round(ndvi, 3) if ndvi is not None else None,
            "lst_proxy":         round(lst, 2) if lst is not None else None,
            "evi_proxy":         round(evi, 3) if evi is not None else None,
            "terrain_modifier_used": req.terrain_score is not None,
            "water_modifier_used":   req.water_risk_score is not None,
            "crop_stage":        req.crop_stage,
        },
        "recommendations":    recommendations,
        "scouting_checklist": scouting_checklist,
        "summary":            summary,
    }


# ════════════════════════════════════════════════════════════
# PALADIN — LLM-Powered Rice Farming Assistant
# ════════════════════════════════════════════════════════════

PALADIN_SYSTEM_PROMPT = """You are PALADIN (Predictive Agricultural Layered AI Diagnosis and Intervention Network), the AI farming assistant embedded inside PAL-AI — a Philippine rice yield forecasting and pest risk platform.

Your role is to help Filipino rice farmers understand their data, make better farming decisions, and navigate disease, pest, and climate risks.

## Behavior Rules
- Always use the PAL-AI context provided to give specific, location-aware advice.
- When interpreting forecast data, explain yield trends in plain Filipino farmer terms.
- When discussing pest risk, reference the specific pests and scores from the context.
- When discussing terrain, explain how slope, elevation, and water proximity affect farming.
- When analyzing images, evaluate both pest/disease indicators and visible rice-leaf discoloration or general plant stress.
- Describe discoloration color, distribution, pattern, apparent severity, and plausible nutrient, water, disease, pest, chemical, or environmental causes.
- Separate what is visibly observed from what is only a possible cause.
- Use careful AI-assisted language — never say "confirmed disease."
- Always recommend field verification and consultation with local agricultural technicians before applying chemical treatment.
- Prioritize Integrated Pest Management (IPM) strategies over immediate chemical intervention.
- Be warm, practical, and clear. Use simple language. Avoid jargon unless you explain it.
- Always remind users: "AI-assisted diagnosis — verify through field scouting or local experts."

## Wording Guidelines
Use: "likely", "possible", "estimated", "image-based diagnosis", "field verification recommended"
Never use: "confirmed disease", "guaranteed outbreak", "definitely infected" — unless the user explicitly states confirmed lab/field results.

## Response Format
Keep responses concise but comprehensive. Use bullet points for action items. Use headings for long responses. Always end image diagnoses with a field verification reminder.

## Response Length
- Text chat: max 150 words. Be direct. Farmers are busy.
- Image diagnosis: use the exact compact format provided. Never exceed it.
- Never repeat yourself. Skip empty sections."""


class PaladinChatRequest(BaseModel):
    message: str
    context: dict = {}
    conversation: list = []


def summarize_palai_context(ctx: dict) -> str:
    """Convert PAL-AI frontend context dict into a readable LLM context string."""
    parts = []

    if ctx.get("region_name"):
        parts.append(
            f"Selected Region: {ctx['region_name']} (ID: {ctx.get('region_id', 'N/A')})")

    if ctx.get("latitude") and ctx.get("longitude"):
        parts.append(
            f"Coordinates: {ctx['latitude']:.4f}°N, {ctx['longitude']:.4f}°E")

    if ctx.get("forecast_summary"):
        fs = ctx["forecast_summary"]
        if isinstance(fs, dict):
            parts.append(
                f"Latest Forecast: {fs.get('latest_yield', 'N/A')} t/ha yield, "
                f"trend={fs.get('trend', 'N/A')}, region={fs.get('region', 'N/A')}"
            )
        else:
            parts.append(f"Forecast Summary: {fs}")

    if ctx.get("terrain_scores"):
        ts = ctx["terrain_scores"]
        if isinstance(ts, dict):
            parts.append(
                f"Terrain Scores — Suitability: {ts.get('suitability', 'N/A')}, "
                f"Slope Risk: {ts.get('slope_risk', 'N/A')}, "
                f"Flood Risk: {ts.get('flood_risk', 'N/A')}, "
                f"Erosion: {ts.get('erosion', 'N/A')}, "
                f"Drainage: {ts.get('drainage', 'N/A')}"
            )

    if ctx.get("terrain_location"):
        tl = ctx["terrain_location"]
        if isinstance(tl, dict):
            parts.append(
                f"Terrain Location: {tl.get('name', 'N/A')} "
                f"(Elev: {tl.get('elevation', 'N/A')}m, "
                f"Slope: {tl.get('slope', 'N/A')}°)"
            )

    if ctx.get("pest_risk"):
        pr = ctx["pest_risk"]
        if isinstance(pr, dict):
            parts.append(
                f"Pest Risk — Overall: {pr.get('overall_risk_level', 'N/A')} "
                f"(score {pr.get('overall_risk_score', 'N/A')}), "
                f"Top Pest: {pr.get('likely_pest', 'N/A')}, "
                f"Confidence: {pr.get('bayesian_confidence', 'N/A')}, "
                f"Est. Yield Impact: {pr.get('estimated_yield_impact', 'N/A')}"
            )
            pests = pr.get("pest_risks", [])[:3]
            if pests:
                pest_lines = [
                    f"{p['name']}: {p['risk_score']} ({p['risk_level']})" for p in pests]
                parts.append("Top Pest Risks: " + " | ".join(pest_lines))

    if ctx.get("spatiotemporal"):
        st = ctx["spatiotemporal"]
        if isinstance(st, dict):
            parts.append(
                f"Spatiotemporal — NDVI: {st.get('ndvi_proxy', 'N/A')}, "
                f"LST: {st.get('lst_proxy', 'N/A')}, "
                f"EVI: {st.get('evi_proxy', 'N/A')}, "
                f"Season: {st.get('season_label', 'N/A')}"
            )

    if ctx.get("last_image_diagnosis"):
        parts.append(
            f"Last Image Diagnosis: {str(ctx['last_image_diagnosis'])[:400]}")

    if not parts:
        return "No PAL-AI context currently available."

    return "\n".join(parts)


def _call_llm(messages: list, max_tokens: int = 1024) -> str:
    """Call the configured Gemini model. Returns reply text or raises."""
    if not LLM_API_KEY:
        raise ValueError(
            "PALADIN API key is not configured. Run CONFIGURE_PALADIN_API_KEY.bat, then place your Gemini key in backend/.env as LLM_API_KEY=YOUR_KEY.")

    # Convert messages to Gemini format
    gemini_contents = []
    for msg in messages:
        role = "user" if msg["role"] == "user" else "model"
        content = msg["content"]
        if isinstance(content, str):
            gemini_contents.append(
                {"role": role, "parts": [{"text": content}]})
        elif isinstance(content, list):
            # Vision message with image + text
            parts = []
            for block in content:
                if block.get("type") == "text":
                    parts.append({"text": block["text"]})
                elif block.get("type") == "image":
                    src = block["source"]
                    parts.append({
                        "inline_data": {
                            "mime_type": src["media_type"],
                            "data": src["data"],
                        }
                    })
            gemini_contents.append({"role": role, "parts": parts})

    payload = {
        "system_instruction": {"parts": [{"text": PALADIN_SYSTEM_PROMPT}]},
        "contents": gemini_contents,
        "generationConfig": {"maxOutputTokens": max_tokens},
    }

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{LLM_MODEL}:generateContent"
    resp = requests.post(
        url,
        json=payload,
        headers={"x-goog-api-key": LLM_API_KEY},
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()

    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        return "PALADIN could not generate a response. Please try again."

# ════════════════════════════════════════════════════════════
# LIVE PLANTING FORECAST — Google Weather API
# ════════════════════════════════════════════════════════════


def _live_clamp(value, low=0, high=100):
    return max(low, min(high, value))


def _bell_score(value, optimum, sigma, hard_low, hard_high, missing=55):
    """
    Smooth 0–100 score with no flat 100% plateau.
    The closer the value is to the agronomic optimum, the higher the score.
    """
    if value is None:
        return missing

    value = float(value)

    if value <= hard_low or value >= hard_high:
        return 0

    score = 100 * math.exp(-0.5 * ((value - optimum) / sigma) ** 2)
    return _live_clamp(score)


def _rainfall_score(rainfall_mm, precip_probability):
    """
    Planting/transplanting suitability from daily rain amount and rain probability.
    Moderate rain is useful for field moisture; dry days and heavy-rain days are penalized.
    """
    rainfall = float(rainfall_mm or 0)
    probability = float(precip_probability or 0)

    # Around 6–10 mm/day is treated as a practical moisture-friendly window.
    amount_score = _bell_score(
        rainfall, optimum=8, sigma=7, hard_low=-0.01, hard_high=65, missing=50)

    # Some rain chance is useful, but a near-certain rain event increases operational risk.
    probability_score = _bell_score(
        probability, optimum=55, sigma=28, hard_low=-1, hard_high=101, missing=55)

    score = amount_score * 0.72 + probability_score * 0.28

    if rainfall < 1 and probability < 35:
        score -= 22
    if rainfall > 30:
        score -= min(30, (rainfall - 30) * 1.4)
    if rainfall > 45:
        score -= 12

    return _live_clamp(score)


def _dew_point_celsius(temp_c, humidity):
    """
    Estimate dew point using the Magnus formula.
    """
    if temp_c is None or humidity is None:
        return None

    temp_c = float(temp_c)
    humidity = max(1, min(100, float(humidity)))

    a = 17.27
    b = 237.7

    alpha = ((a * temp_c) / (b + temp_c)) + math.log(humidity / 100.0)
    return (b * alpha) / (a - alpha)


def _planting_score(
    temp_c,
    humidity,
    rainfall_mm,
    wind_kph,
    dew_point_c,
    thunder_prob,
    min_temp_c=None,
    max_temp_c=None,
    precipitation_probability=0,
):
    """
    PAL-AI daily planting compatibility score.
    Score is 0–100 and intentionally uses smooth curves, not broad flat ideal ranges.
    """
    temp_score = _bell_score(
        temp_c, optimum=28, sigma=3.8, hard_low=18, hard_high=39)
    max_temp_score = _bell_score(max_temp_c if max_temp_c is not None else temp_c,
                                 optimum=31, sigma=4.2, hard_low=20, hard_high=43)
    min_temp_score = _bell_score(min_temp_c if min_temp_c is not None else temp_c,
                                 optimum=23, sigma=3.5, hard_low=14, hard_high=32)
    rainfall_score = _rainfall_score(rainfall_mm, precipitation_probability)
    humidity_score = _bell_score(
        humidity, optimum=78, sigma=12, hard_low=38, hard_high=100)
    dew_score = _bell_score(dew_point_c, optimum=23,
                            sigma=3.8, hard_low=12, hard_high=32)

    wind = float(wind_kph or 0)
    wind_score = 100 - max(0, wind - 10) * 2.4
    if wind <= 1 and humidity is not None and float(humidity) >= 90:
        wind_score -= 8
    wind_score = _live_clamp(wind_score)

    score = (
        temp_score * 0.22 +
        max_temp_score * 0.12 +
        min_temp_score * 0.07 +
        rainfall_score * 0.25 +
        humidity_score * 0.11 +
        dew_score * 0.08 +
        wind_score * 0.07
    )

    thunder = float(thunder_prob or 0)
    score -= min(thunder * 0.35, 28)

    if max_temp_c is not None and float(max_temp_c) >= 35:
        score -= min(28, (float(max_temp_c) - 34.5) * 5.0)

    if humidity is not None and dew_point_c is not None:
        if float(humidity) >= 90 and float(dew_point_c) >= 25:
            score -= 12
        elif float(humidity) >= 86 and float(dew_point_c) >= 24:
            score -= 6

    if rainfall_mm is not None:
        rain = float(rainfall_mm)
        if rain < 0.5 and float(precipitation_probability or 0) < 30:
            score -= 12
        if rain > 40:
            score -= 16

    return round(_live_clamp(score), 1)


def _planting_label(score):
    if score >= 85:
        return "Excellent"
    if score >= 70:
        return "Good"
    if score >= 55:
        return "Moderate"
    if score >= 40:
        return "Caution"
    return "Poor"


def _planting_advice(score, rainfall_mm, wind_kph, thunder_prob, max_temp_c=None, humidity=None, dew_point_c=None):
    if thunder_prob and thunder_prob >= 50:
        return "Avoid planting during likely thunderstorms; wait for a safer field-work window."
    if max_temp_c is not None and max_temp_c >= 35:
        return "High heat risk. Avoid stressful establishment work during peak heat."
    if rainfall_mm is not None and rainfall_mm > 40:
        return "Heavy rainfall risk. Seeds may wash out or field access may be poor."
    if rainfall_mm is not None and rainfall_mm < 1:
        return "Very low rainfall. Plant only if irrigation or field moisture is available."
    if humidity is not None and dew_point_c is not None and humidity >= 90 and dew_point_c >= 25:
        return "Very humid and dewy conditions may increase disease pressure; monitor seedlings closely."
    if wind_kph is not None and wind_kph > 35:
        return "High wind conditions. Avoid spraying and monitor lodging or seedling stress."
    if score >= 70:
        return "Good planting window. Conditions are generally favorable."
    if score >= 55:
        return "Usable planting window, but monitor field moisture and disease risk."
    return "Not ideal. Consider waiting for a better planting window."


@app.get("/api/live-planting-forecast")
def live_planting_forecast(lat: float, lng: float, days: int = 10):
    """
    Live planting suitability forecast using Google Weather API.

    Google Weather API daily forecast supports up to 10 days.
    """
    if not GOOGLE_WEATHER_API_KEY:
        return {
            "ok": False,
            "error": "GOOGLE_WEATHER_API_KEY is not configured on the backend."
        }

    if lat < 4 or lat > 21 or lng < 116 or lng > 127:
        raise HTTPException(
            status_code=400,
            detail="Coordinates appear to be outside the Philippines."
        )

    safe_days = max(1, min(int(days), 10))

    url = "https://weather.googleapis.com/v1/forecast/days:lookup"

    params = {
        "key": GOOGLE_WEATHER_API_KEY,
        "location.latitude": lat,
        "location.longitude": lng,
        "days": safe_days,
        "pageSize": safe_days,
        "unitsSystem": "METRIC",
        "languageCode": "en",
    }

    try:
        response = requests.get(url, params=params, timeout=25)
        response.raise_for_status()
        raw = response.json()

        forecast_days = raw.get("forecastDays", [])
        normalized_days = []

        for index, day in enumerate(forecast_days):
            display = day.get("displayDate", {})
            daytime = day.get("daytimeForecast", {}) or {}
            nighttime = day.get("nighttimeForecast", {}) or {}

            max_temp = (day.get("maxTemperature") or {}).get("degrees")
            min_temp = (day.get("minTemperature") or {}).get("degrees")

            if max_temp is not None and min_temp is not None:
                avg_temp = (float(max_temp) + float(min_temp)) / 2
            else:
                avg_temp = max_temp if max_temp is not None else min_temp

            humidity_day = daytime.get("relativeHumidity")
            humidity_night = nighttime.get("relativeHumidity")

            humidity_values = [
                h for h in [humidity_day, humidity_night]
                if h is not None
            ]

            humidity = sum(humidity_values) / \
                len(humidity_values) if humidity_values else None

            precip_day = ((daytime.get("precipitation") or {}).get(
                "qpf") or {}).get("quantity", 0)
            precip_night = ((nighttime.get("precipitation") or {}).get(
                "qpf") or {}).get("quantity", 0)
            rainfall_mm = float(precip_day or 0) + float(precip_night or 0)

            precip_prob_day = (((daytime.get("precipitation") or {}).get(
                "probability") or {}).get("percent", 0))
            precip_prob_night = (((nighttime.get("precipitation") or {}).get(
                "probability") or {}).get("percent", 0))
            precip_probability = max(
                float(precip_prob_day or 0), float(precip_prob_night or 0))

            wind_day = (((daytime.get("wind") or {}).get(
                "speed") or {}).get("value", 0))
            wind_night = (((nighttime.get("wind") or {}).get(
                "speed") or {}).get("value", 0))
            wind_kph = max(float(wind_day or 0), float(wind_night or 0))

            thunder_prob = max(
                float(daytime.get("thunderstormProbability") or 0),
                float(nighttime.get("thunderstormProbability") or 0)
            )

            condition = (
                ((daytime.get("weatherCondition") or {}).get(
                    "description") or {}).get("text")
                or "Forecast available"
            )

            icon_base = ((daytime.get("weatherCondition")
                         or {}).get("iconBaseUri") or "")

            dew_point = _dew_point_celsius(avg_temp, humidity)

            score = _planting_score(
                temp_c=avg_temp,
                humidity=humidity,
                rainfall_mm=rainfall_mm,
                wind_kph=wind_kph,
                dew_point_c=dew_point,
                thunder_prob=thunder_prob,
                min_temp_c=min_temp,
                max_temp_c=max_temp,
                precipitation_probability=precip_probability
            )

            normalized_days.append({
                "day_index": index + 1,
                "date": f"{display.get('year')}-{str(display.get('month')).zfill(2)}-{str(display.get('day')).zfill(2)}",
                "condition": condition,
                "icon": f"{icon_base}.svg" if icon_base else "",
                "score": score,
                "label": _planting_label(score),
                "advice": _planting_advice(
                    score, rainfall_mm, wind_kph, thunder_prob,
                    max_temp_c=float(
                        max_temp) if max_temp is not None else None,
                    humidity=round(
                        humidity, 1) if humidity is not None else None,
                    dew_point_c=round(
                        dew_point, 1) if dew_point is not None else None
                ),
                "temperature_c": round(avg_temp, 1) if avg_temp is not None else None,
                "max_temp_c": round(float(max_temp), 1) if max_temp is not None else None,
                "min_temp_c": round(float(min_temp), 1) if min_temp is not None else None,
                "humidity": round(humidity, 1) if humidity is not None else None,
                "dew_point_c": round(dew_point, 1) if dew_point is not None else None,
                "rainfall_mm": round(rainfall_mm, 2),
                "precipitation_probability": round(precip_probability, 1),
                "wind_kph": round(wind_kph, 1),
                "thunderstorm_probability": round(thunder_prob, 1),
            })

        return {
            "ok": True,
            "source": "Google Weather API",
            "requested_days": days,
            "returned_days": len(normalized_days),
            "max_google_daily_days": 10,
            "limit_note": "Google Weather API daily forecast returns up to 10 days only.",
            "lat": lat,
            "lng": lng,
            "days": normalized_days,
        }

    except requests.HTTPError as e:
        return {
            "ok": False,
            "error": f"Google Weather API error: {str(e)}",
            "details": response.text[:500] if "response" in locals() else ""
        }
    except Exception as e:
        return {
            "ok": False,
            "error": str(e)
        }


@app.post("/api/paladin/chat")
def paladin_chat(req: PaladinChatRequest):
    """
    PALADIN text chat endpoint.
    Receives message + PAL-AI context + recent conversation history.
    Returns LLM-generated farming advice.
    """
    if not LLM_API_KEY:
        return {"ok": False, "reply": "⚠️ PALADIN API key is not configured. Run CONFIGURE_PALADIN_API_KEY.bat, then place your Gemini key in backend/.env as LLM_API_KEY=YOUR_KEY."}

    try:
        ctx_summary = summarize_palai_context(req.context)
        system_context_msg = f"## Current PAL-AI Dashboard Context\n{ctx_summary}"

        # Build conversation history (keep last 10 turns max)
        messages = []
        # Inject context as first user message if we have context
        if ctx_summary != "No PAL-AI context currently available.":
            messages.append({
                "role": "user",
                "content": f"[PAL-AI Context Update]\n{system_context_msg}"
            })
            messages.append({
                "role": "assistant",
                "content": "Understood. I have your current PAL-AI dashboard context loaded. How can I help you with your rice farming today?"
            })

        # Add recent conversation
        for turn in req.conversation[-8:]:
            role = turn.get("role", "user")
            content = turn.get("content", "")
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": str(content)})

        # Add current user message
        messages.append({"role": "user", "content": req.message})

        reply = _call_llm(messages, max_tokens=1200)
        return {"ok": True, "reply": reply}

    except ValueError as e:
        return {"ok": False, "reply": str(e)}
    except Exception as e:
        return {"ok": False, "reply": f"PALADIN encountered an error: {str(e)}"}


ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg",
                       "image/jpg", "image/webp", "image/gif"}
MAX_IMAGE_BYTES = 12 * 1024 * 1024  # 12 MB

IMAGE_DIAGNOSIS_PROMPT = """Analyze this rice plant or rice-leaf image for BOTH visible plant health/discoloration and possible pests, diseases, or nutrient/environmental stress.

Important analysis rules:
- First decide whether the image clearly contains a rice plant or leaf. If not, say the image is unsuitable and do not invent a diagnosis.
- Inspect visible leaf colors carefully: normal green, pale green, yellow, orange, brown, gray, white, purple, black, or mixed coloration.
- Describe where discoloration appears: tips, margins, veins, between veins, spots, streaks, lesions, lower leaves, upper leaves, or whole leaf.
- Estimate affected visible leaf area only as a rough image-based percentage. Do not present it as laboratory measurement.
- Distinguish likely pest/disease signs from nutrient deficiency, water stress, chemical injury, heat/sun damage, natural senescence, and camera/lighting effects.
- Do not diagnose from color alone. Use shape, distribution, lesions, holes, insects, wilting, curling, and contextual clues.
- Use "likely", "possible", and "image-based estimate". Never say confirmed unless laboratory or field confirmation is explicitly supplied.
- If image quality is poor, lower confidence and request a clearer close-up plus a whole-plant photo.

Reply in this EXACT format. Do not omit the Leaf Health & Discoloration Report.

## 🍃 Leaf Health & Discoloration Report

**Overall Plant Health:** [Healthy / Mostly Healthy / Mild Stress / Moderate Stress / Severe Stress / Unable to Assess] — [one-sentence explanation]

**Discoloration Alert:** [None Detected / Mild / Moderate / Severe / Unable to Assess]

**Observed Leaf Colors:** [list visible colors and clearly state whether lighting may affect them]

**Pattern and Location:** [where and how discoloration appears]

**Estimated Visible Area Affected:** [rough percentage or Unable to Estimate]

**Likely Discoloration Causes:**
- [Most likely cause + visual reason]
- [Second possible cause + visual reason]
- [Third possible cause + visual reason]

## 🔬 Pest, Disease & Deficiency Assessment

**Likely Condition:** [condition name, general stress, or No clear pest/disease sign]

**Top 3 Possible Causes:**
- [Cause 1 + one sentence why]
- [Cause 2 + one sentence why]
- [Cause 3 + one sentence why]

**Symptoms Observed:** [2-3 concise sentences describing only visible evidence]

**Image Quality:** [one sentence on focus, lighting, color reliability, leaf coverage, and zoom]

**Urgency:** [Low / Moderate / High / Critical] — [one sentence reason]

**Top Action:** [single most important immediate action]

**Field Checks:**
- [specific check 1]
- [specific check 2]
- [specific check 3]

⚠️ AI-assisted image assessment only. Verify discoloration, pests, disease, and nutrient status through field scouting, soil/plant testing when appropriate, or a local agricultural technician before treatment.

---PALADIN_DATA---
{
  "diagnosis": "[condition name]",
  "confidence": [0-100],
  "plant_health_score": [0-100, where 100 means visually healthy],
  "discoloration_detected": [true or false],
  "discoloration_severity": [0-100, where 100 means severe visible discoloration],
  "discoloration_level": "[None / Mild / Moderate / Severe / Unable to Assess]",
  "discoloration_colors": ["color 1", "color 2"],
  "discoloration_pattern": "[short pattern and location]",
  "affected_area_estimate_percent": [0-100 or null],
  "likely_stress_category": "[Healthy / Nutrient / Pest / Disease / Water / Chemical / Weather / Mixed / Uncertain]",
  "outbreak_potential": [0-100],
  "urgency_score": [0-100],
  "causes": ["Cause 1", "Cause 2", "Cause 3"],
  "image_quality": [0-100]
}
---END_DATA---"""


@app.post("/api/paladin/vision")
async def paladin_vision(
    file: UploadFile = File(...),
    message: str = Form(default=""),
    context_json: str = Form(default="{}"),
):
    """
    PALADIN image diagnosis endpoint.
    Accepts a rice plant/leaf image, runs LLM vision analysis.
    """
    if not LLM_API_KEY:
        return {"ok": False, "reply": "⚠️ PALADIN API key is not configured. Run CONFIGURE_PALADIN_API_KEY.bat, then place your Gemini key in backend/.env as LLM_API_KEY=YOUR_KEY."}

    try:
        # Validate file type
        content_type = file.content_type or ""
        if content_type not in ALLOWED_IMAGE_TYPES:
            return {"ok": False, "reply": f"❌ Unsupported image type: {content_type}. Please upload PNG, JPG, WEBP, or GIF."}

        # Read and size-check
        image_bytes = await file.read()
        if len(image_bytes) > MAX_IMAGE_BYTES:
            return {"ok": False, "reply": f"❌ Image too large ({len(image_bytes)//1024//1024}MB). Maximum allowed is 12MB."}

        # Base64 encode
        b64_data = base64.standard_b64encode(image_bytes).decode("utf-8")
        media_type = content_type if content_type != "image/jpg" else "image/jpeg"

        # Parse context
        try:
            ctx = json.loads(context_json) if context_json else {}
        except Exception:
            ctx = {}

        ctx_summary = summarize_palai_context(ctx)

        # Build user message content
        user_text = IMAGE_DIAGNOSIS_PROMPT
        if ctx_summary != "No PAL-AI context currently available.":
            user_text += f"\n\n## PAL-AI Dashboard Context\n{ctx_summary}"
        if message.strip():
            user_text += f"\n\nFarmer's note: {message.strip()}"

        # Build LLM vision message
        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": user_text,
                    },
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": b64_data,
                        },
                    },
                ],
            }
        ]

        # Check if model supports vision (claude-sonnet/opus/haiku 3+ do)
        reply = _call_llm(messages, max_tokens=3000)

        # Append combined score note if pest risk exists
        if ctx.get("pest_risk"):
            pr = ctx["pest_risk"]
            overall = pr.get("overall_risk_score", None)
            if overall is not None:
                reply += (
                    f"\n\n---\n**📊 Combined Context Note:** Your PAL-AI Pest Risk system shows an overall "
                    f"risk score of **{overall}/100** ({pr.get('overall_risk_level', 'N/A')}) for "
                    f"{pr.get('likely_pest', 'the top pest')}. Cross-reference this with the image-based "
                    f"outbreak potential above for a more complete picture. Field verification is still required."
                )

        return {"ok": True, "reply": reply}

    except ValueError as e:
        return {"ok": False, "reply": str(e)}
    except Exception as e:
        return {"ok": False, "reply": f"PALADIN vision error: {str(e)}"}


@app.post("/api/pest-risk")
def post_pest_risk(req: PestRiskRequest):
    """
    Bayesian-Spatiotemporal Pest Outbreak Detection.

    Estimates outbreak risk for 8 major rice pests/diseases using:
    - Climate suitability scoring (temperature, humidity, precipitation, dew point, wind)
    - Bayesian prior + seasonal + crop stage modifiers
    - Monte Carlo uncertainty simulation (300 runs) for credible intervals
    - Optional terrain score, water risk score, and spatiotemporal indices
    - Returns pest-specific risk cards, recommendations, and scouting checklist
    """
    if req.region_id not in REGIONS:
        raise HTTPException(
            status_code=404, detail=f"Region {req.region_id} not found.")
    try:
        result = _compute_pest_risk_response(req)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
