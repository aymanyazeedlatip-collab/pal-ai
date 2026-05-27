/* ════════════════════════════════════════
   PAL-AI — app.js  (v2)
   Main application logic
   ════════════════════════════════════════ */

const API = 'http://localhost:8000';

// ── Chart instances ──
let annualChart = null;
let quarterlyChart = null;
let climateChart = null;
let popupChart = null;
let terrainProfileChart = null;

// Graphs for Pest Detection
let pestRankingChart = null;
let pestIntervalChart = null;
let pestFactorChart = null;
let pestSeasonChart = null;
let pestYieldGaugeChart = null;

// ── State ──
let forecastData = null;
let forecastMap = null;
let forecastMarker = null;
let geoMap = null;
let terrainMiniMap = null;
let terrainMiniMarker = null;
let terrainMiniRect = null;

let pestMiniMap = null;
let pestMiniMarker = null;
let pestMiniRect = null;
let pestHeatOverlay = null;

let currentRegionId = null;
let lastForecastLat = null;
let lastForecastLng = null;
let waterAnalyzerRunId = 0;
let waterAnalyzerAbortController = null;
const REGIONS_CACHE = {}; // Populated by loadRegions

// ── Pest Risk module state ──
let pestRiskData = null;
let latestTerrainScores = null;
let latestTerrainLocation = null;
let latestSpatiotemporalData = null;
let latestFertilizerAnalysis = null;

// ── Rice Facts for loading screen ──
const RICE_FACTS = [
  "🌾 The Philippines is the 8th largest rice producer in the world.",
  "💧 Rice paddies can hold 3–4 times more carbon than upland soils.",
  "🌡️ Every 1°C rise in night temperature reduces rice yield by about 10%.",
  "🧬 There are over 40,000 varieties of rice in the world.",
  "📅 Filipino farmers plant rice twice a year — Dry Season and Wet Season.",
  "🤖 XGBoost stands for Extreme Gradient Boosting — a powerful AI method.",
  "🌍 About half the world's population eats rice as a staple food.",
  "🏔️ Terraced rice fields in Ifugao, Philippines are over 2,000 years old.",
  "💚 Hybrid rice can yield up to 20% more than traditional inbred varieties.",
  "☀️ Rice needs 8–10 hours of sunlight per day for optimal growth.",
  "🌧️ The ideal rainfall for rice is 1,200–1,500mm per year.",
  "⚗️ Rice provides 20% of the world's dietary energy supply.",
  "🌱 A single rice plant produces 150–400 grains per panicle.",
  "📊 Average Philippine rice yield is about 3.9 metric tons per hectare.",
  "🔬 IRRI (International Rice Research Institute) is based in Los Baños, Laguna.",
];

// Navigation Panel Sidebar
function switchTab(tabName) {
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const section = document.getElementById(`tab-${tabName}`);
  if (section) section.classList.add('active');

  const btn = document.querySelector(`[data-tab="${tabName}"]`);
  if (btn) btn.classList.add('active');

  // Close sidebar only on mobile after clicking a navigation item.
  if (window.innerWidth <= 860) {
    closeSidebar();
  }

  // Lazy-init and resize maps when their tabs become visible.
  if (tabName === 'home') {
    setTimeout(() => {
      if (!geoMap) {
        initGeoMap();
      } else {
        geoMap.invalidateSize();
      }
    }, 150);
  }

  if (tabName === 'forecast') {
    setTimeout(() => {
      if (!forecastMap) initForecastMap();
      if (forecastMap) forecastMap.invalidateSize();
    }, 200);
  }
  if (tabName === 'pest') {
    setTimeout(() => {
      if (pestMiniMap) {
        pestMiniMap.invalidateSize();
      }
    }, 250);
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  if (!sidebar) return;

  if (window.innerWidth <= 860) {
    sidebar.classList.toggle('open');

    if (overlay) {
      overlay.classList.toggle('show', sidebar.classList.contains('open'));
    }
  } else {
    document.body.classList.toggle('sidebar-collapsed');
  }
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('show');
}

// Keep old function name just in case anything still calls it.
function toggleMobileNav() {
  toggleSidebar();
}

// Navbar scroll shadow
window.addEventListener('scroll', () => {
  const navbar = document.getElementById('navbar');
  if (navbar) {
    navbar.classList.toggle('scrolled', window.scrollY > 10);
  }
});

// ── Loading Screen ──
let loadInterval = null;
let loadHideTimer = null;

function showLoading(title = "Generating Your Forecasts") {
  const overlay = document.getElementById('loading-overlay');
  const bar = document.getElementById('load-progress');
  const factEl = document.getElementById('load-fact');
  const titleEl = document.querySelector('.load-title');

  if (!overlay || !bar || !factEl) return;

  clearInterval(loadInterval);
  clearTimeout(loadHideTimer);

  overlay.classList.remove('hidden');

  if (titleEl) titleEl.textContent = title;

  let progress = 0;
  bar.style.width = '0%';
  factEl.textContent = RICE_FACTS[Math.floor(Math.random() * RICE_FACTS.length)];

  loadInterval = setInterval(() => {
    progress = Math.min(progress + Math.random() * 12, 90);
    bar.style.width = progress + '%';

    if (progress > 45 && Math.random() > 0.65) {
      factEl.textContent = RICE_FACTS[Math.floor(Math.random() * RICE_FACTS.length)];
    }
  }, 600);
}

function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  const bar = document.getElementById('load-progress');

  clearInterval(loadInterval);
  clearTimeout(loadHideTimer);
  loadInterval = null;

  if (!overlay || !bar) return;

  bar.style.width = '100%';

  loadHideTimer = setTimeout(() => {
    overlay.classList.add('hidden');
    bar.style.width = '0%';
  }, 350);
}

function forceHideLoading() {
  clearInterval(loadInterval);
  clearTimeout(loadHideTimer);
  loadInterval = null;

  const overlay = document.getElementById('loading-overlay');
  const bar = document.getElementById('load-progress');

  if (overlay) overlay.classList.add('hidden');
  if (bar) bar.style.width = '0%';
}

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  if (window.Chart && window['chartjs-plugin-zoom']) {
    Chart.register(window['chartjs-plugin-zoom']);
  }

  await loadRegions();
  initGeoMap();

  const pestHeatmapKmInput = document.getElementById('pest-heatmap-km');

  if (pestHeatmapKmInput) {
    pestHeatmapKmInput.addEventListener('input', () => {
      redrawPestHeatmapVisuals();
    });

    pestHeatmapKmInput.addEventListener('change', () => {
      redrawPestHeatmapVisuals();
    });
  }
  // Recover canvases, charts, Leaflet maps, and WebGL after tab sleep / browser idle.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (window.Terrain && typeof Terrain.pauseRenderer === 'function') {
        Terrain.pauseRenderer();
      }
    } else {
      schedulePALAIVisualRecovery('tab-visible');
    }
  });

  window.addEventListener('focus', () => {
    schedulePALAIVisualRecovery('window-focus');
  });

  window.addEventListener('pageshow', () => {
    schedulePALAIVisualRecovery('page-show');
  });

  window.addEventListener('resize', () => {
    schedulePALAIVisualRecovery('window-resize');
  });

  // Safety refresh after long idle periods.
  setInterval(() => {
    if (!document.hidden) {
      schedulePALAIVisualRecovery('periodic-refresh');
    }
  }, 90000);
});

// ── Load Regions from API ──
async function loadRegions() {
  try {
    const res = await fetch(`${API}/api/regions`);
    const regions = await res.json();
    regions.forEach(r => { REGIONS_CACHE[r.id] = r.name; });
    ['region-select', 'calc-region', 'pest-region'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      regions.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = r.name;
        el.appendChild(opt);
      });
    });
  } catch (e) {
    // Fallback from geo-data.js
    populateRegionsFallback();
  }
}

function populateRegionsFallback() {
  ['region-select', 'calc-region', 'pest-region'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    Object.entries(PH_GEO).forEach(([id2, r]) => {
      const opt = document.createElement('option');
      opt.value = id2;
      opt.textContent = r.name;
      el.appendChild(opt);
    });
  });
}

// ════════════════════════════════════════
// FORECAST MAP (Leaflet – draggable pin)
// ════════════════════════════════════════
function initForecastMap() {
  const el = document.getElementById('forecast-map');
  if (!el || forecastMap) return;

  forecastMap = L.map('forecast-map', { zoomControl: true }).setView([12.0, 122.0], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 18
  }).addTo(forecastMap);

  // Custom green marker icon
  const greenIcon = L.divIcon({
    className: '',
    html: `<div style="background:#84cc16;border:3px solid #65a30d;border-radius:50% 50% 50% 0;width:28px;height:28px;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(0,0,0,.3)"><div style="transform:rotate(45deg);width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:12px">📍</div></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
  });

  forecastMarker = L.marker([12.0, 122.0], { draggable: true, icon: greenIcon }).addTo(forecastMap);

  forecastMarker.on('dragend', function (e) {
    const { lat, lng } = e.target.getLatLng();
    lastForecastLat = lat;
    lastForecastLng = lng;
    snapMarkerToRegion(lat, lng);
  });

  forecastMap.on('click', function (e) {
    forecastMarker.setLatLng(e.latlng);
    lastForecastLat = e.latlng.lat;
    lastForecastLng = e.latlng.lng;
    snapMarkerToRegion(e.latlng.lat, e.latlng.lng);
  });
  // Force Leaflet to render all tiles correctly after container becomes visible.
  setTimeout(() => {
    forecastMap.invalidateSize();
  }, 300);
}

function snapMarkerToRegion(lat, lng) {
  const region = coordsToRegion(lat, lng);
  if (region) {
    // Save exact coords FIRST so onRegionChange won't snap the marker to region center
    lastForecastLat = lat;
    lastForecastLng = lng;
    const sel = document.getElementById('region-select');
    sel.value = region.id;
    onRegionChange();
    showGpsStatus(`📍 Map pin set → ${PH_GEO[region.id]?.name || region.name}`, 'success');
  }
}

// ════════════════════════════════════════
// GEO MAP (Leaflet – home dashboard)
// ════════════════════════════════════════

// Historical average yield per region (from rice_data.csv averages)
const REGION_YIELD_AVERAGES = {
  1: 1.22,
  2: 0.87,
  3: 1.31,
  4: 0.32,
  5: 1.04,
  6: 1.28,
  7: 1.28,
  8: 1.65,
  9: 2.10,
  10: 2.91,
  11: 2.26,
  12: 0.68,
  13: 2.19,
  14: 1.02,
  15: 1.24,
  16: 1.45
};

const REGION_CLIMATE_AVGS = {
  1: { temp: 27.1, humidity: 73, precip: 2.1, wind: 6.8, dew: 20.9 },
  2: { temp: 24.8, humidity: 82, precip: 7.8, wind: 3.6, dew: 20.2 },
  3: { temp: 24.8, humidity: 85, precip: 3.1, wind: 9.9, dew: 21.3 },
  4: { temp: 26.6, humidity: 83, precip: 5.0, wind: 7.7, dew: 22.5 },
  5: { temp: 27.5, humidity: 80, precip: 3.5, wind: 8.0, dew: 22.0 },
  6: { temp: 27.3, humidity: 79, precip: 3.1, wind: 13.3, dew: 22.4 },
  7: { temp: 27.9, humidity: 81, precip: 2.8, wind: 8.9, dew: 22.5 },
  8: { temp: 28.3, humidity: 76, precip: 2.9, wind: 15.1, dew: 22.8 },
  9: { temp: 27.8, humidity: 77, precip: 2.7, wind: 11.9, dew: 23.2 },
  10: { temp: 28.3, humidity: 79, precip: 3.6, wind: 14.5, dew: 23.5 },
  11: { temp: 30.5, humidity: 79, precip: 4.1, wind: 5.6, dew: 22.9 },
  12: { temp: 27.7, humidity: 81, precip: 6.1, wind: 10.0, dew: 21.9 },
  13: { temp: 31.5, humidity: 82, precip: 2.9, wind: 4.6, dew: 22.4 },
  14: { temp: 24.8, humidity: 82, precip: 8.6, wind: 3.6, dew: 20.5 },
  15: { temp: 27.2, humidity: 75, precip: 4.0, wind: 6.3, dew: 21.0 },
  16: { temp: 23.7, humidity: 88, precip: 8.9, wind: 4.9, dew: 20.4 },
};

function getYieldColor(yld) {
  // red < 0.8, yellow 0.8–1.8, green > 1.8
  if (yld < 0.8) return '#ef4444';
  if (yld < 1.2) return '#f97316';
  if (yld < 1.8) return '#eab308';
  if (yld < 2.5) return '#84cc16';
  return '#16a34a';
}

function initGeoMap() {
  const el = document.getElementById('geo-map');
  if (!el || geoMap) return;

  geoMap = L.map('geo-map', { zoomControl: true, scrollWheelZoom: false }).setView([12.0, 122.0], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 18, opacity: 0.5
  }).addTo(geoMap);

  // Add region markers
  Object.entries(REGION_COORDS).forEach(([rid, coords]) => {
    const id = parseInt(rid);
    const yld = REGION_YIELD_AVERAGES[id] || 1.0;
    const color = getYieldColor(yld);
    const regionInfo = PH_GEO[id];

    const icon = L.divIcon({
      className: '',
      html: `<div style="
        background:${color};border:3px solid white;border-radius:50%;
        width:36px;height:36px;display:flex;align-items:center;justify-content:center;
        font-family:'Syne',sans-serif;font-weight:800;font-size:11px;color:white;
        box-shadow:0 2px 8px rgba(0,0,0,.35);cursor:pointer;
        transition:transform .2s;
      " onmouseenter="this.style.transform='scale(1.2)'" onmouseleave="this.style.transform='scale(1)'">
        ${yld.toFixed(1)}
      </div>`,
      iconSize: [36, 36], iconAnchor: [18, 18],
    });

    const marker = L.marker(coords, { icon }).addTo(geoMap);
    marker.on('click', () => openRegionPopup(id));
  });
}

let popupChartInstance = null;

function openRegionPopup(regionId) {
  const popup = document.getElementById('region-popup');
  const regionInfo = PH_GEO[regionId];
  const yld = REGION_YIELD_AVERAGES[regionId] || 1.0;
  const climate = REGION_CLIMATE_AVGS[regionId] || {};

  document.getElementById('popup-badge').textContent = `Region ${regionId}`;
  document.getElementById('popup-title').textContent = regionInfo?.name || `Region ${regionId}`;

  // Climate grid
  const climateGrid = document.getElementById('popup-climate');
  climateGrid.innerHTML = `
    <div class="popup-climate-item"><div class="pci-val">${climate.temp?.toFixed(1)}°C</div><div class="pci-lbl">Avg Temp</div></div>
    <div class="popup-climate-item"><div class="pci-val">${climate.humidity}%</div><div class="pci-lbl">Humidity</div></div>
    <div class="popup-climate-item"><div class="pci-val">${climate.precip?.toFixed(1)}mm</div><div class="pci-lbl">Precip</div></div>
    <div class="popup-climate-item"><div class="pci-val">${climate.wind?.toFixed(1)}</div><div class="pci-lbl">Wind km/h</div></div>
    <div class="popup-climate-item"><div class="pci-val">${climate.dew?.toFixed(1)}°C</div><div class="pci-lbl">Dew Point</div></div>
    <div class="popup-climate-item"><div class="pci-val">${yld.toFixed(2)}</div><div class="pci-lbl">t/ha avg</div></div>
  `;

  // Mini forecast chart (synthetic data for popup demo)
  if (popupChartInstance) popupChartInstance.destroy();
  const ctx = document.getElementById('popup-chart').getContext('2d');

  // Generate a simple projected trend line
  const histYears = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
  const baseYield = yld;
  const trend = (Math.random() - 0.3) * 0.005;
  const histData = histYears.map((y, i) => ({ x: y, y: +(baseYield + (Math.random() - 0.5) * 0.3).toFixed(3) }));
  const futureYears = [2030, 2040, 2050, 2060, 2070, 2080, 2090, 2100];
  const futureData = futureYears.map((y, i) => ({ x: y, y: +(baseYield + trend * (y - 2025) + (Math.random() - 0.5) * 0.1).toFixed(3) }));

  popupChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        { label: 'Historical', data: histData, borderColor: '#0ea5e9', borderWidth: 2, pointRadius: 2, tension: 0.3, fill: false },
        { label: 'Forecast', data: futureData, borderColor: '#84cc16', borderWidth: 2, borderDash: [5, 3], pointRadius: 2, tension: 0.3, fill: false },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { font: { size: 10 }, padding: 8 } } },
      scales: {
        x: { type: 'linear', ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { color: '#f1f5f9' } },
        y: { ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { color: '#f1f5f9' } }
      }
    }
  });

  // CTA button
  document.getElementById('popup-cta-btn').onclick = () => {
    closeRegionPopup();
    document.getElementById('region-select').value = regionId;
    onRegionChange();
    switchTab('forecast');
  };

  popup.classList.remove('hidden');
}

function closeRegionPopup() {
  document.getElementById('region-popup').classList.add('hidden');
}

// ════════════════════════════════════════
// GPS
// ════════════════════════════════════════
function detectLocation() {
  const btn = document.getElementById('gps-btn');
  if (!navigator.geolocation) {
    showGpsStatus('❌ Geolocation is not supported by your browser.', 'error');
    return;
  }
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span> Detecting location...';
  showGpsStatus('📡 Requesting your location...', 'loading');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      btn.disabled = false;
      btn.innerHTML = '<span class="btn-icon">🛰️</span> Detect My Location Automatically';

      // Update forecast map pin
      if (forecastMap && forecastMarker) {
        forecastMarker.setLatLng([lat, lng]);
        forecastMap.setView([lat, lng], 10);
      }
      lastForecastLat = lat;
      lastForecastLng = lng;

      // Pre-fill terrain coords
      document.getElementById('terrain-lat').value = lat.toFixed(4);
      document.getElementById('terrain-lng').value = lng.toFixed(4);

      const region = coordsToRegion(lat, lng);
      if (region) {
        document.getElementById('region-select').value = region.id;
        onRegionChange();
        showGpsStatus(`✅ Location detected! (${lat.toFixed(4)}, ${lng.toFixed(4)}) → ${PH_GEO[region.id]?.name || region.name}`, 'success');
      } else {
        showGpsStatus(`📍 Location found (${lat.toFixed(4)}, ${lng.toFixed(4)}) but could not match a region. Please select manually.`, 'error');
      }
    },
    (err) => {
      btn.disabled = false;
      btn.innerHTML = '<span class="btn-icon">🛰️</span> Detect My Location Automatically';
      const msg = err.code === 1
        ? '❌ Location access denied. Please select your region manually.'
        : '❌ Could not get location. Please try manually.';
      showGpsStatus(msg, 'error');
    },
    { timeout: 15000, maximumAge: 0, enableHighAccuracy: true }
  );
}

function coordsToRegion(lat, lng) {
  for (const r of REGION_BOUNDS) {
    if (lat >= r.lat[0] && lat <= r.lat[1] && lng >= r.lng[0] && lng <= r.lng[1]) return r;
  }
  let best = null, bestDist = Infinity;
  for (const r of REGION_BOUNDS) {
    const cLat = (r.lat[0] + r.lat[1]) / 2;
    const cLng = (r.lng[0] + r.lng[1]) / 2;
    const d = Math.hypot(lat - cLat, lng - cLng);
    if (d < bestDist) { bestDist = d; best = r; }
  }
  return bestDist < 2 ? best : null;
}

function showGpsStatus(msg, type) {
  const el = document.getElementById('gps-status');
  el.textContent = msg;
  el.className = `gps-status ${type}`;
  el.classList.remove('hidden');
}

// ════════════════════════════════════════
// CASCADING DROPDOWNS
// ════════════════════════════════════════
async function onRegionChange() {
  const regionId = document.getElementById('region-select').value;
  currentRegionId = parseInt(regionId);
  document.getElementById('forecast-btn').disabled = !regionId;

  const provSel = document.getElementById('province-select');
  const munSel = document.getElementById('municipality-select');
  const barSel = document.getElementById('barangay-select');

  provSel.innerHTML = '<option value="">— Select Province —</option>';
  munSel.innerHTML = '<option value="">— Select Municipality / City —</option>';
  barSel.innerHTML = '<option value="">— Select Barangay —</option>';

  provSel.disabled = true;
  munSel.disabled = true;
  barSel.disabled = true;

  if (!regionId) return;

  try {
    const res = await fetch(`${API}/api/locations/provinces/${regionId}`);
    if (!res.ok) throw new Error(`Could not load provinces: ${res.status}`);

    const provinces = await res.json();

    provinces.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.code;
      opt.textContent = p.name;
      provSel.appendChild(opt);
    });

    provSel.disabled = false;

    // Pan forecast map to region center only if user has not placed a custom pin yet.
    // If lastForecastLat/Lng is set, the user dragged or clicked the map — keep their pin.
    if (forecastMap && REGION_COORDS[regionId]) {
      if (!lastForecastLat || !lastForecastLng) {
        forecastMap.setView(REGION_COORDS[regionId], 9);
        if (forecastMarker) forecastMarker.setLatLng(REGION_COORDS[regionId]);
      } else {
        forecastMap.setView([lastForecastLat, lastForecastLng], 10);
      }
    }

  } catch (err) {
    console.error(err);
    alert("Failed to load official province list. Check backend and internet connection.");
  }
}

async function onProvinceChange() {
  const provinceCode = document.getElementById('province-select').value;
  const munSel = document.getElementById('municipality-select');
  const barSel = document.getElementById('barangay-select');

  munSel.innerHTML = '<option value="">— Select Municipality / City —</option>';
  barSel.innerHTML = '<option value="">— Select Barangay —</option>';

  munSel.disabled = true;
  barSel.disabled = true;

  if (!provinceCode) return;

  try {
    const res = await fetch(`${API}/api/locations/municipalities/${provinceCode}`);
    if (!res.ok) throw new Error(`Could not load municipalities: ${res.status}`);

    const municipalities = await res.json();

    municipalities.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.code;
      opt.textContent = m.name;
      munSel.appendChild(opt);
    });

    munSel.disabled = false;

  } catch (err) {
    console.error(err);
    alert("Failed to load official city/municipality list.");
  }
}

async function onMunicipalityChange() {
  const cityMunicipalityCode = document.getElementById('municipality-select').value;
  const barSel = document.getElementById('barangay-select');

  barSel.innerHTML = '<option value="">— Select Barangay —</option>';
  barSel.disabled = true;

  if (!cityMunicipalityCode) return;

  try {
    const res = await fetch(`${API}/api/locations/barangays/${cityMunicipalityCode}`);
    if (!res.ok) throw new Error(`Could not load barangays: ${res.status}`);

    const barangays = await res.json();

    barangays.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.code;
      opt.textContent = b.name;
      barSel.appendChild(opt);
    });

    barSel.disabled = false;

  } catch (err) {
    console.error(err);
    alert("Failed to load official barangay list.");
  }
}

// ════════════════════════════════════════
// FORECAST
// ════════════════════════════════════════

function getSelectedText(selectId) {
  const el = document.getElementById(selectId);
  if (!el || el.selectedIndex < 0) return '';

  const text = el.options[el.selectedIndex].textContent;
  return text.startsWith('—') ? '' : text;
}

async function runForecast() {
  const regionId = document.getElementById('region-select').value;
  if (!regionId) return;

  const province = getSelectedText('province-select');
  const municipality = getSelectedText('municipality-select');
  const barangay = getSelectedText('barangay-select');
  const hectares = parseFloat(document.getElementById('hectare-input').value) || null;
  const cropType = document.getElementById('crop-type-select').value;

  showLoading();
  document.getElementById('results-section').classList.add('hidden');
  document.getElementById('forecast-btn').disabled = true;

  try {
    const res = await fetch(`${API}/api/forecast/${regionId}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();
    forecastData = data;
    renderResults(data, province, municipality, barangay, hectares, cropType);
  } catch (e) {
    alert(`Error fetching forecast: ${e.message}\n\nMake sure the backend is running:\nuvicorn main:app --reload`);
  } finally {
    hideLoading();
    document.getElementById('forecast-btn').disabled = false;
  }
}

function renderResults(data, province, municipality, barangay, hectares, cropType) {
  document.getElementById('results-region-name').textContent = data.region_name;
  const parts = [province, municipality, barangay].filter(Boolean);
  document.getElementById('results-location-detail').textContent = parts.length ? parts.join(', ') : '';

  const histAvg = avg(data.historical.map(r => r.yield));
  const row2050 = data.annual.find(r => r.year === 2050);
  const row2100 = data.annual.find(r => r.year === 2100);

  document.getElementById('sum-hist-avg').textContent = histAvg.toFixed(3);
  document.getElementById('sum-2050').textContent = row2050 ? row2050.yield.toFixed(3) : '—';
  document.getElementById('sum-2100').textContent = row2100 ? row2100.yield.toFixed(3) : '—';

  const firstFc = data.annual[0]?.yield ?? 0;
  const lastFc = row2100?.yield ?? 0;
  const diff = lastFc - firstFc;
  document.getElementById('sum-trend').textContent =
    diff > 0.05 ? '📈 Increasing' : diff < -0.05 ? '📉 Decreasing' : '➡️ Stable';

  // Hectare total
  const totalCard = document.getElementById('sum-total-card');
  if (hectares && row2050) {
    const total = (row2050.yield * hectares).toFixed(2);
    document.getElementById('sum-total').textContent = total;
    document.getElementById('sum-total-unit').textContent = `t total (${hectares} ha × ${row2050.yield.toFixed(3)} t/ha)`;
    totalCard.style.display = '';
  } else {
    totalCard.style.display = 'none';
  }

  drawAnnualChart(data);
  drawQuarterlyChart(data);
  drawClimateChart(data, 'temperature');

  document.getElementById('results-section').classList.remove('hidden');
  document.getElementById('results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ════════════════════════════════════════
// CHARTS (Forecast)
// ════════════════════════════════════════
function drawAnnualChart(data) {
  if (annualChart) annualChart.destroy();
  const histYears = data.historical.map(r => r.year);
  const histYields = data.historical.map(r => r.yield);
  const fcYears = data.annual.map(r => r.year);
  const fcYields = data.annual.map(r => r.yield);
  const ctx = document.getElementById('annualChart').getContext('2d');
  annualChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        { label: 'Historical Yield', data: histYears.map((y, i) => ({ x: y, y: histYields[i] })), borderColor: '#0ea5e9', backgroundColor: 'rgba(14,165,233,.08)', borderWidth: 2.5, pointRadius: 4, tension: 0.3, fill: true },
        { label: 'Forecast Yield', data: fcYears.map((y, i) => ({ x: y, y: fcYields[i] })), borderColor: '#84cc16', backgroundColor: 'rgba(132,204,22,.06)', borderWidth: 2, borderDash: [6, 3], pointRadius: 2, tension: 0.3, fill: true },
      ]
    },
    options: chartOptions('Year', 'Yield (t/ha)', true),
  });
}

function drawQuarterlyChart(data) {
  if (quarterlyChart) quarterlyChart.destroy();
  const qColors = ['#84cc16', '#0ea5e9', '#f59e0b', '#a855f7'];
  const qLabels = ['Q1 (Jan-Mar)', 'Q2 (Apr-Jun)', 'Q3 (Jul-Sep)', 'Q4 (Oct-Dec)'];
  const datasets = [1, 2, 3, 4].map((q, i) => {
    const rows = data.quarterly.filter(r => r.quarter === q || r.quarter === String(q));
    return { label: qLabels[i], data: rows.map(r => ({ x: r.year, y: r.yield })), borderColor: qColors[i], borderWidth: 1.5, pointRadius: 1, tension: 0.3, fill: false };
  });
  const ctx = document.getElementById('quarterlyChart').getContext('2d');
  quarterlyChart = new Chart(ctx, { type: 'line', data: { datasets }, options: chartOptions('Year', 'Yield (t/ha)', true) });
}

function drawClimateChart(data, variable) {
  if (climateChart) climateChart.destroy();
  const proj = data.climate_projections;
  const labelMap = { temperature: 'Temperature (°C)', dew_point: 'Dew Point (°C)', precipitation: 'Precipitation (mm)', wind_speed: 'Wind Speed (km/h)', humidity: 'Humidity (%)' };
  const ctx = document.getElementById('climateChart').getContext('2d');
  climateChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{ label: labelMap[variable], data: proj.years.map((y, i) => ({ x: y, y: proj[variable][i] })), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,.08)', borderWidth: 2, pointRadius: 1.5, tension: 0.3, fill: true }]
    },
    options: chartOptions('Year', labelMap[variable], true),
  });
}

function updateClimateChart() {
  if (!forecastData) return;
  drawClimateChart(forecastData, document.getElementById('climate-var-select').value);
}

function chartOptions(xLabel, yLabel, zoomable) {
  const opts = {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top', labels: { font: { size: 12 }, padding: 16, usePointStyle: true } },
      tooltip: { backgroundColor: '#0f172a', titleFont: { size: 12 }, bodyFont: { size: 12 }, padding: 10, cornerRadius: 8, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(4)}` } },
    },
    scales: {
      x: { type: 'linear', title: { display: true, text: xLabel, color: '#64748b', font: { size: 11 } }, grid: { color: '#f1f5f9' }, ticks: { color: '#94a3b8', font: { size: 11 } } },
      y: { title: { display: true, text: yLabel, color: '#64748b', font: { size: 11 } }, grid: { color: '#f1f5f9' }, ticks: { color: '#94a3b8', font: { size: 11 } } }
    }
  };
  if (zoomable && window['chartjs-plugin-zoom']) {
    opts.plugins.zoom = { pan: { enabled: true, mode: 'xy' }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' } };
  }
  return opts;
}

function resetZoom(chartId) {
  const map = { annualChart, quarterlyChart, climateChart };
  map[chartId]?.resetZoom?.();
}

function switchChartTab(name, btn) {
  document.querySelectorAll('.chart-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`panel-${name}`).classList.add('active');
  btn.classList.add('active');
}

// ════════════════════════════════════════
// TERRAIN ANALYSIS
// ════════════════════════════════════════
function useForecastLocation() {
  if (lastForecastLat && lastForecastLng) {
    document.getElementById('terrain-lat').value = lastForecastLat.toFixed(4);
    document.getElementById('terrain-lng').value = lastForecastLng.toFixed(4);
    showTerrainStatus('📍 Forecast location loaded!', 'success');
  } else if (currentRegionId && REGION_COORDS[currentRegionId]) {
    const [lat, lng] = REGION_COORDS[currentRegionId];
    document.getElementById('terrain-lat').value = lat.toFixed(4);
    document.getElementById('terrain-lng').value = lng.toFixed(4);
    showTerrainStatus(`📍 Using center of ${PH_GEO[currentRegionId]?.name}`, 'success');
  } else {
    showTerrainStatus('⚠️ Please select a region in the Forecast tab first, or enter coordinates manually.', 'error');
  }
}

function updateTerrainMode() {
  const mode = document.getElementById('terrain-mode').value;
  Terrain.updateMode(mode);
}

function resetTerrainCamera() { Terrain.resetCamera(); }
function toggleTerrainWireframe() { Terrain.toggleWireframe(); }
function toggleTerrainExaggeration() { Terrain.toggleExaggeration(); }
function toggleTerrainAnimation() { Terrain.toggleAnimation(); }

function initTerrainMiniMap() {
  const el = document.getElementById('terrain-minimap');

  if (!el) return;
  if (terrainMiniMap) return;

  terrainMiniMap = L.map('terrain-minimap', {
    zoomControl: false,
    attributionControl: true,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    tap: false,
    touchZoom: false
  }).setView([12.0, 122.0], 6);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 18,
    keepBuffer: 4
  }).addTo(terrainMiniMap);
}

function getTerrainBounds(lat, lng, gridKm) {
  const halfKm = gridKm / 2;

  // More accurate than fixed 0.009 degrees because longitude changes by latitude.
  const latDeg = halfKm / 111.32;
  const lngDeg = halfKm / (111.32 * Math.cos(lat * Math.PI / 180));

  return [
    [lat - latDeg, lng - lngDeg],
    [lat + latDeg, lng + lngDeg]
  ];
}

function updateTerrainMiniMap(lat, lng, gridKm) {
  initTerrainMiniMap();

  if (!terrainMiniMap) return;

  const bounds = getTerrainBounds(lat, lng, gridKm);

  // Clear old marker and rectangle
  if (terrainMiniMarker) {
    terrainMiniMap.removeLayer(terrainMiniMarker);
    terrainMiniMarker = null;
  }

  if (terrainMiniRect) {
    terrainMiniMap.removeLayer(terrainMiniRect);
    terrainMiniRect = null;
  }

  terrainMiniRect = L.rectangle(bounds, {
    color: '#84cc16',
    weight: 2,
    fillColor: '#84cc16',
    fillOpacity: 0.18
  }).addTo(terrainMiniMap);

  terrainMiniMarker = L.circleMarker([lat, lng], {
    radius: 5,
    color: '#ffffff',
    weight: 2,
    fillColor: '#84cc16',
    fillOpacity: 1
  }).addTo(terrainMiniMap);

  terrainMiniMap.fitBounds(bounds, {
    padding: [18, 18],
    maxZoom: 14
  });

  setTimeout(() => {
    terrainMiniMap.invalidateSize();
  }, 150);

  const sizeLabel = document.getElementById('terrain-minimap-size');
  if (sizeLabel) {
    sizeLabel.textContent = `${gridKm} km × ${gridKm} km`;
  }
}

function showWaterAnalyzerStatus(text, type = 'loading') {
  const section = document.getElementById('water-analyzer-section');
  const badge = document.getElementById('water-analyzer-status');
  const summary = document.getElementById('water-analyzer-summary');

  if (section) section.classList.remove('hidden');

  if (badge) {
    badge.textContent = text;
    badge.className = `water-analyzer-badge ${type}`;
  }

  if (summary && type === 'loading') {
    summary.textContent =
      'Scanning map data for rivers, ponds, lakes, reservoirs, and other mapped water features...';
  }
}

function getWaterAnalyzerBounds(lat, lng, gridKm) {
  const halfKm = gridKm / 2;

  const latDeg = halfKm / 111.32;
  const lngDeg = halfKm / (111.32 * Math.cos(lat * Math.PI / 180));

  return {
    south: lat - latDeg,
    north: lat + latDeg,
    west: lng - lngDeg,
    east: lng + lngDeg
  };
}

async function fetchWaterBodiesForAnalyzer(lat, lng, gridKm, signal) {
  const safeLat = Number(lat);
  const safeLng = Number(lng);
  const safeGrid = Number(gridKm) || 5;

  const url =
    `${API}/api/water-bodies?lat=${encodeURIComponent(safeLat)}` +
    `&lng=${encodeURIComponent(safeLng)}` +
    `&grid_km=${encodeURIComponent(safeGrid)}` +
    `&_=${Date.now()}`; // cache-buster

  console.log('Water Body Analyzer request URL:', url);

  try {
    const response = await fetch(url, {
      signal,
      cache: 'no-store',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Backend water endpoint failed: ${response.status} ${text.slice(0, 120)}`);
    }

    const data = await response.json();

    console.log('Water Body Analyzer backend result:', data);

    if (data.debug) {
      console.table(data.debug);
    }

    const waterBodies = Array.isArray(data.waterBodies)
      ? data.waterBodies
      : Array.isArray(data.water_bodies)
        ? data.water_bodies
        : [];

    console.log('Water Body Analyzer parsed waterBodies:', waterBodies.length);

    return waterBodies;
  } catch (err) {
    if (err.name === 'AbortError') throw err;

    console.warn('Water Body Analyzer backend request failed:', err);
    return [];
  }
}

function waterFeatureIntensity(feature) {
  const tags = feature.tags || {};
  const pointCount = feature.geometry?.length || 0;

  // This is NOT measured depth.
  // It is a visual depth-intensity proxy based on water type and mapped feature size.
  if (tags.water === 'lake' || tags.natural === 'water' || tags.landuse === 'reservoir') {
    return Math.min(1, 0.65 + pointCount / 220);
  }

  if (tags.waterway === 'river' || tags.waterway === 'riverbank') {
    return 0.78;
  }

  if (tags.waterway === 'stream') {
    return 0.42;
  }

  if (
    tags.waterway === 'canal' ||
    tags.waterway === 'drain' ||
    tags.waterway === 'ditch'
  ) {
    return 0.35;
  }

  return Math.min(0.7, 0.35 + pointCount / 260);
}

function waterColorFromIntensity(t) {
  // Light blue to dark blue, no black.
  if (t < 0.35) return 'rgba(147, 197, 253, 0.78)';
  if (t < 0.55) return 'rgba(96, 165, 250, 0.84)';
  if (t < 0.75) return 'rgba(37, 99, 235, 0.86)';
  return 'rgba(30, 64, 175, 0.90)';
}

function latLngToWaterCanvasPoint(pLat, pLng, bounds, width, height) {
  const x = ((pLng - bounds.west) / (bounds.east - bounds.west)) * width;
  const y = height - (((pLat - bounds.south) / (bounds.north - bounds.south)) * height);

  return { x, y };
}

function drawWaterAnalyzerGrid(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Light grid
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;

  const gridCount = 20;

  for (let i = 0; i <= gridCount; i++) {
    const x = (i / gridCount) * width;
    const y = (i / gridCount) * height;

    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Border
  ctx.strokeStyle = '#bfdbfe';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);
}

function isWaterAreaFeature(feature) {
  const tags = feature.tags || {};

  return (
    tags.natural === 'water' ||
    tags.water ||
    tags.landuse === 'reservoir' ||
    tags.waterway === 'riverbank'
  );
}

function normalizeWaterGeometryPoint(point) {
  if (!point || typeof point !== 'object') return null;

  const lat = Number(point.lat ?? point.latitude);
  const lon = Number(point.lon ?? point.lng ?? point.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  return { lat, lon };
}

function sanitizeWaterGeometry(geometry) {
  if (!Array.isArray(geometry)) return [];

  return geometry
    .map(normalizeWaterGeometryPoint)
    .filter(Boolean);
}

function extractWaterGeometries(feature) {
  const geometries = [];

  if (!feature || typeof feature !== 'object') {
    return geometries;
  }

  const mainGeometry = sanitizeWaterGeometry(feature.geometry);

  if (mainGeometry.length >= 2) {
    geometries.push(mainGeometry);
  }

  if (Array.isArray(feature.members)) {
    feature.members.forEach(member => {
      const memberGeometry = sanitizeWaterGeometry(member?.geometry);

      if (memberGeometry.length >= 2) {
        geometries.push(memberGeometry);
      }
    });
  }

  return geometries;
}

function drawWaterBodiesOnCanvas(waterBodies, lat, lng, gridKm) {
  const canvas = document.getElementById('waterBodyCanvas');
  const summary = document.getElementById('water-analyzer-summary');

  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  const displaySize = Math.min(canvas.clientWidth || 720, 720);

  canvas.width = displaySize;
  canvas.height = displaySize;

  const width = canvas.width;
  const height = canvas.height;

  const bounds = getWaterAnalyzerBounds(lat, lng, gridKm);

  drawWaterAnalyzerGrid(ctx, width, height);

  let riverCount = 0;
  let lakePondCount = 0;
  let canalDrainCount = 0;
  let drawnCount = 0;

  waterBodies.forEach(feature => {
    const tags = feature.tags || {};
    const geometries = extractWaterGeometries(feature);

    if (!geometries.length) return;

    const intensity = waterFeatureIntensity(feature);
    const color = waterColorFromIntensity(intensity);
    const isArea = isWaterAreaFeature(feature);

    if (tags.waterway === 'river' || tags.waterway === 'riverbank') {
      riverCount++;
    } else if (
      tags.waterway === 'canal' ||
      tags.waterway === 'drain' ||
      tags.waterway === 'ditch' ||
      tags.waterway === 'stream'
    ) {
      canalDrainCount++;
    } else if (tags.natural === 'water' || tags.water || tags.landuse === 'reservoir') {
      lakePondCount++;
    }

    geometries.slice(0, 80).forEach(geometry => {
      const step = Math.max(1, Math.ceil(geometry.length / 300));
      const simplifiedGeometry = geometry.filter((_, i) => i % step === 0);
      const sourceGeometry = simplifiedGeometry.length >= 2 ? simplifiedGeometry : geometry;

      const points = sourceGeometry
        .map(g => latLngToWaterCanvasPoint(g.lat, g.lon, bounds, width, height))
        .filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));

      if (points.length < 2) return;

      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);

      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }

      if (isArea && points.length > 3) {
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.fillStyle = 'rgba(96, 165, 250, 0.22)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(30, 64, 175, 0.65)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.strokeStyle = color;
        if (tags.waterway === 'river') {
          ctx.lineWidth = 5;
        } else if (tags.waterway === 'stream') {
          ctx.lineWidth = 3;
        } else {
          ctx.lineWidth = 2.5;
        }
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        if (tags.waterway === 'river') {
          ctx.strokeStyle = 'rgba(30, 58, 138, 0.35)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      drawnCount++;
    });
  });

  // Center point marker
  const center = latLngToWaterCanvasPoint(lat, lng, bounds, width, height);
  ctx.beginPath();
  ctx.arc(center.x, center.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#84cc16';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();

  if (summary) {
    if (drawnCount === 0) {
      summary.textContent =
        `No drawable mapped water bodies were detected inside the ${gridKm} km × ${gridKm} km analysis area. Try a larger grid or verify the coordinates.`;
    } else {
      summary.textContent =
        `Detected ${waterBodies.length} mapped water features and drew ${drawnCount} water geometries: ${riverCount} river/riverbank features, ${lakePondCount} lake/pond/reservoir features, and ${canalDrainCount} stream/canal/drainage features. Color darkness is a depth-intensity proxy, not measured water depth.`;
    }
  }

  // Render irrigation quality score panel
  renderWaterQualityScore(waterBodies, riverCount, lakePondCount, canalDrainCount);
}

function renderWaterQualityScore(waterBodies, riverCount, lakePondCount, canalDrainCount) {
  // Pull terrain irrigation score if available
  const terrainIrrigScore = latestTerrainScores?.details?.irrigation?.irrigationScore ?? null;
  const irrigType = latestTerrainScores?.details?.irrigation?.irrigationType ?? 'Unknown';

  const totalFeatures = waterBodies.length;

  // Score components
  // 1. Terrain-derived irrigation score (50% weight)
  const terrainComponent = terrainIrrigScore !== null ? terrainIrrigScore : 50;

  // 2. Water feature presence score (30% weight)
  // Rivers are best, canals good, lakes/ponds moderate
  const featureScore = Math.min(100,
    (riverCount * 18) +
    (canalDrainCount * 10) +
    (lakePondCount * 8) +
    (totalFeatures > 0 ? 15 : 0)
  );

  // 3. Diversity bonus (20% weight) — more feature types = more reliable supply
  const typeCount = [riverCount > 0, canalDrainCount > 0, lakePondCount > 0].filter(Boolean).length;
  const diversityScore = typeCount === 3 ? 100 : typeCount === 2 ? 70 : typeCount === 1 ? 45 : 10;

  const finalScore = Math.round(
    terrainComponent * 0.50 +
    featureScore * 0.30 +
    diversityScore * 0.20
  );

  const clampedScore = Math.max(0, Math.min(100, finalScore));

  // Level label and color
  let level, color, desc;
  if (clampedScore >= 80) {
    level = 'Excellent';
    color = '#0ea5e9';
    desc = 'Strong irrigation potential. Rivers or canals present with good terrain drainage.';
  } else if (clampedScore >= 60) {
    level = 'Good';
    color = '#38bdf8';
    desc = 'Adequate irrigation potential. Some water features detected nearby.';
  } else if (clampedScore >= 40) {
    level = 'Moderate';
    color = '#f59e0b';
    desc = 'Irrigation may be limited. Rainfed supplementation likely needed.';
  } else {
    level = 'Poor';
    color = '#ef4444';
    desc = 'Low irrigation potential. Few or no water features detected. Rainfed conditions likely.';
  }

  // Animate the ring
  const ringFill = document.getElementById('wqp-ring-fill');
  const ringVal = document.getElementById('wqp-score-val');
  const levelEl = document.getElementById('wqp-level');
  const descEl = document.getElementById('wqp-desc');

  if (ringFill) {
    const circumference = 2 * Math.PI * 32;
    ringFill.style.strokeDasharray = circumference;
    ringFill.style.stroke = color;
    ringFill.style.strokeDashoffset = circumference;
    setTimeout(() => {
      ringFill.style.strokeDashoffset = circumference * (1 - clampedScore / 100);
    }, 200);
  }
  if (ringVal) ringVal.textContent = clampedScore + '%';
  if (levelEl) { levelEl.textContent = level; levelEl.style.color = color; }
  if (descEl) descEl.textContent = desc;

  // Metrics
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setText('wqp-terrain-score', terrainIrrigScore !== null ? terrainIrrigScore.toFixed(0) + '%' : 'N/A');
  setText('wqp-feature-count', totalFeatures + ' detected');
  setText('wqp-irrig-type', irrigType);
  setText('wqp-river-count', riverCount);
  setText('wqp-canal-count', canalDrainCount);
  setText('wqp-lake-count', lakePondCount);
}

// ════════════════════════════════════════
// Detected Water Body Detail Cards
// ════════════════════════════════════════

function waterCardSafeTags(feature) {
  return feature && typeof feature === 'object' && feature.tags ? feature.tags : {};
}

function waterBodyDisplayName(feature, index) {
  const tags = waterCardSafeTags(feature);
  return (
    tags.name ||
    tags['name:en'] ||
    tags.alt_name ||
    tags.official_name ||
    `Unnamed Water Body ${index + 1}`
  );
}

function waterBodyTypeLabel(feature) {
  const tags = waterCardSafeTags(feature);

  if (tags.waterway === 'river') return 'River';
  if (tags.waterway === 'stream') return 'Stream';
  if (tags.waterway === 'canal') return 'Canal';
  if (tags.waterway === 'drain') return 'Drainage Channel';
  if (tags.waterway === 'ditch') return 'Ditch';
  if (tags.waterway === 'riverbank') return 'Riverbank';
  if (tags.water === 'river') return 'River';
  if (tags.water === 'lake') return 'Lake';
  if (tags.water === 'pond') return 'Pond';
  if (tags.water === 'reservoir') return 'Reservoir';
  if (tags.natural === 'water') return 'Natural Water Body';
  if (tags.landuse === 'reservoir') return 'Reservoir';

  return 'Mapped Water Feature';
}

function waterBodyEmoji(typeLabel) {
  const t = String(typeLabel || '').toLowerCase();

  if (t.includes('river')) return '🌊';
  if (t.includes('stream')) return '💧';
  if (t.includes('canal')) return '🛶';
  if (t.includes('lake')) return '🏞️';
  if (t.includes('pond')) return '💦';
  if (t.includes('reservoir')) return '🌊';

  return '💧';
}

function parseWaterNumber(value) {
  if (value === null || value === undefined) return null;

  const match = String(value).match(/\d+(\.\d+)?/);
  if (!match) return null;

  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

function waterCardGeometries(feature) {
  if (typeof extractWaterGeometries === 'function') {
    return extractWaterGeometries(feature);
  }

  const geometries = [];

  if (Array.isArray(feature?.geometry)) {
    const clean = feature.geometry
      .map(p => {
        const lat = Number(p?.lat ?? p?.latitude);
        const lon = Number(p?.lon ?? p?.lng ?? p?.longitude);
        return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
      })
      .filter(Boolean);

    if (clean.length >= 2) geometries.push(clean);
  }

  if (Array.isArray(feature?.members)) {
    feature.members.forEach(member => {
      if (!Array.isArray(member?.geometry)) return;

      const clean = member.geometry
        .map(p => {
          const lat = Number(p?.lat ?? p?.latitude);
          const lon = Number(p?.lon ?? p?.lng ?? p?.longitude);
          return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
        })
        .filter(Boolean);

      if (clean.length >= 2) geometries.push(clean);
    });
  }

  return geometries;
}

function waterDistanceKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function waterGeometryLengthKm(geometry) {
  if (!Array.isArray(geometry) || geometry.length < 2) return 0;

  let total = 0;

  for (let i = 1; i < geometry.length; i++) {
    total += waterDistanceKm(geometry[i - 1], geometry[i]);
  }

  return total;
}

function getWaterFeatureLengthKm(feature) {
  const geometries = waterCardGeometries(feature);

  return geometries.reduce((sum, geometry) => {
    return sum + waterGeometryLengthKm(geometry);
  }, 0);
}

function estimateWaterWidthMeters(feature, lengthKm) {
  const tags = waterCardSafeTags(feature);
  const taggedWidth = parseWaterNumber(tags.width || tags.est_width || tags['width:average']);

  if (taggedWidth !== null) {
    return {
      label: `${taggedWidth.toFixed(taggedWidth >= 10 ? 0 : 1)} m`,
      source: 'mapped width tag'
    };
  }

  const type = waterBodyTypeLabel(feature).toLowerCase();

  let estimate;

  if (type.includes('riverbank')) estimate = Math.max(18, Math.min(65, 20 + lengthKm * 4));
  else if (type.includes('river')) estimate = Math.max(10, Math.min(45, 12 + lengthKm * 3));
  else if (type.includes('stream')) estimate = Math.max(2, Math.min(8, 2 + lengthKm * 0.8));
  else if (type.includes('canal')) estimate = Math.max(3, Math.min(12, 4 + lengthKm * 0.6));
  else if (type.includes('drain') || type.includes('ditch')) estimate = 2.5;
  else if (type.includes('lake') || type.includes('pond') || type.includes('reservoir')) {
    return {
      label: 'Area-based feature',
      source: 'width not applicable'
    };
  } else estimate = 5;

  return {
    label: `~${estimate.toFixed(estimate >= 10 ? 0 : 1)} m`,
    source: 'estimated proxy'
  };
}

function estimateWaterDepth(feature, widthInfo) {
  const tags = waterCardSafeTags(feature);
  const taggedDepth = parseWaterNumber(tags.depth || tags.maxdepth || tags['depth:max'] || tags['max_depth']);

  if (taggedDepth !== null) {
    return {
      label: `${taggedDepth.toFixed(taggedDepth >= 10 ? 0 : 1)} m`,
      source: 'mapped depth tag'
    };
  }

  const type = waterBodyTypeLabel(feature).toLowerCase();

  if (type.includes('riverbank')) {
    return { label: '~2–5 m', source: 'estimated depth proxy' };
  }

  if (type.includes('river')) {
    return { label: '~1–3 m', source: 'estimated depth proxy' };
  }

  if (type.includes('stream')) {
    return { label: '~0.2–1 m', source: 'estimated depth proxy' };
  }

  if (type.includes('canal')) {
    return { label: '~0.5–2 m', source: 'estimated depth proxy' };
  }

  if (type.includes('lake') || type.includes('reservoir')) {
    return { label: 'Not available', source: 'requires bathymetry or field measurement' };
  }

  return { label: 'Not available', source: 'not measured in map data' };
}

function estimateWaterQuality(feature) {
  const tags = waterCardSafeTags(feature);
  const type = waterBodyTypeLabel(feature).toLowerCase();

  const irrigationScore =
    Number(latestTerrainScores?.details?.irrigation?.irrigationScore) ||
    Number(latestTerrainScores?.irrigationScore) ||
    50;

  let score = 50;

  if (type.includes('river')) score += 18;
  if (type.includes('stream')) score += 10;
  if (type.includes('canal')) score += 12;
  if (type.includes('reservoir') || type.includes('lake')) score += 15;
  if (type.includes('drain') || type.includes('ditch')) score -= 18;

  score += (irrigationScore - 50) * 0.35;

  if (tags.intermittent === 'yes' || tags.seasonal === 'yes') score -= 10;
  if (tags.tunnel === 'yes' || tags.culvert === 'yes') score -= 5;

  score = Math.max(0, Math.min(100, Math.round(score)));

  if (score >= 70) {
    return {
      score,
      level: 'Good',
      className: 'good',
      label: 'Good irrigation proxy'
    };
  }

  if (score >= 45) {
    return {
      score,
      level: 'Moderate',
      className: 'moderate',
      label: 'Moderate irrigation proxy'
    };
  }

  return {
    score,
    level: 'Limited',
    className: 'limited',
    label: 'Limited irrigation proxy'
  };
}

function googleImageSearchUrl(name, lat, lng) {
  const q = `${name} river ${lat || ''} ${lng || ''} South Cotabato`;
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`;
}

function googleMapsSearchUrl(name, lat, lng) {
  const q = `${name} ${lat || ''},${lng || ''}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function buildDetectedWaterBodyDetails(waterBodies, lat, lng) {
  const namedFirst = [...(waterBodies || [])]
    .map((feature, index) => {
      const name = waterBodyDisplayName(feature, index);
      const type = waterBodyTypeLabel(feature);
      const lengthKm = getWaterFeatureLengthKm(feature);
      const width = estimateWaterWidthMeters(feature, lengthKm);
      const depth = estimateWaterDepth(feature, width);
      const quality = estimateWaterQuality(feature);
      const tags = waterCardSafeTags(feature);

      return {
        feature,
        name,
        type,
        lengthKm,
        width,
        depth,
        quality,
        tags,
        hasName: !!(tags.name || tags['name:en'] || tags.alt_name || tags.official_name),
        googleImageUrl: googleImageSearchUrl(name, lat, lng),
        googleMapsUrl: googleMapsSearchUrl(name, lat, lng)
      };
    })
    .filter(item => item.lengthKm > 0 || item.hasName)
    .sort((a, b) => {
      if (a.hasName !== b.hasName) return a.hasName ? -1 : 1;
      return b.lengthKm - a.lengthKm;
    });

  return namedFirst.slice(0, 6);
}

function renderDetectedWaterBodies(waterBodies, lat, lng, gridKm) {
  const panel = document.getElementById('detected-water-panel');
  const countEl = document.getElementById('detected-water-count');
  const list = document.getElementById('detected-water-list');

  if (!panel || !countEl || !list) return;

  const details = buildDetectedWaterBodyDetails(waterBodies, lat, lng);

  countEl.textContent = `${details.length} shown`;

  if (!details.length) {
    list.innerHTML = `
      <div class="detected-water-empty">
        No named or drawable water body details were available. The analyzer may still detect unnamed mapped water geometries.
      </div>
    `;
    return;
  }

  list.innerHTML = details.map(item => {
    const lengthLabel =
      item.lengthKm >= 1
        ? `${item.lengthKm.toFixed(2)} km`
        : `${Math.round(item.lengthKm * 1000)} m`;

    return `
      <div class="water-detail-card">
       

        <div class="water-detail-body">
          <div class="water-detail-top">
            <div>
              <div class="water-detail-name">${item.name}</div>
              <div class="water-detail-type">${item.type}</div>
            </div>
            <div class="water-quality-chip ${item.quality.className}">
              ${item.quality.level}
            </div>
          </div>

          <div class="water-detail-metrics">
            <div class="water-detail-metric">
              <span>Mapped Length</span>
              <strong>${lengthLabel}</strong>
            </div>
            <div class="water-detail-metric">
              <span>Avg. Width</span>
              <strong>${item.width.label}</strong>
            </div>
            <div class="water-detail-metric">
              <span>Max Depth</span>
              <strong>${item.depth.label}</strong>
            </div>
            <div class="water-detail-metric">
              <span>Water Quality</span>
              <strong>${item.quality.score}% proxy</strong>
            </div>
          </div>

          <div class="water-detail-source">
            Source: OpenStreetMap geometry/tags. Width, depth, and quality are estimated unless a mapped tag exists.
            Width source: ${item.width.source}. Depth source: ${item.depth.source}.
          </div>

          <div class="water-detail-actions">
            <a href="${item.googleMapsUrl}" target="_blank" rel="noopener">Open in Google Maps</a>
            <a href="${item.googleImageUrl}" target="_blank" rel="noopener">Search Google Photos</a>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function prepareWaterBodyAnalyzer(lat, lng, gridKm) {
  showWaterAnalyzerStatus('Queued', 'loading');

  const canvas = document.getElementById('waterBodyCanvas');
  const summary = document.getElementById('water-analyzer-summary');

  if (canvas) {
    const ctx = canvas.getContext('2d');
    const size = Math.min(canvas.clientWidth || 720, 720);

    canvas.width = size;
    canvas.height = size;

    drawWaterAnalyzerGrid(ctx, size, size);
  }

  if (summary) {
    summary.textContent =
      'Water Body Analyzer is ready. It will scan mapped water bodies after the 3D terrain finishes loading.';
  }
  renderDetectedWaterBodies([], lat, lng, gridKm);
}

async function startWaterBodyAnalyzer(lat, lng, gridKm) {
  if (waterAnalyzerAbortController) {
    waterAnalyzerAbortController.abort();
  }
  waterAnalyzerAbortController = new AbortController();
  waterAnalyzerRunId++;

  showWaterAnalyzerStatus('Scanning', 'loading');

  const canvas = document.getElementById('waterBodyCanvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    const size = Math.min(canvas.clientWidth || 720, 720);
    canvas.width = size;
    canvas.height = size;
    drawWaterAnalyzerGrid(ctx, size, size);
  }

  try {
    const waterBodies = await fetchWaterBodiesForAnalyzer(
      lat, lng, gridKm,
      waterAnalyzerAbortController.signal
    );

    // No runId check — just render whatever came back
    drawWaterBodiesOnCanvas(waterBodies, lat, lng, gridKm);
    renderDetectedWaterBodies(waterBodies, lat, lng, gridKm);

    const foundCount = Array.isArray(waterBodies) ? waterBodies.length : 0;

    console.log('Water Body Analyzer final frontend count:', foundCount);

    showWaterAnalyzerStatus(
      foundCount ? `${foundCount} found` : '0 found',
      foundCount ? 'success' : 'error'
    );

  } catch (err) {
    if (err.name === 'AbortError') return;

    console.error('Water Body Analyzer failed:', err);
    drawWaterBodiesOnCanvas([], lat, lng, gridKm);
    renderDetectedWaterBodies([], lat, lng, gridKm);
    showWaterAnalyzerStatus('0 found', 'error');

    const summary = document.getElementById('water-analyzer-summary');
    if (summary) {
      summary.textContent = 'Water scan failed. Check that the backend is running and try again.';
    }
  }
}

async function runTerrainAnalysis() {
  const lat = parseFloat(document.getElementById('terrain-lat').value);
  const lng = parseFloat(document.getElementById('terrain-lng').value);
  const gridKm = parseInt(document.getElementById('terrain-grid').value) || 5;
  const mode = document.getElementById('terrain-mode').value;

  if (isNaN(lat) || isNaN(lng)) {
    showTerrainStatus('⚠️ Please enter valid latitude and longitude coordinates.', 'error');
    return;
  }
  if (lat < 4 || lat > 21 || lng < 116 || lng > 127) {
    showTerrainStatus('⚠️ Coordinates seem to be outside the Philippines. Please double-check.', 'error');
    return;
  }

  const btn = document.getElementById('terrain-run-btn');
  btn.disabled = true;
  btn.innerHTML = '⏳ Loading terrain...';

  showLoading("Generating 3D Terrain");
  showTerrainStatus('⏳ Fetching elevation data and building 3D model...', 'loading');

  document.getElementById('terrain-scores').classList.add('hidden');

  // Show the analyzer panel immediately, but do not start the heavy OSM scan yet.
  prepareWaterBodyAnalyzer(lat, lng, gridKm);

  try {
    const terrainResult = await Terrain.init(lat, lng, gridKm, mode);
    if (!terrainResult) throw new Error('Terrain init returned no data');

    // Apply the same camera view as the Reset Camera button after terrain is fully loaded.
    setTimeout(() => {
      if (window.Terrain) {
        window.Terrain.resetCamera();
      } else if (typeof Terrain !== 'undefined') {
        Terrain.resetCamera();
      }
    }, 120);

    updateTerrainMiniMap(lat, lng, gridKm);
    showTerrainStatus(
      `✅ 3D terrain loaded ${terrainResult.usedAPI ? '(SRTM elevation data)' : '(fallback terrain model)'}`,
      'success'
    );

    // Start the water scan after the 3D model is already stable.
    setTimeout(() => {
      startWaterBodyAnalyzer(lat, lng, gridKm);
    }, 600);

    // Compute scores
    const scores = Terrain.computeScores(terrainResult);
    renderTerrainScores(scores, lat, lng, gridKm);

    // Fertilizer Compatibility Analysis
    try {
      generateAndRenderFertilizerAnalysis(scores, lat, lng, gridKm);
    } catch (fertErr) {
      console.error('Fertilizer analysis failed (non-fatal):', fertErr);
    }

    // Store for pest risk module
    latestTerrainScores = scores;
    latestTerrainLocation = { lat, lng, gridKm };
    const pestHeatKm = document.getElementById('pest-heatmap-km');
    if (pestHeatKm) {
      pestHeatKm.value = gridKm;
    }

    if (typeof window._onTerrainScoresComputed === 'function') {
      window._onTerrainScoresComputed(scores, { lat, lng, gridKm });
    }

    // Profile chart
    const crossSection = Terrain.getCrossSection();
    drawTerrainProfile(crossSection, gridKm);

    // ── Spatiotemporal Analysis ──
    // Runs after terrain scores so it can read and augment them
    if (currentRegionId) {
      runSpatiotemporalAnalysis(currentRegionId, scores);
    }

  } catch (e) {
    const msg = String(e && e.message ? e.message : e);

    if (msg.includes('WebGL') || msg.includes('context')) {
      showTerrainStatus(
        `❌ Terrain analysis failed: ${msg} If this persists, close this browser tab completely, open PAL-AI in a fresh tab, and test with a 5 km grid first.`,
        'error'
      );
    } else {
      showTerrainStatus(`❌ Terrain analysis failed: ${msg}`, 'error');
    }
  } finally {
    hideLoading();

    btn.disabled = false;
    btn.innerHTML = '🗺️ Generate 3D Terrain';
  }
}

function showTerrainStatus(msg, type) {
  const el = document.getElementById('terrain-status');
  el.textContent = msg;
  el.className = `terrain-status ${type}`;
  el.classList.remove('hidden');
}

function renderTerrainScores(scores, lat, lng, gridKm) {
  const { topoScore, yieldImpactScore, overallModifier, details } = scores;

  // Animate score rings
  animateRing('topo-ring-fill', topoScore, '#84cc16');
  animateRing('yield-ring-fill', yieldImpactScore, '#0ea5e9');

  document.getElementById('topo-score-val').textContent = topoScore + '%';
  document.getElementById('yield-impact-val').textContent = yieldImpactScore + '%';

  const topoLabel = topoScore >= 75 ? 'Excellent for rice cultivation' : topoScore >= 55 ? 'Good terrain conditions' : topoScore >= 35 ? 'Moderate suitability' : 'Challenging terrain';
  const yieldLabel = yieldImpactScore >= 80 ? 'Minimal terrain penalty' : yieldImpactScore >= 60 ? 'Minor yield reduction' : yieldImpactScore >= 40 ? 'Moderate yield impact' : 'Significant terrain penalty';

  document.getElementById('topo-score-sub').textContent = topoLabel;
  document.getElementById('yield-impact-sub').textContent = yieldLabel;

  // Final yield calculation
  const baseYield = forecastData
    ? avg(forecastData.historical.map(r => r.yield))
    : (REGION_YIELD_AVERAGES[currentRegionId] || 1.8);
  const adjustedYield = baseYield * parseFloat(overallModifier);
  const modifierPct = ((parseFloat(overallModifier) - 1) * 100).toFixed(1);

  document.getElementById('final-yield-val').textContent = adjustedYield.toFixed(3) + ' t/ha';
  document.getElementById('final-yield-base').textContent = `Base: ${baseYield.toFixed(3)} t/ha (historical avg)`;
  document.getElementById('final-yield-mod').textContent = `Terrain modifier: ${modifierPct}%`;

  document.getElementById('terrain-location-label').textContent =
    `${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E — ${gridKm}km² analysis area`;

  // Detailed metrics
  const { elevation, slope, soil, irrigation } = details;

  document.getElementById('elev-metrics').innerHTML = metricRows([
    ['Min Elevation', Math.round(elevation.minE) + ' m'],
    ['Max Elevation', Math.round(elevation.maxE) + ' m'],
    ['Avg Elevation', Math.round(elevation.avgE) + ' m'],
    ['Elevation Range', Math.round(elevation.elevRange) + ' m'],
    ['Elevation Score', elevation.elevScore.toFixed(0) + '%'],
  ]);

  document.getElementById('slope-metrics').innerHTML = metricRows([
    ['Avg Slope', slope.avgSlope.toFixed(1) + '°'],
    ['Flat Area (<3°)', (slope.flatFraction * 100).toFixed(0) + '%'],
    ['Gentle (3–8°)', (slope.mildFraction * 100).toFixed(0) + '%'],
    ['Steep (>15°)', (slope.steepFraction * 100).toFixed(0) + '%'],
    ['Slope Score', slope.slopeScore.toFixed(0) + '%'],
  ]);

  document.getElementById('soil-metrics').innerHTML = metricRows([
    ['Inferred Soil', soil.soilType],
    ['Fertility', soil.soilFertility],
    ['Soil pH', soil.soilpH],
    ['Texture', soil.soilTexture],
    ['Drainage Score', soil.drainageScore.toFixed(0) + '%'],
  ]);

  document.getElementById('irrigation-metrics').innerHTML = metricRows([
    ['Irrigation Score', irrigation.irrigationScore.toFixed(0) + '%'],
    ['Type', irrigation.irrigationType],
    ['Elev Variability', irrigation.elevVariance + ' m'],
    ['Water Retention', soil.soilTexture.includes('Clay') ? 'Good' : 'Moderate'],
    ['Flood Risk', slope.avgSlope < 1.5 ? 'Moderate' : 'Low'],
  ]);

  document.getElementById('terrain-scores').classList.remove('hidden');
  document.getElementById('terrain-scores').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function metricRows(rows) {
  return rows.map(([lbl, val]) =>
    `<div class="metric-row">
      <span class="metric-row-lbl">${lbl}</span>
      <span class="metric-row-val">${val}</span>
    </div>`
  ).join('');
}

function animateRing(id, score, color) {
  const el = document.getElementById(id);
  if (!el) return;

  const circumference = 2 * Math.PI * 32; // SVG circle radius = 32

  el.style.stroke = color;
  el.style.strokeDasharray = circumference;
  el.style.strokeDashoffset = circumference;

  setTimeout(() => {
    el.style.strokeDashoffset = circumference * (1 - score / 100);
  }, 300);
}

function drawTerrainProfile(crossSectionData, gridKm) {
  if (terrainProfileChart) terrainProfileChart.destroy();
  const ctx = document.getElementById('terrainProfileChart').getContext('2d');
  const labels = crossSectionData.map((_, i) => ((i / (crossSectionData.length - 1)) * gridKm).toFixed(1));

  terrainProfileChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Elevation (m)',
        data: crossSectionData,
        borderColor: '#84cc16',
        backgroundColor: 'rgba(132,204,22,.12)',
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
        tension: 0.4,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.parsed.y.toFixed(0)}m` } } },
      scales: {
        x: { title: { display: true, text: 'Distance (km)', color: '#64748b', font: { size: 11 } }, grid: { color: '#f1f5f9' }, ticks: { color: '#94a3b8', maxTicksLimit: 10 } },
        y: { title: { display: true, text: 'Elevation (m)', color: '#64748b', font: { size: 11 } }, grid: { color: '#f1f5f9' }, ticks: { color: '#94a3b8' } }
      }
    }
  });
}

// ════════════════════════════════════════
// CALCULATOR
// ════════════════════════════════════════
async function runCalculator() {
  const regionId = document.getElementById('calc-region').value;
  const quarter = document.getElementById('calc-quarter').value;
  const temperature = document.getElementById('calc-temp').value;
  const dew_point = document.getElementById('calc-dew').value;
  const precipitation = document.getElementById('calc-precip').value;
  const wind_speed = document.getElementById('calc-wind').value;
  const humidity = document.getElementById('calc-humidity').value;
  const hectares = parseFloat(document.getElementById('calc-hectares').value) || null;
  const cropType = document.getElementById('calc-crop').value;

  const errEl = document.getElementById('calc-error');
  const missing = [];
  if (!regionId) missing.push('Region');
  if (!quarter) missing.push('Quarter');
  if (!temperature) missing.push('Temperature');
  if (!dew_point) missing.push('Dew Point');
  if (!precipitation) missing.push('Precipitation');
  if (!wind_speed) missing.push('Wind Speed');
  if (!humidity) missing.push('Humidity');

  if (missing.length) {
    errEl.textContent = `Please fill in: ${missing.join(', ')}`;
    errEl.classList.remove('hidden');
    document.getElementById('calc-result').classList.add('hidden');
    return;
  }
  errEl.classList.add('hidden');

  try {
    const body = {
      region_id: parseInt(regionId), quarter: parseInt(quarter),
      temperature: parseFloat(temperature), dew_point: parseFloat(dew_point),
      precipitation: parseFloat(precipitation), wind_speed: parseFloat(wind_speed),
      humidity: parseFloat(humidity),
    };
    const res = await fetch(`${API}/api/predict`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { const err = await res.json(); throw new Error(err.detail || `HTTP ${res.status}`); }
    const result = await res.json();
    const yld = result.predicted_yield_t_ha;

    document.getElementById('calc-yield-value').textContent = yld.toFixed(4);
    document.getElementById('calc-context').textContent = `${result.region_name} · Q${quarter} · ${cropType} rice · ${yieldContext(yld)}`;

    // Hectare total
    const totalRow = document.getElementById('calc-total-row');
    if (hectares) {
      document.getElementById('calc-total-val').textContent = `${(yld * hectares).toFixed(2)} metric tons (${hectares} ha × ${yld.toFixed(4)} t/ha)`;
      totalRow.classList.remove('hidden');
    } else {
      totalRow.classList.add('hidden');
    }

    document.getElementById('calc-result').classList.remove('hidden');
  } catch (e) {
    errEl.textContent = `Prediction failed: ${e.message}`;
    errEl.classList.remove('hidden');
  }
}

function yieldContext(yld) {
  if (yld < 1.0) return '⚠️ Very low yield — check climate conditions';
  if (yld < 2.0) return '🟡 Below average yield';
  if (yld < 3.5) return '🟢 Average yield range';
  if (yld < 5.0) return '✅ Good yield expected';
  return '🌟 Excellent yield expected';
}

// ── Utilities ──
function avg(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

// ═══════════════════════════════════════════════════════════════════════════
// SPATIOTEMPORAL ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

let spatioNdviChart = null;
let spatioLstChart = null;

async function runSpatiotemporalAnalysis(regionId, terrainScores) {
  const section = document.getElementById('spatio-section');
  if (!section) return;

  section.classList.remove('hidden');

  // Show loading state in the badge
  const badge = document.getElementById('spatio-adj-val');
  if (badge) badge.textContent = '...';

  try {
    const res = await fetch(`${API}/api/spatiotemporal/${regionId}`);
    if (!res.ok) throw new Error(`Spatiotemporal API error: ${res.status}`);
    const data = await res.json();

    // Store for pest risk module
    latestSpatiotemporalData = data;

    renderSpatioSection(data, terrainScores);
  } catch (e) {
    console.error('Spatiotemporal analysis failed:', e);
    if (badge) badge.textContent = 'N/A';
  }
}

function renderSpatioSection(data, terrainScores) {
  // ── Adjustment badge ──────────────────────────────────────────────────────
  const adjPct = data.yield_adjustment_pct;
  const adjSign = adjPct >= 0 ? '+' : '';
  const adjBadge = document.getElementById('spatio-adj-val');
  const adjDir = document.getElementById('spatio-adj-dir');
  const adjBadgeWrap = document.getElementById('spatio-adj-badge');

  if (adjBadge) {
    adjBadge.textContent = `${adjSign}${adjPct}%`;
    adjBadge.className = adjPct < 0 ? 'sab-value negative' : 'sab-value';
  }
  if (adjDir) adjDir.textContent = data.trend_direction;

  // ── 6 canvas panels ──────────────────────────────────────────────────────
  const panels = [
    {
      id: 'spCanvas-ndvi-pre',
      valId: 'sp-val-ndvi-pre',
      value: data.pre_monsoon_ndvi,
      unit: '',
      type: 'ndvi',
      label: data.pre_monsoon_ndvi.toFixed(3),
    },
    {
      id: 'spCanvas-ndvi-post',
      valId: 'sp-val-ndvi-post',
      value: data.post_monsoon_ndvi,
      unit: '',
      type: 'ndvi',
      label: data.post_monsoon_ndvi.toFixed(3),
    },
    {
      id: 'spCanvas-evi',
      valId: 'sp-val-evi',
      value: data.post_monsoon_evi,
      unit: '',
      type: 'ndvi',
      label: data.post_monsoon_evi.toFixed(3),
    },
    {
      id: 'spCanvas-lst-pre',
      valId: 'sp-val-lst-pre',
      value: data.pre_monsoon_lst,
      unit: '°C',
      type: 'lst',
      label: data.pre_monsoon_lst.toFixed(1) + '°C',
    },
    {
      id: 'spCanvas-lst-post',
      valId: 'sp-val-lst-post',
      value: data.post_monsoon_lst,
      unit: '°C',
      type: 'lst',
      label: data.post_monsoon_lst.toFixed(1) + '°C',
    },
    {
      id: 'spCanvas-delta',
      valId: 'sp-val-delta',
      value: data.post_monsoon_ndvi - data.pre_monsoon_ndvi,
      unit: '',
      type: 'delta',
      label: ((data.post_monsoon_ndvi - data.pre_monsoon_ndvi) >= 0 ? '+' : '') +
        (data.post_monsoon_ndvi - data.pre_monsoon_ndvi).toFixed(3),
    },
  ];

  panels.forEach(p => {
    const canvas = document.getElementById(p.id);
    const valEl = document.getElementById(p.valId);
    if (canvas) drawSpatioPanel(canvas, p.value, p.type, data);
    if (valEl) valEl.textContent = p.label;
  });

  // ── Metrics row ───────────────────────────────────────────────────────────
  setText('smc-veg-class', data.vegetation_class);
  setText('smc-lst-class', data.lst_class);
  setText('smc-trend', data.trend_direction);
  setText('smc-stability', (data.stability_score * 100).toFixed(0) + '%');
  setText('smc-irrig', (data.irrigation_dependency * 100).toFixed(0) + '% rain-dep.');
  setText('smc-heat', data.heat_stress_index.toFixed(3));

  // ── Annual NDVI chart ─────────────────────────────────────────────────────
  const ndviTrendLabel = `Slope: ${data.ndvi_trend_slope >= 0 ? '+' : ''}${(data.ndvi_trend_slope * 1000).toFixed(2)}×10⁻³/yr`;
  setText('spatio-ndvi-trend-label', ndviTrendLabel);

  if (spatioNdviChart) spatioNdviChart.destroy();
  const ndviCtx = document.getElementById('spatioNdviChart');
  if (ndviCtx && data.annual_series) {
    spatioNdviChart = new Chart(ndviCtx.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Annual NDVI',
            data: data.annual_series.map(r => ({ x: r.year, y: r.ndvi })),
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34,197,94,.10)',
            borderWidth: 2.5,
            pointRadius: 4,
            pointBackgroundColor: '#22c55e',
            tension: 0.35,
            fill: true,
          },
          {
            label: 'Annual EVI',
            data: data.annual_series.map(r => ({ x: r.year, y: r.evi })),
            borderColor: '#84cc16',
            backgroundColor: 'rgba(132,204,22,.06)',
            borderWidth: 1.5,
            borderDash: [5, 3],
            pointRadius: 2,
            tension: 0.35,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { font: { size: 11 }, padding: 12, usePointStyle: true } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(4)}` } },
        },
        scales: {
          x: {
            type: 'linear', ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { color: '#f1f5f9' },
            title: { display: true, text: 'Year', color: '#64748b', font: { size: 10 } }
          },
          y: {
            min: 0, max: 1,
            title: { display: true, text: 'Index (0–1)', color: '#64748b', font: { size: 10 } },
            ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { color: '#f1f5f9' }
          },
        },
      },
    });
  }

  // ── Annual LST chart ──────────────────────────────────────────────────────
  const lstTrendLabel = `Slope: ${data.lst_trend_slope >= 0 ? '+' : ''}${(data.lst_trend_slope * 10).toFixed(2)}×10⁻¹ °C/yr`;
  setText('spatio-lst-trend-label', lstTrendLabel);

  if (spatioLstChart) spatioLstChart.destroy();
  const lstCtx = document.getElementById('spatioLstChart');
  if (lstCtx && data.annual_series) {
    spatioLstChart = new Chart(lstCtx.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Land Surface Temp (LST)',
            data: data.annual_series.map(r => ({ x: r.year, y: r.lst })),
            borderColor: '#f97316',
            backgroundColor: 'rgba(249,115,22,.10)',
            borderWidth: 2.5,
            pointRadius: 4,
            pointBackgroundColor: '#f97316',
            tension: 0.35,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { font: { size: 11 }, padding: 12, usePointStyle: true } },
          tooltip: { callbacks: { label: ctx => ` LST: ${ctx.parsed.y.toFixed(2)} °C` } },
        },
        scales: {
          x: {
            type: 'linear', ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { color: '#f1f5f9' },
            title: { display: true, text: 'Year', color: '#64748b', font: { size: 10 } }
          },
          y: {
            title: { display: true, text: 'Temperature (°C)', color: '#64748b', font: { size: 10 } },
            ticks: { color: '#94a3b8', font: { size: 11 }, callback: v => v + '°C' },
            grid: { color: '#f1f5f9' },
          },
        },
      },
    });
  }

  // ── NDVI Seasonal Heatmap ─────────────────────────────────────────────────
  renderNdviHeatmap(data.ndvi_heatmap);

  // ── Final Score Banner ────────────────────────────────────────────────────
  renderFinalBanner(data, terrainScores);

  // Scroll to section
  setTimeout(() => {
    document.getElementById('spatio-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 200);
}

// ── Draw a single false-color panel canvas ────────────────────────────────
function drawSpatioPanel(canvas, centralValue, type, data) {
  // Simulate a spatial raster using the annual_series + seasonal_profile
  // to create a plausible false-color gradient map
  const W = canvas.offsetWidth || 320;
  const H = Math.round(W / 1.6) || 200;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const COLS = 48, ROWS = 30;
  const cw = W / COLS, ch = H / ROWS;

  // Use annual series to get temporal variation
  const series = data.annual_series || [];
  const ndviArr = series.map(r => type === 'lst' ? r.lst : r.ndvi);
  const minVal = Math.min(...ndviArr);
  const maxVal = Math.max(...ndviArr);
  const range = Math.max(maxVal - minVal, 0.001);

  // Seeded pseudo-random spatial variation around the central value
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const seed = Math.sin(row * 41.3 + col * 73.7 + centralValue * 1000) * 9999;
      const noise = (seed - Math.floor(seed)) - 0.5;

      let v;
      if (type === 'delta') {
        v = centralValue + noise * 0.12;
      } else if (type === 'lst') {
        v = centralValue + noise * 4.0;
      } else {
        v = centralValue + noise * 0.15;
      }

      let r, g, b;
      if (type === 'ndvi') {
        // NDVI colormap: red→yellow→green (standard remote sensing)
        const t = Math.max(0, Math.min(1, v / 0.85));
        if (t < 0.25) {
          r = 180; g = Math.round(t / 0.25 * 60); b = 20;
        } else if (t < 0.5) {
          const s = (t - 0.25) / 0.25;
          r = Math.round(180 - s * 60); g = Math.round(60 + s * 140); b = 20;
        } else if (t < 0.75) {
          const s = (t - 0.5) / 0.25;
          r = Math.round(120 - s * 100); g = Math.round(200 + s * 30); b = Math.round(20 + s * 20);
        } else {
          const s = (t - 0.75) / 0.25;
          r = Math.round(20 - s * 10); g = Math.round(230 - s * 30); b = Math.round(40 + s * 30);
        }
      } else if (type === 'lst') {
        // LST colormap: blue→cyan→yellow→red (thermal)
        const t = Math.max(0, Math.min(1, (v - 20) / 22));
        if (t < 0.25) {
          r = 0; g = Math.round(t / 0.25 * 180); b = 255;
        } else if (t < 0.5) {
          const s = (t - 0.25) / 0.25;
          r = Math.round(s * 100); g = Math.round(180 + s * 75); b = Math.round(255 - s * 200);
        } else if (t < 0.75) {
          const s = (t - 0.5) / 0.25;
          r = Math.round(100 + s * 155); g = Math.round(255 - s * 140); b = 55;
        } else {
          const s = (t - 0.75) / 0.25;
          r = 255; g = Math.round(115 - s * 115); b = Math.round(55 - s * 55);
        }
      } else {
        // Delta NDVI: red (decrease) → white (no change) → green (increase)
        const t = Math.max(0, Math.min(1, (v + 0.4) / 0.8));
        if (t < 0.5) {
          const s = t / 0.5;
          r = 220; g = Math.round(s * 220); b = Math.round(s * 220);
        } else {
          const s = (t - 0.5) / 0.5;
          r = Math.round(220 - s * 200); g = 220; b = Math.round(220 - s * 180);
        }
      }

      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(Math.round(col * cw), Math.round(row * ch), Math.ceil(cw) + 1, Math.ceil(ch) + 1);
    }
  }

  // Overlay a subtle scanline grid for the "satellite imagery" aesthetic
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 0.5;
  for (let col = 0; col <= COLS; col++) {
    ctx.beginPath(); ctx.moveTo(col * cw, 0); ctx.lineTo(col * cw, H); ctx.stroke();
  }
  for (let row = 0; row <= ROWS; row++) {
    ctx.beginPath(); ctx.moveTo(0, row * ch); ctx.lineTo(W, row * ch); ctx.stroke();
  }

  // Central value label overlay
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(6, H - 26, 80, 20);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 11px monospace';
  ctx.fillText(`μ = ${centralValue.toFixed(3)}`, 10, H - 11);
}

// ── NDVI Heatmap Table ────────────────────────────────────────────────────
function renderNdviHeatmap(heatmapData) {
  const wrap = document.getElementById('spatio-heatmap-wrap');
  if (!wrap || !heatmapData) return;

  const years = Object.keys(heatmapData).sort();
  const quarters = ['1', '2', '3', '4'];
  const qLabels = { '1': 'Q1 (Jan–Mar)', '2': 'Q2 (Apr–Jun)', '3': 'Q3 (Jul–Sep)', '4': 'Q4 (Oct–Dec)' };

  // Collect all values for scaling
  const allVals = [];
  years.forEach(y => quarters.forEach(q => {
    const v = heatmapData[y]?.[q];
    if (v !== undefined) allVals.push(v);
  }));
  const minV = Math.min(...allVals), maxV = Math.max(...allVals);
  const range = Math.max(maxV - minV, 0.001);

  // Color function: white (low) → deep green (high)
  function ndviCellColor(v) {
    const t = (v - minV) / range;
    // white → light-green → green → dark-green
    if (t < 0.33) {
      const s = t / 0.33;
      return `rgb(${Math.round(255 - s * 80)},${Math.round(255 - s * 30)},${Math.round(255 - s * 140)})`;
    } else if (t < 0.66) {
      const s = (t - 0.33) / 0.33;
      return `rgb(${Math.round(175 - s * 100)},${Math.round(225 - s * 20)},${Math.round(115 - s * 60)})`;
    } else {
      const s = (t - 0.66) / 0.34;
      return `rgb(${Math.round(75 - s * 55)},${Math.round(205 - s * 75)},${Math.round(55 - s * 25)})`;
    }
  }

  function textColor(v) {
    const t = (v - minV) / range;
    return t > 0.45 ? '#fff' : '#1a1a1a';
  }

  let html = `<table class="spatio-heatmap-table"><thead><tr>
    <th>Year</th>
    ${quarters.map(q => `<th>${qLabels[q]}</th>`).join('')}
    <th>Annual Avg</th>
  </tr></thead><tbody>`;

  years.forEach(y => {
    const rowVals = quarters.map(q => heatmapData[y]?.[q]).filter(v => v !== undefined);
    const rowAvg = rowVals.length ? rowVals.reduce((a, b) => a + b, 0) / rowVals.length : 0;
    html += `<tr><td style="font-weight:700;color:var(--muted);background:var(--bg)">${y}</td>`;
    quarters.forEach(q => {
      const v = heatmapData[y]?.[q];
      if (v !== undefined) {
        const bg = ndviCellColor(v);
        const tc = textColor(v);
        html += `<td style="background:${bg};color:${tc}" title="NDVI ${v.toFixed(3)} — ${y} Q${q}">${v.toFixed(2)}</td>`;
      } else {
        html += `<td style="background:#f1f5f9;color:#cbd5e1">—</td>`;
      }
    });
    const avgBg = ndviCellColor(rowAvg);
    const avgTc = textColor(rowAvg);
    html += `<td style="background:${avgBg};color:${avgTc};font-weight:700">${rowAvg.toFixed(3)}</td>`;
    html += '</tr>';
  });

  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// ── Final combined score banner ───────────────────────────────────────────
function renderFinalBanner(spatioData, terrainScores) {
  const banner = document.getElementById('spatio-final-banner');
  if (!banner) return;

  // Terrain suitability score (from terrain analysis)
  const terrainScore = terrainScores ? terrainScores.topoScore : null;
  const spatioDelta = spatioData.suitability_score_delta;

  let finalScore = null;
  if (terrainScore !== null && terrainScore !== undefined) {
    finalScore = Math.max(0, Math.min(100, terrainScore + spatioDelta));
  }

  setText('sfb-terrain-score', terrainScore !== null ? terrainScore + '/100' : '—');
  setText('sfb-spatio-delta', (spatioDelta >= 0 ? '+' : '') + spatioDelta + ' pts');

  const finalScoreEl = document.getElementById('sfb-final-score');
  if (finalScoreEl) {
    finalScoreEl.textContent = finalScore !== null ? finalScore + '/100' : '—';
    finalScoreEl.style.color = finalScore >= 65 ? '#84cc16' : finalScore >= 45 ? '#eab308' : '#ef4444';
  }

  // Yield calculation
  // Base yield: from forecastData if available, else terrain estimate
  let baseYield = null;
  if (window.forecastData) {
    baseYield = avg(window.forecastData.historical.map(r => r.yield));
  } else if (terrainScores && terrainScores.details) {
    // Fallback: regional average from REGION_YIELD_AVERAGES
    baseYield = REGION_YIELD_AVERAGES[currentRegionId] || 1.8;
  }

  const terrainMod = terrainScores ? parseFloat(terrainScores.overallModifier) : 1.0;
  const spatioMod = 1.0 + spatioData.yield_adjustment_factor;
  const combinedMod = terrainMod * spatioMod;
  const finalYield = baseYield !== null ? baseYield * combinedMod : null;

  setText('sfb-base-yield', baseYield !== null ? baseYield.toFixed(3) + ' t/ha' : '—');
  setText('sfb-combined-mod', (combinedMod >= 1 ? '+' : '') + ((combinedMod - 1) * 100).toFixed(1) + '%');

  const finalYieldEl = document.getElementById('sfb-final-yield');
  if (finalYieldEl) {
    finalYieldEl.textContent = finalYield !== null ? finalYield.toFixed(3) + ' t/ha' : '—';
  }

  banner.style.display = 'flex';
}

// ── Tiny helper ───────────────────────────────────────────────────────────
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}


// ════════════════════════════════════════════════════════════════════════════
// BAYESIAN-SPATIOTEMPORAL PEST OUTBREAK DETECTION — app.js additions
// ════════════════════════════════════════════════════════════════════════════

// ── Pest module chart instance ──
let pestChart = null;

// ── Auto-fill Helpers ────────────────────────────────────────────────────────

function useCurrentRegionForPest() {
  if (currentRegionId) {
    const sel = document.getElementById('pest-region');
    if (sel) sel.value = currentRegionId;
    showPestMsg(`✅ Region set to ${REGIONS_CACHE[currentRegionId] || 'Region ' + currentRegionId}`, 'success');
  } else {
    showPestMsg('ℹ️ No region selected yet. Select a region in the Forecast tab first.', 'info');
  }
}

// After the original loadRegions populates dropdowns, also fill the cache.
// We do this via a MutationObserver-free approach: override after DOMContentLoaded.
document.addEventListener('DOMContentLoaded', () => {
  // Re-read pest-region options once loaded to fill REGIONS_CACHE
  setTimeout(() => {
    const sel = document.getElementById('region-select');
    if (sel) {
      Array.from(sel.options).forEach(opt => {
        if (opt.value) REGIONS_CACHE[parseInt(opt.value)] = opt.textContent;
      });
    }
  }, 1500);
});

function useForecastValuesForPest() {
  // Read climate from forecast form
  const temp = document.getElementById('calc-temp')?.value || document.getElementById('forecast-temp')?.value;
  const dew = document.getElementById('calc-dew')?.value || document.getElementById('forecast-dew')?.value;
  const precip = document.getElementById('calc-precip')?.value || document.getElementById('forecast-precip')?.value;
  const wind = document.getElementById('calc-wind')?.value || document.getElementById('forecast-wind')?.value;
  const humidity = document.getElementById('calc-humidity')?.value || document.getElementById('forecast-humidity')?.value;
  const quarter = document.getElementById('calc-quarter')?.value || document.getElementById('forecast-quarter')?.value;
  const region = document.getElementById('calc-region')?.value || document.getElementById('region-select')?.value;

  if (temp) document.getElementById('pest-temp').value = temp;
  if (dew) document.getElementById('pest-dew').value = dew;
  if (precip) document.getElementById('pest-precip').value = precip;
  if (wind) document.getElementById('pest-wind').value = wind;
  if (humidity) document.getElementById('pest-humidity').value = humidity;
  if (quarter) document.getElementById('pest-quarter').value = quarter;
  if (region) document.getElementById('pest-region').value = region;

  // Lat/lng from forecast
  if (lastForecastLat) document.getElementById('pest-lat').value = lastForecastLat.toFixed(4);
  if (lastForecastLng) document.getElementById('pest-lng').value = lastForecastLng.toFixed(4);

  showPestMsg('✅ Forecast climate values applied to pest form.', 'success');
}

function useTerrainValuesForPest() {
  let filled = false;
  if (latestTerrainLocation) {
    if (latestTerrainLocation.lat) document.getElementById('pest-lat').value = parseFloat(latestTerrainLocation.lat).toFixed(4);
    if (latestTerrainLocation.lng) document.getElementById('pest-lng').value = parseFloat(latestTerrainLocation.lng).toFixed(4);
    filled = true;
  }
  if (latestTerrainScores && latestTerrainScores.topoScore !== undefined) {
    document.getElementById('pest-terrain-score').value = latestTerrainScores.topoScore;
    filled = true;
  }
  if (filled) {
    showPestMsg('✅ Terrain location and score applied.', 'success');
  } else {
    showPestMsg('ℹ️ No terrain data yet. Run Terrain Analysis first.', 'info');
  }
}

// ── Risk Level CSS class ─────────────────────────────────────────────────────
function pestRiskLevelClass(level) {
  const map = {
    'Low': 'pest-low',
    'Moderate': 'pest-moderate',
    'High': 'pest-high',
    'Severe': 'pest-severe',
  };
  return map[level] || 'pest-low';
}

// ── Tiny message helper ───────────────────────────────────────────────────────
function showPestMsg(msg, type = 'info') {
  const el = document.getElementById('pest-error');
  if (!el) return;
  el.textContent = msg;
  el.className = `error-msg ${type === 'success' ? 'success-msg' : type === 'info' ? 'info-msg' : ''}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

// ── Main Analysis Function ───────────────────────────────────────────────────
async function runPestRiskAnalysis() {
  const regionId = parseInt(document.getElementById('pest-region')?.value);
  const quarter = parseInt(document.getElementById('pest-quarter')?.value);
  const cropStage = document.getElementById('pest-crop-stage')?.value;
  const temp = parseFloat(document.getElementById('pest-temp')?.value);
  const humidity = parseFloat(document.getElementById('pest-humidity')?.value);
  const dew = parseFloat(document.getElementById('pest-dew')?.value);
  const precip = parseFloat(document.getElementById('pest-precip')?.value);
  const wind = parseFloat(document.getElementById('pest-wind')?.value);
  const lat = document.getElementById('pest-lat')?.value ? parseFloat(document.getElementById('pest-lat').value) : null;
  const lng = document.getElementById('pest-lng')?.value ? parseFloat(document.getElementById('pest-lng').value) : null;
  const terrain = document.getElementById('pest-terrain-score')?.value ? parseFloat(document.getElementById('pest-terrain-score').value) : null;
  const water = document.getElementById('pest-water-score')?.value ? parseFloat(document.getElementById('pest-water-score').value) : null;

  // Validation
  const errEl = document.getElementById('pest-error');
  if (!regionId || isNaN(regionId)) { showPestMsg('❌ Please select a region.'); return; }
  if (!quarter || isNaN(quarter)) { showPestMsg('❌ Please select a quarter.'); return; }
  if (isNaN(temp)) { showPestMsg('❌ Temperature is required.'); return; }
  if (isNaN(humidity)) { showPestMsg('❌ Humidity is required.'); return; }
  if (isNaN(dew)) { showPestMsg('❌ Dew point is required.'); return; }
  if (isNaN(precip)) { showPestMsg('❌ Precipitation is required.'); return; }
  if (isNaN(wind)) { showPestMsg('❌ Wind speed is required.'); return; }

  errEl?.classList.add('hidden');

  const btn = document.getElementById('pest-analyze-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span> Running Bayesian Simulation…';

  showLoading("Analyzing Pest Outbreak Risk");

  const payload = {
    region_id: regionId,
    quarter: quarter,
    temperature: temp,
    dew_point: dew,
    precipitation: precip,
    wind_speed: wind,
    humidity: humidity,
    crop_stage: cropStage || 'vegetative',
  };
  if (lat !== null) payload.latitude = lat;
  if (lng !== null) payload.longitude = lng;
  if (terrain !== null) payload.terrain_score = terrain;
  if (water !== null) payload.water_risk_score = water;

  try {
    const res = await fetch(`${API}/api/pest-risk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || `Server error ${res.status}`);
    }
    const data = await res.json();
    pestRiskData = data;
    renderPestRiskResults(data);
  } catch (e) {
    showPestMsg(`❌ Analysis failed: ${e.message}`);
    document.getElementById('pest-results').classList.add('hidden');
  } finally {
    hideLoading();

    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">🦗</span> Analyze Pest Outbreak Risk';
  }
}

// ── Pest Analytics Visualizers ──────────────────────────────────────────────

function destroyPestAnalyticsCharts() {
  if (pestRankingChart) pestRankingChart.destroy();
  if (pestIntervalChart) pestIntervalChart.destroy();
  if (pestFactorChart) pestFactorChart.destroy();
  if (pestSeasonChart) pestSeasonChart.destroy();
  if (pestYieldGaugeChart) pestYieldGaugeChart.destroy();

  pestRankingChart = null;
  pestIntervalChart = null;
  pestFactorChart = null;
  pestSeasonChart = null;
  pestYieldGaugeChart = null;
}

function shortPestName(name) {
  const map = {
    'Brown Planthopper': 'BPH',
    'Green Leafhopper / Tungro Vector': 'GLH/Tungro',
    'Rice Stem Borer': 'Stem Borer',
    'Rice Leaf Folder': 'Leaf Folder',
    'Rice Bug': 'Rice Bug',
    'Armyworm': 'Armyworm',
    'Rice Blast': 'Blast',
    'Bacterial Leaf Blight': 'BLB'
  };

  return map[name] || String(name || 'Pest');
}

function getRiskColor(score) {
  const s = Number(score || 0);

  if (s >= 85) return 'rgba(153, 27, 27, 0.86)';
  if (s >= 65) return 'rgba(220, 38, 38, 0.74)';
  if (s >= 35) return 'rgba(248, 113, 113, 0.62)';
  return 'rgba(254, 202, 202, 0.78)';
}

function getRiskBorderColor(score) {
  const s = Number(score || 0);

  if (s >= 85) return '#7f1d1d';
  if (s >= 65) return '#dc2626';
  if (s >= 35) return '#f87171';
  return '#fecaca';
}

function basePestChartOptions(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    normalized: true,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(15, 23, 42, 0.92)',
        titleFont: { size: 12, weight: '700' },
        bodyFont: { size: 11 },
        padding: 10
      }
    },
    scales: {
      x: {
        grid: { color: 'rgba(148, 163, 184, 0.16)' },
        ticks: { color: '#64748b', font: { size: 10 } }
      },
      y: {
        grid: { color: 'rgba(148, 163, 184, 0.16)' },
        ticks: { color: '#64748b', font: { size: 10 } }
      }
    },
    ...extra
  };
}

function parseYieldImpactValue(impactText, fallbackScore = 0) {
  if (!impactText) return Math.round(Number(fallbackScore || 0) * 0.35);

  const nums = String(impactText).match(/\d+(\.\d+)?/g);
  if (!nums || !nums.length) return Math.round(Number(fallbackScore || 0) * 0.35);

  const values = nums.map(Number);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function getLikelyPest(data) {
  const risks = [...(data?.pest_risks || [])].sort((a, b) => Number(b.risk_score || 0) - Number(a.risk_score || 0));
  return risks[0] || null;
}

function computePestFactorScores(data) {
  const top = getLikelyPest(data);
  const inputs = getPestHeatmapInputs(data);

  if (!top) {
    return {
      labels: ['Temperature', 'Humidity', 'Rainfall', 'Dew Point', 'Wind', 'Water', 'Terrain'],
      values: [0, 0, 0, 0, 0, 0, 0]
    };
  }

  const reasons = (top.main_reasons || []).join(' ').toLowerCase();

  const temp = Math.max(0, Math.min(100, 100 - Math.abs((parseFloat(document.getElementById('pest-temp')?.value) || 28) - 28) * 9));
  const humidity = Math.max(0, Math.min(100, inputs.humidity));
  const rainfall = Math.max(0, Math.min(100, inputs.precip * 7));
  const dew = Math.max(0, Math.min(100, ((parseFloat(document.getElementById('pest-dew')?.value) || 22) / 30) * 100));
  const wind = Math.max(0, Math.min(100, 100 - Math.abs(inputs.wind - 6) * 7));
  const water = Math.max(0, Math.min(100, inputs.water));
  const terrain = Math.max(0, Math.min(100, inputs.terrain));

  const boost = (label, base) => {
    if (reasons.includes(label)) return Math.min(100, base + 12);
    return base;
  };

  return {
    labels: ['Temperature', 'Humidity', 'Rainfall', 'Dew Point', 'Wind', 'Water', 'Terrain'],
    values: [
      boost('temperature', temp),
      boost('humidity', humidity),
      boost('precipitation', rainfall),
      boost('dew', dew),
      boost('wind', wind),
      boost('water', water),
      boost('terrain', terrain)
    ].map(v => Math.round(v))
  };
}

function estimateQuarterRiskForPest(pestName, selectedQuarter, currentRisk) {
  const seasonalProfiles = {
    'Brown Planthopper': [38, 64, 82, 68],
    'Green Leafhopper / Tungro Vector': [32, 72, 80, 45],
    'Rice Stem Borer': [55, 72, 68, 42],
    'Rice Leaf Folder': [35, 70, 76, 45],
    'Rice Bug': [25, 36, 76, 80],
    'Armyworm': [36, 72, 70, 44],
    'Rice Blast': [34, 68, 82, 74],
    'Bacterial Leaf Blight': [30, 70, 84, 76]
  };

  const base = seasonalProfiles[pestName] || [35, 55, 65, 50];
  const selectedIndex = Math.max(0, Math.min(3, Number(selectedQuarter || 1) - 1));
  const selectedBase = base[selectedIndex] || 50;
  const scale = selectedBase > 0 ? Number(currentRisk || 0) / selectedBase : 1;

  return base.map(v => Math.max(0, Math.min(100, Math.round(v * scale))));
}

function renderPestRiskRankingChart(data) {
  const canvas = document.getElementById('pestRankingChart');
  if (!canvas) return;

  const pests = [...(data.pest_risks || [])]
    .sort((a, b) => Number(b.risk_score || 0) - Number(a.risk_score || 0))
    .slice(0, 8);

  const labels = pests.map(p => shortPestName(p.name));
  const values = pests.map(p => Number(p.risk_score || 0));

  pestRankingChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Risk %',
        data: values,
        backgroundColor: values.map(getRiskColor),
        borderColor: values.map(getRiskBorderColor),
        borderWidth: 1,
        borderRadius: 8
      }]
    },
    options: basePestChartOptions({
      indexAxis: 'y',
      scales: {
        x: {
          min: 0,
          max: 100,
          grid: { color: 'rgba(148, 163, 184, 0.16)' },
          ticks: { color: '#64748b', font: { size: 10 }, callback: v => `${v}%` }
        },
        y: {
          grid: { display: false },
          ticks: { color: '#334155', font: { size: 10, weight: '700' } }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` Risk: ${Number(ctx.raw || 0).toFixed(1)}%`
          }
        }
      }
    })
  });
}

function renderPestIntervalChart(data) {
  const canvas = document.getElementById('pestIntervalChart');
  if (!canvas) return;

  const pests = [...(data.pest_risks || [])]
    .sort((a, b) => Number(b.risk_score || 0) - Number(a.risk_score || 0))
    .slice(0, 6);

  const labels = pests.map(p => shortPestName(p.name));
  const lower = pests.map(p => Number(p.credible_interval?.lower || 0));
  const mean = pests.map(p => Number(p.risk_score || 0));
  const upper = pests.map(p => Number(p.credible_interval?.upper || 0));

  pestIntervalChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Lower bound',
          data: lower,
          backgroundColor: 'rgba(254, 202, 202, 0.55)',
          borderColor: '#fecaca',
          borderWidth: 1,
          borderRadius: 8
        },
        {
          label: 'Mean risk',
          data: mean,
          backgroundColor: 'rgba(220, 38, 38, 0.70)',
          borderColor: '#dc2626',
          borderWidth: 1,
          borderRadius: 8
        },
        {
          label: 'Upper bound',
          data: upper,
          backgroundColor: 'rgba(127, 29, 29, 0.62)',
          borderColor: '#7f1d1d',
          borderWidth: 1,
          borderRadius: 8
        }
      ]
    },
    options: basePestChartOptions({
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#334155', font: { size: 9, weight: '700' } }
        },
        y: {
          min: 0,
          max: 100,
          grid: { color: 'rgba(148, 163, 184, 0.16)' },
          ticks: { color: '#64748b', font: { size: 10 }, callback: v => `${v}%` }
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { boxWidth: 10, font: { size: 10 } }
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${Number(ctx.raw || 0).toFixed(1)}%`
          }
        }
      }
    })
  });
}

function renderPestFactorContributionChart(data) {
  const canvas = document.getElementById('pestFactorChart');
  if (!canvas) return;

  const factorData = computePestFactorScores(data);

  pestFactorChart = new Chart(canvas.getContext('2d'), {
    type: 'radar',
    data: {
      labels: factorData.labels,
      datasets: [{
        label: 'Contribution',
        data: factorData.values,
        fill: true,
        backgroundColor: 'rgba(220, 38, 38, 0.18)',
        borderColor: '#dc2626',
        pointBackgroundColor: '#dc2626',
        pointBorderColor: '#ffffff',
        pointRadius: 3,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      normalized: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${Number(ctx.raw || 0).toFixed(0)}%`
          }
        }
      },
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: {
            stepSize: 25,
            display: false
          },
          grid: { color: 'rgba(148, 163, 184, 0.25)' },
          angleLines: { color: 'rgba(148, 163, 184, 0.22)' },
          pointLabels: {
            color: '#334155',
            font: { size: 10, weight: '700' }
          }
        }
      }
    }
  });
}

function renderPestSeasonCalendarChart(data) {
  const canvas = document.getElementById('pestSeasonChart');
  if (!canvas) return;

  const top = getLikelyPest(data);
  if (!top) return;

  const quarter = Number(data.spatiotemporal_context?.quarter || document.getElementById('pest-quarter')?.value || 1);
  const values = estimateQuarterRiskForPest(top.name, quarter, top.risk_score);

  pestSeasonChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: ['Q1', 'Q2', 'Q3', 'Q4'],
      datasets: [{
        label: `${shortPestName(top.name)} seasonal risk`,
        data: values,
        backgroundColor: values.map(getRiskColor),
        borderColor: values.map(getRiskBorderColor),
        borderWidth: 1,
        borderRadius: 10
      }]
    },
    options: basePestChartOptions({
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#334155', font: { size: 11, weight: '700' } }
        },
        y: {
          min: 0,
          max: 100,
          grid: { color: 'rgba(148, 163, 184, 0.16)' },
          ticks: { color: '#64748b', font: { size: 10 }, callback: v => `${v}%` }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: ctx => `${ctx[0].label} vulnerability`,
            label: ctx => ` Estimated risk: ${Number(ctx.raw || 0).toFixed(0)}%`
          }
        }
      }
    })
  });
}

function renderPestYieldGaugeChart(data) {
  const canvas = document.getElementById('pestYieldGaugeChart');
  if (!canvas) return;

  const score = Number(data.overall_risk_score || 0);
  const impactValue = parseYieldImpactValue(data.estimated_yield_impact, score);
  const safeImpact = Math.max(0, Math.min(60, impactValue));
  const remaining = Math.max(0, 60 - safeImpact);

  pestYieldGaugeChart = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Estimated impact', 'Remaining range'],
      datasets: [{
        data: [safeImpact, remaining],
        backgroundColor: [
          getRiskColor(score),
          'rgba(226, 232, 240, 0.85)'
        ],
        borderColor: [
          getRiskBorderColor(score),
          'rgba(226, 232, 240, 1)'
        ],
        borderWidth: 1,
        circumference: 180,
        rotation: 270,
        cutout: '72%'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              if (ctx.dataIndex === 0) return ` Estimated yield impact: ${safeImpact.toFixed(1)}%`;
              return ` Gauge ceiling: 60%`;
            }
          }
        }
      }
    },
    plugins: [{
      id: 'pestGaugeCenterText',
      afterDraw(chart) {
        const { ctx, chartArea } = chart;
        if (!chartArea) return;

        const x = (chartArea.left + chartArea.right) / 2;
        const y = chartArea.bottom - 18;

        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillStyle = '#0f172a';
        ctx.font = '800 30px Outfit, sans-serif';
        ctx.fillText(`${safeImpact.toFixed(1)}%`, x, y - 22);

        ctx.fillStyle = '#64748b';
        ctx.font = '700 12px Outfit, sans-serif';
        ctx.fillText('estimated unmanaged yield impact', x, y);
        ctx.restore();
      }
    }]
  });

  const note = document.getElementById('pest-gauge-note');
  if (note) {
    note.textContent =
      `PAL-AI estimates around ${safeImpact.toFixed(1)}% potential yield impact if the detected pest risk is left unmanaged. This is a planning estimate, not a confirmed crop loss measurement.`;
  }
}

function renderPestAnalyticsCharts(data) {
  destroyPestAnalyticsCharts();

  if (!data || !Array.isArray(data.pest_risks)) return;

  renderPestRiskRankingChart(data);
  renderPestIntervalChart(data);
  renderPestFactorContributionChart(data);
  renderPestSeasonCalendarChart(data);
  renderPestYieldGaugeChart(data);
}

// ── Render Results ───────────────────────────────────────────────────────────
function renderPestRiskResults(data) {
  pestRiskData = data;
  const resultsEl = document.getElementById('pest-results');
  resultsEl.classList.remove('hidden');

  // Overall score card
  const scoreEl = document.getElementById('pest-score-display');
  const levelEl = document.getElementById('pest-level-badge');
  const cardEl = document.getElementById('pest-overall-card');
  const lvlClass = pestRiskLevelClass(data.overall_risk_level);

  if (scoreEl) scoreEl.textContent = data.overall_risk_score.toFixed(0) + '%';
  if (levelEl) {
    levelEl.textContent = data.overall_risk_level;
    levelEl.className = `pest-level-badge ${lvlClass}`;
  }
  if (cardEl) {
    cardEl.className = `pest-summary-card pest-card-accent-${lvlClass}`;
  }

  // Likely pest
  setText('pest-likely-name', data.likely_pest);
  const topPest = data.pest_risks.find(p => p.name === data.likely_pest);
  setText('pest-likely-category', topPest ? topPest.category.charAt(0).toUpperCase() + topPest.category.slice(1) : '');

  // Confidence
  setText('pest-confidence', data.bayesian_confidence + ' Confidence');
  setText('pest-interval', `${data.credible_interval.lower.toFixed(0)}–${data.credible_interval.upper.toFixed(0)}%`);

  // Yield impact
  setText('pest-yield-impact', data.estimated_yield_impact);

  // Summary
  const summaryEl = document.getElementById('pest-summary-box');
  if (summaryEl) summaryEl.textContent = data.summary;

  // Spatiotemporal context
  renderPestSpatioContext(data.spatiotemporal_context);

  // Pest analytics charts
  renderPestAnalyticsCharts(data);

  // Pest cards
  renderPestCards(data.pest_risks);

  // Recommendations
  renderPestRecommendations(data);

  // Smooth spatial heatmap
  drawSmoothPestRiskHeatmap(data);

  // Minimap of the heatmap
  updatePestRiskMiniMap(data);

  // Scroll to results
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPestSpatioContext(ctx) {
  const grid = document.getElementById('pest-spatio-grid');
  if (!grid || !ctx) return;

  const items = [
    { label: 'Season', value: ctx.season_label },
    { label: 'Crop Stage', value: ctx.crop_stage },
    { label: 'NDVI Proxy', value: ctx.ndvi_proxy !== null ? ctx.ndvi_proxy.toFixed(3) : 'N/A' },
    { label: 'LST Proxy', value: ctx.lst_proxy !== null ? ctx.lst_proxy.toFixed(1) + ' °C' : 'N/A' },
    { label: 'EVI Proxy', value: ctx.evi_proxy !== null ? ctx.evi_proxy.toFixed(3) : 'N/A' },
    { label: 'Terrain Used', value: ctx.terrain_modifier_used ? '✅ Yes' : '— No' },
    { label: 'Water Used', value: ctx.water_modifier_used ? '✅ Yes' : '— No' },
    { label: 'Trend', value: ctx.trend_interpretation },
  ];

  grid.innerHTML = items.map(item => `
    <div class="pest-spatio-item">
      <div class="psi-label">${item.label}</div>
      <div class="psi-value">${item.value}</div>
    </div>
  `).join('');
}

function pestEmojiFallback(name) {
  const map = {
    'Brown Planthopper': '🦗',
    'Green Leafhopper / Tungro Vector': '🍃',
    'Rice Stem Borer': '🐛',
    'Rice Leaf Folder': '🌿',
    'Rice Bug': '🐞',
    'Armyworm': '🐛',
    'Rice Blast': '🍂',
    'Bacterial Leaf Blight': '🦠'
  };

  return map[name] || '🌾';
}

function renderPestCards(pests) {
  const container = document.getElementById('pest-card-grid');
  if (!container) return;

  container.innerHTML = pests.map((pest, idx) => {
    const lvlClass = pestRiskLevelClass(pest.risk_level);
    const pct = Math.max(0, Math.min(96, Number(pest.risk_score || 0))).toFixed(0);
    const topReasons = (pest.main_reasons || [])
      .slice(0, 2)
      .map(r => `<li>${r}</li>`)
      .join('');

    const imgSrc = pest.image_url
      ? (pest.image_url.startsWith('http') ? pest.image_url : `${API}${pest.image_url}`)
      : '';

    const imageBlock = imgSrc
      ? `
        <div class="pest-image-wrap">
          <img
            src="${imgSrc}"
            alt="${pest.name}"
            loading="lazy"
            onerror="this.style.display='none'; this.parentElement.classList.add('pest-img-missing');"
          />
          <div class="pest-image-placeholder">${pestEmojiFallback(pest.name)}</div>
        </div>
      `
      : `
        <div class="pest-image-wrap pest-img-missing">
          <div class="pest-image-placeholder">${pestEmojiFallback(pest.name)}</div>
        </div>
      `;

    return `
      <div class="pest-card ${idx === 0 ? 'pest-card-top' : ''}">
        ${imageBlock}

        <div class="pest-card-header">
          <div class="pest-card-name">${pest.name}</div>
          <div class="pest-level-badge ${lvlClass}">${pest.risk_level}</div>
        </div>

        <div class="pest-card-category">${pest.category}</div>

        <div class="pest-progress-wrap">
          <div class="pest-progress">
            <div class="pest-progress-fill ${lvlClass}" style="width:${pct}%"></div>
          </div>
          <span class="pest-progress-label">${pct}%</span>
        </div>

        <div class="pest-card-interval">
          Credible interval:
          ${Number(pest.credible_interval?.lower || 0).toFixed(0)}–${Number(pest.credible_interval?.upper || 0).toFixed(0)}%
          &nbsp;·&nbsp; ${pest.confidence} confidence
        </div>

        <div class="pest-card-yield">
          Yield impact if unmanaged:
          <strong>${pest.yield_impact_pct}</strong>
        </div>

        <ul class="pest-card-reasons">${topReasons}</ul>

        <details class="pest-card-details">
          <summary>View symptoms &amp; actions</summary>

          <div class="pest-detail-section">
            <strong>Symptoms:</strong>
            <ul>${(pest.symptoms || []).map(s => `<li>${s}</li>`).join('')}</ul>
          </div>

          <div class="pest-detail-section">
            <strong>Recommended actions:</strong>
            <ul>${(pest.actions || []).map(a => `<li>${a}</li>`).join('')}</ul>
          </div>
        </details>
      </div>
    `;
  }).join('');
}

// ── Pest Outbreak Heatmap ───────────────────────────────────────────────────

// ── Pest Risk Reference Minimap ─────────────────────────────────────────────

// ── Pest Risk Actual Map Overlay ────────────────────────────────────────────

function initPestRiskMiniMap() {
  const el = document.getElementById('pest-risk-minimap');

  if (!el) return;
  if (pestMiniMap) return;

  pestMiniMap = L.map('pest-risk-minimap', {
    zoomControl: true,
    attributionControl: true,
    dragging: true,
    scrollWheelZoom: false,
    doubleClickZoom: true,
    boxZoom: true,
    keyboard: true,
    tap: true,
    touchZoom: true
  }).setView([12.0, 122.0], 6);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 18,
    keepBuffer: 4,
    opacity: 0.92
  }).addTo(pestMiniMap);
}

function getPestAnalysisLocation() {
  const latInput = parseFloat(document.getElementById('pest-lat')?.value);
  const lngInput = parseFloat(document.getElementById('pest-lng')?.value);

  if (Number.isFinite(latInput) && Number.isFinite(lngInput)) {
    return { lat: latInput, lng: lngInput, source: 'Pest Risk coordinates' };
  }

  if (latestTerrainLocation?.lat && latestTerrainLocation?.lng) {
    return {
      lat: Number(latestTerrainLocation.lat),
      lng: Number(latestTerrainLocation.lng),
      source: 'Latest terrain scan'
    };
  }

  if (lastForecastLat && lastForecastLng) {
    return {
      lat: Number(lastForecastLat),
      lng: Number(lastForecastLng),
      source: 'Forecast map pin'
    };
  }

  const regionId = parseInt(document.getElementById('pest-region')?.value || currentRegionId || 0);
  if (regionId && REGION_COORDS[regionId]) {
    const [lat, lng] = REGION_COORDS[regionId];
    return {
      lat,
      lng,
      source: REGIONS_CACHE[regionId] || PH_GEO[regionId]?.name || `Region ${regionId}`
    };
  }

  return null;
}

function pestOverlayRedColor(t) {
  // Green -> yellow -> red gradient for Leaflet map overlay
  t = Math.max(0, Math.min(1, t));

  const alpha = 0.10 + t * 0.52;

  if (t < 0.5) {
    const k = t / 0.5;
    const r = Math.round(34 + k * (250 - 34));
    const g = Math.round(197 + k * (204 - 197));
    const b = Math.round(94 + k * (21 - 94));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const k = (t - 0.5) / 0.5;
  const r = Math.round(250 + k * (220 - 250));
  const g = Math.round(204 + k * (38 - 204));
  const b = Math.round(21 + k * (38 - 21));

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function createPestHeatmapOverlayImage(data, size = 768) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  const w = size;
  const h = size;

  const inputs = getPestHeatmapInputs(data);
  const riskNorm = Math.max(0.05, Math.min(0.95, inputs.overall / 100));

  const areaKm = getPestHeatmapAreaKm();
  const areaScale = Math.max(0.4, Math.min(4.0, areaKm / 5));

  ctx.clearRect(0, 0, w, h);

  // Transparent background so the real map remains visible.
  ctx.fillStyle = 'rgba(255,255,255,0)';
  ctx.fillRect(0, 0, w, h);

  // High-resolution raster grid.
  const cols = 80;
  const rows = 80;
  const cellW = w / cols;
  const cellH = h / rows;

  const regionId = document.getElementById('pest-region')?.value || '0';
  const seed = hashPestSeed(`${regionId}-${inputs.topPest}-${inputs.lat}-${inputs.lng}-${areaKm}`);
  const rand = seededRandom(seed);

  const hotspotCount = Math.min(
    18,
    Math.max(
      4,
      Math.round(4 + riskNorm * 5 + Math.log2(areaKm + 1) * 2)
    )
  );

  const hotspots = [];

  const waterBias = (inputs.water - 50) / 100;
  const terrainBias = (inputs.terrain - 50) / 120;
  const windShift = Math.max(-0.12, Math.min(0.12, (inputs.wind - 6) / 40));

  for (let i = 0; i < hotspotCount; i++) {
    let x = (0.12 + rand() * 0.76) * w;
    let y = (0.12 + rand() * 0.76) * h;

    x += waterBias * w * 0.10 + windShift * w;
    y += waterBias * h * 0.08 - terrainBias * h * 0.06;

    x = Math.max(w * 0.06, Math.min(w * 0.94, x));
    y = Math.max(h * 0.06, Math.min(h * 0.94, y));

    hotspots.push({
      x,
      y,
      strength: Math.max(0.18, Math.min(1, riskNorm + (rand() - 0.5) * 0.25)),
      radius: w * ((0.18 + rand() * 0.10 + riskNorm * 0.06) / Math.sqrt(areaScale))
    });
  }

  // Center hotspot around the selected coordinate.
  hotspots.push({
    x: w / 2,
    y: h / 2,
    strength: Math.min(1, riskNorm + 0.10),
    radius: w * ((0.22 + riskNorm * 0.08) / Math.sqrt(areaScale))
  });

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * cellW;
      const y = row * cellH;
      const cx = x + cellW / 2;
      const cy = y + cellH / 2;

      let intensity = 0.00;

      for (const hot of hotspots) {
        const dx = cx - hot.x;
        const dy = cy - hot.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const influence = Math.max(0, 1 - dist / hot.radius);
        intensity += influence * hot.strength * 0.85;
      }

      // Climate field modifiers.
      intensity += Math.max(0, (inputs.humidity - 65) / 100) * 0.08;
      intensity += Math.max(0, inputs.precip / 25) * 0.05;

      // Larger scanned areas should not look equally saturated everywhere.
      intensity = intensity / Math.sqrt(areaScale);
      intensity = Math.max(0, Math.min(1, intensity));

      // Very low intensity stays almost transparent.
      if (intensity < 0.08) continue;

      ctx.fillStyle = pestOverlayRedColor(intensity);
      ctx.fillRect(x, y, cellW + 0.3, cellH + 0.3);
    }
  }

  // Add a subtle risk-colored boundary fade around the central area.
  const centerGradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.42);
  centerGradient.addColorStop(0, pestOverlayRedColor(Math.min(1, riskNorm + 0.12)));
  centerGradient.addColorStop(0.55, pestOverlayRedColor(Math.max(0, riskNorm * 0.65)));
  centerGradient.addColorStop(1, 'rgba(34, 197, 94, 0)');

  ctx.fillStyle = centerGradient;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2);
  ctx.fill();

  return canvas.toDataURL('image/png');
}

function updatePestRiskMiniMap(data = null) {
  initPestRiskMiniMap();

  if (!pestMiniMap) return;

  const location = getPestAnalysisLocation();
  const sizeLabel = document.getElementById('pest-minimap-size');
  const coordLabel = document.getElementById('pest-minimap-coords');

  if (!location) {
    if (sizeLabel) sizeLabel.textContent = 'No location';
    if (coordLabel) coordLabel.textContent = 'No valid pest-risk coordinates were found.';
    return;
  }

  const { lat, lng, source } = location;
  const gridKm = getPestHeatmapAreaKm();
  const bounds = getTerrainBounds(lat, lng, gridKm);

  // Force Leaflet to fully update the displayed scanned area.
  if (pestMiniMap) {
    pestMiniMap.invalidateSize();
  }

  if (pestHeatOverlay) {
    pestMiniMap.removeLayer(pestHeatOverlay);
    pestHeatOverlay = null;
  }

  if (pestMiniMarker) {
    pestMiniMap.removeLayer(pestMiniMarker);
    pestMiniMarker = null;
  }

  if (pestMiniRect) {
    pestMiniMap.removeLayer(pestMiniRect);
    pestMiniRect = null;
  }

  const riskLevel = data?.overall_risk_level || 'Risk Area';
  const riskScore = Number(data?.overall_risk_score || 0);

  let rectColor = '#ef4444';
  let fillOpacity = 0.05;

  if (riskScore >= 85) {
    rectColor = '#991b1b';
    fillOpacity = 0.07;
  } else if (riskScore >= 65) {
    rectColor = '#dc2626';
    fillOpacity = 0.06;
  } else if (riskScore >= 35) {
    rectColor = '#ef4444';
    fillOpacity = 0.045;
  } else {
    rectColor = '#fca5a5';
    fillOpacity = 0.035;
  }

  // 1. Add the generated heatmap image directly on the real map.
  if (data) {
    const overlayImage = createPestHeatmapOverlayImage(data, 768);

    pestHeatOverlay = L.imageOverlay(overlayImage, bounds, {
      opacity: 0.78,
      interactive: false,
      zIndex: 410
    }).addTo(pestMiniMap);
  }

  // 2. Add scanned area rectangle.
  pestMiniRect = L.rectangle(bounds, {
    color: rectColor,
    weight: 2,
    fillColor: rectColor,
    fillOpacity,
    zIndex: 420
  }).addTo(pestMiniMap);

  // 3. Add center marker.
  pestMiniMarker = L.circleMarker([lat, lng], {
    radius: 6,
    color: '#ffffff',
    weight: 2,
    fillColor: rectColor,
    fillOpacity: 1,
    zIndex: 430
  }).addTo(pestMiniMap);

  pestMiniRect.bindPopup(`
    <strong>Pest Vulnerability Overlay</strong><br>
    Size: ${gridKm} km × ${gridKm} km<br>
    Risk: ${riskScore.toFixed(0)}% ${riskLevel}<br>
    Center: ${lat.toFixed(4)}, ${lng.toFixed(4)}
  `);

  pestMiniMap.fitBounds(bounds, {
    padding: [24, 24],
    maxZoom: gridKm <= 3 ? 15 : gridKm <= 8 ? 14 : 13
  });

  setTimeout(() => {
    pestMiniMap.invalidateSize();
  }, 200);

  if (sizeLabel) {
    sizeLabel.textContent = `${gridKm} km × ${gridKm} km`;
  }

  if (coordLabel) {
    coordLabel.textContent =
      `Overlay centered at ${lat.toFixed(4)}, ${lng.toFixed(4)} from ${source}. ` +
      `The red raster layer shows relative pest outbreak vulnerability over the actual map.`;
  }
}

function redrawPestHeatmapVisuals() {
  if (!pestRiskData) return;

  // Redraw the standalone heatmap canvas if it exists.
  if (typeof drawSmoothPestRiskHeatmap === 'function') {
    drawSmoothPestRiskHeatmap(pestRiskData);
  }

  // Redraw the actual Leaflet map overlay if it exists.
  if (typeof updatePestRiskMiniMap === 'function') {
    updatePestRiskMiniMap(pestRiskData);
  }
}

// ════════════════════════════════════════
// PAL-AI Visual Stability Guard
// Prevents blank canvases/charts after browser idle, tab sleep, or GPU pause.
// ════════════════════════════════════════

let palaiVisualRecoveryTimer = null;

function safeChartRefresh(chart) {
  if (!chart) return;

  try {
    chart.resize();
    chart.update('none');
  } catch (err) {
    console.warn('Chart refresh skipped:', err);
  }
}

function refreshAllChartInstances() {
  [
    annualChart,
    quarterlyChart,
    climateChart,
    popupChartInstance,
    terrainProfileChart,
    spatioNdviChart,
    spatioLstChart,
    pestRankingChart,
    pestIntervalChart,
    pestFactorChart,
    pestSeasonChart,
    pestYieldGaugeChart
  ].forEach(safeChartRefresh);

  // Backup refresh for any Chart.js instance not captured above.
  try {
    if (window.Chart && Chart.instances) {
      Object.values(Chart.instances).forEach(safeChartRefresh);
    }
  } catch (err) {
    console.warn('Global Chart.js refresh skipped:', err);
  }
}

function redrawSpatioCanvasesOnly() {
  const data = latestSpatiotemporalData;
  if (!data) return;

  const panels = [
    { id: 'spCanvas-ndvi-pre', value: data.pre_monsoon_ndvi, type: 'ndvi' },
    { id: 'spCanvas-ndvi-post', value: data.post_monsoon_ndvi, type: 'ndvi' },
    { id: 'spCanvas-evi', value: data.post_monsoon_evi, type: 'ndvi' },
    { id: 'spCanvas-lst-pre', value: data.pre_monsoon_lst, type: 'lst' },
    { id: 'spCanvas-lst-post', value: data.post_monsoon_lst, type: 'lst' },
    {
      id: 'spCanvas-delta',
      value: data.post_monsoon_ndvi - data.pre_monsoon_ndvi,
      type: 'delta'
    }
  ];

  panels.forEach(p => {
    const canvas = document.getElementById(p.id);
    if (canvas && typeof drawSpatioPanel === 'function') {
      drawSpatioPanel(canvas, p.value, p.type, data);
    }
  });
}

function refreshLeafletMaps() {
  [geoMap, forecastMap, terrainMiniMap, pestMiniMap].forEach(map => {
    try {
      if (map) map.invalidateSize();
    } catch (err) {
      console.warn('Leaflet map refresh skipped:', err);
    }
  });
}

function recoverPALAIVisuals(reason = 'manual') {
  forceHideLoading();

  requestAnimationFrame(() => {
    try {
      refreshAllChartInstances();
      refreshLeafletMaps();

      if (pestRiskData) {
        if (typeof drawSmoothPestRiskHeatmap === 'function') {
          drawSmoothPestRiskHeatmap(pestRiskData);
        }

        if (typeof updatePestRiskMiniMap === 'function') {
          updatePestRiskMiniMap(pestRiskData);
        }

        if (typeof renderPestAnalyticsCharts === 'function') {
          renderPestAnalyticsCharts(pestRiskData);
        }
      }

      redrawSpatioCanvasesOnly();

      if (latestFertilizerAnalysis && typeof renderFertilizerAnalysis === 'function') {
        renderFertilizerAnalysis(latestFertilizerAnalysis);
      }

      if (window.Terrain && typeof Terrain.resumeRenderer === 'function') {
        Terrain.resumeRenderer();
      }

      console.info(`PAL-AI visuals recovered: ${reason}`);
    } catch (err) {
      console.warn('PAL-AI visual recovery failed:', err);
    }
  });
}

function schedulePALAIVisualRecovery(reason = 'scheduled') {
  clearTimeout(palaiVisualRecoveryTimer);

  palaiVisualRecoveryTimer = setTimeout(() => {
    recoverPALAIVisuals(reason);
  }, 250);
}

window.recoverPALAIVisuals = recoverPALAIVisuals;
window.schedulePALAIVisualRecovery = schedulePALAIVisualRecovery;

function getPestHeatmapAreaKm() {
  const heatmapInput = document.getElementById('pest-heatmap-km');
  const raw = parseFloat(heatmapInput?.value);

  if (Number.isFinite(raw)) {
    return Math.max(1, Math.min(20, raw));
  }

  if (latestTerrainLocation && latestTerrainLocation.gridKm) {
    return Math.max(1, Math.min(20, Number(latestTerrainLocation.gridKm)));
  }

  const terrainGrid = parseFloat(document.getElementById('terrain-grid')?.value);
  if (Number.isFinite(terrainGrid)) {
    return Math.max(1, Math.min(20, terrainGrid));
  }

  return 5;
}

function updatePestHeatmapAxisLabels(areaKm) {
  const half = areaKm / 2;

  const top = document.getElementById('pest-heatmap-y-top');
  const bottom = document.getElementById('pest-heatmap-y-bottom');
  const left = document.getElementById('pest-heatmap-x-left');
  const right = document.getElementById('pest-heatmap-x-right');

  if (top) top.textContent = `+${half.toFixed(1)} km`;
  if (bottom) bottom.textContent = `-${half.toFixed(1)} km`;
  if (left) left.textContent = `-${half.toFixed(1)} km`;
  if (right) right.textContent = `+${half.toFixed(1)} km`;
}

function pestHeatColor(t) {
  // Green -> yellow -> red gradient for smooth/transparent heatmap use
  t = Math.max(0, Math.min(1, t));

  const alpha = 0.10 + (t * 0.62);

  if (t < 0.5) {
    const k = t / 0.5;
    const r = Math.round(34 + k * (250 - 34));
    const g = Math.round(197 + k * (204 - 197));
    const b = Math.round(94 + k * (21 - 94));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const k = (t - 0.5) / 0.5;
  const r = Math.round(250 + k * (220 - 250));
  const g = Math.round(204 + k * (38 - 204));
  const b = Math.round(21 + k * (38 - 21));

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function pestHeatSolidColor(t) {
  // Green -> yellow -> red gradient for high-resolution grid heatmap
  t = Math.max(0, Math.min(1, t));

  if (t < 0.5) {
    const k = t / 0.5;
    const r = Math.round(34 + k * (250 - 34));   // 34 -> 250
    const g = Math.round(197 + k * (204 - 197)); // 197 -> 204
    const b = Math.round(94 + k * (21 - 94));    // 94 -> 21
    return `rgb(${r}, ${g}, ${b})`;
  }

  const k = (t - 0.5) / 0.5;
  const r = Math.round(250 + k * (220 - 250));  // 250 -> 220
  const g = Math.round(204 + k * (38 - 204));   // 204 -> 38
  const b = Math.round(21 + k * (38 - 21));     // 21 -> 38

  return `rgb(${r}, ${g}, ${b})`;
}

function hashPestSeed(text) {
  let h = 2166136261;
  const s = String(text || 'PAL-AI');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function seededRandom(seed) {
  let x = seed || 123456789;
  return function () {
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    return ((x >>> 0) / 4294967295);
  };
}

function getPestHeatmapInputs(data) {
  const overall = Number(data?.overall_risk_score || 0);
  const topPest = data?.likely_pest || 'Unknown Pest';

  const water = parseFloat(document.getElementById('pest-water-score')?.value);
  const terrain = parseFloat(document.getElementById('pest-terrain-score')?.value);
  const wind = parseFloat(document.getElementById('pest-wind')?.value);
  const humidity = parseFloat(document.getElementById('pest-humidity')?.value);
  const precip = parseFloat(document.getElementById('pest-precip')?.value);
  const lat = parseFloat(document.getElementById('pest-lat')?.value);
  const lng = parseFloat(document.getElementById('pest-lng')?.value);

  return {
    overall: Math.max(0, Math.min(100, overall)),
    topPest,
    water: Number.isFinite(water) ? water : 50,
    terrain: Number.isFinite(terrain) ? terrain : 50,
    wind: Number.isFinite(wind) ? wind : 5,
    humidity: Number.isFinite(humidity) ? humidity : 75,
    precip: Number.isFinite(precip) ? precip : 3,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null
  };
}

function drawSmoothPestRiskHeatmap(data) {
  const canvas = document.getElementById('pestHeatmapCanvas');
  if (!canvas || !data) return;

  const ctx = canvas.getContext('2d');

  const displaySize = Math.min(canvas.clientWidth || 720, 760);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.floor(displaySize * pixelRatio);
  canvas.height = Math.floor(displaySize * pixelRatio);
  canvas.style.height = `${displaySize}px`;

  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  const w = displaySize;
  const h = displaySize;

  const areaKm = getPestHeatmapAreaKm();
  updatePestHeatmapAxisLabels(areaKm);

  const areaScale = Math.max(0.4, Math.min(4.0, areaKm / 5));

  const inputs = getPestHeatmapInputs(data);
  const riskNorm = Math.max(0.05, Math.min(0.95, inputs.overall / 100));

  ctx.clearRect(0, 0, w, h);

  // Background
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#f8fafc');
  bg.addColorStop(0.5, '#f1f5f9');
  bg.addColorStop(1, '#fff7ed');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Grid heatmap settings
  const cols = 100;   // increase for higher resolution
  const rows = 100;
  const cellW = w / cols;
  const cellH = h / rows;

  const regionId = document.getElementById('pest-region')?.value || '0';
  const seed = hashPestSeed(`${regionId}-${inputs.topPest}-${inputs.lat}-${inputs.lng}-${areaKm}`);
  const rand = seededRandom(seed);

  // Create several hotspot centers
  const hotspotCount = Math.min(
    18,
    Math.max(
      4,
      Math.round(4 + riskNorm * 5 + Math.log2(areaKm + 1) * 2)
    )
  );
  const hotspots = [];

  const waterBias = (inputs.water - 50) / 100;
  const terrainBias = (inputs.terrain - 50) / 120;
  const windShift = Math.max(-0.12, Math.min(0.12, (inputs.wind - 6) / 40));

  for (let i = 0; i < hotspotCount; i++) {
    let x = (0.15 + rand() * 0.70) * w;
    let y = (0.15 + rand() * 0.70) * h;

    x += waterBias * w * 0.10 + windShift * w;
    y += waterBias * h * 0.08 - terrainBias * h * 0.06;

    x = Math.max(w * 0.08, Math.min(w * 0.92, x));
    y = Math.max(h * 0.08, Math.min(h * 0.92, y));

    hotspots.push({
      x,
      y,
      strength: Math.max(0.2, Math.min(1, riskNorm + (rand() - 0.5) * 0.25)),
      radius: w * ((0.18 + rand() * 0.10 + riskNorm * 0.06) / Math.sqrt(areaScale))
    });
  }

  // Add center hotspot
  hotspots.push({
    x: w / 2,
    y: h / 2,
    strength: Math.min(1, riskNorm + 0.10),
    radius: w * ((0.22 + riskNorm * 0.08) / Math.sqrt(areaScale))
  });

  // Draw high-resolution heatmap cells
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * cellW;
      const y = row * cellH;
      const cx = x + cellW / 2;
      const cy = y + cellH / 2;

      let intensity = 0.06;

      for (const hot of hotspots) {
        const dx = cx - hot.x;
        const dy = cy - hot.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const influence = Math.max(0, 1 - dist / hot.radius);
        intensity += influence * hot.strength * 0.9;
      }

      // Humidity and rainfall slightly raise overall field intensity
      intensity += ((inputs.humidity - 60) / 100) * 0.08;
      intensity += (inputs.precip / 20) * 0.06;

      intensity = intensity / Math.sqrt(areaScale);
      intensity = Math.max(0, Math.min(1, intensity));

      ctx.fillStyle = pestHeatSolidColor(intensity);
      ctx.fillRect(x, y, cellW + 0.4, cellH + 0.4);
    }
  }

  // Draw thin grid lines so it stays readable
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 0.6;

  for (let c = 0; c <= cols; c++) {
    const gx = c * cellW;
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, h);
    ctx.stroke();
  }

  for (let r = 0; r <= rows; r++) {
    const gy = r * cellH;
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }
  ctx.restore();

  // Stronger major measurement guides
  ctx.save();
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.22)';
  ctx.lineWidth = 1.2;

  const divisions = 4;
  for (let i = 1; i < divisions; i++) {
    const p = (i / divisions) * w;

    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, h);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(w, p);
    ctx.stroke();
  }
  ctx.restore();

  // Border
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.20)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0.75, 0.75, w - 1.5, h - 1.5);

  // Center marker
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#84cc16';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // Scale bar
  const scaleKm = areaKm >= 10 ? 2 : 1;
  const scalePx = (scaleKm / areaKm) * w;
  const sx = 24;
  const sy = h - 30;

  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + scalePx, sy);
  ctx.stroke();

  ctx.fillStyle = '#0f172a';
  ctx.font = '700 12px Outfit, sans-serif';
  ctx.fillText(`${scaleKm} km`, sx, sy - 8);

  // Title
  ctx.fillStyle = 'rgba(15, 23, 42, 0.76)';
  ctx.font = '700 13px Outfit, sans-serif';
  ctx.fillText(`${areaKm} km × ${areaKm} km scanned area`, 18, 24);

  // Badge
  const badge = document.getElementById('pest-heatmap-badge');
  if (badge) {
    badge.textContent = `${inputs.overall.toFixed(0)}% ${data.overall_risk_level}`;
  }

  // Info text
  const info = document.getElementById('pest-heatmap-info');
  if (info) {
    const coordText =
      inputs.lat !== null && inputs.lng !== null
        ? ` Center: ${inputs.lat.toFixed(4)}, ${inputs.lng.toFixed(4)}.`
        : '';

    info.textContent =
      `Heatmap shows estimated relative outbreak danger zones for ${data.likely_pest} across a ${areaKm} km × ${areaKm} km area.${coordText} ` +
      `This version uses a high-resolution grid heatmap for clearer zone mapping; field scouting is still required.`;
  }
}

function renderPestRecommendations(data) {
  const actionEl = document.getElementById('pest-action-list');
  const scoutEl = document.getElementById('pest-scouting-list');

  if (actionEl) {
    actionEl.innerHTML = data.recommendations
      .map(r => `<li class="pest-action-item">${r}</li>`)
      .join('');
  }

  if (scoutEl) {
    scoutEl.innerHTML = data.scouting_checklist
      .map(s => `<li class="pest-scout-item"><span class="pest-check">☐</span> ${s}</li>`)
      .join('');
  }
}

// ── Terrain/Spatio integration hooks ────────────────────────────────────────
// These are called from existing terrain analysis functions if you wire them in.
// We hook into the global after terrain analysis runs.
const _origRunTerrainAnalysis = window.runTerrainAnalysis;
if (typeof runTerrainAnalysis === 'function') {
  // Will be patched once defined — see below
}

// Expose hooks for terrain.js to call
window._onTerrainScoresComputed = function (scores, location) {
  latestTerrainScores = scores;
  latestTerrainLocation = location;
};

window._onSpatiotemporalData = function (data) {
  latestSpatiotemporalData = data;
};


/* ════════════════════════════════════════
   PALADIN — Floating LLM Rice Farming Assistant
   ════════════════════════════════════════ */

// ── PALADIN State ──
let paladinOpen = false;
let paladinImageModeOn = false;
let paladinMemory = {
  messages: [],          // recent conversation turns [{role, content}]
  lastContext: null,
  lastImageDiagnosis: null,
};

// ── Toggle chat window ──
function togglePaladinChat() {
  const win = document.getElementById('paladin-window');
  paladinOpen = !paladinOpen;
  if (paladinOpen) {
    win.classList.remove('paladin-hidden');
    document.getElementById('paladin-input').focus();
  } else {
    win.classList.add('paladin-hidden');
  }
}

// ── Toggle fullscreen ──
let paladinIsFullscreen = false;
function togglePaladinFullscreen() {
  const win = document.getElementById('paladin-window');
  const btn = document.getElementById('paladin-fs-btn');
  paladinIsFullscreen = !paladinIsFullscreen;
  if (paladinIsFullscreen) {
    win.classList.add('paladin-fullscreen');
    btn.textContent = '⛶'; // same icon works as toggle
    btn.title = 'Exit Fullscreen';
  } else {
    win.classList.remove('paladin-fullscreen');
    btn.title = 'Fullscreen';
  }
}

// ── Toggle image mode ──
function togglePaladinImageMode() {
  paladinImageModeOn = document.getElementById('paladin-image-mode').checked;
  const uploadArea = document.getElementById('paladin-upload-area');
  if (paladinImageModeOn) {
    uploadArea.classList.remove('paladin-hidden');
  } else {
    uploadArea.classList.add('paladin-hidden');
  }
}

// ── Trigger file picker ──
function triggerPaladinImageUpload() {
  document.getElementById('paladin-image-upload').click();
}

// ── Enter key handler ──
function handlePaladinEnter(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendPaladinMessage();
  }
}

// ── Quick-send a prompt button ──
function paladinQuickSend(text) {
  // Hide the prompt buttons after first use
  const promptsEl = document.getElementById('paladin-prompts');
  if (promptsEl) promptsEl.style.display = 'none';

  // Put text into input and send
  const inputEl = document.getElementById('paladin-input');
  if (inputEl) inputEl.value = text;
  sendPaladinMessage();
}

// ── Append a message bubble ──
function appendPaladinMessage(role, content, extraClass) {
  const container = document.getElementById('paladin-messages');
  const msgDiv = document.createElement('div');
  msgDiv.className = `paladin-msg paladin-${role}${extraClass ? ' ' + extraClass : ''}`;

  const bubble = document.createElement('div');
  bubble.className = 'paladin-bubble';

  if (role === 'loading') {
    bubble.innerHTML = `<div class="paladin-loading"><span></span><span></span><span></span></div>`;
    msgDiv.className = 'paladin-msg paladin-bot';
  } else {
    bubble.innerHTML = paladinMarkdown(content);
    paladinRenderCharts(bubble, content);
    paladinShowDiseasePhoto(bubble, content);
  }

  msgDiv.appendChild(bubble);
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
  return msgDiv;
}

function appendPaladinTyped(rawContent) {
  // Keep the original raw text for chart/photo parsing
  const _raw = rawContent || '';
  // Strip the JSON data block from what the user sees
  const content = paladinStripDataBlock(_raw);

  const container = document.getElementById('paladin-messages');
  const msgDiv = document.createElement('div');
  msgDiv.className = 'paladin-msg paladin-bot';
  const bubble = document.createElement('div');
  bubble.className = 'paladin-bubble';
  msgDiv.appendChild(bubble);
  container.appendChild(msgDiv);

  let i = 0;
  const speed = 4; // 2x faster than before (was 8)

  function typeNext() {
    if (i < content.length) {
      bubble.textContent = content.slice(0, i + 1);
      i++;
      container.scrollTop = container.scrollHeight;
      setTimeout(typeNext, speed);
    } else {
      // Typing done — render markdown and attach charts
      bubble.innerHTML = paladinMarkdown(content);
      container.scrollTop = container.scrollHeight;
      // _raw still has the ---PALADIN_DATA--- block, so charts can parse it
      paladinRenderCharts(bubble, _raw);
      paladinShowDiseasePhoto(bubble, _raw);
    }
  }
  typeNext();
  return msgDiv;
}

// ── Minimal markdown renderer ──
function paladinMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Bold **text**
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic *text*
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
    // Headings ### and ##
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    // HR ---
    .replace(/^---+$/gm, '<hr>')
    // Bullet lists
    .replace(/^[-•]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    // Numbered lists
    .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Line breaks (double newline → paragraph)
    .split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

// ── Parse structured JSON block from vision replies ──
function paladinExtractData(rawText) {
  const match = rawText.match(/---PALADIN_DATA---\s*([\s\S]*?)\s*---END_DATA---/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    return null;
  }
}

// ── Strip the raw JSON block from displayed text ──
function paladinStripDataBlock(text) {
  return text.replace(/---PALADIN_DATA---[\s\S]*?---END_DATA---/g, '').trim();
}

// ── Draw one circular SVG meter ──
function paladinDrawMeter(label, value, color) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const fill = (value / 100) * circ;
  const dash = `${fill.toFixed(1)} ${(circ - fill).toFixed(1)}`;

  // Pick emoji based on value
  const emoji =
    value >= 75 ? '🔴' :
      value >= 50 ? '🟠' :
        value >= 25 ? '🟡' : '🟢';

  return `
    <div class="pal-meter">
      <svg viewBox="0 0 88 88" class="pal-meter-svg">
        <circle cx="44" cy="44" r="${r}" class="pal-meter-track"/>
        <circle cx="44" cy="44" r="${r}"
          class="pal-meter-fill"
          style="stroke:${color};stroke-dasharray:${dash};stroke-dashoffset:0"
          transform="rotate(-90 44 44)"/>
        <text x="44" y="40" class="pal-meter-val">${value}</text>
        <text x="44" y="56" class="pal-meter-pct">%</text>
      </svg>
      <div class="pal-meter-label">${emoji} ${label}</div>
    </div>`;
}

// ── Color palette for meters ──
const METER_COLORS = [
  '#3b82f6', // blue   — Confidence
  '#ef4444', // red    — Outbreak Potential
  '#f59e0b', // amber  — Urgency
  '#84cc16', // green  — Image Quality
  '#8b5cf6', // purple — extra
  '#06b6d4', // cyan   — extra
  '#ec4899', // pink   — extra
  '#14b8a6', // teal   — extra
];

// ── Render circular meter grid ──
function paladinRenderCharts(bubble, rawText) {
  const data = paladinExtractData(rawText);

  let scores = [];

  if (data) {
    // Vision diagnosis: use structured JSON
    const candidates = [
      { label: 'Confidence', value: data.confidence },
      { label: 'Outbreak Potential', value: data.outbreak_potential },
      { label: 'Urgency', value: data.urgency_score },
      { label: 'Image Quality', value: data.image_quality },
    ];
    scores = candidates.filter(s => s.value !== null && s.value !== undefined);
  } else {
    // Text chat fallback: extract scores from prose
    const pattern = /([A-Za-z\s\/\-]+(?:Score|Confidence|Risk|Potential|Urgency))[\s:]+(\d{1,3})\s*(?:\/\s*100)?/gi;
    let m;
    while ((m = pattern.exec(rawText)) !== null) {
      const label = m[1].trim();
      const value = parseInt(m[2]);
      if (value >= 0 && value <= 100 && !scores.find(s => s.label === label)) {
        scores.push({ label, value });
      }
    }
    if (scores.length < 2) return; // skip if too few numbers
  }

  if (scores.length === 0) return;

  // Build wrapper
  const wrap = document.createElement('div');
  wrap.className = 'pal-meter-wrap';

  const titleEl = document.createElement('div');
  titleEl.className = 'pal-meter-heading';
  titleEl.textContent = '📊 Diagnosis Scores';
  wrap.appendChild(titleEl);

  const grid = document.createElement('div');
  grid.className = 'pal-meter-grid';
  grid.innerHTML = scores
    .map((s, i) => paladinDrawMeter(s.label, s.value, METER_COLORS[i % METER_COLORS.length]))
    .join('');
  wrap.appendChild(grid);

  // Download button — renders grid as PNG via canvas
  const dlBtn = document.createElement('button');
  dlBtn.className = 'paladin-dl-btn';
  dlBtn.textContent = '⬇ Download Chart';
  dlBtn.onclick = () => paladinDownloadMeters(scores);
  wrap.appendChild(dlBtn);

  bubble.appendChild(wrap);
}

// ── Download meters as PNG using canvas ──
function paladinDownloadMeters(scores) {
  const cols = Math.min(scores.length, 4);
  const rows = Math.ceil(scores.length / cols);
  const cellW = 160, cellH = 160;
  const padTop = 40;

  const canvas = document.createElement('canvas');
  canvas.width = cols * cellW;
  canvas.height = rows * cellH + padTop;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#f7f9f4';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Title
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 15px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('PALADIN Diagnosis Scores', canvas.width / 2, 26);

  scores.forEach((s, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = col * cellW + cellW / 2;
    const cy = row * cellH + cellH / 2 + padTop;
    const R = 48;
    const color = METER_COLORS[i % METER_COLORS.length];

    // Track circle
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, 2 * Math.PI);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 10;
    ctx.stroke();

    // Fill arc
    const angle = (s.value / 100) * 2 * Math.PI;
    ctx.beginPath();
    ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + angle);
    ctx.strokeStyle = color;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Value text
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 22px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${s.value}%`, cx, cy + 7);

    // Label
    ctx.fillStyle = '#64748b';
    ctx.font = '11px Outfit, sans-serif';
    ctx.fillText(s.label, cx, cy + R + 18);
  });

  const link = document.createElement('a');
  link.download = 'paladin-diagnosis-scores.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

// ── Fetch and show a reference disease photo ──
const PALADIN_DISEASE_IMAGES = {
  'rice blast': 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/Rice_blast_lesion.jpg/320px-Rice_blast_lesion.jpg',
  'bacterial leaf blight': 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e2/Bacterial_leaf_blight_rice.jpg/320px-Bacterial_leaf_blight_rice.jpg',
  'brown planthopper': 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Brown_planthopper.jpg/320px-Brown_planthopper.jpg',
  'green leafhopper': 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Nephotettix_virescens.jpg/320px-Nephotettix_virescens.jpg',
  'sheath blight': 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/Sheath_blight_symptoms.jpg/320px-Sheath_blight_symptoms.jpg',
  'tungro': 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/89/Rice_tungro_disease.jpg/320px-Rice_tungro_disease.jpg',
  'leaf folder': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Cnaphalocrosis_medinalis.jpg/320px-Cnaphalocrosis_medinalis.jpg',
  'stem borer': 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Scirpophaga_incertulas.jpg/320px-Scirpophaga_incertulas.jpg',
  'false smut': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Ustilaginoidea_virens.jpg/320px-Ustilaginoidea_virens.jpg',
  'nitrogen deficiency': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Nitrogen_deficiency_rice.jpg/320px-Nitrogen_deficiency_rice.jpg',
};

function paladinShowDiseasePhoto(bubble, rawText) {
  const lower = rawText.toLowerCase();
  let matchedLabel = null;
  let matchedUrl = null;

  for (const [keyword, url] of Object.entries(PALADIN_DISEASE_IMAGES)) {
    if (lower.includes(keyword)) {
      matchedLabel = keyword;
      matchedUrl = url;
      break;
    }
  }

  if (!matchedUrl) return;

  const wrap = document.createElement('div');
  wrap.className = 'paladin-ref-photo-wrap';

  const label = document.createElement('div');
  label.className = 'paladin-ref-photo-label';
  label.textContent = `📷 Reference: ${matchedLabel.replace(/\b\w/g, c => c.toUpperCase())}`;

  const img = document.createElement('img');
  img.src = matchedUrl;
  img.alt = `Reference photo: ${matchedLabel}`;
  img.className = 'paladin-ref-photo';
  img.onerror = () => { wrap.style.display = 'none'; }; // hide if image fails

  const dlBtn = document.createElement('button');
  dlBtn.className = 'paladin-dl-btn';
  dlBtn.textContent = '⬇ Download Photo';
  dlBtn.onclick = () => {
    const link = document.createElement('a');
    link.href = matchedUrl;
    link.download = `${matchedLabel.replace(/\s/g, '-')}-reference.jpg`;
    link.target = '_blank';
    link.click();
  };

  const srcNote = document.createElement('div');
  srcNote.className = 'paladin-ref-source';
  srcNote.textContent = 'Source: Wikimedia Commons (CC)';

  wrap.appendChild(label);
  wrap.appendChild(img);
  wrap.appendChild(dlBtn);
  wrap.appendChild(srcNote);
  bubble.appendChild(wrap);
}

// ══════════════════════════════════════════════════════════════════
// FERTILIZER COMPATIBILITY ANALYSIS
// Weighted MCDA + NPK vector similarity + Gaussian pH scoring
// ══════════════════════════════════════════════════════════════════

const FERTILIZER_LIBRARY = [
  {
    id: 'complete-npk',
    name: 'Complete NPK 14-14-14',
    type: 'Complete Fertilizer',
    n: 14, p: 14, k: 14,
    image: 'complete-npk-14-14-14.jpg',
    organic: false,
    bestFor: ['inbred', 'transplanted', 'hybrid'],
    caution: 'Avoid over-application; balanced formula may under-supply N for high-yield hybrid targets.'
  },
  {
    id: 'urea',
    name: 'Urea 46-0-0',
    type: 'Nitrogen Fertilizer',
    n: 46, p: 0, k: 0,
    image: 'urea-46-0-0.jpg',
    organic: false,
    bestFor: ['hybrid', 'transplanted', 'inbred'],
    caution: 'Highly soluble; avoid on sloped or rainfed fields without split application. May cause ammonia volatilization if not incorporated.'
  },
  {
    id: 'ammonium-sulfate',
    name: 'Ammonium Sulfate 21-0-0+S',
    type: 'Nitrogen + Sulfur Fertilizer',
    n: 21, p: 0, k: 0,
    image: 'ammonium-sulfate.jpg',
    organic: false,
    bestFor: ['transplanted', 'inbred', 'direct-seeded'],
    caution: 'Acidifying effect — avoid in already acidic soils (pH < 5.5). Provides sulfur as secondary nutrient.'
  },
  {
    id: 'dap',
    name: 'DAP 18-46-0',
    type: 'Phosphorus Fertilizer',
    n: 18, p: 46, k: 0,
    image: 'dap-18-46-0.jpg',
    organic: false,
    bestFor: ['upland', 'direct-seeded', 'transplanted'],
    caution: 'High phosphorus; best used as basal. Over-use may induce micronutrient deficiencies. Alkaline pH raises P fixation risk.'
  },
  {
    id: 'mop',
    name: 'Muriate of Potash 0-0-60',
    type: 'Potassium Fertilizer',
    n: 0, p: 0, k: 60,
    image: 'muriate-of-potash.jpg',
    organic: false,
    bestFor: ['hybrid', 'rainfed', 'inbred'],
    caution: 'High chloride content; avoid in chloride-sensitive soils. Most beneficial during grain filling stage.'
  },
  {
    id: 'organic-compost',
    name: 'Organic Compost',
    type: 'Organic Amendment',
    n: 1.5, p: 1.0, k: 1.5,
    image: 'organic-compost.jpg',
    organic: true,
    bestFor: ['rainfed', 'upland', 'inbred'],
    caution: 'Nutrient release is slow; apply 2–4 weeks before planting. Actual NPK varies by compost source.'
  },
  {
    id: 'chicken-manure',
    name: 'Chicken Manure',
    type: 'Organic Fertilizer',
    n: 3, p: 2.5, k: 2,
    image: 'chicken-manure.jpg',
    organic: true,
    bestFor: ['upland', 'rainfed', 'direct-seeded'],
    caution: 'Risk of salinity and ammonia burn if fresh; always composted. Contains micronutrients and improves soil biology.'
  },
  {
    id: 'rice-straw-compost',
    name: 'Rice Straw Compost',
    type: 'Organic Amendment',
    n: 0.6, p: 0.3, k: 1.5,
    image: 'rice-straw-compost.jpg',
    organic: true,
    bestFor: ['inbred', 'transplanted', 'rainfed'],
    caution: 'Low N content; supplement with nitrogen source. Best used for long-term soil organic matter improvement and potassium cycling.'
  },
  {
    id: 'zinc-sulfate',
    name: 'Zinc Sulfate',
    type: 'Micronutrient Amendment',
    n: 0, p: 0, k: 0,
    image: 'zinc-sulfate.jpg',
    organic: false,
    bestFor: ['transplanted', 'inbred', 'hybrid'],
    caution: 'Use only when zinc deficiency is confirmed or likely (high pH paddy soils). Excess zinc is toxic to rice.'
  },
  {
    id: 'dolomite',
    name: 'Dolomite / Agricultural Lime',
    type: 'Soil Amendment (pH Correction)',
    n: 0, p: 0, k: 0,
    image: 'dolomite-lime.jpg',
    organic: false,
    bestFor: ['upland', 'rainfed', 'direct-seeded'],
    caution: 'Only apply when soil pH is confirmed below 5.5. Over-liming causes nutrient lockout. Apply 2–4 weeks before planting.'
  }
];

const RICE_CROP_PROFILES = {
  'inbred': {
    label: 'Inbred Lowland Rice',
    nDemand: 0.55, pDemand: 0.5, kDemand: 0.5,
    preferOrganic: false,
    irrigationSensitive: true,
    stressTolerance: 0.4
  },
  'hybrid': {
    label: 'Hybrid Rice',
    nDemand: 0.85, pDemand: 0.55, kDemand: 0.7,
    preferOrganic: false,
    irrigationSensitive: true,
    stressTolerance: 0.3
  },
  'rainfed': {
    label: 'Rainfed Lowland Rice',
    nDemand: 0.45, pDemand: 0.5, kDemand: 0.5,
    preferOrganic: true,
    irrigationSensitive: false,
    stressTolerance: 0.7
  },
  'upland': {
    label: 'Upland Rice',
    nDemand: 0.4, pDemand: 0.7, kDemand: 0.45,
    preferOrganic: true,
    irrigationSensitive: false,
    stressTolerance: 0.75
  },
  'direct-seeded': {
    label: 'Direct-Seeded Rice',
    nDemand: 0.6, pDemand: 0.65, kDemand: 0.45,
    preferOrganic: false,
    irrigationSensitive: false,
    stressTolerance: 0.5
  },
  'transplanted': {
    label: 'Transplanted Rice',
    nDemand: 0.6, pDemand: 0.55, kDemand: 0.55,
    preferOrganic: false,
    irrigationSensitive: true,
    stressTolerance: 0.4
  }
};

function fertClamp(v, min = 0, max = 100) {
  if (!isFinite(v) || isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function parseSoilPHRange(phText) {
  if (!phText || typeof phText !== 'string') return 6.0;
  const nums = phText.match(/[\d.]+/g);
  if (!nums || nums.length === 0) return 6.0;
  const vals = nums.map(Number).filter(n => n > 0 && n < 14);
  if (vals.length === 0) return 6.0;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

function gaussianScore(value, optimum, spread) {
  if (!isFinite(value) || !isFinite(optimum) || !isFinite(spread) || spread === 0) return 50;
  return fertClamp(100 * Math.exp(-0.5 * Math.pow((value - optimum) / spread, 2)));
}

function fertilityFactor(fertility) {
  if (!fertility) return 0.5;
  const s = fertility.toLowerCase();
  if (s.includes('very high') || s.includes('excellent')) return 0.9;
  if (s.includes('high') || s.includes('good')) return 0.75;
  if (s.includes('moderate') || s.includes('medium')) return 0.5;
  if (s.includes('low') || s.includes('poor')) return 0.3;
  if (s.includes('very low')) return 0.15;
  return 0.5;
}

function inferNutrientNeedVector(soil, slope, irrigation, cropProfile) {
  const fertF = fertilityFactor(soil.soilFertility);
  const irrigScore = fertClamp(irrigation.irrigationScore || 50, 0, 100) / 100;
  const slopeVal = Math.max(0, slope.avgSlope || 5);

  // Base N-P-K demand from crop profile
  let nNeed = cropProfile.nDemand;
  let pNeed = cropProfile.pDemand;
  let kNeed = cropProfile.kDemand;

  // Adjust for low fertility (needs more)
  const fertBoost = 1 + (1 - fertF) * 0.5;
  nNeed *= fertBoost;
  pNeed *= fertBoost;
  kNeed *= fertBoost;

  // Slope reduces N need slightly (runoff risk) but boosts organic need
  if (slopeVal > 8) {
    nNeed *= 0.85;
    pNeed *= 1.1;
  }

  // Poor irrigation reduces N demand (can't flush excess ammonia)
  if (!cropProfile.irrigationSensitive && irrigScore < 0.4) {
    nNeed *= 0.75;
  }

  return {
    n: fertClamp(nNeed, 0, 1),
    p: fertClamp(pNeed, 0, 1),
    k: fertClamp(kNeed, 0, 1)
  };
}

function normalizeFertilizerNPK(fert) {
  const total = fert.n + fert.p + fert.k;
  if (total === 0) return { n: 0, p: 0, k: 0 };
  return { n: fert.n / total, p: fert.p / total, k: fert.k / total };
}

function normalizeNeedVector(need) {
  const total = need.n + need.p + need.k;
  if (total === 0) return { n: 0.33, p: 0.33, k: 0.34 };
  return { n: need.n / total, p: need.p / total, k: need.k / total };
}

function cosineNutrientMatch(fert, need) {
  const fNorm = normalizeFertilizerNPK(fert);
  const nNorm = normalizeNeedVector(need);

  // If fertilizer has no NPK (amendments like dolomite/zinc), return 40 (neutral)
  if (fert.n + fert.p + fert.k === 0) return 40;

  const dot = fNorm.n * nNorm.n + fNorm.p * nNorm.p + fNorm.k * nNorm.k;
  const magA = Math.sqrt(fNorm.n ** 2 + fNorm.p ** 2 + fNorm.k ** 2);
  const magB = Math.sqrt(nNorm.n ** 2 + nNorm.p ** 2 + nNorm.k ** 2);

  if (magA === 0 || magB === 0) return 40;
  return fertClamp((dot / (magA * magB)) * 100);
}

function fertilizerSoilMatch(fert, soil, slope, irrigation) {
  const soilType = (soil.soilType || '').toLowerCase();
  const fertility = (soil.soilFertility || '').toLowerCase();
  const texture = (soil.soilTexture || '').toLowerCase();
  const irrigScore = fertClamp(irrigation.irrigationScore || 50, 0, 100);
  const slopeVal = Math.max(0, slope.avgSlope || 5);
  const fertF = fertilityFactor(soil.soilFertility);

  let score = 60; // base

  // Organic fertilizers preferred when low fertility or poor structure
  if (fert.organic) {
    if (fertF < 0.35) score += 30;
    else if (fertF < 0.55) score += 15;
    if (slopeVal > 8) score += 10;
    if (texture.includes('sandy') || texture.includes('loam')) score += 8;
  }

  // Urea: best when irrigation is good, nitrogen demand is high
  if (fert.id === 'urea') {
    score += (irrigScore / 100) * 25;
    if (fertF > 0.6) score -= 10; // high fertility = less N deficit
    if (slopeVal > 10) score -= 15; // slope = leaching risk
  }

  // DAP: phosphorus demand, early establishment, upland/direct-seeded
  if (fert.id === 'dap') {
    if (fertility.includes('low') || fertility.includes('poor')) score += 15;
    if (texture.includes('sandy') || texture.includes('loam')) score += 10;
  }

  // MOP: sandy soil, high K loss
  if (fert.id === 'mop') {
    if (texture.includes('sandy')) score += 20;
    if (texture.includes('clay')) score -= 10; // clay holds K naturally
    if (irrigScore > 65) score += 10; // flushing = K loss
  }

  // Zinc sulfate: high pH or paddy conditions
  if (fert.id === 'zinc-sulfate') {
    const ph = parseSoilPHRange(soil.soilpH);
    if (ph > 6.8) score += 30;
    if (soilType.includes('paddy') || soilType.includes('clay')) score += 15;
  }

  // Dolomite: only good for acid soils
  if (fert.id === 'dolomite') {
    const ph = parseSoilPHRange(soil.soilpH);
    if (ph < 5.5) score += 40;
    else if (ph < 6.0) score += 15;
    else score -= 25; // already adequate pH, liming not needed
  }

  // Ammonium sulfate: penalized in acid soils
  if (fert.id === 'ammonium-sulfate') {
    const ph = parseSoilPHRange(soil.soilpH);
    if (ph < 5.5) score -= 25;
    else if (ph < 6.0) score -= 10;
  }

  // Rice straw compost: clay, long-term OM
  if (fert.id === 'rice-straw-compost') {
    if (texture.includes('clay')) score += 15;
    if (irrigScore < 50) score += 10;
  }

  return fertClamp(score);
}

function fertilizerCropMatch(fert, cropProfile) {
  const cropType = Object.keys(RICE_CROP_PROFILES).find(k =>
    RICE_CROP_PROFILES[k] === cropProfile
  ) || 'inbred';

  let score = 50;

  // Match bestFor list
  if (fert.bestFor && fert.bestFor.includes(cropType)) score += 30;

  // Organic preference
  if (cropProfile.preferOrganic && fert.organic) score += 20;
  if (!cropProfile.preferOrganic && fert.organic) score -= 10;

  // Stress tolerance: rainfed/upland prefer stress-resilient amendments
  if (cropProfile.stressTolerance > 0.6) {
    if (fert.organic) score += 10;
    if (fert.id === 'urea') score -= 15;
    if (fert.id === 'mop') score += 10;
  }

  // Hybrid: N and K heavy
  if (cropType === 'hybrid') {
    if (fert.id === 'urea') score += 15;
    if (fert.id === 'mop') score += 12;
    if (fert.id === 'complete-npk') score += 10;
    if (fert.organic && fert.n < 2) score -= 15; // too slow release
  }

  // Upland: P and soil improvement
  if (cropType === 'upland') {
    if (fert.id === 'dap') score += 20;
    if (fert.id === 'dolomite') score += 10;
    if (fert.id === 'chicken-manure') score += 15;
    if (fert.id === 'urea') score -= 10;
  }

  // Direct-seeded: early growth, balanced N
  if (cropType === 'direct-seeded') {
    if (fert.id === 'complete-npk') score += 10;
    if (fert.id === 'dap') score += 15;
  }

  // Rainfed: organic matter, stress tolerance
  if (cropType === 'rainfed') {
    if (fert.organic) score += 20;
    if (fert.id === 'mop') score += 10;
    if (fert.id === 'urea') score -= 10;
  }

  return fertClamp(score);
}

function fertilizerPHMatch(fert, soil) {
  const ph = parseSoilPHRange(soil.soilpH);

  // Dolomite: only good for acid soils
  if (fert.id === 'dolomite') {
    return ph < 5.5 ? 95 : ph < 6.0 ? 65 : ph < 6.5 ? 30 : 15;
  }

  // Zinc sulfate: high pH paddy soils
  if (fert.id === 'zinc-sulfate') {
    return ph > 6.8 ? 90 : ph > 6.2 ? 70 : 50;
  }

  // Ammonium sulfate: penalized in acid soils
  if (fert.id === 'ammonium-sulfate') {
    return ph < 5.5 ? 25 : gaussianScore(ph, 6.5, 0.8);
  }

  // Default: Gaussian centered at pH 6.2 for rice
  return gaussianScore(ph, 6.2, 0.85);
}

function fertilizerTerrainMatch(fert, slope, irrigation, soil) {
  const irrigScore = fertClamp(irrigation.irrigationScore || 50, 0, 100);
  const slopeVal = Math.max(0, slope.avgSlope || 5);
  const flatFrac = fertClamp((slope.flatFraction || 0.5) * 100, 0, 100);
  const texture = (soil.soilTexture || '').toLowerCase();

  let score = 60;

  // Higher irrigation helps synthetic N
  if (!fert.organic && fert.n > 10) {
    score += (irrigScore / 100) * 20;
  }

  // High slope penalizes highly soluble synthetic fertilizers
  if (!fert.organic && slopeVal > 10) {
    score -= Math.min(20, (slopeVal - 10) * 1.5);
  }

  // Flat terrain bonus for water-intensive synthetics
  if (!fert.organic && flatFrac > 70) {
    score += 10;
  }

  // Organic amendments benefit from structure risk on slopes
  if (fert.organic && slopeVal > 5) {
    score += Math.min(15, (slopeVal - 5) * 1.2);
  }

  // Rice straw compost on clay soils in good irrigation: long-term benefit
  if (fert.id === 'rice-straw-compost' && texture.includes('clay')) {
    score += 12;
  }

  return fertClamp(score);
}

function fertilizerSafetyBalance(fert, need, soil) {
  let score = 60;

  // Balanced fertilizer bonus
  if (fert.n > 0 && fert.p > 0 && fert.k > 0) score += 15;

  // Organic soil-health bonus
  if (fert.organic) score += 10;

  // Single-nutrient penalty if that nutrient is not strongly needed
  if (fert.n > 40 && fert.p === 0 && fert.k === 0) {
    if (need.n < 0.5) score -= 20;
  }

  if (fert.p > 40 && fert.n < 5 && fert.k === 0) {
    if (need.p < 0.5) score -= 20;
  }

  if (fert.k > 50 && fert.n === 0 && fert.p === 0) {
    if (need.k < 0.5) score -= 15;
  }

  // Dolomite: only if pH needs correction
  if (fert.id === 'dolomite') {
    const ph = parseSoilPHRange(soil.soilpH);
    if (ph >= 6.0) score -= 30; // pH correction not needed
  }

  return fertClamp(score);
}

function fertilizerLevel(score) {
  if (score >= 82) return 'Excellent';
  if (score >= 68) return 'High';
  if (score >= 50) return 'Moderate';
  return 'Low';
}

function mainNutrientNeed(need) {
  const { n, p, k } = need;
  const max = Math.max(n, p, k);
  if (max === n) return 'Nitrogen (N)';
  if (max === p) return 'Phosphorus (P)';
  return 'Potassium (K)';
}

function fertilizerEmojiFallback(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('urea')) return '⚗️';
  if (n.includes('ammonium') || n.includes('sulfate')) return '🧪';
  if (n.includes('dap') || n.includes('18-46')) return '🌾';
  if (n.includes('potash') || n.includes('dolomite') || n.includes('lime')) return '🪨';
  if (n.includes('compost') || n.includes('straw')) return '🍂';
  if (n.includes('chicken') || n.includes('manure')) return '🐔';
  if (n.includes('zinc')) return '🔬';
  return '🌱';
}

function resolveFertilizerImageUrl(fert) {
  return `assets/fertilizers/${fert.image}`;
}

function calculateFertilizerCompatibility(scores, lat, lng, gridKm) {
  const details = scores?.details || {};
  const elevation = details.elevation || {};
  const slope = {
    avgSlope: details.slope?.avgSlope ?? 5,
    flatFraction: details.slope?.flatFraction ?? 0.5,
    slopeScore: details.slope?.slopeScore ?? 50
  };
  const soil = {
    soilType: details.soil?.soilType || 'Unspecified terrain-inferred soil',
    soilFertility: details.soil?.soilFertility || 'Moderate',
    soilpH: details.soil?.soilpH || '5.8–6.5',
    soilTexture: details.soil?.soilTexture || 'Clay Loam',
    drainageScore: details.soil?.drainageScore ?? 50
  };
  const irrigation = {
    irrigationScore: details.irrigation?.irrigationScore ?? 50,
    irrigationType: details.irrigation?.irrigationType || 'Mixed'
  };

  const cropTypeEl = document.getElementById('terrain-rice-type');
  const cropTypeKey = (cropTypeEl ? cropTypeEl.value : 'inbred') || 'inbred';
  const cropProfile = RICE_CROP_PROFILES[cropTypeKey] || RICE_CROP_PROFILES['inbred'];

  const need = inferNutrientNeedVector(soil, slope, irrigation, cropProfile);

  const fertilizers = FERTILIZER_LIBRARY.map(fert => {
    const nutrientMatch = fertClamp(cosineNutrientMatch(fert, need));
    const soilMatch = fertClamp(fertilizerSoilMatch(fert, soil, slope, irrigation));
    const cropMatch = fertClamp(fertilizerCropMatch(fert, cropProfile));
    const phMatch = fertClamp(fertilizerPHMatch(fert, soil));
    const terrainMatch = fertClamp(fertilizerTerrainMatch(fert, slope, irrigation, soil));
    const safetyMatch = fertClamp(fertilizerSafetyBalance(fert, need, soil));

    const score = fertClamp(
      nutrientMatch * 0.30 +
      soilMatch * 0.25 +
      cropMatch * 0.20 +
      phMatch * 0.10 +
      terrainMatch * 0.10 +
      safetyMatch * 0.05
    );

    const level = fertilizerLevel(score);

    // Build dynamic reasons
    const reasons = [];
    const ph = parseSoilPHRange(soil.soilpH);

    if (fert.id === 'dolomite' && ph < 5.8) reasons.push(`Soil pH ~${ph.toFixed(1)} is acidic — lime helps correction`);
    if (fert.id === 'dolomite' && ph >= 6.0) reasons.push('Soil pH is already adequate; liming not recommended');
    if (fert.id === 'zinc-sulfate' && ph > 6.5) reasons.push(`High soil pH (~${ph.toFixed(1)}) increases zinc deficiency risk`);
    if (fert.organic && fertilityFactor(soil.soilFertility) < 0.4) reasons.push('Low inferred soil fertility benefits from organic matter');
    if (fert.id === 'urea' && irrigation.irrigationScore > 65) reasons.push('Good irrigation score supports soluble N application');
    if (fert.id === 'urea' && slope.avgSlope > 10) reasons.push('High slope risk — split urea application recommended');
    if (fert.id === 'mop' && (soil.soilTexture || '').toLowerCase().includes('sandy')) reasons.push('Sandy texture has low K retention — MOP addresses deficiency');
    if (cropProfile.preferOrganic && fert.organic) reasons.push(`${cropProfile.label} benefits from organic soil improvement`);
    if (fert.bestFor.includes(cropTypeKey)) reasons.push(`Recognized as compatible with ${cropProfile.label}`);
    if (slope.avgSlope > 8 && fert.organic) reasons.push('Organic matter improves slope stability and reduces runoff loss');
    if (fert.n > 0 && need.n > 0.6) reasons.push('Nitrogen need is elevated based on crop and soil fertility');
    if (fert.p > 30 && need.p > 0.6) reasons.push('Phosphorus demand is high — good for root and early-stage growth');
    if (fert.id === 'ammonium-sulfate' && ph < 5.5) reasons.push('⚠️ Already acidic soil — ammonium sulfate may worsen acidity');

    if (reasons.length === 0) {
      if (score >= 68) reasons.push('Good compatibility with terrain-inferred soil conditions');
      else reasons.push('Limited compatibility based on terrain and crop data');
    }

    return {
      ...fert,
      score: Math.round(score),
      level,
      components: { nutrientMatch: Math.round(nutrientMatch), soilMatch: Math.round(soilMatch), cropMatch: Math.round(cropMatch), phMatch: Math.round(phMatch), terrainMatch: Math.round(terrainMatch), safetyMatch: Math.round(safetyMatch) },
      reasons: reasons.slice(0, 3),
      caution: fert.caution
    };
  });

  fertilizers.sort((a, b) => b.score - a.score);
  const best = fertilizers[0];

  return {
    cropType: cropTypeKey,
    cropLabel: cropProfile.label,
    location: { lat, lng, gridKm },
    soil,
    slope,
    elevation,
    irrigation,
    nutrientNeed: need,
    primaryNeed: mainNutrientNeed(need),
    fertilizers,
    best
  };
}

function renderFertilizerAnalysis(data) {
  const section = document.getElementById('fertilizer-analysis-section');
  if (!section) return;

  // Badge / header
  const bestNameEl = document.getElementById('fertilizer-best-name');
  const bestScoreEl = document.getElementById('fertilizer-best-score');
  const bestNameLgEl = document.getElementById('fertilizer-best-name-lg');
  const bestReasonEl = document.getElementById('fertilizer-best-reason');
  const cropTypeEl = document.getElementById('fertilizer-crop-type');
  const soilTypeEl = document.getElementById('fertilizer-soil-type');
  const phEl = document.getElementById('fertilizer-ph-condition');
  const needEl = document.getElementById('fertilizer-main-need');

  if (bestNameEl) bestNameEl.textContent = data.best.name;
  if (bestScoreEl) bestScoreEl.textContent = data.best.score + '%';
  if (bestNameLgEl) bestNameLgEl.textContent = data.best.name;
  if (bestReasonEl) bestReasonEl.textContent = data.best.reasons.slice(0, 2).join(' · ');
  if (cropTypeEl) cropTypeEl.textContent = data.cropLabel;
  if (soilTypeEl) soilTypeEl.textContent = data.soil.soilType;
  if (phEl) phEl.textContent = `pH ${data.soil.soilpH} (${parseSoilPHRange(data.soil.soilpH) < 5.8 ? 'Acidic' : parseSoilPHRange(data.soil.soilpH) > 7.0 ? 'Alkaline' : 'Near-Neutral'})`;
  if (needEl) needEl.textContent = data.primaryNeed;

  // Animate score ring for best fertilizer
  const fsrFill = document.getElementById('fsr-fill-circle');
  const fsrVal = document.getElementById('fsr-val');
  if (fsrFill && fsrVal) {
    const circumference = 2 * Math.PI * 32;
    fsrFill.style.strokeDasharray = circumference;
    fsrFill.style.strokeDashoffset = circumference;
    fsrVal.textContent = data.best.score + '%';
    // Color by level
    const levelColor = data.best.score >= 82 ? '#22c55e' : data.best.score >= 68 ? '#84cc16' : data.best.score >= 50 ? '#eab308' : '#ef4444';
    fsrFill.style.stroke = levelColor;
    setTimeout(() => {
      fsrFill.style.strokeDashoffset = circumference * (1 - data.best.score / 100);
    }, 300);
  }

  // Fertilizer cards
  const grid = document.getElementById('fertilizer-card-grid');
  if (!grid) return;
  grid.innerHTML = '';

  data.fertilizers.forEach((fert, idx) => {
    const isBest = idx === 0;
    const levelClass = `fert-${fert.level.toLowerCase()}`;
    const imgUrl = resolveFertilizerImageUrl(fert);
    const emoji = fertilizerEmojiFallback(fert.name);

    const card = document.createElement('div');
    card.className = `fertilizer-card${isBest ? ' best' : ''}`;

    card.innerHTML = `
      <div class="fertilizer-image-wrap">
        <img
          src="${imgUrl}"
          alt="${fert.name}"
          loading="lazy"
          onerror="this.style.display='none';this.closest('.fertilizer-image-wrap').classList.add('fertilizer-img-missing');"
        />
        <div class="fertilizer-image-placeholder">${emoji}</div>
      </div>
      <div class="fertilizer-card-body">
        <div class="fertilizer-card-head">
          <div>
            <div class="fertilizer-card-name">${fert.name}</div>
            <div class="fertilizer-card-type">${fert.type}</div>
          </div>
          <span class="fertilizer-score-badge ${levelClass}">${fert.score}%</span>
        </div>
        <div class="fertilizer-progress">
          <div class="fertilizer-progress-fill ${levelClass}" style="width:0%" data-target="${fert.score}"></div>
        </div>
        <div class="fertilizer-card-meta">
          ${isBest ? '<span class="fertilizer-chip chip-best">🏆 Best Match</span>' : ''}
          ${fert.organic ? '<span class="fertilizer-chip chip-organic">🍃 Organic</span>' : ''}
          ${fert.n > 0 ? `<span class="fertilizer-chip chip-n">N ${fert.n}</span>` : ''}
          ${fert.p > 0 ? `<span class="fertilizer-chip chip-p">P ${fert.p}</span>` : ''}
          ${fert.k > 0 ? `<span class="fertilizer-chip chip-k">K ${fert.k}</span>` : ''}
          <span class="fertilizer-chip chip-organic" style="background:#f1f5f9;border-color:#cbd5e1;color:#475569">${fert.level}</span>
        </div>
        <ul class="fertilizer-card-reasons">
          ${fert.reasons.map(r => `<li>${r}</li>`).join('')}
        </ul>
      </div>
      <div class="fertilizer-card-caution">⚠️ ${fert.caution}</div>
    `;

    grid.appendChild(card);
  });

  // Animate progress bars
  setTimeout(() => {
    grid.querySelectorAll('.fertilizer-progress-fill[data-target]').forEach(el => {
      el.style.width = el.dataset.target + '%';
    });
  }, 120);

  section.classList.remove('hidden');
  setTimeout(() => {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 400);
}

function generateAndRenderFertilizerAnalysis(scores, lat, lng, gridKm) {
  try {
    const data = calculateFertilizerCompatibility(scores, lat, lng, gridKm);
    latestFertilizerAnalysis = data;
    renderFertilizerAnalysis(data);
  } catch (err) {
    console.error('generateAndRenderFertilizerAnalysis failed:', err);
  }
}

// ── Collect current PAL-AI context ──
function collectPaladinContext() {
  const ctx = {};

  // Region
  const regionSel = document.getElementById('region-select') || document.getElementById('pest-region');
  if (regionSel && regionSel.value) {
    ctx.region_id = parseInt(regionSel.value) || null;
    // Try name from REGIONS_CACHE
    if (ctx.region_id && REGIONS_CACHE[ctx.region_id]) {
      ctx.region_name = REGIONS_CACHE[ctx.region_id];
    } else if (regionSel.options && regionSel.selectedIndex >= 0) {
      ctx.region_name = regionSel.options[regionSel.selectedIndex].text;
    }
  }

  // Coordinates — try multiple sources
  const latEl = document.getElementById('pest-lat') || document.getElementById('calc-lat');
  const lngEl = document.getElementById('pest-lng') || document.getElementById('calc-lng');
  if (latEl && lngEl && latEl.value && lngEl.value) {
    ctx.latitude = parseFloat(latEl.value);
    ctx.longitude = parseFloat(lngEl.value);
  } else if (latestTerrainLocation) {
    ctx.latitude = latestTerrainLocation.lat || latestTerrainLocation.latitude;
    ctx.longitude = latestTerrainLocation.lng || latestTerrainLocation.longitude;
  } else if (lastForecastLat && lastForecastLng) {
    ctx.latitude = lastForecastLat;
    ctx.longitude = lastForecastLng;
  }

  // Forecast
  if (forecastData) {
    const years = Object.keys(forecastData).sort();
    const latestYear = years[years.length - 1];
    const latestEntry = forecastData[latestYear];
    ctx.forecast_summary = {
      region: ctx.region_name || 'N/A',
      latest_year: latestYear,
      latest_yield: latestEntry ? (latestEntry.predicted_yield || latestEntry.yield || 'N/A') : 'N/A',
      trend: latestEntry ? (latestEntry.trend || 'N/A') : 'N/A',
    };
  }

  // Terrain
  if (latestTerrainScores) ctx.terrain_scores = latestTerrainScores;
  if (latestTerrainLocation) ctx.terrain_location = latestTerrainLocation;

  // Spatiotemporal
  if (latestSpatiotemporalData) ctx.spatiotemporal = latestSpatiotemporalData;

  // Pest Risk
  if (pestRiskData) ctx.pest_risk = pestRiskData;

  // Fertilizer Analysis
  if (latestFertilizerAnalysis) ctx.fertilizer_analysis = latestFertilizerAnalysis;

  // Last image diagnosis
  if (paladinMemory.lastImageDiagnosis) ctx.last_image_diagnosis = paladinMemory.lastImageDiagnosis;

  paladinMemory.lastContext = ctx;
  return ctx;
}

// ── Send text message ──
async function sendPaladinMessage() {
  const inputEl = document.getElementById('paladin-input');
  const text = inputEl ? inputEl.value.trim() : '';
  if (!text) return;

  inputEl.value = '';
  appendPaladinMessage('user', text);

  // Store in memory
  paladinMemory.messages.push({ role: 'user', content: text });
  if (paladinMemory.messages.length > 20) paladinMemory.messages = paladinMemory.messages.slice(-20);

  // Show loading
  const loadingNode = appendPaladinMessage('loading', '');

  const ctx = collectPaladinContext();

  try {
    const resp = await fetch(`${API}/api/paladin/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        context: ctx,
        conversation: paladinMemory.messages.slice(-10),
      }),
    });
    const data = await resp.json();

    loadingNode.remove();

    if (data.ok && data.reply) {
      appendPaladinTyped(data.reply);
      paladinMemory.messages.push({ role: 'assistant', content: data.reply });
    } else {
      appendPaladinMessage('error', data.reply || 'PALADIN encountered an unknown error.');
    }
  } catch (err) {
    loadingNode.remove();
    appendPaladinMessage('error', `⚠️ Could not reach PALADIN backend. Make sure the server is running.\n\n${err.message}`);
  }
}

// ── Handle image selected ──
async function handlePaladinImageSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Preview
  // Preview briefly, then collapse upload area after send
  const previewEl = document.getElementById('paladin-image-preview');
  const reader = new FileReader();
  reader.onload = (e) => {
    previewEl.innerHTML = `<img src="${e.target.result}" alt="Uploaded rice image" />`;
    previewEl.classList.remove('paladin-hidden');
  };
  reader.readAsDataURL(file);

  // User message
  appendPaladinMessage('user', `📷 Uploaded image: ${file.name} (${(file.size / 1024).toFixed(1)} KB) — analyzing…`);

  // Loading
  const loadingNode = appendPaladinMessage('loading', '');

  const ctx = collectPaladinContext();
  const userNote = document.getElementById('paladin-input').value.trim();
  document.getElementById('paladin-input').value = '';

  // Build multipart form
  const formData = new FormData();
  formData.append('file', file);
  formData.append('message', userNote);
  formData.append('context_json', JSON.stringify(ctx));

  try {
    const resp = await fetch(`${API}/api/paladin/vision`, {
      method: 'POST',
      body: formData,
    });
    const data = await resp.json();

    loadingNode.remove();

    if (data.ok && data.reply) {
      appendPaladinTyped(data.reply);
      paladinMemory.lastImageDiagnosis = data.reply;
      paladinMemory.messages.push({ role: 'assistant', content: data.reply });
    } else {
      appendPaladinMessage('error', data.reply || 'PALADIN vision analysis failed.');
    }
  } catch (err) {
    loadingNode.remove();
    appendPaladinMessage('error', `⚠️ Image upload failed. Check your backend server.\n\n${err.message}`);
  }

  // Reset file input, hide upload area and toggle
  event.target.value = '';

  // Collapse image mode UI after upload is sent
  const uploadArea = document.getElementById('paladin-upload-area');
  const previewReset = document.getElementById('paladin-image-preview');
  const toggleEl = document.getElementById('paladin-image-mode');
  if (uploadArea) uploadArea.classList.add('paladin-hidden');
  if (previewReset) { previewReset.innerHTML = ''; previewReset.classList.add('paladin-hidden'); }
  if (toggleEl) toggleEl.checked = false;
  paladinImageModeOn = false;
}

