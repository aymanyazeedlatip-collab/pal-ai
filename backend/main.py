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

from typing import Optional, List, Any
import io
import os
import json
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

LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "claude-sonnet-4-20250514")

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
app = FastAPI(
    title="PAL-AI API",
    description="Predictive Rice Agriculture using Layered Artificial Intelligence",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:5500",
        "https://YOUR-VERCEL-FRONTEND-URL.vercel.app"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
    return {"status": "ok", "model_loaded": model_ok, "version": "1.0.0"}


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

                if results:
                    collected.extend(results)
                    collected = dedupe_results(collected)

                    return {
                        "ok": True,
                        "count": len(collected),
                        "waterBodies": collected[:180],
                        "source": endpoint,
                        "plan": plan["label"],
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

    return {
        "ok": True,
        "count": 0,
        "waterBodies": [],
        "source": None,
        "plan": None,
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
        pred = float(model.predict(X)[0])
        pred = max(0.0, pred)
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
                pred = max(0.0, float(model.predict(X)[0]))
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
- When analyzing images, use careful AI-assisted language — never say "confirmed disease."
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
    """Call Gemini API (free, no credit card). Returns reply text or raises."""
    if not LLM_API_KEY:
        raise ValueError(
            "PALADIN LLM API key is not configured. Add LLM_API_KEY to your .env file.")

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

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{LLM_MODEL}:generateContent?key={LLM_API_KEY}"
    resp = requests.post(url, json=payload, timeout=60)
    resp.raise_for_status()
    data = resp.json()

    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        return "PALADIN could not generate a response. Please try again."


@app.post("/api/paladin/chat")
def paladin_chat(req: PaladinChatRequest):
    """
    PALADIN text chat endpoint.
    Receives message + PAL-AI context + recent conversation history.
    Returns LLM-generated farming advice.
    """
    if not LLM_API_KEY:
        return {"ok": False, "reply": "⚠️ PALADIN LLM API key is not configured. Please add LLM_API_KEY to your backend .env file."}

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

IMAGE_DIAGNOSIS_PROMPT = """Analyze this rice plant image. Reply in this EXACT compact format. Do not add extra sections.

## 🔬 AI Diagnosis

**Likely Condition:** [name the disease/pest/deficiency in one line]

**Top 3 Possible Causes:**
- [Cause 1 + one sentence why]
- [Cause 2 + one sentence why]
- [Cause 3 + one sentence why]

**Symptoms Observed:** [2-3 sentences describing what you see]

**Image Quality:** [one sentence on focus/lighting/zoom]

**Urgency:** [Low / Moderate / High / Critical] — [one sentence reason]

**Top Action:** [single most important thing the farmer should do right now]

⚠️ AI-assisted only. Field verification required before any treatment.

---PALADIN_DATA---
{
  "diagnosis": "[condition name]",
  "confidence": [0-100],
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
        return {"ok": False, "reply": "⚠️ PALADIN LLM API key is not configured. Please add LLM_API_KEY to your backend .env file."}

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
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": b64_data,
                        },
                    },
                    {
                        "type": "text",
                        "text": user_text,
                    },
                ],
            }
        ]

        # Check if model supports vision (claude-sonnet/opus/haiku 3+ do)
        reply = _call_llm(messages, max_tokens=2048)

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
