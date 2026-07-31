/* ════════════════════════════════════════
   PAL-AI — app.js  (v2)
   Main application logic
   ════════════════════════════════════════ */

const API =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8000'
    : 'https://pal-ai-tupinhs.onrender.com';

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

const LOCATION_CACHE = {
  provincesByRegion: {},
  municipalitiesByProvince: {},
  barangaysByMunicipality: {},
};

function setSelectOptions(selectEl, options, placeholder, disabled = false) {
  if (!selectEl) return;

  const frag = document.createDocumentFragment();
  const first = document.createElement('option');
  first.value = '';
  first.textContent = placeholder;
  frag.appendChild(first);

  options.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.code;
    opt.textContent = item.name;
    frag.appendChild(opt);
  });

  selectEl.innerHTML = '';
  selectEl.appendChild(frag);
  selectEl.disabled = disabled;
}

function getLocalRegion(regionId) {
  if (!regionId || typeof PH_GEO === 'undefined') return null;
  return PH_GEO[String(regionId)] || PH_GEO[Number(regionId)] || null;
}

function getLocalProvinces(regionId) {
  const region = getLocalRegion(regionId);
  if (!region || !region.provinces) return [];

  return Object.keys(region.provinces)
    .sort((a, b) => a.localeCompare(b))
    .map(name => ({
      code: `local-province|${regionId}|${encodeURIComponent(name)}`,
      name
    }));
}

function getLocalMunicipalitiesFromProvinceValue(provinceValue) {
  const parts = String(provinceValue || '').split('|');
  if (parts[0] !== 'local-province') return [];

  const regionId = parts[1];
  const provinceName = decodeURIComponent(parts[2] || '');
  const region = getLocalRegion(regionId);
  const province = region?.provinces?.[provinceName];

  if (!province || !province.municipalities) return [];

  return Object.keys(province.municipalities)
    .sort((a, b) => a.localeCompare(b))
    .map(name => ({
      code: `local-municipality|${regionId}|${encodeURIComponent(provinceName)}|${encodeURIComponent(name)}`,
      name
    }));
}

function getLocalBarangaysFromMunicipalityValue(municipalityValue) {
  const parts = String(municipalityValue || '').split('|');
  if (parts[0] !== 'local-municipality') return [];

  const regionId = parts[1];
  const provinceName = decodeURIComponent(parts[2] || '');
  const municipalityName = decodeURIComponent(parts[3] || '');

  const region = getLocalRegion(regionId);
  const barangays = region?.provinces?.[provinceName]?.municipalities?.[municipalityName];

  if (!Array.isArray(barangays)) return [];

  return barangays
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .map(name => ({
      code: `local-barangay|${encodeURIComponent(name)}`,
      name
    }));
}

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

// ════════════════════════════════════════
// PAL-AI Voice Narrator
// ════════════════════════════════════════

let voiceNarratorEnabled = true;
let lastVoiceKey = null;
let voiceSequenceTimer = null;
let welcomeScreenEntered = false;
let suppressNarrationOnce = false;

const VOICE_CLIPS = {
  "home-welcome": "/static/assets/voice/home-welcome.mp3",
  "home-start": "/static/assets/voice/home-start.mp3",

  "forecast-yield": "/static/assets/voice/forecast-yield.mp3",
  "forecast-live": "/static/assets/voice/forecast-live.mp3",
  "forecast-longterm": "/static/assets/voice/forecast-longterm.mp3",

  "terrain-3d-open": "/static/assets/voice/terrain-3d-open.mp3",
  "terrain-3d-complete": "/static/assets/voice/terrain-3d-complete.mp3",
  "terrain-water": "/static/assets/voice/terrain-water.mp3",
  "terrain-fertilizer": "/static/assets/voice/terrain-fertilizer.mp3",
  "terrain-farm-health": "/static/assets/voice/terrain-farm-health.mp3",

  "pest-outbreak-open": "/static/assets/voice/pest-outbreak-open.mp3",
  "pest-outbreak-complete": "/static/assets/voice/pest-outbreak-complete.mp3",
  "pest-specific": "/static/assets/voice/pest-specific.mp3",

  "manual-calculation": "/static/assets/voice/manual-calculation.mp3",
  "about": "/static/assets/voice/about.mp3",
};

function getVoiceAudio() {
  return document.getElementById("tab-narrator-audio");
}

// ════════════════════════════════════════
// PAL-AI Background Music
// ════════════════════════════════════════

let bgmStarted = false;
let bgmFadeTimer = null;
const BGM_TARGET_VOLUME = 0.14;

function getBgmAudio() {
  return document.getElementById("palai-bgm-audio");
}

function fadeBgmTo(targetVolume, duration = 900) {
  const bgm = getBgmAudio();
  if (!bgm) return;

  clearInterval(bgmFadeTimer);

  const startVolume = bgm.volume || 0;
  const steps = 24;
  const stepTime = duration / steps;
  let currentStep = 0;

  bgmFadeTimer = setInterval(() => {
    currentStep += 1;
    const progress = Math.min(currentStep / steps, 1);
    bgm.volume = startVolume + (targetVolume - startVolume) * progress;

    if (progress >= 1) {
      clearInterval(bgmFadeTimer);
      bgmFadeTimer = null;
    }
  }, stepTime);
}

function startBackgroundMusic() {
  const bgm = getBgmAudio();
  if (!bgm) return;

  bgm.loop = true;
  bgm.muted = false;

  if (!bgmStarted) {
    bgm.volume = 0;
    bgmStarted = true;
  }

  const playPromise = bgm.play();

  if (playPromise && typeof playPromise.catch === "function") {
    playPromise
      .then(() => {
        fadeBgmTo(BGM_TARGET_VOLUME, 1200);
      })
      .catch(() => {
        console.warn("BGM was blocked until user interaction.");
      });
  } else {
    fadeBgmTo(BGM_TARGET_VOLUME, 1200);
  }
}

function setBgmMuteState(isMuted) {
  const bgm = getBgmAudio();
  if (!bgm) return;

  bgm.muted = isMuted;

  if (!isMuted && bgmStarted) {
    bgm.play().catch(() => { });
    fadeBgmTo(BGM_TARGET_VOLUME, 500);
  }
}

function showVoiceUnlockPrompt() {
  const toast = document.getElementById("voice-unlock-toast");
  if (toast) toast.classList.remove("hidden");
}

function hideVoiceUnlockPrompt() {
  const toast = document.getElementById("voice-unlock-toast");
  if (toast) toast.classList.add("hidden");
}

function setVoicePlayingState(isPlaying) {
  const playBtn = document.getElementById("voice-play-btn");
  if (playBtn) playBtn.classList.toggle("is-active", isPlaying);
}

function stopVoiceNarration() {
  clearTimeout(voiceSequenceTimer);
  voiceSequenceTimer = null;

  const audio = getVoiceAudio();
  if (!audio) return;

  audio.onended = null;
  audio.pause();

  try {
    audio.currentTime = 0;
  } catch (err) {
    console.warn("Voice reset skipped:", err);
  }

  setVoicePlayingState(false);
}

function setVoiceMuteState(isMuted) {
  const audio = getVoiceAudio();
  const muteBtn = document.getElementById("voice-mute-btn");

  voiceNarratorEnabled = !isMuted;

  if (audio) audio.muted = isMuted;

  setBgmMuteState(isMuted);

  if (muteBtn) {
    muteBtn.classList.toggle("is-active", isMuted);
    muteBtn.title = isMuted ? "Voice guide muted" : "Mute voice guide";
    muteBtn.setAttribute("aria-label", muteBtn.title);
  }

  if (isMuted) stopVoiceNarration();
}

function toggleVoiceMute() {
  setVoiceMuteState(voiceNarratorEnabled);
}

function playVoiceLine(key, options = {}) {
  const force = options.force || false;

  if (!voiceNarratorEnabled) return false;
  if (!key || !VOICE_CLIPS[key]) return false;
  if (!force && lastVoiceKey === key) return false;

  const audio = getVoiceAudio();
  if (!audio) return false;

  stopVoiceNarration();

  lastVoiceKey = key;
  audio.onerror = () => {
    console.warn(`PAL-AI voice file failed to load: ${VOICE_CLIPS[key]}`);
  };

  audio.onended = () => setVoicePlayingState(false);
  audio.src = VOICE_CLIPS[key];
  audio.volume = 0.86;
  audio.load();

  const playPromise = audio.play();

  if (playPromise && typeof playPromise.catch === "function") {
    playPromise
      .then(() => hideVoiceUnlockPrompt())
      .catch(() => showVoiceUnlockPrompt());
  }

  return true;
}

function playVoiceSequence(keys, gapMs = 700) {
  if (!voiceNarratorEnabled) return;

  const audio = getVoiceAudio();
  if (!audio) return;

  stopVoiceNarration();

  let index = 0;

  function playNext() {
    if (index >= keys.length) {
      setVoicePlayingState(false);
      return;
    }

    const key = keys[index];
    index += 1;

    if (!VOICE_CLIPS[key]) {
      playNext();
      return;
    }

    lastVoiceKey = key;
    audio.onerror = () => {
      console.warn(`PAL-AI voice file failed to load: ${VOICE_CLIPS[key]}`);
    };

    audio.onended = null;
    audio.src = VOICE_CLIPS[key];
    audio.volume = 0.86;
    audio.load();

    const playPromise = audio.play();

    if (playPromise && typeof playPromise.catch === "function") {
      playPromise
        .then(() => hideVoiceUnlockPrompt())
        .catch(() => showVoiceUnlockPrompt());
    }

    audio.onended = () => {
      voiceSequenceTimer = setTimeout(playNext, gapMs);
    };
  }

  playNext();
}

function unlockVoiceNarrator() {
  setVoiceMuteState(false);
  hideVoiceUnlockPrompt();
  playVoiceSequence(["home-welcome", "home-start"], 750);
}

function getCurrentVoiceTarget() {
  const activeMainTab = document.querySelector('.nav-btn.active')?.dataset.tab || 'home';

  if (activeMainTab === 'home') {
    return ["home-welcome", "home-start"];
  }

  if (activeMainTab === 'forecast') {
    const forecastVoiceMap = {
      yield: "forecast-yield",
      live: "forecast-live",
      longterm: "forecast-longterm",
    };

    return forecastVoiceMap[currentAnalysisSubtabs.forecast || 'yield'];
  }

  if (activeMainTab === 'terrain') {
    const terrainVoiceMap = {
      "terrain-3d": "terrain-3d-open",
      "terrain-farm-health": "terrain-farm-health",
      "terrain-water": "terrain-water",
      "terrain-fertilizer": "terrain-fertilizer",
    };

    return terrainVoiceMap[currentAnalysisSubtabs.terrain || 'terrain-3d'];
  }

  if (activeMainTab === 'pest') {
    const pestVoiceMap = {
      "pest-outbreak": "pest-outbreak-open",
      "pest-specific": "pest-specific",
    };

    return pestVoiceMap[currentAnalysisSubtabs.pest || 'pest-outbreak'];
  }

  if (activeMainTab === 'calculator') return "manual-calculation";
  if (activeMainTab === 'about') return "about";

  return null;
}

function replayCurrentVoiceLine() {
  setVoiceMuteState(false);

  const target = getCurrentVoiceTarget();

  if (Array.isArray(target)) {
    playVoiceSequence(target, 750);
  } else if (target) {
    playVoiceLine(target, { force: true });
  }
}

function enterPALAIWebsite() {
  if (welcomeScreenEntered) return;
  welcomeScreenEntered = true;

  const welcomeScreen = document.getElementById("palai-welcome-screen");

  document.body.classList.remove("welcome-active");
  hideVoiceUnlockPrompt();
  setVoiceMuteState(false);
  startBackgroundMusic();

  if (welcomeScreen) {
    welcomeScreen.classList.add("is-leaving");

    setTimeout(() => {
      welcomeScreen.classList.add("hidden");
      welcomeScreen.style.display = "none";
    }, 900);
  }

  setTimeout(() => {
    playVoiceSequence(["home-welcome", "home-start"], 750);
  }, 650);
}

// Prepare the voice controls, but do not play audio yet.
// The Home voice starts only after clicking Enter Website.
window.addEventListener("DOMContentLoaded", () => {
  const audio = getVoiceAudio();

  if (audio) {
    audio.addEventListener("play", () => setVoicePlayingState(true));
    audio.addEventListener("pause", () => setVoicePlayingState(false));
    audio.addEventListener("ended", () => setVoicePlayingState(false));
  }

  setVoiceMuteState(false);
});

// ════════════════════════════════════════
// HOME — Animated mock 3D terrain showcase
// Visual-only background; it does not replace or simulate the real DEM analysis.
// ════════════════════════════════════════
let homeTerrainAnimationFrame = null;
let homeTerrainCanvasState = null;

function initHomeTerrainShowcase() {
  const canvas = document.getElementById('home-terrain-canvas');
  if (!canvas || typeof canvas.getContext !== 'function') return;

  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return;

  homeTerrainCanvasState = { canvas, context, width: 0, height: 0, dpr: 1 };

  const resize = () => {
    if (!homeTerrainCanvasState) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(320, Math.round(rect.width));
    const height = Math.max(300, Math.round(rect.height));

    if (width === homeTerrainCanvasState.width && height === homeTerrainCanvasState.height && dpr === homeTerrainCanvasState.dpr) return;

    homeTerrainCanvasState.width = width;
    homeTerrainCanvasState.height = height;
    homeTerrainCanvasState.dpr = dpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  resize();
  window.addEventListener('resize', resize, { passive: true });

  const draw = (timestamp) => {
    if (!homeTerrainCanvasState) return;
    resize();
    drawHomeTerrainFrame(timestamp || 0, homeTerrainCanvasState);
    homeTerrainAnimationFrame = requestAnimationFrame(draw);
  };

  if (homeTerrainAnimationFrame) cancelAnimationFrame(homeTerrainAnimationFrame);
  homeTerrainAnimationFrame = requestAnimationFrame(draw);
}

function drawHomeTerrainFrame(timestamp, state) {
  const { context: ctx, width, height } = state;
  if (!width || !height) return;

  ctx.clearRect(0, 0, width, height);
  ctx.save();

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const t = reducedMotion ? 0 : timestamp * 0.001;
  const columns = 34;
  const rows = 28;
  const scale = Math.min(width / 49, height / 32) * 1.04;
  const originX = width * 0.53;
  const originY = height * 0.71;

  // Slow continuous rotation: approximately one revolution every 145 seconds.
  const angle = reducedMotion ? 0.48 : 0.48 + t * 0.0433;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const scanProgress = reducedMotion ? 1 : (t % 8.2) / 8.2;
  const points = [];
  const clamp01 = value => Math.max(0, Math.min(1, value));

  // Draw the atmospheric footprint first so it stays behind the terrain mesh.
  const footprint = ctx.createRadialGradient(
    width * 0.58,
    height * 0.75,
    12,
    width * 0.58,
    height * 0.75,
    width * 0.48
  );
  footprint.addColorStop(0, 'rgba(132, 204, 22, .17)');
  footprint.addColorStop(0.52, 'rgba(101, 163, 13, .075)');
  footprint.addColorStop(1, 'rgba(22, 101, 52, 0)');
  ctx.fillStyle = footprint;
  ctx.fillRect(0, height * 0.33, width, height * 0.67);

  const heightAt = (x, z) => {
    const rollingBase =
      Math.sin(x * 0.29 + z * 0.08) * 1.25 +
      Math.cos(z * 0.34 - x * 0.05) * 1.05 +
      Math.sin((x + z) * 0.22) * 0.78;

    const mountainA = 8.4 * Math.exp(-(((x - 5.4) ** 2) / 34 + ((z + 2.8) ** 2) / 25));
    const mountainB = 6.8 * Math.exp(-(((x + 7.2) ** 2) / 27 + ((z - 4.6) ** 2) / 31));
    const mountainC = 4.9 * Math.exp(-(((x + 0.8) ** 2) / 24 + ((z + 8.2) ** 2) / 19));
    const longRidge = 2.15 * Math.exp(-((z + x * 0.32 - 1.4) ** 2) / 8.5) * Math.cos(x * 0.22);
    const drainageValley = -2.75 * Math.exp(-((x * 0.46 + z * 0.62 + 1.8) ** 2) / 5.8);
    const fieldUndulation = 0.48 * Math.sin(x * 0.84) * Math.cos(z * 0.72);

    return rollingBase + mountainA + mountainB + mountainC + longRidge + drainageValley + fieldUndulation;
  };

  const project = (x, z, elevation) => {
    const rx = x * cosA - z * sinA;
    const rz = x * sinA + z * cosA;
    return {
      x: originX + (rx - rz) * scale * 0.88,
      y: originY + (rx + rz) * scale * 0.31 - elevation * scale * 1.14,
      depth: rx + rz
    };
  };

  for (let row = 0; row < rows; row++) {
    const line = [];
    const z = row - (rows - 1) / 2;
    for (let column = 0; column < columns; column++) {
      const x = column - (columns - 1) / 2;
      const elevation = heightAt(x, z);
      line.push({ ...project(x, z, elevation), elevation, column, row, modelX: x, modelZ: z });
    }
    points.push(line);
  }

  const surfaceCells = [];
  for (let row = 0; row < rows - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const p1 = points[row][column];
      const p2 = points[row][column + 1];
      const p3 = points[row + 1][column + 1];
      const p4 = points[row + 1][column];
      const averageHeight = (p1.elevation + p2.elevation + p3.elevation + p4.elevation) / 4;
      const localSlope = Math.max(
        Math.abs(p2.elevation - p1.elevation),
        Math.abs(p4.elevation - p1.elevation),
        Math.abs(p3.elevation - p2.elevation),
        Math.abs(p3.elevation - p4.elevation)
      );
      const normalizedHeight = clamp01((averageHeight + 4.2) / 15.8);
      const slopeSuitability = 1 - clamp01(localSlope / 4.2);
      const elevationSuitability = 1 - clamp01(Math.abs(averageHeight - 1.4) / 10.5);
      const suitability = clamp01(slopeSuitability * 0.68 + elevationSuitability * 0.32);
      const reveal = column / (columns - 1);
      const scanDistance = Math.abs(reveal - scanProgress);
      const scanGlow = Math.max(0, 1 - scanDistance * 12);

      surfaceCells.push({
        p1, p2, p3, p4,
        reveal,
        normalizedHeight,
        suitability,
        scanGlow,
        depth: (p1.depth + p2.depth + p3.depth + p4.depth) / 4
      });
    }
  }

  surfaceCells.sort((a, b) => a.depth - b.depth);

  // Keep the complete terrain visible at all times. The scanner only intensifies it.
  surfaceCells.forEach(cell => {
    const hue = 48 + cell.suitability * 78;
    const saturation = 61 + cell.suitability * 8;
    const lightness = 55 - cell.normalizedHeight * 10;
    const alreadyScanned = cell.reveal <= scanProgress;
    const alpha = alreadyScanned
      ? 0.43 + cell.suitability * 0.17 + cell.scanGlow * 0.12
      : 0.25 + cell.suitability * 0.10;

    ctx.beginPath();
    ctx.moveTo(cell.p1.x, cell.p1.y);
    ctx.lineTo(cell.p2.x, cell.p2.y);
    ctx.lineTo(cell.p3.x, cell.p3.y);
    ctx.lineTo(cell.p4.x, cell.p4.y);
    ctx.closePath();
    ctx.fillStyle = `hsla(${hue.toFixed(1)}, ${saturation.toFixed(0)}%, ${lightness.toFixed(0)}%, ${alpha.toFixed(3)})`;
    ctx.fill();

    ctx.strokeStyle = `hsla(${Math.min(128, hue + 5).toFixed(1)}, 58%, 31%, ${0.10 + cell.scanGlow * 0.18})`;
    ctx.lineWidth = 0.45;
    ctx.stroke();
  });

  // Draw all mesh lines at a readable baseline; brighten lines near the scan front.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let row = 0; row < rows; row++) {
    ctx.beginPath();
    points[row].forEach((point, column) => {
      if (column === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    const rowRatio = row / Math.max(1, rows - 1);
    const hue = 62 + rowRatio * 55;
    ctx.strokeStyle = `hsla(${hue}, 65%, 31%, ${0.34 + rowRatio * 0.18})`;
    ctx.lineWidth = row % 4 === 0 ? 1.45 : 0.78;
    ctx.stroke();
  }

  for (let column = 0; column < columns; column++) {
    const reveal = column / (columns - 1);
    const focus = Math.max(0, 1 - Math.abs(reveal - scanProgress) * 11);
    ctx.beginPath();
    for (let row = 0; row < rows; row++) {
      const point = points[row][column];
      if (row === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    const hue = 52 + reveal * 72;
    ctx.strokeStyle = `hsla(${hue}, 71%, 34%, ${0.34 + focus * 0.55})`;
    ctx.lineWidth = focus > 0.45 ? 2.05 : 0.86;
    ctx.stroke();
  }

  // Survey points travel with the active scan front.
  for (let row = 0; row < rows; row += 2) {
    for (let column = 0; column < columns; column += 2) {
      const reveal = column / (columns - 1);
      if (Math.abs(reveal - scanProgress) > 0.075) continue;
      const point = points[row][column];
      const suitability = clamp01((point.elevation + 4) / 14);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.05, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${55 + suitability * 66}, 76%, 40%, .98)`;
      ctx.fill();
    }
  }

  ctx.restore();
}

// Navigation Panel Sidebar

// ════════════════════════════════════════
// Dropdown Navigation + Analysis Subtabs
// ════════════════════════════════════════

const currentAnalysisSubtabs = {
  forecast: 'yield',
  terrain: 'terrain-3d',
  pest: 'pest-outbreak'
};

function toggleAnalysisDropdown(menuId) {
  const menu = document.getElementById(menuId);
  if (!menu) return;

  const wrapper = menu.closest('.nav-dropdown');
  const willOpen = !menu.classList.contains('open');

  menu.classList.toggle('open', willOpen);
  if (wrapper) wrapper.classList.toggle('open', willOpen);
}

function handleAnalysisParentClick(tabName, menuId) {
  const menu = document.getElementById(menuId);
  const wasOpen = menu && menu.classList.contains('open');

  // Always switch to the main tab first.
  switchTab(tabName);

  // Clicking the same parent tab controls only its own dropdown.
  if (wasOpen) {
    closeAnalysisDropdown(menuId);
  } else {
    openAnalysisDropdown(menuId);
  }
}

function openAnalysisDropdown(menuId) {
  const menu = document.getElementById(menuId);
  if (!menu) return;

  const wrapper = menu.closest('.nav-dropdown');

  menu.classList.add('open');
  if (wrapper) wrapper.classList.add('open');
}

function closeAnalysisDropdown(menuId) {
  const menu = document.getElementById(menuId);
  if (!menu) return;

  const wrapper = menu.closest('.nav-dropdown');

  menu.classList.remove('open');
  if (wrapper) wrapper.classList.remove('open');
}

function hideElementsBySelector(selectors) {
  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(el => {
      el.classList.add('subsection-hidden');
    });
  });
}

function showElementsBySelector(selectors) {
  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(el => {
      el.classList.remove('subsection-hidden');
    });
  });
}

function applyPestSubtabVisibility(subtab) {
  const outbreakPanel = document.getElementById('pest-outbreak-results-panel');
  const specificPanel = document.getElementById('pest-specific-results-panel');
  const formCard = document.querySelector('.pest-form-card');

  const showOutbreak = subtab === 'pest-outbreak';
  const showSpecific = subtab === 'pest-specific';

  if (formCard) {
    formCard.classList.toggle('subsection-hidden', !showOutbreak);
    formCard.style.display = showOutbreak ? '' : 'none';
  }

  if (outbreakPanel) {
    outbreakPanel.classList.toggle('subsection-hidden', !showOutbreak);
    outbreakPanel.style.display = showOutbreak ? '' : 'none';
  }

  if (specificPanel) {
    specificPanel.classList.toggle('subsection-hidden', !showSpecific);
    specificPanel.style.display = showSpecific ? '' : 'none';
  }
}

function refreshVisibleAnalysisVisuals(parent, subtab) {
  setTimeout(() => {
    try {
      if (parent === 'terrain') {
        if (subtab === 'terrain-3d') {
          if (terrainMiniMap) terrainMiniMap.invalidateSize();
          if (terrainProfileChart) terrainProfileChart.resize();

          if (window.Terrain && typeof Terrain.resumeRenderer === 'function') {
            Terrain.resumeRenderer();
          }
        }

    if (subtab === 'terrain-water') {
          const canvas = document.getElementById('waterBodyCanvas');
          if (canvas && latestTerrainLocation && typeof redrawWaterBodyAnalyzer === 'function') {
            redrawWaterBodyAnalyzer();
          }
        }
      }

      if (parent === 'pest') {
        applyPestSubtabVisibility(subtab);

        // Only refresh Bayesian charts/heatmap when Outbreak Analysis is active.
        if (subtab === 'pest-outbreak') {
          if (pestMiniMap) pestMiniMap.invalidateSize();

          if (pestRiskData) {
            if (typeof redrawPestHeatmapVisuals === 'function') {
              redrawPestHeatmapVisuals();
            }

            if (typeof renderPestAnalyticsCharts === 'function') {
              renderPestAnalyticsCharts(pestRiskData);
            }
          }
        }
      }
    } catch (err) {
      console.warn('Subtab visual refresh skipped:', err);
    }
  }, 180);
}

function switchAnalysisSubtab(parent, subtab, shouldSwitchMainTab = true) {
  if (shouldSwitchMainTab) {
    suppressNarrationOnce = true;
    switchTab(parent);
    suppressNarrationOnce = false;
  }

  currentAnalysisSubtabs[parent] = subtab;
  if (!suppressNarrationOnce) {
    const analysisVoiceMap = {
      "terrain-3d": "terrain-3d-open",
      "terrain-farm-health": "terrain-farm-health",
      "terrain-water": "terrain-water",
      "terrain-fertilizer": "terrain-fertilizer",
      "pest-outbreak": "pest-outbreak-open",
      "pest-specific": "pest-specific",
    };

    playVoiceLine(analysisVoiceMap[subtab], { force: true });
  }

  if (parent === 'terrain') {
    const terrainPageTitle = document.querySelector('#tab-terrain .page-title');
    const terrainPageDesc = document.querySelector('#tab-terrain .page-desc');
    const terrainHeadings = {
      'terrain-3d': ['3D Terrain & Topographic Analysis', 'Interactive real-elevation model, soil scoring, and terrain-adjusted yield estimation'],
      'terrain-farm-health': ['Farm Health & Seasonal Condition', 'Farmer-focused local climate, crop-stage, moisture, heat, and terrain condition report'],
      'terrain-water': ['Irrigation & Water Body Analysis', 'Mapped rivers, canals, reservoirs, drainage, and farm water-access context'],
      'terrain-fertilizer': ['Soil & Fertilizer Recommendation', 'Soil evidence, rice suitability, and fertilizer compatibility guidance']
    };
    const heading = terrainHeadings[subtab] || terrainHeadings['terrain-3d'];
    if (terrainPageTitle) terrainPageTitle.textContent = heading[0];
    if (terrainPageDesc) terrainPageDesc.textContent = heading[1];

    const terrain3D = [
      '.terrain-controls-card',
      '#terrain-viewer-card',
      '#terrain-scores'
    ];

    const terrainFarmHealth = [
      '#spatio-section'
    ];

    const terrainWater = [
      '#water-analyzer-section'
    ];

    const terrainFertilizer = [
      '#fertilizer-analysis-section'
    ];

    const allTerrainSections = [
      ...terrain3D,
      ...terrainFarmHealth,
      ...terrainWater,
      ...terrainFertilizer
    ];

    hideElementsBySelector(allTerrainSections);

    if (subtab === 'terrain-3d') {
      showElementsBySelector(terrain3D);

      // Show terrain results only if analysis already generated them.
      if (latestTerrainScores) {
        const scores = document.getElementById('terrain-scores');
        if (scores) scores.classList.remove('hidden');
      }
    }

    if (subtab === 'terrain-farm-health') {
      showElementsBySelector(terrainFarmHealth);
      const farmHealth = document.getElementById('spatio-section');
      if (farmHealth) farmHealth.classList.remove('hidden', 'subsection-hidden');
    }

    if (subtab === 'terrain-water') {
      showElementsBySelector(terrainWater);

      // Show water analyzer if terrain has already been generated.
      if (latestTerrainLocation) {
        const water = document.getElementById('water-analyzer-section');
        if (water) water.classList.remove('hidden');
      }
    }

    if (subtab === 'terrain-fertilizer') {
      showElementsBySelector(terrainFertilizer);

      // Show fertilizer section if analysis already generated it.
      if (latestFertilizerAnalysis) {
        const fertilizer = document.getElementById('fertilizer-analysis-section');
        if (fertilizer) fertilizer.classList.remove('hidden');
      }
    }
  }

  if (parent === 'pest') {
    applyPestSubtabVisibility(subtab);
  }

  document.querySelectorAll(`[data-sub-parent="${parent}"]`).forEach(btn => {
    btn.classList.toggle('active', btn.dataset.subTarget === subtab);
  });

  refreshVisibleAnalysisVisuals(parent, subtab);
}

function switchTab(tabName) {
  applyNavigationModeForTab(tabName);
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const section = document.getElementById(`tab-${tabName}`);
  if (section) section.classList.add('active');

  const btn = document.querySelector(`[data-tab="${tabName}"]`);
  if (btn) btn.classList.add('active');

  if (tabName === 'home') {
    startBackgroundMusic();
  }

  if (tabName === 'calculator') {
    playVoiceLine("manual-calculation", { force: true });
  }

  if (tabName === 'about') {
    playVoiceLine("about", { force: true });
  }

  if (tabName === 'forecast') {
    switchForecastSubtab(currentAnalysisSubtabs.forecast || 'yield', false);

    setTimeout(() => {
      if (!forecastMap) initForecastMap();
      if (forecastMap) forecastMap.invalidateSize();
    }, 200);

  } else if (tabName === 'terrain') {
    switchAnalysisSubtab('terrain', currentAnalysisSubtabs.terrain || 'terrain-3d', false);
  } else if (tabName === 'pest') {
    switchAnalysisSubtab('pest', currentAnalysisSubtabs.pest || 'pest-outbreak', false);
  }
  else if (tabName === 'about') {
    setTimeout(() => {
      initAboutTimeline();
    }, 80);
  }

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

// ════════════════════════════════════════
// ABOUT TAB — Interactive Project Timeline
// ════════════════════════════════════════

const ABOUT_TIMELINE = {
  "2024": {
    phase: "Pioneering Phase",
    title: "Sow Timely, Grow Primely",
    projectName: "Sow Timely, Grow Primely",
    coreTech: "MLR Forecasting",
    milestone: "First NSTF Appearance",
    researchers: ["Alexander Callueng", "Febellen Rejas", "Ayman Latip"],
    description:
      "This year was the pioneering phase of the project. It first started with only the rice yield forecasting algorithm developed, with no system or website yet. It developed the mathematical models for forecasting using only Multiple Linear Regression. The project was named “Sow Timely, Grow Primely” and earned its first appearance at the National Science and Technology Fair."
  },
  "2025": {
    phase: "Automation and System Phase",
    title: "GR-AI-N",
    projectName: "GR-AI-N",
    coreTech: "Automated Web Tool + AI Decision Support",
    milestone: "Second NSTF Appearance",
    researchers: ["Ayman Latip"],
    description:
      "This year was the automation and system phase. Using the forecasting models, the project evolved into a website-type tool for farmers. With only a few clicks, farmers could estimate rice yield and calculate optimal planting times. This pushed the project toward AI-powered systems, complete with an AI-assisted decision support system for farmers. The project was called GR-AI-N and earned its second appearance at the NSTF."
  },
  "2026": {
    phase: "Expansion and Precision Agriculture Phase",
    title: "PAL-AI",
    projectName: "PAL-AI",
    coreTech: "3D Terrain + Water + Pest Outbreak Intelligence",
    milestone: "Target Third NSTF Appearance",
    researchers: ["Mary Gamotia", "Prince Ace Gumpal", "Shane Pano"],
    description:
      "The latest iteration of the project is now passed down to three students: Mary Gamotia, Prince Ace Gumpal, and Shane Pano. This version improves the established AI system by adding 3D Terrain Analysis using satellite-based open-source data, an irrigation and water body detector system, and a Pest Outbreak Prevention system for a more powerful and complete farmer analysis. It expands the AI integration into more advanced features with hopes of reaching a third NSTF appearance."
  }
};

let aboutCurrentYear = "2024";
let aboutTimelineReady = false;

function initAboutTimeline() {
  if (aboutTimelineReady) {
    setAboutTimelineYear(aboutCurrentYear);
    return;
  }

  aboutTimelineReady = true;

  document.querySelectorAll('.about-section, .about-function-card, .about-time-machine, .about-future-card').forEach(el => {
    el.classList.add('about-reveal');
  });

  if ('IntersectionObserver' in window) {
    const aboutObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
        }
      });
    }, { threshold: 0.16 });

    document.querySelectorAll('.about-reveal').forEach(el => aboutObserver.observe(el));
  } else {
    document.querySelectorAll('.about-reveal').forEach(el => el.classList.add('in-view'));
  }

  setAboutTimelineYear("2024");
}

function setAboutTimelineYear(year) {
  const data = ABOUT_TIMELINE[year];
  if (!data) return;

  aboutCurrentYear = year;

  const years = ["2024", "2025", "2026"];
  const index = years.indexOf(year);
  const progress = index <= 0 ? 0 : index === 1 ? 50 : 100;

  const progressEl = document.getElementById('about-time-progress');
  if (progressEl) progressEl.style.width = `${progress}%`;

  document.querySelectorAll('.about-year-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.year === year);
  });

  document.querySelectorAll('.about-time-node').forEach(node => {
    node.classList.toggle('active', node.dataset.year === year);
  });

  const stage = document.querySelector('.about-timeline-stage');
  if (stage) {
    stage.classList.remove('about-year-changing');
    void stage.offsetWidth;
    stage.classList.add('about-year-changing');
  }

  const photo = document.getElementById('about-photo-placeholder');
  const photoYear = photo ? photo.querySelector('.about-photo-year') : null;

  if (photoYear) photoYear.textContent = year;

  setText('about-phase-badge', data.phase);
  setText('about-year-number', year);
  setText('about-year-title', data.title);
  setText('about-year-description', data.description);
  setText('about-project-name', data.projectName);
  setText('about-core-tech', data.coreTech);
  setText('about-milestone', data.milestone);

  const researchers = document.getElementById('about-researchers-list');
  if (researchers) {
    researchers.innerHTML = data.researchers.map(name => `<span>${name}</span>`).join('');
  }

  const yearPhoto = document.getElementById('about-year-photo');
  if (yearPhoto) {
    yearPhoto.src = `/static/assets/about/${year}.jpg`;
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function aboutTimelineNext() {
  const years = ["2024", "2025", "2026"];
  const currentIndex = years.indexOf(aboutCurrentYear);
  const nextYear = years[Math.min(currentIndex + 1, years.length - 1)];
  setAboutTimelineYear(nextYear);
}

function aboutTimelinePrev() {
  const years = ["2024", "2025", "2026"];
  const currentIndex = years.indexOf(aboutCurrentYear);
  const prevYear = years[Math.max(currentIndex - 1, 0)];
  setAboutTimelineYear(prevYear);
}

function aboutJumpToTimeline() {
  switchTab('about');

  setTimeout(() => {
    const timeline = document.getElementById('about-timeline-section');
    if (timeline) {
      timeline.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    initAboutTimeline();
  }, 120);
}

function applyNavigationModeForTab(tabName) {
  const body = document.body;
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const menuButton = document.getElementById('sidebar-mobile-toggle');
  const isHome = tabName === 'home';

  body.classList.toggle('home-immersive-nav', isHome);
  body.classList.remove('sidebar-collapsed');
  body.classList.remove('sidebar-drawer-open');

  if (isHome) {
    body.classList.add('sidebar-hidden');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
    if (menuButton) menuButton.setAttribute('aria-expanded', 'false');
  } else if (body.classList.contains('home-immersive-nav') === false) {
    // Leaving the full-screen home page restores the normal navigation.
    body.classList.remove('sidebar-hidden');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
    if (menuButton) menuButton.setAttribute('aria-expanded', 'false');
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const menuButton = document.getElementById('sidebar-mobile-toggle');

  if (!sidebar) return;

  const drawerMode = window.innerWidth <= 860 || document.body.classList.contains('sidebar-hidden');

  if (drawerMode) {
    const willOpen = !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', willOpen);
    document.body.classList.toggle('sidebar-drawer-open', willOpen);
    if (overlay) overlay.classList.toggle('show', willOpen);
    if (menuButton) menuButton.setAttribute('aria-expanded', String(willOpen));
    return;
  }

  // Desktop: collapse completely instead of leaving an icon rail behind.
  document.body.classList.add('sidebar-hidden');
  document.body.classList.remove('sidebar-drawer-open');
  sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('show');
  if (menuButton) menuButton.setAttribute('aria-expanded', 'false');
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const menuButton = document.getElementById('sidebar-mobile-toggle');

  if (sidebar) sidebar.classList.remove('open');
  document.body.classList.remove('sidebar-drawer-open');
  if (overlay) overlay.classList.remove('show');
  if (menuButton) menuButton.setAttribute('aria-expanded', 'false');
}

// Keep old function name just in case anything still calls it.
function toggleMobileNav() {
  toggleSidebar();
}

// ════════════════════════════════════════
// PAL-AI Settings — Region XII preload
// ════════════════════════════════════════
let region12PreloadPollTimer = null;
let region12PreloadRequestBusy = false;

function formatPreloadNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number).toLocaleString('en-US') : '0';
}

function openSettingsPanel() {
  const overlay = document.getElementById('palai-settings-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  refreshRegion12PreloadStatus(true);
}

function closeSettingsPanel(event = null) {
  if (event && event.target !== event.currentTarget) return;
  const overlay = document.getElementById('palai-settings-overlay');
  if (overlay) overlay.classList.add('hidden');
  document.body.style.overflow = '';
  if (region12PreloadPollTimer) {
    clearTimeout(region12PreloadPollTimer);
    region12PreloadPollTimer = null;
  }
}

function setRegion12PreloadPolling(shouldPoll) {
  if (region12PreloadPollTimer) {
    clearTimeout(region12PreloadPollTimer);
    region12PreloadPollTimer = null;
  }
  if (shouldPoll) {
    region12PreloadPollTimer = setTimeout(() => refreshRegion12PreloadStatus(false), 2500);
  }
}

function renderRegion12PreloadStatus(data) {
  const state = String(data?.status || 'idle').toLowerCase();
  const running = Boolean(data?.running);
  const progress = Math.max(0, Math.min(100, Number(data?.progress_pct || 0)));
  const toggle = document.getElementById('region12-preload-toggle');
  const stateEl = document.getElementById('region12-preload-state');
  const percentEl = document.getElementById('region12-preload-percent');
  const progressEl = document.querySelector('.region12-preload-progress');
  const progressFill = document.getElementById('region12-preload-progress-fill');
  const messageEl = document.getElementById('region12-preload-message');
  const persistenceEl = document.getElementById('region12-preload-persistence-note');

  if (toggle) {
    toggle.checked = running;
    toggle.disabled = region12PreloadRequestBusy || state === 'starting' || state === 'stopping';
  }
  if (stateEl) {
    const labels = {
      idle: 'Not started',
      starting: 'Starting',
      running: 'Running',
      stopping: 'Stopping',
      completed: 'Completed',
      cancelled: 'Stopped',
      failed: 'Failed'
    };
    stateEl.textContent = labels[state] || state;
    stateEl.className = `region12-preload-state ${state}`;
  }
  if (percentEl) percentEl.textContent = `${progress.toFixed(1)}%`;
  if (progressFill) progressFill.style.width = `${progress}%`;
  if (progressEl) progressEl.setAttribute('aria-valuenow', String(progress));
  if (messageEl) messageEl.textContent = data?.message || 'Waiting for server status...';

  const tileCurrent = Number(data?.current_tile || 0);
  const tileTotal = Number(data?.total_tiles || 0);
  const pointsCurrent = Number(data?.processed_points || 0);
  const pointsTotal = Number(data?.total_points || 0);
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  setText('region12-preload-tiles', `${formatPreloadNumber(tileCurrent)} / ${formatPreloadNumber(tileTotal)}`);
  setText('region12-preload-points', `${formatPreloadNumber(pointsCurrent)} / ${formatPreloadNumber(pointsTotal)}`);
  setText('region12-preload-saved', formatPreloadNumber(data?.new_points_saved));
  setText('region12-preload-failed', formatPreloadNumber(data?.failed_points));

  if (persistenceEl) {
    if (data?.cache_persistence === 'persistent_disk_or_redis') {
      persistenceEl.textContent = 'Persistent cache storage is configured. Saved elevation points can survive service restarts according to the configured disk or Redis service.';
    } else {
      persistenceEl.textContent = 'This Render service is using temporary local storage. The cache will be lost after a redeploy or service restart unless you attach a persistent disk or configure Upstash Redis.';
    }
  }

  setRegion12PreloadPolling(running || state === 'starting' || state === 'stopping');
}

async function refreshRegion12PreloadStatus(showLoading = false) {
  const messageEl = document.getElementById('region12-preload-message');
  if (showLoading && messageEl) messageEl.textContent = 'Contacting the Render backend...';
  try {
    const response = await fetch(`${API}/api/elevation-preload/region12/status`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`Backend returned HTTP ${response.status}`);
    const data = await response.json();
    renderRegion12PreloadStatus(data);
    return data;
  } catch (error) {
    if (messageEl) messageEl.textContent = `Could not read preload status: ${error.message}. The Render service may still be waking up.`;
    setRegion12PreloadPolling(false);
    return null;
  }
}

async function handleRegion12PreloadToggle(checked) {
  if (region12PreloadRequestBusy) return;
  region12PreloadRequestBusy = true;
  const toggle = document.getElementById('region12-preload-toggle');
  const messageEl = document.getElementById('region12-preload-message');
  if (toggle) toggle.disabled = true;
  if (messageEl) {
    messageEl.textContent = checked
      ? 'Sending the Region XII preload request to Render...'
      : 'Requesting a graceful stop after the current elevation batch...';
  }

  try {
    const action = checked ? 'start' : 'stop';
    const response = await fetch(`${API}/api/elevation-preload/region12/${action}`, {
      method: 'POST',
      headers: { 'Accept': 'application/json' }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.detail || data?.message || `Backend returned HTTP ${response.status}`);
    renderRegion12PreloadStatus(data);
  } catch (error) {
    if (messageEl) messageEl.textContent = `Preload request failed: ${error.message}`;
    if (toggle) toggle.checked = !checked;
  } finally {
    region12PreloadRequestBusy = false;
    if (toggle) toggle.disabled = false;
    setTimeout(() => refreshRegion12PreloadStatus(false), 800);
  }
}

window.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    const overlay = document.getElementById('palai-settings-overlay');
    if (overlay && !overlay.classList.contains('hidden')) closeSettingsPanel();
  }
});

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

function showLoading(title = "Generating Your Forecasts", message = "Preparing analysis...") {
  const overlay = document.getElementById('loading-overlay');
  const bar = document.getElementById('load-progress');
  const factEl = document.getElementById('load-fact');
  const titleEl = document.querySelector('.load-title');

  if (!overlay || !bar || !factEl) return;

  clearInterval(loadInterval);
  clearTimeout(loadHideTimer);

  overlay.classList.remove('hidden');

  if (titleEl) titleEl.textContent = title;

  bar.style.width = '0%';
  factEl.textContent = message;

  // Slow automatic movement only to show the app is alive.
  // Real terrain batch progress will override this through updateLoadingProgress().
  let progress = 4;
  loadInterval = setInterval(() => {
    progress = Math.min(progress + 2, 88);
    bar.style.width = progress + '%';
  }, 900);
}

function setLoadingText(message) {
  const factEl = document.getElementById('load-fact');
  if (factEl) factEl.textContent = message;
}

function updateLoadingProgress(percent, message = null) {
  const bar = document.getElementById('load-progress');

  if (bar) {
    const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
    bar.style.width = safePercent + '%';
  }

  if (message) setLoadingText(message);
}

function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  const bar = document.getElementById('load-progress');

  clearInterval(loadInterval);
  clearTimeout(loadHideTimer);
  loadInterval = null;

  if (!overlay || !bar) return;

  bar.style.width = '100%';
  setLoadingText('Analysis complete. Preparing results...');

  loadHideTimer = setTimeout(() => {
    overlay.classList.add('hidden');
    bar.style.width = '0%';
    setLoadingText('Preparing analysis...');
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
  setLoadingText('Preparing analysis...');
}

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  applyNavigationModeForTab('home');
  initHomeTerrainShowcase();
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
// FORECAST SUBTABS
// ════════════════════════════════════════

let longTermPlantingChart = null;
let longTermPlantingData = [];
let longTermSelectedYear = null;
let longTermSelectedMonth = 0;

function getProjectionValue(proj, key, year) {
  if (!proj || !Array.isArray(proj.years) || !Array.isArray(proj[key])) return null;

  const index = proj.years.findIndex(y => Number(y) === Number(year));
  if (index >= 0) return Number(proj[key][index]);

  return null;
}

function smoothClimateScore(value, optimum, sigma, hardLow, hardHigh, missing = 55) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return missing;

  const v = Number(value);
  if (v <= hardLow || v >= hardHigh) return 0;

  const score = 100 * Math.exp(-0.5 * Math.pow((v - optimum) / sigma, 2));
  return Math.max(0, Math.min(100, score));
}

function regulatedClimateScore(value, optimum, sigma, hardLow, hardHigh, missing = 62) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return missing;

  const v = Number(value);
  const curveScore = 100 * Math.exp(-0.5 * Math.pow((v - optimum) / sigma, 2));
  const boundaryPenalty =
    v < hardLow ? Math.min(18, (hardLow - v) * 1.4) :
      v > hardHigh ? Math.min(18, (v - hardHigh) * 1.4) :
        0;

  // Long-range climate projections should not collapse to 0 from one extreme variable.
  // This keeps the value as a planning compatibility index, not a fake exact probability.
  return Math.max(38, Math.min(93, curveScore - boundaryPenalty));
}

function getPlantingRiskLabel(score) {
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Good';
  if (score >= 55) return 'Moderate';
  if (score >= 40) return 'Caution';
  return 'Poor';
}

function getLongTermScoreColor(score) {
  if (score >= 85) return '#16a34a';
  if (score >= 70) return '#84cc16';
  if (score >= 55) return '#eab308';
  if (score >= 40) return '#f97316';
  return '#dc2626';
}

function getQuarterFromWeek(week) {
  return Math.min(4, Math.max(1, Math.ceil(Number(week) / 13)));
}

function getWeekRangeFromWeek(year, week) {
  const start = new Date(Date.UTC(Number(year), 0, 1));
  start.setUTCDate(start.getUTCDate() + (Number(week) - 1) * 7);

  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);

  const fmt = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' });
  const startLabel = fmt.format(start);
  const endLabel = fmt.format(end);

  return {
    start,
    end,
    label: `${startLabel}–${endLabel}`,
    fullLabel: `${startLabel}–${endLabel}, ${year}`
  };
}

function getMonthFromWeek(week) {
  const mid = new Date(Date.UTC(2026, 0, 1));
  mid.setUTCDate(mid.getUTCDate() + (Number(week) - 1) * 7 + 3);
  return mid.toLocaleDateString('en-PH', { month: 'long' });
}

function buildLongTermScoringContext(data) {
  const years = (data.annual || [])
    .map(r => Number(r.year))
    .filter(y => y >= 2025 && y <= 2100);

  const yields = years
    .map(year => Number((data.annual || []).find(r => Number(r.year) === year)?.yield || 0))
    .filter(v => Number.isFinite(v) && v > 0);

  const regionId = Number(currentRegionId || data?.region_id || 13);
  const fallbackCoords = (typeof REGION_COORDS !== 'undefined' && REGION_COORDS[regionId])
    ? REGION_COORDS[regionId]
    : [12.8797, 121.7740];
  const latitude = Number(lastForecastLat ?? latestTerrainLocation?.lat ?? fallbackCoords[0]);
  const longitude = Number(lastForecastLng ?? latestTerrainLocation?.lng ?? fallbackCoords[1]);
  const cropType = document.getElementById('crop-type-select')?.value ||
    document.getElementById('terrain-rice-type')?.value || 'inbred';

  const terrainIrrigation = Number(latestTerrainScores?.details?.irrigation?.irrigationScore);
  const terrainDrainage = Number(latestTerrainScores?.details?.soil?.drainageScore);

  return {
    years,
    minYear: years.length ? Math.min(...years) : 2026,
    maxYear: years.length ? Math.max(...years) : 2100,
    minYield: yields.length ? Math.min(...yields) : 0,
    maxYield: yields.length ? Math.max(...yields) : 1,
    regionId,
    latitude: Number.isFinite(latitude) ? latitude : fallbackCoords[0],
    longitude: Number.isFinite(longitude) ? longitude : fallbackCoords[1],
    cropType,
    irrigationScore: Number.isFinite(terrainIrrigation) ? terrainIrrigation : null,
    drainageScore: Number.isFinite(terrainDrainage) ? terrainDrainage : null,
    cache: {
      weekSuitability: new Map(),
      sunlight: new Map(),
      growthStage: new Map(),
      pestDisease: new Map(),
      harvest: new Map(),
      window: new Map()
    }
  };
}

function normalizeYieldScore(yieldValue, context) {
  const y = Number(yieldValue || 0);
  const minY = Number(context.minYield || 0);
  const maxY = Number(context.maxYield || 0);

  if (!Number.isFinite(y) || y <= 0 || maxY <= minY) return 55;

  // Keep yield helpful but never perfect. This prevents early high-yield years from becoming 100%.
  const normalized = (y - minY) / (maxY - minY);
  return 42 + normalized * 48; // 42–90 only
}

function getQuarterYield(year, quarter, data, fallbackYield) {
  const indexed = typeof getLongTermDataIndex === 'function' ? getLongTermDataIndex(data) : null;
  const indexedYield = indexed?.quarterlyYield?.get(`${Number(year)}:${Number(quarter)}`);
  if (Number.isFinite(indexedYield)) return Number(indexedYield);

  const qRows = (data.quarterly || []).filter(r => Number(r.year) === Number(year));
  const qRow = qRows.find(r => Number(r.quarter) === Number(quarter));
  return Number(qRow?.yield || fallbackYield || 0);
}

function estimateWeekSuitability(year, week, data, context) {
  const cacheKey = `${Number(year)}:${Number(week)}`;
  const weekCache = context?.cache?.weekSuitability;
  if (weekCache?.has(cacheKey)) return weekCache.get(cacheKey);

  const proj = data.climate_projections || {};
  const dataIndex = typeof getLongTermDataIndex === 'function' ? getLongTermDataIndex(data) : null;
  const annualRow = dataIndex?.annual?.get(Number(year)) ||
    (data.annual || []).find(r => Number(r.year) === Number(year));
  const annualYield = Number(annualRow?.yield || 0);

  const temp = getProjectionValue(proj, 'temperature', year);
  const precip = getProjectionValue(proj, 'precipitation', year);
  const humidity = getProjectionValue(proj, 'humidity', year);
  const wind = getProjectionValue(proj, 'wind_speed', year);
  const dew = getProjectionValue(proj, 'dew_point', year);

  const quarter = getQuarterFromWeek(week);
  const qRows = dataIndex?.quarterlyRows?.get(Number(year)) ||
    (data.quarterly || []).filter(r => Number(r.year) === Number(year));
  const qYield = getQuarterYield(year, quarter, data, annualYield);

  const bestQuarterRow = qRows.length
    ? [...qRows].sort((a, b) => Number(b.yield || 0) - Number(a.yield || 0))[0]
    : null;

  const bestQuarter = Number(bestQuarterRow?.quarter || quarter || 3);

  // Quarterly centers are seasonal anchors only. PAL-AI still tests all 52 weeks.
  const idealWeekByQuarter = { 1: 7, 2: 20, 3: 33, 4: 45 };
  const idealWeek = idealWeekByQuarter[bestQuarter] || 33;

  const weekDistance = Math.abs(Number(week) - idealWeek);
  const seasonalScore = Math.min(91, 7 + 84 * Math.exp(-0.5 * Math.pow(weekDistance / 5.4, 2)));

  // Regulated climate curves prevent far-future projections from becoming unrealistically perfect or unrealistically zero.
  const tempScore = regulatedClimateScore(temp, 28, 4.4, 18, 39);
  const rainScore = regulatedClimateScore(precip, 8, 8.2, 0, 65);
  const humidityScore = regulatedClimateScore(humidity, 77, 13.5, 38, 100);
  const dewScore = regulatedClimateScore(dew, 23, 4.6, 12, 32);
  const windScore = wind === null || wind === undefined
    ? 62
    : Math.max(42, Math.min(91, 91 - Math.max(0, Number(wind) - 8) * 1.55));

  const annualYieldScore = normalizeYieldScore(annualYield, context);
  const quarterYieldScore = normalizeYieldScore(qYield, context);

  // Keep future uncertainty real but not so strong that the year 2080+ always becomes red.
  const horizon = Math.max(0, (Number(year) - 2026) / (2100 - 2026));
  const uncertaintyPenalty = 1.4 + Math.min(8.5, horizon * 8.5);

  // Deterministic interannual variability avoids repeated ties while staying reproducible.
  const regionSeed = Number(currentRegionId || 13);
  const variability = Math.abs(Math.sin(Number(year) * 12.9898 + regionSeed * 78.233));
  const naturalVariabilityPenalty = 0.8 + variability * 3.4;
  const naturalVariabilityNudge = Math.sin(Number(year) * 0.73 + regionSeed * 1.17) * 1.6;

  let climatePenalty = 0;
  if (temp !== null && Number(temp) >= 33) climatePenalty += Math.min(7, (Number(temp) - 32.5) * 1.25);
  if (humidity !== null && Number(humidity) >= 88) climatePenalty += Math.min(5, (Number(humidity) - 87) * 0.55);
  if (dew !== null && Number(dew) >= 26) climatePenalty += Math.min(4, (Number(dew) - 25.5) * 0.85);
  if (precip !== null && Number(precip) < 1) climatePenalty += 3.5;
  if (precip !== null && Number(precip) > 32) climatePenalty += Math.min(6, (Number(precip) - 32) * 0.42);
  if (wind !== null && Number(wind) > 30) climatePenalty += Math.min(5, (Number(wind) - 30) * 0.45);

  // If the chosen week is not in the strongest quarter, reduce confidence slightly.
  const bestQuarterYield = Number(bestQuarterRow?.yield || qYield || annualYield || 0);
  const quarterMismatchPenalty = bestQuarterYield > 0
    ? Math.max(0, ((bestQuarterYield - qYield) / bestQuarterYield) * 10)
    : 0;

  const rawScore =
    seasonalScore * 0.22 +
    tempScore * 0.16 +
    rainScore * 0.12 +
    humidityScore * 0.08 +
    dewScore * 0.06 +
    windScore * 0.06 +
    annualYieldScore * 0.15 +
    quarterYieldScore * 0.15 -
    uncertaintyPenalty -
    naturalVariabilityPenalty -
    climatePenalty -
    quarterMismatchPenalty;

  // Logistic regulation: raises overly collapsed far-future scores, lowers near-perfect scores,
  // and guarantees no long-term projection displays as 100%.
  const regulatedScore = 50 + (43 / (1 + Math.exp(-(rawScore - 55) / 13))) + naturalVariabilityNudge;
  const finalScore = Math.max(50, Math.min(93.2, regulatedScore));
  if (weekCache) weekCache.set(cacheKey, finalScore);
  return finalScore;
}

const LONG_TERM_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function clampPlantingScore(score) {
  return Math.max(25, Math.min(95.5, Number(score) || 25));
}

function longTermClamp(value, min = 0, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function longTermGaussian(value, optimum, sigma, fallback = 55) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return longTermClamp(100 * Math.exp(-0.5 * Math.pow((number - optimum) / sigma, 2)));
}

function addUtcDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + Number(days));
  return result;
}

function getUtcDayOfYear(date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.floor((date.getTime() - start.getTime()) / 86400000) + 1;
}

function getWeekFromUtcDate(date) {
  return Math.min(52, Math.max(1, Math.ceil(getUtcDayOfYear(date) / 7)));
}

function getIsoFromUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

function getFullDateLabel(year, monthIndex, day) {
  return new Date(Date.UTC(Number(year), Number(monthIndex), Number(day)))
    .toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function getShortDayLabel(year, monthIndex, day) {
  return new Date(Date.UTC(Number(year), Number(monthIndex), Number(day)))
    .toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatLongTermRange(startDate, endDate, includeYear = false) {
  const startFmt = new Intl.DateTimeFormat('en-PH', {
    month: 'short', day: 'numeric', ...(includeYear ? { year: 'numeric' } : {}), timeZone: 'UTC'
  });
  const endFmt = new Intl.DateTimeFormat('en-PH', {
    month: 'short', day: 'numeric', ...(includeYear ? { year: 'numeric' } : {}), timeZone: 'UTC'
  });

  if (startDate.getUTCMonth() === endDate.getUTCMonth()) {
    const month = startDate.toLocaleDateString('en-PH', { month: 'short', timeZone: 'UTC' });
    const yearText = includeYear ? `, ${startDate.getUTCFullYear()}` : '';
    return `${month} ${startDate.getUTCDate()}–${endDate.getUTCDate()}${yearText}`;
  }

  return `${startFmt.format(startDate)}–${endFmt.format(endDate)}`;
}

const LONG_TERM_CROP_TIMING = {
  'inbred': { maturityDays: 115, rainOptimum: 6.5, soilMoistureOptimum: 67, irrigationReliance: 0.72 },
  'hybrid': { maturityDays: 120, rainOptimum: 6.8, soilMoistureOptimum: 69, irrigationReliance: 0.78 },
  'glutinous': { maturityDays: 120, rainOptimum: 6.6, soilMoistureOptimum: 68, irrigationReliance: 0.70 },
  'aromatic': { maturityDays: 125, rainOptimum: 6.4, soilMoistureOptimum: 67, irrigationReliance: 0.72 },
  'rainfed': { maturityDays: 120, rainOptimum: 8.4, soilMoistureOptimum: 72, irrigationReliance: 0.30 },
  'upland': { maturityDays: 110, rainOptimum: 6.0, soilMoistureOptimum: 58, irrigationReliance: 0.18 },
  'direct-seeded': { maturityDays: 105, rainOptimum: 6.2, soilMoistureOptimum: 62, irrigationReliance: 0.45 },
  'transplanted': { maturityDays: 120, rainOptimum: 6.8, soilMoistureOptimum: 70, irrigationReliance: 0.80 }
};

const LONG_TERM_TYPHOON_MONTH_RISK = [7, 6, 5, 6, 10, 19, 34, 48, 61, 68, 50, 24];
const LONG_TERM_TYPHOON_EXPOSURE = {
  1: 0.92, 2: 1.15, 3: 0.88, 4: 0.90,
  5: 0.82, 6: 1.16, 7: 0.72, 8: 0.78,
  9: 1.08, 10: 0.42, 11: 0.38, 12: 0.28,
  13: 0.25, 14: 0.72, 15: 1.00, 16: 0.24
};

function getLongTermCropTiming(context) {
  return LONG_TERM_CROP_TIMING[context.cropType] || LONG_TERM_CROP_TIMING.inbred;
}

const LONG_TERM_DATA_INDEX = new WeakMap();

function getLongTermDataIndex(data) {
  if (!data || typeof data !== 'object') {
    return { years: [], quarterlyClimate: new Map(), historicalQuarterClimate: new Map(), annual: new Map(), quarterlyYield: new Map(), quarterlyRows: new Map(), dateClimate: new Map(), averageClimate: new Map() };
  }
  if (LONG_TERM_DATA_INDEX.has(data)) return LONG_TERM_DATA_INDEX.get(data);

  const index = {
    years: (data?.climate_projections?.years || data?.years || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b),
    quarterlyClimate: new Map(),
    historicalQuarterClimate: new Map(),
    annual: new Map(),
    quarterlyYield: new Map(),
    quarterlyRows: new Map(),
    dateClimate: new Map(),
    averageClimate: new Map()
  };

  (data.quarterly_climate || []).forEach(row => {
    index.quarterlyClimate.set(`${Number(row.year)}:${Number(row.quarter)}`, row);
  });
  (data.historical_quarter_climate || []).forEach(row => {
    index.historicalQuarterClimate.set(Number(row.quarter), row);
  });
  (data.annual || []).forEach(row => {
    index.annual.set(Number(row.year), row);
  });
  (data.quarterly || []).forEach(row => {
    const year = Number(row.year);
    const quarter = Number(row.quarter);
    index.quarterlyYield.set(`${year}:${quarter}`, Number(row.yield));
    if (!index.quarterlyRows.has(year)) index.quarterlyRows.set(year, []);
    index.quarterlyRows.get(year).push(row);
  });

  index.minYear = index.years.length ? index.years[0] : 2026;
  index.maxYear = index.years.length ? index.years[index.years.length - 1] : 2100;
  index.yearSet = new Set(index.years);

  LONG_TERM_DATA_INDEX.set(data, index);
  return index;
}

function getNearestProjectionYear(data, requestedYear) {
  const index = getLongTermDataIndex(data);
  const year = Number(requestedYear);
  if (!index.years.length) return year;
  if (index.yearSet?.has(year)) return year;
  if (year <= index.minYear) return index.minYear;
  if (year >= index.maxYear) return index.maxYear;

  // Forecast years are continuous in PAL-AI. This guarded rounded lookup avoids
  // repeatedly scanning all 75 years while still supporting a sparse future set.
  const rounded = Math.round(year);
  if (index.yearSet?.has(rounded)) return rounded;
  let low = 0;
  let high = index.years.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const value = index.years[mid];
    if (value === year) return value;
    if (value < year) low = mid + 1;
    else high = mid - 1;
  }
  const lower = index.years[Math.max(0, high)];
  const upper = index.years[Math.min(index.years.length - 1, low)];
  return Math.abs(year - lower) <= Math.abs(upper - year) ? lower : upper;
}

function getHistoricalQuarterClimate(data, quarter, key) {
  const row = getLongTermDataIndex(data).historicalQuarterClimate.get(Number(quarter));
  const value = Number(row?.[key]);
  return Number.isFinite(value) ? value : null;
}

function getQuarterClimateValue(data, year, quarter, key) {
  const nearestYear = getNearestProjectionYear(data, year);
  const row = getLongTermDataIndex(data).quarterlyClimate.get(`${Number(nearestYear)}:${Number(quarter)}`);
  const direct = Number(row?.[key]);
  if (Number.isFinite(direct)) return direct;

  const annualValue = getProjectionValue(data.climate_projections || {}, key, nearestYear);
  const historicalQuarter = getHistoricalQuarterClimate(data, quarter, key);
  const historicalRows = data.historical_quarter_climate || [];
  const historicalAnnual = historicalRows.length
    ? historicalRows.reduce((sum, item) => sum + Number(item?.[key] || 0), 0) / historicalRows.length
    : null;

  if (Number.isFinite(annualValue) && Number.isFinite(historicalQuarter) && Number.isFinite(historicalAnnual)) {
    if (key === 'temperature' || key === 'dew_point' || key === 'humidity' || key === 'wind_speed') {
      return Number(annualValue) + (historicalQuarter - historicalAnnual);
    }
    if (historicalAnnual > 0) return Math.max(0, Number(annualValue) * (historicalQuarter / historicalAnnual));
  }

  if (Number.isFinite(annualValue)) return Number(annualValue);
  return Number.isFinite(historicalQuarter) ? historicalQuarter : null;
}

function getProjectedClimateForDate(date, data) {
  const dataIndex = getLongTermDataIndex(data);
  const dateKey = date.getTime();
  if (dataIndex.dateClimate.has(dateKey)) return dataIndex.dateClimate.get(dateKey);

  const year = date.getUTCFullYear();
  const dayOfYear = getUtcDayOfYear(date);
  const quarterCenters = [46, 137, 229, 320];
  const keyNames = ['temperature', 'dew_point', 'precipitation', 'wind_speed', 'humidity'];

  let leftQuarter = 1;
  let rightQuarter = 1;
  let leftDay = quarterCenters[0];
  let rightDay = quarterCenters[0];
  let leftYear = year;
  let rightYear = year;

  if (dayOfYear <= quarterCenters[0]) {
    leftQuarter = 4;
    rightQuarter = 1;
    leftDay = quarterCenters[3] - 365;
    rightDay = quarterCenters[0];
    leftYear = year - 1;
  } else if (dayOfYear >= quarterCenters[3]) {
    leftQuarter = 4;
    rightQuarter = 1;
    leftDay = quarterCenters[3];
    rightDay = quarterCenters[0] + 365;
    rightYear = year + 1;
  } else {
    for (let index = 0; index < quarterCenters.length - 1; index++) {
      if (dayOfYear >= quarterCenters[index] && dayOfYear <= quarterCenters[index + 1]) {
        leftQuarter = index + 1;
        rightQuarter = index + 2;
        leftDay = quarterCenters[index];
        rightDay = quarterCenters[index + 1];
        break;
      }
    }
  }

  const fraction = longTermClamp((dayOfYear - leftDay) / Math.max(1, rightDay - leftDay), 0, 1);
  const result = {};

  keyNames.forEach(key => {
    const leftValue = getQuarterClimateValue(data, leftYear, leftQuarter, key);
    const rightValue = getQuarterClimateValue(data, rightYear, rightQuarter, key);
    if (Number.isFinite(leftValue) && Number.isFinite(rightValue)) {
      result[key] = leftValue + (rightValue - leftValue) * fraction;
    } else {
      result[key] = Number.isFinite(leftValue) ? leftValue : rightValue;
    }
  });

  dataIndex.dateClimate.set(dateKey, result);
  return result;
}

function averageProjectedClimate(startDate, days, data) {
  const dataIndex = getLongTermDataIndex(data);
  const cacheKey = `${startDate.getTime()}:${Number(days)}`;
  if (dataIndex.averageClimate.has(cacheKey)) return dataIndex.averageClimate.get(cacheKey);

  const samples = Array.from({ length: days }, (_, index) =>
    getProjectedClimateForDate(addUtcDays(startDate, index), data)
  );
  const keys = ['temperature', 'dew_point', 'precipitation', 'wind_speed', 'humidity'];
  const result = {};
  keys.forEach(key => {
    const values = samples.map(item => Number(item[key])).filter(Number.isFinite);
    result[key] = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  });
  dataIndex.averageClimate.set(cacheKey, result);
  return result;
}

function getAstronomicalDayLength(latitude, date) {
  const latRad = Number(latitude) * Math.PI / 180;
  const day = getUtcDayOfYear(date);
  const declination = 23.44 * Math.sin((2 * Math.PI / 365) * (284 + day));
  const declinationRad = declination * Math.PI / 180;
  const argument = longTermClamp(-Math.tan(latRad) * Math.tan(declinationRad), -1, 1);
  const hourAngle = Math.acos(argument);
  return (24 / Math.PI) * hourAngle;
}

function getEffectiveSunlightHours(latitude, date, climate) {
  const daylight = getAstronomicalDayLength(latitude, date);
  const rainfall = Number(climate.precipitation || 0);
  const humidity = Number(climate.humidity || 75);
  const cloudRetention = longTermClamp(0.90 - rainfall * 0.025 - Math.max(0, humidity - 75) * 0.006, 0.48, 0.90);
  return daylight * cloudRetention;
}

function getCachedEffectiveSunlight(context, date, climate) {
  const key = date.getTime();
  const cache = context?.cache?.sunlight;
  if (cache?.has(key)) return cache.get(key);
  const hours = getEffectiveSunlightHours(context.latitude, date, climate);
  if (cache) cache.set(key, hours);
  return hours;
}

function getMoonPhaseDetails(date) {
  const referenceNewMoon = Date.UTC(2000, 0, 6, 18, 14, 0);
  const synodicMonthDays = 29.530588853;
  const age = ((date.getTime() - referenceNewMoon) / 86400000 % synodicMonthDays + synodicMonthDays) % synodicMonthDays;
  const waxing = age < synodicMonthDays / 2;
  const illumination = 0.5 * (1 - Math.cos((2 * Math.PI * age) / synodicMonthDays));
  const traditionalScore = waxing
    ? 70 + Math.sin((Math.PI * age) / (synodicMonthDays / 2)) * 25
    : 48 + (1 - illumination) * 12;
  return { age, waxing, illumination, score: longTermClamp(traditionalScore) };
}

function getOperationalLaborScore(startDate) {
  const day = startDate.getUTCDay();
  const byDay = { 0: 62, 1: 92, 2: 88, 3: 82, 4: 72, 5: 62, 6: 56 };
  return byDay[day] || 65;
}

function getIrrigationContextScore(context, climate, cropTiming) {
  const inferredIrrigation = Number.isFinite(context.irrigationScore)
    ? context.irrigationScore
    : ({ inbred: 68, hybrid: 72, glutinous: 66, aromatic: 68, rainfed: 38, upland: 30, 'direct-seeded': 52, transplanted: 75 }[context.cropType] || 62);
  const rainfallSupport = longTermGaussian(Number(climate.precipitation), cropTiming.rainOptimum, 4.8, 50);

  if (context.cropType === 'rainfed' || context.cropType === 'upland') {
    return longTermClamp(rainfallSupport * 0.78 + inferredIrrigation * 0.22);
  }

  return longTermClamp(inferredIrrigation * cropTiming.irrigationReliance + rainfallSupport * (1 - cropTiming.irrigationReliance));
}

function getSoilMoistureAssessment(climate, context, cropTiming) {
  const rain = Number(climate.precipitation || 0);
  const humidity = Number(climate.humidity || 75);
  const temperature = Number(climate.temperature || 28);
  const wind = Number(climate.wind_speed || 7);
  const drainage = Number.isFinite(context.drainageScore) ? context.drainageScore : 72;

  const moistureIndex = longTermClamp(
    rain * 6.2 + humidity * 0.52 - Math.max(0, temperature - 26) * 3.6 - wind * 0.45,
    0,
    100
  );
  let score = longTermGaussian(moistureIndex, cropTiming.soilMoistureOptimum, 19, 55);

  if (rain > 12 && drainage < 60) score -= Math.min(26, (rain - 12) * 2.1 + (60 - drainage) * 0.35);
  if (rain < 1.2 && context.cropType === 'rainfed') score -= 25;

  return { moistureIndex, score: longTermClamp(score) };
}

function getSoilTemperatureAssessment(climate, effectiveSunlight) {
  const ambient = Number(climate.temperature || 28);
  const rainCooling = Math.min(2.4, Number(climate.precipitation || 0) * 0.12);
  const solarAdjustment = (Number(effectiveSunlight || 8) - 8) * 0.38;
  const soilTemperature = ambient + solarAdjustment - rainCooling;
  let score = longTermGaussian(soilTemperature, 29, 3.4, 55);
  if (soilTemperature < 20) score = Math.min(score, 35);
  return { soilTemperature, score: longTermClamp(score) };
}

function getExtremeWeatherRisk(date, climate, context, soilTemperature = null) {
  const monthIndex = date.getUTCMonth();
  const exposure = LONG_TERM_TYPHOON_EXPOSURE[context.regionId] ?? 0.70;
  const rain = Number(climate.precipitation || 0);
  const temp = Number(climate.temperature || 28);
  const humidity = Number(climate.humidity || 78);
  const wind = Number(climate.wind_speed || 7);

  const typhoonRisk = longTermClamp(
    LONG_TERM_TYPHOON_MONTH_RISK[monthIndex] * exposure + Math.max(0, wind - 15) * 1.8 + Math.max(0, rain - 15) * 0.8
  );
  const droughtRisk = longTermClamp(Math.max(0, 3.2 - rain) * 15 + Math.max(0, temp - 31) * 8 + Math.max(0, 72 - humidity) * 0.8);
  const floodRisk = longTermClamp(Math.max(0, rain - 10) * 5.2 + Math.max(0, humidity - 88) * 1.7);
  const frostRisk = context.regionId === 15 && Number.isFinite(soilTemperature)
    ? longTermClamp(Math.max(0, 18 - soilTemperature) * 14)
    : 0;

  const combinedRisk = longTermClamp(typhoonRisk * 0.48 + droughtRisk * 0.27 + floodRisk * 0.22 + frostRisk * 0.03);
  return {
    typhoonRisk,
    droughtRisk,
    floodRisk,
    frostRisk,
    score: longTermClamp(100 - combinedRisk)
  };
}

function getPestDiseaseCycleScore(date, climate, context) {
  const cacheKey = date.getTime();
  const cache = context?.cache?.pestDisease;
  if (cache?.has(cacheKey)) return cache.get(cacheKey);

  const temp = Number(climate.temperature || 28);
  const humidity = Number(climate.humidity || 78);
  const dew = Number(climate.dew_point || 22);
  const rain = Number(climate.precipitation || 0);
  const month = date.getUTCMonth();

  const fungalPressure = longTermClamp(
    Math.max(0, humidity - 78) * 2.0 + Math.max(0, dew - 22) * 4.2 + Math.max(0, rain - 5) * 2.3
  );
  const insectThermal = longTermGaussian(temp, 29, 4.2, 60);
  const wetSeasonPulse = [20, 18, 18, 22, 30, 42, 52, 58, 62, 58, 44, 30][month];
  const regionalWetness = [0.75, 1.05, 0.85, 0.88, 0.85, 1.05, 0.92, 0.90, 1.00, 0.72, 0.82, 0.72, 0.70, 0.94, 0.82, 0.68][context.regionId - 1] || 0.85;
  const insectPressure = longTermClamp(insectThermal * 0.42 + wetSeasonPulse * regionalWetness * 0.58);
  const combinedPressure = longTermClamp(fungalPressure * 0.55 + insectPressure * 0.45);
  const finalScore = longTermClamp(100 - combinedPressure * 0.72);
  if (cache) cache.set(cacheKey, finalScore);
  return finalScore;
}

function getRainfallPatternScore(startClimate, previousClimate, cropTiming, context) {
  const rain = Number(startClimate.precipitation || 0);
  const previousRain = Number(previousClimate.precipitation || 0);
  const amountScore = longTermGaussian(rain, cropTiming.rainOptimum, context.cropType === 'rainfed' ? 4.2 : 5.2, 50);
  const rise = rain - previousRain;

  let onsetScore = 52;
  if (rain >= 2.5 && rain <= 12 && rise >= 1.0) onsetScore = 92;
  else if (rain >= 2.5 && rain <= 12 && rise >= 0) onsetScore = 80;
  else if (rain > 12) onsetScore = Math.max(35, 78 - (rain - 12) * 4);
  else if (rain < 1.2) onsetScore = context.cropType === 'rainfed' ? 22 : 45;
  else onsetScore = 60;

  return longTermClamp(amountScore * 0.68 + onsetScore * 0.32);
}

function getHarvestMaturityScore(harvestDate, climate, context) {
  const cacheKey = harvestDate.getTime();
  const cache = context?.cache?.harvest;
  if (cache?.has(cacheKey)) return cache.get(cacheKey);

  const effectiveSun = getCachedEffectiveSunlight(context, harvestDate, climate);
  const dryHarvest = longTermGaussian(Number(climate.precipitation), 3.0, 4.0, 50);
  const temperature = longTermGaussian(Number(climate.temperature), 27.0, 3.8, 55);
  const sunlight = longTermGaussian(effectiveSun, 8.2, 1.9, 55);
  const hazard = getExtremeWeatherRisk(harvestDate, climate, context).score;
  const finalScore = longTermClamp(dryHarvest * 0.32 + temperature * 0.22 + sunlight * 0.20 + hazard * 0.26);
  if (cache) cache.set(cacheKey, finalScore);
  return finalScore;
}

function getGrowthStageAlignmentScore(startDate, data, context, cropTiming) {
  const cacheKey = `${startDate.getTime()}:${context.cropType}`;
  const cache = context?.cache?.growthStage;
  if (cache?.has(cacheKey)) return cache.get(cacheKey);

  const seedlingDate = addUtcDays(startDate, 10);
  const vegetativeDate = addUtcDays(startDate, Math.round(cropTiming.maturityDays * 0.32));
  const floweringDate = addUtcDays(startDate, Math.round(cropTiming.maturityDays * 0.63));
  const grainFillDate = addUtcDays(startDate, Math.round(cropTiming.maturityDays * 0.82));

  const seedlingClimate = getProjectedClimateForDate(seedlingDate, data);
  const vegetativeClimate = getProjectedClimateForDate(vegetativeDate, data);
  const floweringClimate = getProjectedClimateForDate(floweringDate, data);
  const grainFillClimate = getProjectedClimateForDate(grainFillDate, data);

  const seedlingSun = getCachedEffectiveSunlight(context, seedlingDate, seedlingClimate);
  const seedlingSoilTemp = getSoilTemperatureAssessment(seedlingClimate, seedlingSun);
  const seedlingMoisture = getSoilMoistureAssessment(seedlingClimate, context, cropTiming).score;

  const vegetativeSun = getCachedEffectiveSunlight(context, vegetativeDate, vegetativeClimate);
  const vegetativeScore = longTermClamp(
    longTermGaussian(vegetativeSun, 8.8, 1.8, 55) * 0.55 +
    getSoilMoistureAssessment(vegetativeClimate, context, cropTiming).score * 0.45
  );

  const floweringHeat = longTermGaussian(Number(floweringClimate.temperature), 27.5, 3.0, 50);
  const floweringHazard = getExtremeWeatherRisk(floweringDate, floweringClimate, context).score;
  const floweringScore = longTermClamp(floweringHeat * 0.58 + floweringHazard * 0.42);

  const grainSun = getCachedEffectiveSunlight(context, grainFillDate, grainFillClimate);
  const grainFillScore = longTermClamp(
    longTermGaussian(grainSun, 8.5, 1.8, 55) * 0.58 +
    longTermGaussian(Number(grainFillClimate.temperature), 27.0, 3.6, 55) * 0.42
  );

  const finalScore = longTermClamp(
    ((seedlingSoilTemp.score + seedlingMoisture) / 2) * 0.25 +
    vegetativeScore * 0.25 +
    floweringScore * 0.30 +
    grainFillScore * 0.20
  );
  if (cache) cache.set(cacheKey, finalScore);
  return finalScore;
}

function getLongTermYieldPotentialScore(startDate, data, context) {
  const year = getNearestProjectionYear(data, startDate.getUTCFullYear());
  const week = getWeekFromUtcDate(startDate);
  const quarter = getQuarterFromWeek(week);
  const annualRow = getLongTermDataIndex(data).annual.get(Number(year)) ||
    (data.annual || []).find(row => Number(row.year) === Number(year));
  const annualYield = Number(annualRow?.yield || 0);
  const quarterYield = getQuarterYield(year, quarter, data, annualYield);
  return longTermClamp(normalizeYieldScore(annualYield, context) * 0.45 + normalizeYieldScore(quarterYield, context) * 0.55);
}

function buildLongTermExplanation(factors) {
  const factorLabels = {
    rainfall: 'rainfall timing', temperature: 'temperature', sunlight: 'sunlight',
    extremeWeather: 'low weather risk', soilMoisture: 'soil moisture', soilTemperature: 'soil warmth',
    humidity: 'humidity balance', maturity: 'harvest timing', growthStages: 'growth-stage alignment',
    pestDisease: 'lower pest pressure', water: 'water availability', forecastCore: 'forecast yield'
  };

  return Object.entries(factors)
    .filter(([key]) => factorLabels[key])
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 3)
    .map(([key]) => factorLabels[key])
    .join(', ');
}

function scoreLongTermPlantingWindow(startDate, data, context) {
  const cacheKey = `${startDate.getTime()}:${context.cropType}:${context.irrigationScore ?? 'na'}:${context.drainageScore ?? 'na'}`;
  const cache = context?.cache?.window;
  if (cache?.has(cacheKey)) return cache.get(cacheKey);

  const cropTiming = getLongTermCropTiming(context);
  const midpoint = addUtcDays(startDate, 3);
  const endDate = addUtcDays(startDate, 6);
  const previousPeriod = addUtcDays(startDate, -21);
  const startClimate = averageProjectedClimate(startDate, 7, data);
  const previousClimate = averageProjectedClimate(previousPeriod, 7, data);

  const averageSunlight = Array.from({ length: 7 }, (_, index) => {
    const date = addUtcDays(startDate, index);
    const climate = getProjectedClimateForDate(date, data);
    return getCachedEffectiveSunlight(context, date, climate);
  }).reduce((sum, hours) => sum + hours, 0) / 7;

  const soilMoisture = getSoilMoistureAssessment(startClimate, context, cropTiming);
  const soilTemperature = getSoilTemperatureAssessment(startClimate, averageSunlight);
  const extremeWeather = getExtremeWeatherRisk(midpoint, startClimate, context, soilTemperature.soilTemperature);
  const harvestDate = addUtcDays(startDate, cropTiming.maturityDays);
  const harvestClimate = getProjectedClimateForDate(harvestDate, data);

  const weeklyCore = Array.from({ length: 7 }, (_, index) => {
    const date = addUtcDays(startDate, index);
    return estimateWeekSuitability(date.getUTCFullYear(), getWeekFromUtcDate(date), data, context);
  }).reduce((sum, score) => sum + score, 0) / 7;

  const factors = {
    forecastCore: weeklyCore,
    rainfall: getRainfallPatternScore(startClimate, previousClimate, cropTiming, context),
    temperature: longTermGaussian(Number(startClimate.temperature), 27.5, 3.6, 55),
    sunlight: longTermGaussian(averageSunlight, 8.6, 1.9, 55),
    extremeWeather: extremeWeather.score,
    soilMoisture: soilMoisture.score,
    soilTemperature: soilTemperature.score,
    humidity: longTermGaussian(Number(startClimate.humidity), 76, 10.5, 55),
    maturity: getHarvestMaturityScore(harvestDate, harvestClimate, context),
    growthStages: getGrowthStageAlignmentScore(startDate, data, context, cropTiming),
    pestDisease: longTermClamp(
      getPestDiseaseCycleScore(midpoint, startClimate, context) * 0.58 +
      getPestDiseaseCycleScore(addUtcDays(startDate, Math.round(cropTiming.maturityDays * 0.63)),
        getProjectedClimateForDate(addUtcDays(startDate, Math.round(cropTiming.maturityDays * 0.63)), data), context) * 0.42
    ),
    lunar: getMoonPhaseDetails(midpoint).score,
    water: getIrrigationContextScore(context, startClimate, cropTiming),
    labor: getOperationalLaborScore(startDate),
    yieldPotential: getLongTermYieldPotentialScore(midpoint, data, context)
  };

  const weightedScore =
    factors.forecastCore * 0.10 +
    factors.rainfall * 0.12 +
    factors.temperature * 0.08 +
    factors.sunlight * 0.05 +
    factors.extremeWeather * 0.08 +
    factors.soilMoisture * 0.10 +
    factors.soilTemperature * 0.05 +
    factors.humidity * 0.05 +
    factors.maturity * 0.08 +
    factors.growthStages * 0.09 +
    factors.pestDisease * 0.07 +
    factors.lunar * 0.02 +
    factors.water * 0.07 +
    factors.labor * 0.02 +
    factors.yieldPotential * 0.02;

  const horizon = longTermClamp((midpoint.getUTCFullYear() - 2026) / (2100 - 2026), 0, 1);
  const uncertaintyPenalty = 0.7 + horizon * 5.2;
  const crossYearPenalty = harvestDate.getUTCFullYear() > context.maxYear ? 1.5 : 0;
  const finalScore = clampPlantingScore(weightedScore - uncertaintyPenalty - crossYearPenalty);

  const result = {
    startDate,
    endDate,
    midpoint,
    harvestDate,
    score: Number(finalScore.toFixed(1)),
    factors,
    explanation: buildLongTermExplanation(factors),
    climate: startClimate,
    averageSunlight: Number(averageSunlight.toFixed(2)),
    soilMoistureIndex: Number(soilMoisture.moistureIndex.toFixed(1)),
    soilTemperature: Number(soilTemperature.soilTemperature.toFixed(1)),
    hazard: extremeWeather
  };
  if (cache) cache.set(cacheKey, result);
  return result;
}

function estimateDaySuitability(year, monthIndex, day, data, context) {
  const date = new Date(Date.UTC(Number(year), Number(monthIndex), Number(day)));
  const windowStart = addUtcDays(date, -3);
  return scoreLongTermPlantingWindow(windowStart, data, context).score;
}

function buildMonthlyPlantingResult(year, monthIndex, data, context) {
  const daysInMonth = new Date(Date.UTC(Number(year), Number(monthIndex) + 1, 0)).getUTCDate();
  const candidateWindows = [];

  for (let startDay = 1; startDay <= daysInMonth - 6; startDay++) {
    const startDate = new Date(Date.UTC(Number(year), Number(monthIndex), startDay));
    candidateWindows.push(scoreLongTermPlantingWindow(startDate, data, context));
  }

  const rankedWindows = [...candidateWindows].sort((a, b) =>
    b.score - a.score || a.startDate.getUTCDate() - b.startDate.getUTCDate()
  );
  const bestWindow = rankedWindows[0];
  const bestStartDay = bestWindow.startDate.getUTCDate();
  const bestEndDay = bestWindow.endDate.getUTCDate();
  const primaryDay = bestWindow.midpoint.getUTCDate();
  const bestDayNumbers = new Set(Array.from({ length: 7 }, (_, index) => bestStartDay + index));

  const dailyScores = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const covering = candidateWindows.filter(window =>
      day >= window.startDate.getUTCDate() && day <= window.endDate.getUTCDate()
    );
    const score = covering.length
      ? Math.max(...covering.map(window => window.score))
      : estimateDaySuitability(year, monthIndex, day, data, context);
    const date = new Date(Date.UTC(Number(year), Number(monthIndex), day));
    const week = getWeekFromUtcDate(date);
    return {
      day,
      iso: getIsoFromUtcDate(date),
      label: getShortDayLabel(year, monthIndex, day),
      fullLabel: getFullDateLabel(year, monthIndex, day),
      week,
      quarter: getQuarterFromWeek(week),
      score: Number(score.toFixed(1))
    };
  });

  const bestDays = dailyScores.filter(item => bestDayNumbers.has(item.day));
  const primary = dailyScores.find(item => item.day === primaryDay) || bestDays[0];
  const bestWeek = getWeekFromUtcDate(bestWindow.midpoint);
  const risk = getPlantingRiskLabel(bestWindow.score);
  const cropTiming = getLongTermCropTiming(context);
  const harvestStartDate = addUtcDays(bestWindow.startDate, cropTiming.maturityDays);
  const harvestEndDate = addUtcDays(bestWindow.endDate, cropTiming.maturityDays);
  const phaseInput = {
    bestStartISO: getIsoFromUtcDate(bestWindow.startDate),
    bestEndISO: getIsoFromUtcDate(bestWindow.endDate),
    maturityDays: cropTiming.maturityDays,
    cropType: context.cropType
  };
  const growthPhases = typeof PALAIPlantingPdf !== 'undefined'
    ? PALAIPlantingPdf.buildPhaseSchedule(phaseInput)
    : [];

  return {
    year: Number(year),
    monthIndex: Number(monthIndex),
    monthName: LONG_TERM_MONTH_NAMES[monthIndex],
    bestDay: primaryDay,
    bestStartDay,
    bestEndDay,
    bestStartISO: getIsoFromUtcDate(bestWindow.startDate),
    bestEndISO: getIsoFromUtcDate(bestWindow.endDate),
    bestDateISO: primary.iso,
    bestDateFull: primary.fullLabel,
    bestDays,
    bestDaysText: formatLongTermRange(bestWindow.startDate, bestWindow.endDate, false),
    bestRangeFull: formatLongTermRange(bestWindow.startDate, bestWindow.endDate, true),
    bestDaysOnlyText: `${bestStartDay}–${bestEndDay}`,
    bestWeek,
    weekRange: formatLongTermRange(bestWindow.startDate, bestWindow.endDate, false),
    weekRangeFull: formatLongTermRange(bestWindow.startDate, bestWindow.endDate, true),
    score: Number(bestWindow.score.toFixed(1)),
    risk,
    explanation: bestWindow.explanation,
    factorScores: Object.fromEntries(Object.entries(bestWindow.factors).map(([key, value]) => [key, Number(value.toFixed(1))])),
    cropType: context.cropType,
    maturityDays: cropTiming.maturityDays,
    harvestDateISO: getIsoFromUtcDate(harvestStartDate),
    harvestDateFull: harvestStartDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
    harvestStartISO: getIsoFromUtcDate(harvestStartDate),
    harvestEndISO: getIsoFromUtcDate(harvestEndDate),
    harvestRangeFull: formatLongTermRange(harvestStartDate, harvestEndDate, true),
    growthPhases,
    dailyScores
  };
}

function buildYearMonthlyPlantingResult(year, data, context) {
  const months = Array.from({ length: 12 }, (_, monthIndex) =>
    buildMonthlyPlantingResult(year, monthIndex, data, context)
  );

  const bestMonth = [...months].sort((a, b) => b.score - a.score || a.monthIndex - b.monthIndex)[0];
  const avgScore = months.reduce((sum, month) => sum + Number(month.score || 0), 0) / months.length;

  return {
    year: Number(year),
    months,
    bestMonthIndex: bestMonth.monthIndex,
    bestMonthName: bestMonth.monthName,
    bestDaysText: bestMonth.bestDaysText,
    bestDateFull: bestMonth.bestDateFull,
    bestRangeFull: bestMonth.bestRangeFull,
    avgScore: Number(avgScore.toFixed(1)),
    score: Number(bestMonth.score.toFixed(1)),
    risk: bestMonth.risk
  };
}

function generateLongTermPlantingWindows() {
  const status = document.getElementById('longterm-status');

  if (!forecastData) {
    if (status) {
      status.textContent = 'Please run the Yield Forecast first. PAL-AI needs the long-range forecast data before calculating monthly planting days.';
      status.className = 'longterm-status error';
      status.classList.remove('hidden');
    }
    return;
  }

  const context = buildLongTermScoringContext(forecastData);
  const years = context.years.filter(year => Number(year) >= 2026 && Number(year) <= 2100);

  if (!years.length) {
    if (status) {
      status.textContent = 'No 2026–2100 long-term forecast years are available yet. Run the forecast again and try generating the monthly calendar.';
      status.className = 'longterm-status error';
      status.classList.remove('hidden');
    }
    return;
  }

  const results = years.map(year => buildYearMonthlyPlantingResult(year, forecastData, context));

  longTermPlantingData = results;
  const bestOverall = getBestOverallMonthlyWindow(results);
  longTermSelectedYear = bestOverall?.year || results[0].year;
  longTermSelectedMonth = bestOverall?.monthIndex ?? results[0].bestMonthIndex ?? 0;

  renderLongTermPlantingWindows(results);

  if (status) {
    status.textContent = `Generated evidence-weighted 7-day planting windows for all 12 months from ${years[0]} to ${years[years.length - 1]} using regional climate, rainfall onset, sunlight, soil conditions, crop maturity, growth-stage hazards, pest pressure, water access, lunar timing, labor feasibility, and yield projections.`;
    status.className = 'longterm-status success';
    status.classList.remove('hidden');
  }
}

function getBestOverallMonthlyWindow(results) {
  return results
    .flatMap(yearItem => yearItem.months.map(month => ({ ...month, year: yearItem.year })))
    .sort((a, b) => b.score - a.score || a.year - b.year || a.monthIndex - b.monthIndex)[0];
}

function renderLongTermPlantingWindows(results) {
  if (!results.length) return;

  const bestOverall = getBestOverallMonthlyWindow(results);
  const allMonths = results.flatMap(yearItem => yearItem.months);
  const avgScore = allMonths.reduce((sum, month) => sum + Number(month.score || 0), 0) / allMonths.length;

  const bestMonthCounts = {};
  results.forEach(yearItem => {
    bestMonthCounts[yearItem.bestMonthName] = (bestMonthCounts[yearItem.bestMonthName] || 0) + 1;
  });
  const commonMonth = Object.entries(bestMonthCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

  const bestYearEl = document.getElementById('lt-best-year');
  const commonMonthEl = document.getElementById('lt-common-month');
  const avgScoreEl = document.getElementById('lt-average-score');

  if (bestYearEl) bestYearEl.textContent = bestOverall ? `${bestOverall.monthName} ${bestOverall.year}` : '—';
  if (commonMonthEl) commonMonthEl.textContent = commonMonth;
  if (avgScoreEl) avgScoreEl.textContent = `${avgScore.toFixed(1)}%`;

  const summary = document.getElementById('longterm-summary');
  if (summary) summary.classList.remove('hidden');

  renderLongTermCalendarBoard(results, longTermSelectedYear, longTermSelectedMonth);
  renderLongTermPlantingTable(results);
}

function parseIsoDateUTC(iso) {
  return new Date(`${iso}T00:00:00Z`);
}

function isSameUtcDate(a, b) {
  return a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate();
}

function getLongTermCropTypeLabel(cropType) {
  const labels = typeof PALAIPlantingPdf !== 'undefined' ? PALAIPlantingPdf.CROP_LABELS : null;
  return labels?.[cropType] || String(cropType || 'inbred').replace(/-/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function getLongTermLocationMetadata() {
  const regionName = REGIONS_CACHE[currentRegionId] || getLocalRegion(currentRegionId)?.name || `Region ${currentRegionId || ''}`.trim();
  const province = getSelectedText('province-select');
  const municipality = getSelectedText('municipality-select');
  const barangay = getSelectedText('barangay-select');
  const locationParts = [barangay, municipality, province, regionName].filter(Boolean);
  return {
    regionName: regionName || 'Selected PAL-AI Region',
    provinceName: province,
    municipalityName: municipality,
    barangayName: barangay,
    locationLabel: locationParts.join(', ') || regionName || 'Selected PAL-AI Region',
    cropType: document.getElementById('crop-type-select')?.value || 'inbred'
  };
}

function buildLongTermGrowthTimeline(monthItem) {
  const phases = Array.isArray(monthItem.growthPhases) && monthItem.growthPhases.length
    ? monthItem.growthPhases
    : (typeof PALAIPlantingPdf !== 'undefined'
      ? PALAIPlantingPdf.buildPhaseSchedule(monthItem)
      : []);
  const cropLabel = getLongTermCropTypeLabel(monthItem.cropType);

  const phaseCards = phases.map((phase, index) => `
    <div class="lt-growth-stage" style="--phase-color:${phase.color || '#16a34a'}">
      <div class="lt-growth-marker"><span>${index + 1}</span></div>
      <div class="lt-growth-stage-body">
        <div class="lt-growth-stage-topline">
          <strong>${phase.title}</strong>
          <span>${phase.dateRange}</span>
        </div>
        <p>${phase.description}</p>
      </div>
    </div>
  `).join('');

  return `
    <section class="lt-growth-timeline-card">
      <div class="lt-growth-timeline-head">
        <div>
          <div class="lt-calendar-eyebrow">Plant-to-harvest schedule</div>
          <h3>Projected Crop Growth Timeline</h3>
          <p>${cropLabel} · approximately ${monthItem.maturityDays} days to maturity. Dates are shown as ranges because the recommended planting window spans seven days.</p>
        </div>
        <button class="lt-pdf-button" onclick="generateSelectedLongTermPlantingPdf(this)">
          <span>⬇</span> Generate ${monthItem.monthName} ${monthItem.year} PDF
        </button>
      </div>

      <div class="lt-growth-timeline-track">
        ${phaseCards}
      </div>

      <div class="lt-harvest-period-callout">
        <div class="lt-harvest-icon">🌾</div>
        <div>
          <span>Projected harvest period</span>
          <strong>${monthItem.harvestRangeFull || monthItem.harvestDateFull}</strong>
          <small>Calculated from the selected planting window and the ${monthItem.maturityDays}-day maturity profile.</small>
        </div>
      </div>
    </section>
  `;
}

function generateSelectedLongTermPlantingPdf(button = null) {
  const yearItem = longTermPlantingData.find(item => Number(item.year) === Number(longTermSelectedYear));
  const monthItem = yearItem?.months?.find(item => Number(item.monthIndex) === Number(longTermSelectedMonth));

  if (!monthItem) {
    alert('Select a forecast month before generating the planting calendar PDF.');
    return;
  }

  if (typeof PALAIPlantingPdf === 'undefined') {
    alert('The local PDF generator did not load. Refresh PAL-AI and try again.');
    return;
  }

  const originalHtml = button?.innerHTML;
  if (button) {
    button.disabled = true;
    button.innerHTML = '<span>⏳</span> Creating PDF...';
  }

  try {
    const location = getLongTermLocationMetadata();
    const fileName = PALAIPlantingPdf.downloadPlantingCalendarPdf(monthItem, {
      ...location,
      cropType: monthItem.cropType,
      cropTypeLabel: getLongTermCropTypeLabel(monthItem.cropType),
      maturityDays: monthItem.maturityDays,
      generatedAt: new Date()
    });

    const status = document.getElementById('longterm-status');
    if (status) {
      status.textContent = `Downloaded ${fileName}. The PDF contains the selected planting window, projected crop phases, individual phase calendars, and the harvest period.`;
      status.className = 'longterm-status success';
      status.classList.remove('hidden');
    }
  } catch (error) {
    console.error('Planting calendar PDF generation failed:', error);
    alert(`Could not generate the planting calendar PDF: ${error.message}`);
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = originalHtml;
    }
  }
}

function buildMonthlyPlantingCalendar(yearItem, monthItem) {
  const year = Number(yearItem.year);
  const monthIndex = Number(monthItem.monthIndex);
  const monthStart = new Date(Date.UTC(year, monthIndex, 1));
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const firstWeekday = monthStart.getUTCDay();
  const color = getLongTermScoreColor(monthItem.score);
  const bestDaySet = new Set((monthItem.bestDays || []).map(day => Number(day.day)));
  const primaryBest = Number(monthItem.bestDay);

  const blankCells = Array.from({ length: firstWeekday }).map(() => '<div class="lt-month-day empty"></div>');

  const dayCells = Array.from({ length: daysInMonth }).map((_, index) => {
    const dayNum = index + 1;
    const dayScore = monthItem.dailyScores.find(item => Number(item.day) === Number(dayNum));
    const isBestDay = bestDaySet.has(dayNum);
    const isPrimary = Number(dayNum) === primaryBest;
    const classes = [
      'lt-month-day',
      isBestDay ? 'best-window' : '',
      isPrimary ? 'best-start' : ''
    ].filter(Boolean).join(' ');

    const label = isPrimary
      ? '<span class="lt-sprout-pulse">🌱</span>'
      : isBestDay
        ? '<span class="lt-alt-dot"></span>'
        : '';

    const scoreText = dayScore ? `<small>${dayScore.score}%</small>` : '';
    return `<div class="${classes}" title="${monthItem.monthName} ${dayNum}, ${year}"><span>${dayNum}</span>${label}${scoreText}</div>`;
  });

  return `
    <div class="lt-actual-calendar lt-monthly-calendar" style="--score-color:${color}; --score-width:${monthItem.score}%">
      <div class="lt-calendar-topbar">
        <div>
          <div class="lt-calendar-eyebrow">Monthly planting calendar</div>
          <h3>${monthItem.monthName} ${year}</h3>
          <p>Highlighted dates form PAL-AI's strongest seven-day planting window for this month.</p>
        </div>
        <div class="lt-calendar-score-ring">
          <span>${monthItem.score}%</span>
          <small>${monthItem.risk}</small>
        </div>
      </div>

      <div class="lt-week-window-banner">
        <div>
          <span>Best planting window this month</span>
          <strong>${monthItem.bestDaysText}</strong>
          <small>Strongest day: ${monthItem.bestDateFull} · Projected harvest period: ${monthItem.harvestRangeFull || monthItem.harvestDateFull} · Main strengths: ${monthItem.explanation}</small>
        </div>
        <div class="lt-mini-score-bar"><span></span></div>
      </div>

      <div class="lt-month-weekdays">
        <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
      </div>

      <div class="lt-month-grid">
        ${[...blankCells, ...dayCells].join('')}
      </div>

      <div class="lt-calendar-legend">
        <span><i class="best"></i> Best seven-day planting window</span>
        <span><i class="alt"></i> Other recommended days</span>
        <span><i class="pulse"></i> Strongest day</span>
      </div>
    </div>
    ${buildLongTermGrowthTimeline(monthItem)}
  `;
}

function renderLongTermCalendarBoard(results, selectedYear = null, selectedMonthIndex = null) {
  const board = document.getElementById('longterm-calendar-board');
  if (!board || !results.length) return;

  const yearItem = results.find(r => Number(r.year) === Number(selectedYear)) || results[0];
  const monthIndex = selectedMonthIndex !== null && selectedMonthIndex !== undefined
    ? Number(selectedMonthIndex)
    : Number(yearItem.bestMonthIndex || 0);
  const monthItem = yearItem.months.find(month => Number(month.monthIndex) === monthIndex) || yearItem.months[yearItem.bestMonthIndex] || yearItem.months[0];

  longTermSelectedYear = yearItem.year;
  longTermSelectedMonth = monthItem.monthIndex;

  const yearOptions = results.map(item => `
    <option value="${item.year}" ${Number(item.year) === Number(yearItem.year) ? 'selected' : ''}>${item.year}</option>
  `).join('');

  const monthCards = yearItem.months.map(month => {
    const color = getLongTermScoreColor(month.score);
    const active = Number(month.monthIndex) === Number(monthItem.monthIndex);
    return `
      <button class="lt-month-card ${active ? 'active' : ''}"
        onclick="focusLongTermMonth(${yearItem.year}, ${month.monthIndex})"
        style="--score-color:${color}; --score-width:${month.score}%">
        <span>${month.monthName.slice(0, 3)}</span>
        <strong>${month.bestDaysOnlyText}</strong>
        <small>${month.score}% · ${month.risk}</small>
      </button>
    `;
  }).join('');

  board.innerHTML = `
    <div class="lt-monthly-layout">
      <div class="lt-simple-controls">
        <div>
          <div class="lt-rail-title">Choose year</div>
          <p>Select a forecast year, then choose a month below.</p>
        </div>
        <div class="lt-year-control-row">
          <button class="lt-nav-button" onclick="shiftLongTermYear(-1)">‹ Previous</button>
          <select id="lt-year-select" class="lt-year-select" onchange="focusLongTermYear(Number(this.value))">
            ${yearOptions}
          </select>
          <button class="lt-nav-button" onclick="shiftLongTermYear(1)">Next ›</button>
        </div>
      </div>

      <div class="lt-month-card-grid">
        ${monthCards}
      </div>
    </div>
    ${buildMonthlyPlantingCalendar(yearItem, monthItem)}
  `;
}

function renderLongTermPlantingChart(results) {
  // The old yearly line chart is intentionally disabled because the new section
  // is now a monthly calendar view: 12 months per year, best days per month.
}

function renderLongTermPlantingTable(results) {
  const body = document.getElementById('longterm-table-body');
  if (!body) return;

  body.innerHTML = results.map(r => {
    const color = getLongTermScoreColor(r.score);
    return `
      <tr onclick="focusLongTermYear(${r.year})">
        <td><strong>${r.year}</strong></td>
        <td>${r.bestMonthName}</td>
        <td><span class="lt-week-chip">${r.bestDaysText}</span></td>
        <td>
          <div class="lt-score-bar" style="--score-color:${color}; --score-width:${r.avgScore}%">
            <span></span>
            <strong>${r.avgScore}%</strong>
          </div>
        </td>
        <td>${r.bestDateFull}</td>
        <td><span class="lt-risk-badge" style="--score-color:${color}">${r.risk}</span></td>
      </tr>
    `;
  }).join('');
}

function focusLongTermYear(year) {
  const item = longTermPlantingData.find(r => Number(r.year) === Number(year));
  if (!item) return;
  longTermSelectedYear = item.year;
  longTermSelectedMonth = Number(item.bestMonthIndex || 0);
  renderLongTermCalendarBoard(longTermPlantingData, longTermSelectedYear, longTermSelectedMonth);
}

function focusLongTermMonth(year, monthIndex) {
  const item = longTermPlantingData.find(r => Number(r.year) === Number(year));
  if (!item) return;
  longTermSelectedYear = item.year;
  longTermSelectedMonth = Number(monthIndex);
  renderLongTermCalendarBoard(longTermPlantingData, longTermSelectedYear, longTermSelectedMonth);
}

function shiftLongTermYear(direction) {
  if (!longTermPlantingData.length) return;
  const currentIndex = longTermPlantingData.findIndex(item => Number(item.year) === Number(longTermSelectedYear));
  const nextIndex = Math.max(0, Math.min(longTermPlantingData.length - 1, currentIndex + Number(direction)));
  focusLongTermYear(longTermPlantingData[nextIndex].year);
}

// ════════════════════════════════════════
// FORECAST SUBTABS + LIVE PLANTING FORECAST
// ════════════════════════════════════════

function switchForecastSubtab(subtab, shouldSwitchMainTab = true) {
  if (shouldSwitchMainTab) {
    suppressNarrationOnce = true;
    switchTab('forecast');
    suppressNarrationOnce = false;
  }

  currentAnalysisSubtabs.forecast = subtab;
  if (!suppressNarrationOnce) {
    const forecastVoiceMap = {
      yield: "forecast-yield",
      live: "forecast-live",
      longterm: "forecast-longterm",
    };

    playVoiceLine(forecastVoiceMap[subtab], { force: true });
  }

  const yieldPanel = document.getElementById('forecast-yield-panel');
  const livePanel = document.getElementById('forecast-live-panel');
  const longtermPanel = document.getElementById('forecast-longterm-panel');

  const showYield = subtab === 'yield';
  const showLive = subtab === 'live';
  const showLongTerm = subtab === 'longterm';

  if (yieldPanel) {
    yieldPanel.classList.toggle('subsection-hidden', !showYield);
    yieldPanel.style.display = showYield ? '' : 'none';
  }

  if (livePanel) {
    livePanel.classList.toggle('subsection-hidden', !showLive);
    livePanel.style.display = showLive ? '' : 'none';
  }

  if (longtermPanel) {
    longtermPanel.classList.toggle('subsection-hidden', !showLongTerm);
    longtermPanel.style.display = showLongTerm ? '' : 'none';
  }

  document.querySelectorAll('[data-forecast-subtab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.forecastSubtab === subtab);
  });

  if (showYield) {
    setTimeout(() => {
      if (!forecastMap) initForecastMap();
      if (forecastMap) forecastMap.invalidateSize();
    }, 180);
  }

  if (showLongTerm && forecastData && !longTermPlantingData.length) {
    generateLongTermPlantingWindows();
  }
}

function getForecastLatLngForLiveWeather() {
  if (lastForecastLat && lastForecastLng) {
    return {
      lat: lastForecastLat,
      lng: lastForecastLng
    };
  }

  if (forecastMarker && forecastMarker.getLatLng) {
    const pos = forecastMarker.getLatLng();

    return {
      lat: pos.lat,
      lng: pos.lng
    };
  }

  const regionId = document.getElementById('region-select')?.value;

  if (regionId && REGION_COORDS[regionId]) {
    return {
      lat: REGION_COORDS[regionId][0],
      lng: REGION_COORDS[regionId][1]
    };
  }

  return null;
}

function showLiveForecastStatus(message, type = 'loading') {
  const el = document.getElementById('live-forecast-status');
  if (!el) return;

  el.textContent = message;
  el.className = `live-forecast-status ${type}`;
  el.classList.remove('hidden');
}

async function runLivePlantingForecast(options = {}) {
  const silent = options.silent === true;
  const location = getForecastLatLngForLiveWeather();

  if (!location) {
    if (!silent) {
      showLiveForecastStatus('Please select a region or set the map pin first in the Yield Forecast sub-tab.', 'error');
    }
    return;
  }

  if (!silent) {
    showLiveForecastStatus('Fetching live weather data from Google Weather API...', 'loading');
  } else {
    showLiveForecastStatus('Preparing live planting forecast in the background...', 'loading');
  }

  const grid = document.getElementById('planting-calendar-grid');
  const summary = document.getElementById('live-forecast-summary');

  if (summary) summary.classList.add('hidden');

  if (grid) {
    grid.innerHTML = `
      <div class="planting-empty-state">
        <div class="planting-empty-icon">🌦️</div>
        <h3>Loading live planting calendar...</h3>
        <p>PAL-AI is converting weather factors into daily planting compatibility scores.</p>
      </div>
    `;
  }

  try {
    const res = await fetch(`${API}/api/live-planting-forecast?lat=${location.lat}&lng=${location.lng}&days=10`);
    const data = await res.json();

    if (!data.ok) {
      throw new Error(data.error || 'Live planting forecast failed.');
    }

    renderLivePlantingForecast(data);
    showLiveForecastStatus(`Live planting forecast generated for ${data.returned_days} days.`, 'success');

  } catch (err) {
    console.error(err);
    showLiveForecastStatus(`Live forecast failed: ${err.message}`, 'error');
  }
}

function getPlantingScoreColor(score) {
  if (score >= 85) return '#16a34a';
  if (score >= 70) return '#84cc16';
  if (score >= 55) return '#eab308';
  if (score >= 40) return '#f97316';
  return '#dc2626';
}

function renderLivePlantingForecast(data) {
  const grid = document.getElementById('planting-calendar-grid');
  if (!grid) return;

  const days = data.days || [];

  if (!days.length) {
    grid.innerHTML = `
      <div class="planting-empty-state">
        <div class="planting-empty-icon">⚠️</div>
        <h3>No forecast days returned</h3>
        <p>Google Weather API did not return daily forecast data for this location.</p>
      </div>
    `;
    return;
  }

  const best = [...days].sort((a, b) => b.score - a.score)[0];
  const avgScore = days.reduce((sum, d) => sum + d.score, 0) / days.length;

  const bestDate = new Date(best.date);

  document.getElementById('live-best-day').textContent = bestDate.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric'
  });

  document.getElementById('live-best-score').textContent = `${best.score}%`;
  document.getElementById('live-avg-score').textContent = `${avgScore.toFixed(1)}%`;

  const summary = document.getElementById('live-forecast-summary');
  if (summary) summary.classList.remove('hidden');

  const firstDate = new Date(days[0].date);
  const firstWeekDay = firstDate.getDay();

  const blanks = Array.from({ length: firstWeekDay }).map(() => {
    return `<div class="planting-day-card" style="background:#f8fafc"></div>`;
  }).join('');

  const cards = days.map((day, i) => {
    const date = new Date(day.date);
    const color = getPlantingScoreColor(day.score);
    const isBest = day.date === best.date;

    const dateLabel = date.toLocaleDateString('en-PH', {
      month: 'short',
      day: 'numeric'
    });

    const dayName = date.toLocaleDateString('en-PH', {
      weekday: 'short'
    });

    return `
      <div class="planting-day-card ${isBest ? 'best-day' : ''}" style="--score-color:${color}; animation-delay:${i * 0.035}s">
        <div class="planting-day-top">
          <div>
            <div class="planting-date">${dateLabel}</div>
            <div class="planting-day-name">${dayName}</div>
          </div>
          ${day.icon ? `<img src="${day.icon}" alt="${day.condition}" width="34" height="34">` : ''}
        </div>

        <div class="planting-score-pill">${day.score}% · ${day.label}</div>

        <div class="planting-weather-row">
          <div><span>Condition:</span> ${day.condition}</div>
          <div><span>Temp:</span> ${day.min_temp_c ?? '—'}–${day.max_temp_c ?? '—'}°C</div>
          <div><span>Rain:</span> ${day.rainfall_mm} mm · ${day.precipitation_probability}%</div>
          <div><span>Humidity:</span> ${day.humidity ?? '—'}%</div>
          <div><span>Dew Point:</span> ${day.dew_point_c ?? '—'}°C</div>
          <div><span>Wind:</span> ${day.wind_kph ?? '—'} km/h</div>
        </div>

        <div class="planting-advice">${day.advice}</div>
      </div>
    `;
  }).join('');

  grid.innerHTML = blanks + cards;
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
  1: 2.56,
  2: 2.42,
  3: 2.60,
  4: 2.18,
  5: 2.49,
  6: 2.59,
  7: 2.59,
  8: 2.74,
  9: 2.93,
  10: 3.27,
  11: 3.00,
  12: 2.34,
  13: 2.97,
  14: 2.48,
  15: 2.57,
  16: 2.66,
};

// ── Agronomist-calibrated yield display helpers ─────────────────────────
// These helpers keep the same PAL-AI model ranking but scale conservative
// model outputs into practical rice-yield ranges used in the local demo.
const YIELD_CALIBRATION_BASE_T_HA = 2.05;
const YIELD_CALIBRATION_MODEL_WEIGHT = 0.42;
const YIELD_CALIBRATION_MIN_T_HA = 2.00;
const YIELD_CALIBRATION_MAX_T_HA = 3.35;

function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

function calibrateYieldFallback(rawYield) {
  const raw = Math.max(0, Number(rawYield || 0));
  return clampValue(
    YIELD_CALIBRATION_BASE_T_HA + raw * YIELD_CALIBRATION_MODEL_WEIGHT,
    YIELD_CALIBRATION_MIN_T_HA,
    YIELD_CALIBRATION_MAX_T_HA
  );
}

function getTerrainAdjustedYieldModifier(scores) {
  if (!scores) return 1.0;
  const topo = Number(scores.topoScore || 0);
  const impact = Number(scores.yieldImpactScore || 0);
  const quality = clampValue((topo * 0.65 + impact * 0.35) / 100, 0, 1);

  // Good terrain should lift the site-adjusted yield instead of making a
  // visually strong field look artificially weak. Range: 0.90× to 1.45×.
  return clampValue(1.0 + (quality - 0.50) * 0.90, 0.90, 1.45);
}

function getFinalYieldModifier(finalScore, terrainScores, spatioData) {
  const scoreQuality = finalScore !== null && finalScore !== undefined
    ? clampValue(Number(finalScore) / 100, 0, 1)
    : 0.70;
  const terrainQuality = terrainScores
    ? clampValue((Number(terrainScores.topoScore || 0) * 0.65 + Number(terrainScores.yieldImpactScore || 0) * 0.35) / 100, 0, 1)
    : 0.70;
  const farmDelta = Number(spatioData?.suitability_score_delta || 0);
  const farmBonus = clampValue(farmDelta / 100, -0.05, 0.12);

  // Strong final suitability should produce the 4–5 t/ha range expected by
  // the field validation, while weaker sites remain lower.
  return clampValue(1.05 + scoreQuality * 0.62 + (terrainQuality - 0.50) * 0.22 + farmBonus, 1.00, 1.88);
}


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

  setSelectOptions(provSel, [], '— Select Province —', true);
  setSelectOptions(munSel, [], '— Select Municipality / City —', true);
  setSelectOptions(barSel, [], '— Select Barangay —', true);

  if (!regionId) return;

  // Instant local fallback from geo-data.js so the dropdown is never blank.
  const localProvinces = getLocalProvinces(regionId);
  if (localProvinces.length) {
    setSelectOptions(provSel, localProvinces, '— Select Province —', false);
  } else {
    setSelectOptions(provSel, [], 'Loading provinces...', true);
  }

  // Pan forecast map immediately.
  if (forecastMap && REGION_COORDS[regionId]) {
    if (!lastForecastLat || !lastForecastLng) {
      forecastMap.setView(REGION_COORDS[regionId], 9);
      if (forecastMarker) forecastMarker.setLatLng(REGION_COORDS[regionId]);
    } else {
      forecastMap.setView([lastForecastLat, lastForecastLng], 10);
    }
  }

  // Official PSGC result loads in the background and replaces fallback.
  try {
    if (LOCATION_CACHE.provincesByRegion[regionId]) {
      setSelectOptions(provSel, LOCATION_CACHE.provincesByRegion[regionId], '— Select Province —', false);
      return;
    }

    const res = await fetch(`${API}/api/locations/provinces/${regionId}`);
    if (!res.ok) throw new Error(`Could not load provinces: ${res.status}`);

    const provinces = await res.json();
    LOCATION_CACHE.provincesByRegion[regionId] = provinces;

    // Replace fallback with official PSGC options.
    setSelectOptions(provSel, provinces, '— Select Province —', false);

  } catch (err) {
    console.error(err);

    // Keep local fallback visible instead of blanking the dropdown.
    if (localProvinces.length) {
      setSelectOptions(provSel, localProvinces, '— Select Province —', false);
    } else {
      setSelectOptions(provSel, [], 'Could not load provinces', true);
    }
  }
}

async function onProvinceChange() {
  const provinceCode = document.getElementById('province-select').value;
  const munSel = document.getElementById('municipality-select');
  const barSel = document.getElementById('barangay-select');

  setSelectOptions(munSel, [], '— Select Municipality / City —', true);
  setSelectOptions(barSel, [], '— Select Barangay —', true);

  if (!provinceCode) return;

  // Instant local fallback if the province came from geo-data.js.
  if (provinceCode.startsWith('local-province|')) {
    const localMunicipalities = getLocalMunicipalitiesFromProvinceValue(provinceCode);
    setSelectOptions(
      munSel,
      localMunicipalities,
      localMunicipalities.length ? '— Select Municipality / City —' : 'No local municipalities found',
      !localMunicipalities.length
    );
    return;
  }

  // Official PSGC cache.
  if (LOCATION_CACHE.municipalitiesByProvince[provinceCode]) {
    setSelectOptions(munSel, LOCATION_CACHE.municipalitiesByProvince[provinceCode], '— Select Municipality / City —', false);
    return;
  }

  setSelectOptions(munSel, [], 'Loading municipalities...', true);

  try {
    const res = await fetch(`${API}/api/locations/municipalities/${provinceCode}`);
    if (!res.ok) throw new Error(`Could not load municipalities: ${res.status}`);

    const municipalities = await res.json();
    LOCATION_CACHE.municipalitiesByProvince[provinceCode] = municipalities;

    setSelectOptions(munSel, municipalities, '— Select Municipality / City —', false);

  } catch (err) {
    console.error(err);
    setSelectOptions(munSel, [], 'Could not load municipalities', true);
    alert("Failed to load official city/municipality list.");
  }
}

async function onMunicipalityChange() {
  const cityMunicipalityCode = document.getElementById('municipality-select').value;
  const barSel = document.getElementById('barangay-select');

  setSelectOptions(barSel, [], '— Select Barangay —', true);

  if (!cityMunicipalityCode) return;

  // Instant local fallback if the municipality came from geo-data.js.
  if (cityMunicipalityCode.startsWith('local-municipality|')) {
    const localBarangays = getLocalBarangaysFromMunicipalityValue(cityMunicipalityCode);
    setSelectOptions(
      barSel,
      localBarangays,
      localBarangays.length ? '— Select Barangay —' : 'No local barangays found',
      !localBarangays.length
    );
    return;
  }

  // Official PSGC cache.
  if (LOCATION_CACHE.barangaysByMunicipality[cityMunicipalityCode]) {
    setSelectOptions(barSel, LOCATION_CACHE.barangaysByMunicipality[cityMunicipalityCode], '— Select Barangay —', false);
    return;
  }

  setSelectOptions(barSel, [], 'Loading barangays...', true);

  try {
    const res = await fetch(`${API}/api/locations/barangays/${cityMunicipalityCode}`);
    if (!res.ok) throw new Error(`Could not load barangays: ${res.status}`);

    const barangays = await res.json();
    LOCATION_CACHE.barangaysByMunicipality[cityMunicipalityCode] = barangays;

    setSelectOptions(barSel, barangays, '— Select Barangay —', false);

  } catch (err) {
    console.error(err);
    setSelectOptions(barSel, [], 'Could not load barangays', true);
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
    window.forecastData = data;

    // Reset old long-term data so new location/region generates fresh results.
    longTermPlantingData = [];

    // 1. Generate normal Yield Forecast.
    renderResults(data, province, municipality, barangay, hectares, cropType);

    // 2. Generate Long-Term Monthly Planting Days immediately.
    try {
      generateLongTermPlantingWindows();
    } catch (ltErr) {
      console.warn('Long-term monthly planting-day generation failed:', ltErr);
    }

    // 3. Generate 10-Day Live Planting Forecast in the background.
    // This does not switch tabs. It prepares the 10-day calendar automatically.
    runLivePlantingForecast({ silent: true }).catch(liveErr => {
      console.warn('Live planting forecast background run failed:', liveErr);
    });

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

  if ((currentAnalysisSubtabs.forecast || 'yield') === 'yield') {
    document.getElementById('results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
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

    // data.ok === false means every Overpass attempt failed/timed out — this is
    // a real failure and must not be silently reported as "0 water bodies found".
    if (data.ok === false) {
      throw new Error(data.message || 'Water body lookup failed or timed out.');
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

    // Propagate the failure instead of swallowing it as an empty array —
    // the caller (startWaterBodyAnalyzer) already has a proper error UI path.
    console.warn('Water Body Analyzer backend request failed:', err);
    throw err;
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

    // No runId check — just render whatever came back.
    // Also pass the mapped water features into the 3D terrain engine so rivers/lakes/coasts
    // can be shown as a visual water overlay. This is not measured bathymetry.
    if (typeof Terrain !== 'undefined' && typeof Terrain.setWaterFeatures === 'function') {
      Terrain.setWaterFeatures(waterBodies);
    }

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

    // Clear (not stale, not fake) the 3D water overlay on failure too.
    if (typeof Terrain !== 'undefined' && typeof Terrain.setWaterFeatures === 'function') {
      Terrain.setWaterFeatures([]);
    }

    const summary = document.getElementById('water-analyzer-summary');
    if (summary) {
      summary.textContent = 'Water body scan failed. No 3D water overlay was generated. Check that the backend is running and try again.';
    }
  }
}

function getTerrainSoilEvidenceInput() {
  const texture = document.getElementById('terrain-soil-texture')?.value || 'unknown';
  const pHRaw = document.getElementById('terrain-soil-ph')?.value;
  const organicRaw = document.getElementById('terrain-soil-organic')?.value;
  const drainage = document.getElementById('terrain-soil-drainage')?.value || 'unknown';
  const source = document.getElementById('terrain-soil-source')?.value || 'terrain';
  const testDate = document.getElementById('terrain-soil-test-date')?.value || '';
  const cropType = document.getElementById('terrain-rice-type')?.value || 'inbred';

  const pH = pHRaw === '' || pHRaw === undefined ? null : Number(pHRaw);
  const organicMatter = organicRaw === '' || organicRaw === undefined ? null : Number(organicRaw);

  return {
    texture,
    pH: Number.isFinite(pH) ? pH : null,
    organicMatter: Number.isFinite(organicMatter) ? organicMatter : null,
    drainage,
    source,
    testDate,
    cropType
  };
}

function soilText(value, fallback = '—') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function clampSoilVisualPercent(value) {
  const number = Number(value);
  return Math.max(0, Math.min(100, Number.isFinite(number) ? number : 0));
}

function inferSoilVisualPH(soil) {
  const measured = Number(soil?.measuredPH);
  if (soil?.measuredPH !== null && soil?.measuredPH !== undefined && Number.isFinite(measured)) return measured;

  const source = String(soil?.inferredPH || soil?.soilpH || '');
  const matches = source.match(/\d+(?:\.\d+)?/g) || [];
  const values = matches.map(Number).filter(Number.isFinite);
  if (values.length >= 2) return (values[0] + values[1]) / 2;
  if (values.length === 1) return values[0];
  return 6.0;
}

function inferWaterRetentionPercent(label) {
  const value = String(label || '').toLowerCase();
  if (value.includes('very high')) return 92;
  if (value.includes('moderate to high') || value.includes('moderate-high')) return 72;
  if (value.includes('high')) return 82;
  if (value.includes('low to moderate') || value.includes('low-moderate')) return 42;
  if (value.includes('moderate')) return 58;
  if (value.includes('low')) return 28;
  return 50;
}

function applySoilVisualProfile(soil) {
  const textureVisual = document.getElementById('soil-texture-visual');
  const textureText = document.getElementById('soil-visual-texture');
  const groupText = document.getElementById('soil-visual-group');
  const sourceText = document.getElementById('soil-visual-source');
  const suitabilityRing = document.getElementById('soil-suitability-ring');
  const suitabilityScoreText = document.getElementById('soil-visual-suitability-score');
  const suitabilityLabelText = document.getElementById('soil-visual-suitability-label');
  const cropProfileText = document.getElementById('soil-visual-crop-profile');
  const phMarker = document.getElementById('soil-ph-marker');
  const phLabel = document.getElementById('soil-visual-ph-label');
  const waterBar = document.getElementById('soil-water-bar');
  const waterLabel = document.getElementById('soil-visual-water-label');
  const drainageBar = document.getElementById('soil-drainage-bar');
  const drainageLabel = document.getElementById('soil-visual-drainage-label');
  const confidenceBar = document.getElementById('soil-confidence-bar');
  const confidenceLabel = document.getElementById('soil-visual-confidence-label');

  const texture = soilText(soil.soilTexture, 'Estimated soil');
  const textureKey = texture.toLowerCase().includes('sand') ? 'sandy'
    : texture.toLowerCase().includes('silt') ? 'silty'
      : texture.toLowerCase().includes('clay') ? 'clay'
        : texture.toLowerCase().includes('loam') ? 'loam'
          : 'unknown';

  if (textureVisual) textureVisual.dataset.texture = textureKey;
  if (textureText) textureText.textContent = texture;
  if (groupText) groupText.textContent = soilText(soil.soilGroup || soil.soilType, 'Terrain-position estimate');
  if (sourceText) sourceText.textContent = soilText(soil.textureSource || soil.sourceLabel, 'PAL-AI terrain inference');

  const suitability = clampSoilVisualPercent(soil.riceSuitabilityScore);
  if (suitabilityRing) suitabilityRing.style.setProperty('--soil-score', suitability.toFixed(1));
  if (suitabilityScoreText) suitabilityScoreText.textContent = `${Math.round(suitability)}%`;
  if (suitabilityLabelText) suitabilityLabelText.textContent = soilText(soil.riceSuitability, 'Estimated suitability');
  if (cropProfileText) cropProfileText.textContent = soil.cropType === 'upland' ? 'Upland rice soil profile' : 'Lowland rice soil profile';

  const ph = Math.max(3.5, Math.min(9.5, inferSoilVisualPH(soil)));
  const phPosition = ((ph - 3.5) / 6) * 100;
  if (phMarker) phMarker.style.left = `${phPosition.toFixed(1)}%`;
  if (phLabel) {
    phLabel.textContent = soil.measuredPH !== null && soil.measuredPH !== undefined
      ? `Measured ${ph.toFixed(1)}`
      : `Estimated ${soilText(soil.inferredPH || soil.soilpH, ph.toFixed(1))}`;
  }

  const waterPct = inferWaterRetentionPercent(soil.waterRetention);
  if (waterBar) waterBar.style.width = `${waterPct}%`;
  if (waterLabel) waterLabel.textContent = soilText(soil.waterRetention, 'Estimated');

  const drainagePct = clampSoilVisualPercent(soil.drainageScore);
  if (drainageBar) drainageBar.style.width = `${drainagePct}%`;
  if (drainageLabel) drainageLabel.textContent = `${soilText(soil.effectiveDrainage || soil.terrainDrainageClass, 'Estimated')} · ${Math.round(drainagePct)}%`;

  const confidencePct = clampSoilVisualPercent(soil.confidenceScore);
  if (confidenceBar) confidenceBar.style.width = `${confidencePct}%`;
  if (confidenceLabel) confidenceLabel.textContent = `${soilText(soil.confidence, 'Estimated')} · ${Math.round(confidencePct)}%`;
}

function renderSoilProfile(soil, slope) {
  if (!soil) return;

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = soilText(value);
  };

  set('soil-profile-texture', soil.soilTexture);
  set('soil-profile-texture-source', soil.textureSource || soil.sourceLabel);
  set('soil-profile-group', soil.soilGroup || soil.soilType);
  set('soil-profile-water-retention', soil.waterRetention);
  set('soil-profile-drainage', `Drainage: ${soil.effectiveDrainage || soil.terrainDrainageClass || 'Estimated'}`);
  set('soil-profile-rice-suitability', `${soil.riceSuitability || 'Estimated'} (${Number(soil.riceSuitabilityScore || 0).toFixed(0)}%)`);
  set('soil-profile-rice-basis', `${soil.cropType === 'upland' ? 'Upland rice profile' : 'Lowland rice profile'} · terrain and soil evidence`);
  set('soil-confidence-value', soil.confidence || 'Low to Moderate');

  applySoilVisualProfile(soil);

  const badge = document.getElementById('soil-confidence-badge');
  if (badge) {
    const score = Number(soil.confidenceScore || 0);
    badge.dataset.level = score >= 80 ? 'high' : score >= 60 ? 'moderate' : 'estimated';
  }

  const evidence = [
    ['Probable soil group', `${soil.soilGroup || soil.soilType} — terrain-position estimate`],
    ['Texture evidence', `${soil.soilTexture} — ${soil.textureSource || soil.sourceLabel}`],
    ['pH evidence', soil.measuredPH !== null && soil.measuredPH !== undefined
      ? `Measured/entered pH ${Number(soil.measuredPH).toFixed(1)}`
      : `Estimated pH range ${soil.inferredPH || soil.soilpH}`],
    ['Drainage evidence', soil.observedDrainage
      ? `Observed: ${soil.observedDrainage}; terrain score ${Number(soil.drainageScore || 0).toFixed(0)}%`
      : `Terrain-derived: ${soil.terrainDrainageClass}; score ${Number(soil.drainageScore || 0).toFixed(0)}%`],
    ['Organic matter', soil.organicMatter !== null && soil.organicMatter !== undefined
      ? `${Number(soil.organicMatter).toFixed(1)}% entered value`
      : 'Not provided — laboratory measurement recommended'],
    ['Evidence source', `${soil.sourceLabel || 'PAL-AI terrain inference'}${soil.testDate ? ` · ${soil.testDate}` : ''}`]
  ];

  const evidenceList = document.getElementById('soil-evidence-list');
  if (evidenceList) {
    evidenceList.innerHTML = evidence.map(([label, value]) => `
      <div class="soil-evidence-row">
        <span>${label}</span>
        <strong>${value}</strong>
      </div>
    `).join('');
  }

  const renderAdvice = (id, values, fallback) => {
    const el = document.getElementById(id);
    if (!el) return;
    const items = Array.isArray(values) && values.length ? values : [fallback];
    el.innerHTML = items.map(item => `<li>${item}</li>`).join('');
  };

  renderAdvice('soil-limitations-list', soil.limitations,
    'No dominant limitation could be established from the available terrain evidence.');
  renderAdvice('soil-management-list', soil.recommendations,
    'Obtain a laboratory soil test before finalizing fertilizer, lime, and soil-amendment rates.');

  const disclaimer = document.getElementById('soil-profile-disclaimer');
  if (disclaimer) {
    disclaimer.textContent = soil.hasDirectEvidence
      ? `${soil.sourceLabel}. The probable soil group is still terrain-derived unless confirmed by a formal soil survey or laboratory classification.`
      : 'Terrain-derived soil interpretation is a preliminary planning estimate. It does not replace laboratory texture, pH, nutrient, organic-matter, compaction, salinity, or contaminant testing.';
  }
}

async function runTerrainAnalysis() {
  const lat = parseFloat(document.getElementById('terrain-lat').value);
  const lng = parseFloat(document.getElementById('terrain-lng').value);
  const gridKm = parseInt(document.getElementById('terrain-grid').value) || 5;
  const mode = document.getElementById('terrain-mode').value;
  let terrainAnalysisCompletedForVoice = false;

  if (isNaN(lat) || isNaN(lng)) {
    showTerrainStatus('⚠️ Please enter valid latitude and longitude coordinates.', 'error');
    return;
  }
  if (lat < 4 || lat > 21 || lng < 116 || lng > 127) {
    showTerrainStatus('⚠️ Coordinates seem to be outside the Philippines. Please double-check.', 'error');
    return;
  }

  const soilEvidenceForValidation = getTerrainSoilEvidenceInput();
  const pHInput = document.getElementById('terrain-soil-ph')?.value;
  const organicInput = document.getElementById('terrain-soil-organic')?.value;
  if (pHInput !== '' && (soilEvidenceForValidation.pH === null || soilEvidenceForValidation.pH < 3.5 || soilEvidenceForValidation.pH > 9.5)) {
    showTerrainStatus('⚠️ Soil pH must be between 3.5 and 9.5, or left blank.', 'error');
    return;
  }
  if (organicInput !== '' && (soilEvidenceForValidation.organicMatter === null || soilEvidenceForValidation.organicMatter < 0 || soilEvidenceForValidation.organicMatter > 20)) {
    showTerrainStatus('⚠️ Organic matter must be between 0% and 20%, or left blank.', 'error');
    return;
  }

  const btn = document.getElementById('terrain-run-btn');
  btn.disabled = true;
  btn.innerHTML = '⏳ Loading terrain...';

  showLoading("Generating 3D Terrain", "Preparing terrain scan...");
  updateLoadingProgress(8, "Reading coordinates and preparing the elevation grid...");
  showTerrainStatus('⏳ Fetching elevation data and building 3D model...', 'loading');

  const terrainScoresStart = document.getElementById('terrain-scores');
  if (terrainScoresStart) {
    terrainScoresStart.classList.add('hidden');
  }

  const fertilizerStart = document.getElementById('fertilizer-analysis-section');
  if (fertilizerStart) {
    fertilizerStart.classList.add('hidden');
  }

  latestFertilizerAnalysis = null;

  // Show the analyzer panel immediately, but do not start the heavy OSM scan yet.
  prepareWaterBodyAnalyzer(lat, lng, gridKm);

  try {
    updateLoadingProgress(15, "Requesting real elevation data from the backend...");
    const terrainResult = await Terrain.init(lat, lng, gridKm, mode);
    updateLoadingProgress(82, "3D terrain model created. Preparing map overlays...");
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
    const terrainSourceText = terrainResult.sourceLabel || (terrainResult.usedAPI ? 'Real SRTM DEM' : 'DEM source unavailable');
    showTerrainStatus(
      `✅ 3D terrain loaded — ${terrainSourceText}. Elevation range: ${Math.round(terrainResult.maxE - terrainResult.minE)}m.`,
      'success'
    );

    // Start the water scan after the 3D model is already stable.
    setTimeout(() => {
      updateLoadingProgress(90, "Starting mapped water body scan...");
      startWaterBodyAnalyzer(lat, lng, gridKm);
    }, 600);

    // Compute scores. Optional soil evidence changes only the soil profile,
    // confidence, management, and fertilizer context; it does not alter DEM data
    // or the calibrated terrain/yield formulas.
    const scores = Terrain.computeScores(terrainResult, soilEvidenceForValidation);
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

    switchAnalysisSubtab('terrain', currentAnalysisSubtabs.terrain || 'terrain-3d', false);

    // ── Spatiotemporal Analysis ──
    // Runs after terrain scores so it can read and augment them
    if (currentRegionId) {
      runSpatiotemporalAnalysis(currentRegionId, scores);
    }
    terrainAnalysisCompletedForVoice = true;

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
    if (terrainAnalysisCompletedForVoice) {
      setTimeout(() => {
        playVoiceLine("terrain-3d-complete", { force: true });
      }, 450);
    }
  }
}

function showTerrainStatus(msg, type) {
  const el = document.getElementById('terrain-status');
  if (!el) return;
  el.replaceChildren();
  el.textContent = msg;
  el.className = `terrain-status ${type}`;
  el.classList.remove('hidden');
}

function showTerrainFetchProgress(progress = {}) {
  const el = document.getElementById('terrain-status');
  if (!el) return;

  const totalPoints = Math.max(0, Number(progress.totalPoints) || 0);
  const completedPoints = Math.min(totalPoints, Math.max(0, Number(progress.completedPoints) || 0));
  const activePoints = Math.min(
    Math.max(0, totalPoints - completedPoints),
    Math.max(0, Number(progress.activePoints) || 0)
  );
  const realPointCount = Math.max(0, Number(progress.realPointCount) || 0);
  const batchIndex = Math.max(0, Number(progress.batchIndex) || 0);
  const totalBatches = Math.max(0, Number(progress.totalBatches) || 0);
  const completionPct = totalPoints > 0 ? (completedPoints / totalPoints) * 100 : 0;
  const activePct = totalPoints > 0 ? (activePoints / totalPoints) * 100 : 0;
  const phase = String(progress.phase || 'fetching');
  const isComplete = phase === 'validating' || phase === 'building' || phase === 'complete';
  const displayedPct = isComplete ? 100 : completionPct;

  const phaseLabels = {
    preparing: 'Preparing elevation request',
    fetching: 'Fetching real elevation data',
    validating: 'Validating DEM coverage',
    building: 'Building the 3D terrain surface',
    complete: 'Elevation fetch complete'
  };

  const title = document.createElement('div');
  title.className = 'terrain-progress-title';

  const titleLeft = document.createElement('div');
  titleLeft.className = 'terrain-progress-title-left';
  const icon = document.createElement('span');
  icon.className = 'terrain-progress-icon';
  icon.textContent = phase === 'validating' ? '✓' : phase === 'building' ? '◆' : '⌛';
  const label = document.createElement('strong');
  label.textContent = phaseLabels[phase] || phaseLabels.fetching;
  titleLeft.append(icon, label);

  const percent = document.createElement('strong');
  percent.className = 'terrain-progress-percent';
  percent.textContent = `${displayedPct.toFixed(displayedPct >= 10 ? 0 : 1)}%`;
  title.append(titleLeft, percent);

  const track = document.createElement('div');
  track.className = 'terrain-progress-track';
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', phaseLabels[phase] || phaseLabels.fetching);
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', String(totalPoints || 100));
  track.setAttribute('aria-valuenow', String(isComplete ? totalPoints : completedPoints));

  const completedBar = document.createElement('div');
  completedBar.className = 'terrain-progress-completed';
  completedBar.style.width = `${Math.min(100, displayedPct)}%`;
  track.appendChild(completedBar);

  if (!isComplete && activePct > 0) {
    const activeBar = document.createElement('div');
    activeBar.className = 'terrain-progress-active';
    activeBar.style.left = `${Math.min(100, completionPct)}%`;
    activeBar.style.width = `${Math.min(100 - completionPct, activePct)}%`;
    track.appendChild(activeBar);
  }

  const meta = document.createElement('div');
  meta.className = 'terrain-progress-meta';

  const processed = document.createElement('span');
  processed.textContent = totalPoints
    ? `${isComplete ? totalPoints : completedPoints} of ${totalPoints} grid points processed`
    : 'Preparing terrain grid';

  const batch = document.createElement('span');
  batch.textContent = totalBatches
    ? `Batch ${Math.min(batchIndex, totalBatches)} of ${totalBatches}`
    : 'Waiting for elevation batches';
  meta.append(processed, batch);

  const details = document.createElement('div');
  details.className = 'terrain-progress-details';
  const real = document.createElement('span');
  const denominator = Math.max(completedPoints, realPointCount);
  real.textContent = denominator > 0
    ? `${realPointCount} real DEM points received from ${denominator} processed points`
    : 'No elevation points processed yet';
  const source = document.createElement('span');
  source.textContent = progress.detail || 'Cached points load quickly; missing points may take longer to fetch online.';
  details.append(real, source);

  el.replaceChildren(title, track, meta, details);
  el.className = 'terrain-status loading terrain-status-progress';
  el.classList.remove('hidden');
}

function renderTerrainScores(scores, lat, lng, gridKm) {
  const { topoScore, yieldImpactScore, overallModifier, details } = scores;

  const terrainScoresSection = document.getElementById('terrain-scores');
  if (terrainScoresSection) {
    terrainScoresSection.classList.remove('hidden');

    if ((currentAnalysisSubtabs.terrain || 'terrain-3d') === 'terrain-3d') {
      terrainScoresSection.classList.remove('subsection-hidden');
    }
  }

  // Animate score rings
  animateRing('topo-ring-fill', topoScore, '#84cc16');
  animateRing('yield-ring-fill', yieldImpactScore, '#0ea5e9');

  document.getElementById('topo-score-val').textContent = topoScore + '%';
  document.getElementById('yield-impact-val').textContent = yieldImpactScore + '%';

  const topoLabel = topoScore >= 75 ? 'Excellent for rice cultivation' : topoScore >= 55 ? 'Good terrain conditions' : topoScore >= 35 ? 'Moderate suitability' : 'Challenging terrain';
  const yieldLabel = yieldImpactScore >= 80 ? 'Minimal terrain penalty' : yieldImpactScore >= 60 ? 'Minor yield reduction' : yieldImpactScore >= 40 ? 'Moderate yield impact' : 'Significant terrain penalty';

  document.getElementById('topo-score-sub').textContent = topoLabel;
  document.getElementById('yield-impact-sub').textContent = yieldLabel;

  // Final terrain-adjusted yield calculation
  const baseYield = forecastData
    ? avg(forecastData.historical.map(r => r.yield))
    : (REGION_YIELD_AVERAGES[currentRegionId] || 2.6);
  const terrainYieldModifier = getTerrainAdjustedYieldModifier(scores);
  const adjustedYield = baseYield * terrainYieldModifier;
  const modifierPct = ((terrainYieldModifier - 1) * 100).toFixed(1);

  document.getElementById('final-yield-val').textContent = adjustedYield.toFixed(3) + ' t/ha';
  document.getElementById('final-yield-base').textContent = `Base: ${baseYield.toFixed(3)} t/ha (calibrated historical avg)`;
  document.getElementById('final-yield-mod').textContent = `Terrain modifier: ${modifierPct >= 0 ? '+' : ''}${modifierPct}%`;

  document.getElementById('terrain-location-label').textContent =
    `${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E — ${gridKm}km² analysis area`;

  // Detailed metrics
  const { elevation, slope, soil, irrigation } = details;

  document.getElementById('elev-metrics').innerHTML = metricRows([
    ['Min Elevation', Math.round(elevation.minE) + ' m'],
    ['Max Elevation', Math.round(elevation.maxE) + ' m'],
    ['Avg Elevation', Math.round(elevation.avgE) + ' m'],
    ['Elevation Range', Math.round(elevation.elevRange) + ' m'],
    ['DEM Source', elevation.demSourceLabel || '—'],
    ['Real DEM Coverage', `${Number(elevation.demCoveragePct || 0).toFixed(0)}%`],
    ['Fallback-Filled Points', String(elevation.fallbackFilledCount || 0)],
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
    ['Probable Soil Group', soil.soilGroup || soil.soilType],
    ['Likely / Known Texture', soil.soilTexture],
    ['Soil pH', soil.soilpH],
    ['Fertility Estimate', soil.soilFertility],
    ['Water Retention', soil.waterRetention],
    ['Effective Drainage', soil.effectiveDrainage || soil.terrainDrainageClass],
    ['Evidence Source', soil.sourceLabel],
    ['Confidence', soil.confidence],
  ]);

  renderSoilProfile(soil, slope);

  document.getElementById('irrigation-metrics').innerHTML = metricRows([
    ['Irrigation Score', irrigation.irrigationScore.toFixed(0) + '%'],
    ['Type', irrigation.irrigationType],
    ['Elev Variability', irrigation.elevVariance + ' m'],
    ['Water Retention', soil.waterRetention || 'Moderate'],
    ['Flood Risk', slope.avgSlope < 1.5 ? 'Moderate' : 'Low'],
  ]);

  document.getElementById('terrain-scores').classList.remove('hidden');
  renderTerrainYieldSummary(scores, latestSpatiotemporalData);
  document.getElementById('terrain-scores').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderTerrainYieldSummary(terrainScores, spatioData = latestSpatiotemporalData) {
  const banner = document.getElementById('terrain-yield-summary-banner');
  if (!banner || !terrainScores) return;

  const terrainScore = Number(terrainScores.topoScore || 0);
  const farmDelta = Number(spatioData?.suitability_score_delta || 0);
  const finalScore = clampValue(Math.round(terrainScore + farmDelta), 0, 100);

  let baseYield = null;
  if (forecastData?.historical?.length) {
    baseYield = avg(forecastData.historical.map(r => r.yield));
  } else if (window.forecastData?.historical?.length) {
    baseYield = avg(window.forecastData.historical.map(r => r.yield));
  } else {
    baseYield = REGION_YIELD_AVERAGES[currentRegionId] || 2.6;
  }

  const terrainMod = getTerrainAdjustedYieldModifier(terrainScores);
  const terrainAdjustedYield = baseYield * terrainMod;
  const combinedModRaw = getFinalYieldModifier(finalScore, terrainScores, spatioData);
  const finalYieldRaw = baseYield * combinedModRaw;
  const finalYield = Math.max(finalYieldRaw, terrainAdjustedYield + 0.001);
  const combinedMod = baseYield > 0 ? finalYield / baseYield : combinedModRaw;

  setText('tys-terrain-score', `${terrainScore.toFixed(0)}/100`);
  setText('tys-farm-delta', `${farmDelta >= 0 ? '+' : ''}${farmDelta.toFixed(0)} pts`);
  setText('tys-final-score', `${finalScore.toFixed(0)}/100`);
  setText('tys-base-yield', `${baseYield.toFixed(3)} t/ha`);
  setText('tys-combined-mod', `${combinedMod >= 1 ? '+' : ''}${((combinedMod - 1) * 100).toFixed(1)}%`);
  setText('tys-final-yield', `${finalYield.toFixed(3)} t/ha`);
  setText('tys-final-note', `Fully adjusted prediction · higher than the terrain-adjusted yield of ${terrainAdjustedYield.toFixed(3)} t/ha`);

  banner.classList.remove('hidden');
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
  if (yld < 2.0) return '⚠️ Very low yield — check climate conditions';
  if (yld < 2.5) return '🟡 Fair yield range';
  if (yld < 3.2) return '🟢 Average yield range';
  if (yld < 4.2) return '✅ Good yield expected';
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

  if ((currentAnalysisSubtabs.terrain || 'terrain-3d') === 'terrain-3d') {
    section.classList.remove('subsection-hidden');
  }

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

function renderSpatioDecisionText(data, terrainScores) {
  const preNdvi = Number(data.pre_monsoon_ndvi || 0);
  const postNdvi = Number(data.post_monsoon_ndvi || 0);
  const delta = postNdvi - preNdvi;

  const heatIndex = Number(data.heat_stress_index || 0);
  const stabilityPct = Math.round(Number(data.stability_score || 0) * 100);
  const irrigationPct = Math.round(Number(data.irrigation_dependency || 0) * 100);
  const yieldAdj = Number(data.yield_adjustment_pct || 0);

  let mainStress = "No major stress";
  let stressNote = "Farm condition appears balanced.";

  if (heatIndex >= 0.65) {
    mainStress = "Heat Stress";
    stressNote = "High heat stress may reduce crop comfort and water efficiency.";
  } else if (irrigationPct >= 65) {
    mainStress = "Rainfall Dependence";
    stressNote = "The area may rely strongly on rainfall or irrigation timing.";
  } else if (stabilityPct < 60) {
    mainStress = "Low Stability";
    stressNote = "Vegetation proxy stability is weaker than ideal.";
  } else if (delta < -0.03) {
    mainStress = "Seasonal Decline";
    stressNote = "Post-monsoon condition is weaker than pre-monsoon.";
  }

  const bestSeason = postNdvi >= preNdvi ? "Post-Monsoon" : "Pre-Monsoon";
  const bestSeasonNote = postNdvi >= preNdvi
    ? "Post-monsoon values show stronger vegetation proxy conditions."
    : "Pre-monsoon values currently appear more favorable.";

  const trendNote = delta >= 0
    ? `Seasonal condition improves by ${delta.toFixed(3)} from pre- to post-monsoon.`
    : `Seasonal condition declines by ${Math.abs(delta).toFixed(3)} from pre- to post-monsoon.`;

  const healthLabel =
    stabilityPct >= 80 ? "Excellent stability" :
      stabilityPct >= 65 ? "Good stability" :
        stabilityPct >= 50 ? "Moderate stability" :
          "Weak stability";

  setText("st-health-label", healthLabel);
  setText("st-trend-note", trendNote);
  setText("st-main-stress", mainStress);
  setText("st-main-stress-note", stressNote);
  setText("st-season", bestSeason);
  setText("st-season-note", bestSeasonNote);

  const interp = document.getElementById("spatio-ai-interpretation");
  if (interp) {
    const direction = yieldAdj >= 0 ? "positive" : "negative";
    interp.textContent =
      `The selected farm area shows ${healthLabel.toLowerCase()} with ${data.trend_direction}. ` +
      `${bestSeason} appears more suitable based on seasonal vegetation proxy values. ` +
      `The main limiting factor is ${mainStress.toLowerCase()}, producing a ${direction} yield adjustment of ${yieldAdj >= 0 ? "+" : ""}${yieldAdj.toFixed(1)}%.`;
  }

  const actionList = document.getElementById("spatio-action-list");
  if (actionList) {
    let actions = [];

    if (mainStress === "Heat Stress") {
      actions = [
        "Increase irrigation monitoring during hot periods.",
        "Avoid planting during extreme heat windows.",
        "Prioritize moisture retention and field water management."
      ];
    } else if (mainStress === "Rainfall Dependence") {
      actions = [
        "Check irrigation access before planting.",
        "Use rainfall forecast before scheduling field preparation.",
        "Monitor drainage after heavy rainfall."
      ];
    } else if (mainStress === "Low Stability") {
      actions = [
        "Review soil fertility and water consistency.",
        "Use fertilizer recommendation results before application.",
        "Monitor field condition between seasons."
      ];
    } else if (mainStress === "Seasonal Decline") {
      actions = [
        "Compare planting timing between pre- and post-monsoon seasons.",
        "Check if excess rainfall or drainage is affecting suitability.",
        "Use terrain and water-body analysis to confirm field limitations."
      ];
    } else {
      actions = [
        "Maintain current field management practices.",
        "Use forecast and pest-risk modules for timing decisions.",
        "Continue monitoring water and fertilizer compatibility."
      ];
    }

    actionList.innerHTML = actions.map(action => `<span>${action}</span>`).join("");
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
  renderSpatioDecisionText(data, terrainScores);

  // Scroll to section
  setTimeout(() => {
    document.getElementById('spatio-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 200);
}

// ── Draw a single false-color panel canvas ────────────────────────────────
function drawSpatioPanel(canvas, centralValue, type, data) {
  // Simulate a spatial raster using the annual_series + seasonal_profile
  // to create a plausible false-color gradient map
  const displaySize = Math.min(canvas.offsetWidth || 320, 360);
  const W = displaySize;
  const H = displaySize;

  canvas.width = W;
  canvas.height = H;
  canvas.style.width = `${displaySize}px`;
  canvas.style.height = `${displaySize}px`;

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
  // Base yield: from calibrated forecast data if available, else regional fallback.
  let baseYield = null;
  if (forecastData) {
    baseYield = avg(forecastData.historical.map(r => r.yield));
  } else if (window.forecastData) {
    baseYield = avg(window.forecastData.historical.map(r => r.yield));
  } else if (terrainScores && terrainScores.details) {
    baseYield = REGION_YIELD_AVERAGES[currentRegionId] || 2.6;
  }

  const combinedMod = getFinalYieldModifier(finalScore, terrainScores, spatioData);
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
  let pestAnalysisCompletedForVoice = false;

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
    pestAnalysisCompletedForVoice = true;
  } catch (e) {
    showPestMsg(`❌ Analysis failed: ${e.message}`);
    document.getElementById('pest-results').classList.add('hidden');
  } finally {
    hideLoading();

    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">🦗</span> Analyze Pest Outbreak Risk';
    if (pestAnalysisCompletedForVoice) {
      setTimeout(() => {
        playVoiceLine("pest-outbreak-complete", { force: true });
      }, 450);
    }
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

  // Re-apply selected pest sub-tab after all results are rendered.
  applyPestSubtabVisibility(currentAnalysisSubtabs.pest || 'pest-outbreak');

  // Scroll to results
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPestSpatioContext(ctx) {
  const grid = document.getElementById('pest-spatio-grid');
  if (!grid || !ctx) return;

  const clampPct = value => Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 0));
  const quarter = Math.max(1, Math.min(4, Number(ctx.quarter || 1)));
  const ndviValue = ctx.ndvi_proxy !== null && ctx.ndvi_proxy !== undefined ? Number(ctx.ndvi_proxy) : null;
  const eviValue = ctx.evi_proxy !== null && ctx.evi_proxy !== undefined ? Number(ctx.evi_proxy) : null;
  const lstValue = ctx.lst_proxy !== null && ctx.lst_proxy !== undefined ? Number(ctx.lst_proxy) : null;
  const ndviPct = ndviValue === null ? 0 : clampPct(ndviValue * 100);
  const eviPct = eviValue === null ? 0 : clampPct(eviValue * 100);
  const heatPct = lstValue === null ? 0 : clampPct(((lstValue - 18) / 20) * 100);
  const heatClass = lstValue === null ? 'No heat proxy'
    : lstValue >= 34 ? 'High heat pressure'
      : lstValue >= 30 ? 'Warm conditions'
        : lstValue >= 25 ? 'Balanced temperature'
          : 'Cool conditions';

  const seasonNames = ['Q1 Dry Transition', 'Q2 Wet-Season Onset', 'Q3 Peak Wet Season', 'Q4 Harvest Transition'];
  const stageLabel = String(ctx.crop_stage || 'Not specified').replace(/_/g, ' ');
  const seasonLabel = ctx.season_label || seasonNames[quarter - 1];
  const trend = ctx.trend_interpretation || 'Standard seasonal monitoring applies.';

  const quarterSegments = seasonNames.map((name, index) => `
    <div class="pest-quarter-segment ${index + 1 === quarter ? 'active' : ''}">
      <span>Q${index + 1}</span>
      <small>${name.replace(/^Q\d\s*/, '')}</small>
    </div>
  `).join('');

  const proxyRow = (icon, label, valueLabel, percentage, className = '') => `
    <div class="pest-proxy-row ${className}">
      <div class="pest-proxy-label">
        <span class="pest-proxy-icon">${icon}</span>
        <div><strong>${label}</strong><small>${valueLabel}</small></div>
      </div>
      <div class="pest-proxy-track"><i style="width:${percentage.toFixed(1)}%"></i></div>
    </div>
  `;

  grid.innerHTML = `
    <div class="pest-season-dashboard">
      <section class="pest-season-visual-card">
        <div class="pest-season-wheel" style="--season-angle:${(quarter - 1) * 90 + 45}deg">
          <div class="pest-season-wheel-ring"></div>
          <div class="pest-season-pointer"></div>
          <div class="pest-season-center">
            <span>Current season</span>
            <strong>Q${quarter}</strong>
            <small>${seasonLabel}</small>
          </div>
        </div>
        <div class="pest-quarter-strip">${quarterSegments}</div>
      </section>

      <section class="pest-context-proxy-card">
        <div class="pest-context-card-title">
          <div><span>Crop-condition visualizers</span><strong>Seasonal stress indicators</strong></div>
          <small>Proxy values, not direct satellite measurements</small>
        </div>
        <div class="pest-proxy-list">
          ${proxyRow('🌿', 'NDVI vegetation', ndviValue === null ? 'Not available' : ndviValue.toFixed(3), ndviPct, 'vegetation')}
          ${proxyRow('🍃', 'EVI crop vigor', eviValue === null ? 'Not available' : eviValue.toFixed(3), eviPct, 'vigor')}
          ${proxyRow('🌡️', 'Land heat proxy', lstValue === null ? 'Not available' : `${lstValue.toFixed(1)} °C · ${heatClass}`, heatPct, 'heat')}
        </div>
      </section>

      <section class="pest-context-evidence-card">
        <div class="pest-stage-display">
          <span class="pest-stage-icon">🌾</span>
          <div><small>Rice growth stage</small><strong>${stageLabel}</strong></div>
        </div>
        <div class="pest-context-chip-grid">
          <div class="pest-context-chip ${ctx.terrain_modifier_used ? 'active' : ''}">
            <span>⛰️</span><div><small>Terrain context</small><strong>${ctx.terrain_modifier_used ? 'Included' : 'Not used'}</strong></div>
          </div>
          <div class="pest-context-chip ${ctx.water_modifier_used ? 'active' : ''}">
            <span>💧</span><div><small>Water context</small><strong>${ctx.water_modifier_used ? 'Included' : 'Not used'}</strong></div>
          </div>
        </div>
        <div class="pest-context-trend">
          <span>Season interpretation</span>
          <p>${trend}</p>
        </div>
      </section>
    </div>
  `;
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
    {
      id: 'spCanvas-ndvi-post',
      value: data.post_monsoon_ndvi,
      type: 'ndvi'
    },
    {
      id: 'spCanvas-delta',
      value: data.post_monsoon_ndvi - data.pre_monsoon_ndvi,
      type: 'delta'
    },
    {
      id: 'spCanvas-lst-pre',
      value: data.pre_monsoon_lst,
      type: 'lst'
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
    const jsonText = match[1]
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    return JSON.parse(jsonText);
  } catch (e) {
    console.warn('PALADIN structured image data could not be parsed:', e);
    return null;
  }
}

// ── Strip the raw JSON block from displayed text ──
function paladinStripDataBlock(text) {
  return text.replace(/---PALADIN_DATA---[\s\S]*?---END_DATA---/g, '').trim();
}

// ── Draw one circular SVG meter ──
function paladinDrawMeter(label, value, color, polarity = 'risk') {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
  const r = 36;
  const circ = 2 * Math.PI * r;
  const fill = (safeValue / 100) * circ;
  const dash = `${fill.toFixed(1)} ${(circ - fill).toFixed(1)}`;

  let emoji = '🔵';
  if (polarity === 'positive') {
    emoji = safeValue >= 75 ? '🟢' : safeValue >= 50 ? '🟡' : safeValue >= 25 ? '🟠' : '🔴';
  } else if (polarity === 'risk') {
    emoji = safeValue >= 75 ? '🔴' : safeValue >= 50 ? '🟠' : safeValue >= 25 ? '🟡' : '🟢';
  }

  return `
    <div class="pal-meter">
      <svg viewBox="0 0 88 88" class="pal-meter-svg">
        <circle cx="44" cy="44" r="${r}" class="pal-meter-track"/>
        <circle cx="44" cy="44" r="${r}"
          class="pal-meter-fill"
          style="stroke:${color};stroke-dasharray:${dash};stroke-dashoffset:0"
          transform="rotate(-90 44 44)"/>
        <text x="44" y="40" class="pal-meter-val">${Math.round(safeValue)}</text>
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
      { label: 'Plant Health', value: data.plant_health_score, polarity: 'positive' },
      { label: 'Discoloration', value: data.discoloration_severity, polarity: 'risk' },
      { label: 'Diagnosis Confidence', value: data.confidence, polarity: 'neutral' },
      { label: 'Outbreak Potential', value: data.outbreak_potential, polarity: 'risk' },
      { label: 'Urgency', value: data.urgency_score, polarity: 'risk' },
      { label: 'Image Quality', value: data.image_quality, polarity: 'positive' },
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
        scores.push({ label, value, polarity: 'neutral' });
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
    .map((s, i) => paladinDrawMeter(s.label, s.value, METER_COLORS[i % METER_COLORS.length], s.polarity || 'risk'))
    .join('');
  wrap.appendChild(grid);

  // Download button — renders grid as PNG via canvas
  const dlBtn = document.createElement('button');
  dlBtn.className = 'paladin-dl-btn';
  dlBtn.textContent = '⬇ Download Chart';
  dlBtn.onclick = () => paladinDownloadMeters(scores);
  wrap.appendChild(dlBtn);

  bubble.appendChild(wrap);
  if (data) paladinRenderDiscolorationAlert(bubble, data);
}

function paladinRenderDiscolorationAlert(bubble, data) {
  if (!bubble || !data) return;

  const detected = data.discoloration_detected === true || Number(data.discoloration_severity || 0) > 0;
  const severity = Math.max(0, Math.min(100, Number(data.discoloration_severity) || 0));
  const level = String(data.discoloration_level || (detected ? 'Detected' : 'None Detected'));
  const health = Math.max(0, Math.min(100, Number(data.plant_health_score) || 0));
  const colors = Array.isArray(data.discoloration_colors) ? data.discoloration_colors.filter(Boolean) : [];
  const affected = data.affected_area_estimate_percent;

  const alert = document.createElement('section');
  alert.className = `pal-discoloration-alert ${detected ? 'is-detected' : 'is-clear'}`;

  const heading = document.createElement('div');
  heading.className = 'pal-discoloration-alert-head';

  const title = document.createElement('strong');
  title.textContent = detected ? '🍂 Leaf Discoloration Alert' : '🍃 Leaf Color Check';
  heading.appendChild(title);

  const badge = document.createElement('span');
  badge.textContent = level;
  heading.appendChild(badge);
  alert.appendChild(heading);

  const summary = document.createElement('p');
  const affectedText = affected === null || affected === undefined ? 'area not reliably estimated' : `about ${Math.round(Number(affected) || 0)}% of visible leaf area`;
  summary.textContent = detected
    ? `Visible discoloration was estimated at ${severity}% severity, affecting ${affectedText}. Visual plant-health score: ${Math.round(health)}/100.`
    : `No meaningful discoloration was reported in the visible leaves. Visual plant-health score: ${Math.round(health)}/100.`;
  alert.appendChild(summary);

  const details = document.createElement('div');
  details.className = 'pal-discoloration-details';

  const colorItem = document.createElement('div');
  const colorLabel = document.createElement('span');
  colorLabel.textContent = 'Observed colors';
  const colorValue = document.createElement('strong');
  colorValue.textContent = colors.length ? colors.join(', ') : 'Not specified';
  colorItem.append(colorLabel, colorValue);

  const patternItem = document.createElement('div');
  const patternLabel = document.createElement('span');
  patternLabel.textContent = 'Pattern';
  const patternValue = document.createElement('strong');
  patternValue.textContent = String(data.discoloration_pattern || 'Not specified');
  patternItem.append(patternLabel, patternValue);

  const causeItem = document.createElement('div');
  const causeLabel = document.createElement('span');
  causeLabel.textContent = 'Likely stress category';
  const causeValue = document.createElement('strong');
  causeValue.textContent = String(data.likely_stress_category || 'Uncertain');
  causeItem.append(causeLabel, causeValue);

  details.append(colorItem, patternItem, causeItem);
  alert.appendChild(details);
  bubble.appendChild(alert);
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
  return `/static/assets/fertilizers/${fert.image}`;
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
    soilGroup: details.soil?.soilGroup || details.soil?.soilType || 'Unspecified',
    soilFertility: details.soil?.soilFertility || 'Moderate',
    soilpH: details.soil?.soilpH || '5.8–6.5',
    measuredPH: details.soil?.measuredPH ?? null,
    soilTexture: details.soil?.soilTexture || 'Clay Loam',
    drainageScore: details.soil?.drainageScore ?? 50,
    effectiveDrainage: details.soil?.effectiveDrainage || details.soil?.terrainDrainageClass || 'Estimated',
    organicMatter: details.soil?.organicMatter ?? null,
    sourceLabel: details.soil?.sourceLabel || 'PAL-AI terrain inference',
    confidence: details.soil?.confidence || 'Low to Moderate',
    hasDirectEvidence: Boolean(details.soil?.hasDirectEvidence)
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
      if (score >= 68) reasons.push(`Good compatibility with ${soil.hasDirectEvidence ? 'the supplied soil evidence' : 'terrain-inferred soil conditions'}`);
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

  section.classList.remove('hidden');

  if ((currentAnalysisSubtabs.terrain || 'terrain-3d') === 'terrain-fertilizer') {
    section.classList.remove('subsection-hidden');
  }

  latestFertilizerAnalysis = data;

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
  if (soilTypeEl) soilTypeEl.textContent = `${data.soil.soilTexture} · ${data.soil.sourceLabel}`;
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


/* ════════════════════════════════════════════════════════════════════════════
   FARM HEALTH & SEASONAL CONDITION — farmer-focused Terrain subtab
   Overrides the older regional-only spatiotemporal presentation while keeping
   its regional proxy fields available for pest/yield integrations.
   ════════════════════════════════════════════════════════════════════════════ */

let farmHealthLastData = null;

function farmHealthScoreColor(score) {
  const value = Number(score || 0);
  if (value >= 82) return '#2f855a';
  if (value >= 68) return '#65a30d';
  if (value >= 55) return '#ca8a04';
  if (value >= 40) return '#ea580c';
  return '#dc2626';
}

function farmHealthStageLabel(stage) {
  const labels = {
    'pre-planting': 'Land preparation',
    'seedling': 'Seedling establishment',
    'tillering': 'Tillering / vegetative',
    'panicle-initiation': 'Panicle initiation',
    'flowering': 'Flowering',
    'grain-filling': 'Grain filling',
    'ripening': 'Ripening / harvest',
    'not-specified': 'Not specified'
  };
  return labels[stage] || String(stage || 'Not specified').replace(/-/g, ' ');
}

function setFarmHealthLoading(active, title, text, isError = false) {
  const wrap = document.getElementById('farm-health-loading');
  const titleEl = document.getElementById('farm-health-loading-title');
  const textEl = document.getElementById('farm-health-loading-text');
  if (!wrap) return;
  wrap.classList.toggle('is-working', Boolean(active));
  wrap.classList.toggle('is-error', Boolean(isError));
  if (titleEl && title) titleEl.textContent = title;
  if (textEl && text) textEl.textContent = text;
}

function getFarmHealthTerrainContext(terrainScores) {
  const soil = terrainScores?.details?.soil || {};
  const irrigation = terrainScores?.details?.irrigation || {};
  const slope = terrainScores?.details?.slope || terrainScores?.details?.topography || {};
  const numberOrNull = value => Number.isFinite(Number(value)) ? Number(value) : null;
  return {
    terrain_score: numberOrNull(terrainScores?.topoScore),
    drainage_score: numberOrNull(soil?.drainageScore ?? terrainScores?.drainageScore),
    irrigation_score: numberOrNull(irrigation?.irrigationScore ?? terrainScores?.irrigationScore),
    slope_score: numberOrNull(slope?.score ?? slope?.slopeScore)
  };
}

function buildFarmHealthRequest(regionId, terrainScores) {
  if (!latestTerrainLocation) return null;
  const meta = getLongTermLocationMetadata();
  return {
    region_id: Number(regionId || currentRegionId || 13),
    latitude: Number(latestTerrainLocation.lat),
    longitude: Number(latestTerrainLocation.lng),
    radius_km: Number(latestTerrainLocation.gridKm || 5),
    planting_date: document.getElementById('farm-health-planting-date')?.value || null,
    growth_stage: document.getElementById('farm-health-growth-stage')?.value || 'auto',
    irrigation_type: document.getElementById('farm-health-irrigation-type')?.value || 'unknown',
    region_name: meta.regionName || null,
    province_name: meta.provinceName || null,
    municipality_name: meta.municipalityName || null,
    barangay_name: meta.barangayName || null,
    ...getFarmHealthTerrainContext(terrainScores)
  };
}

async function refreshFarmHealthAnalysis() {
  if (!latestTerrainLocation || !latestTerrainScores) {
    setFarmHealthLoading(false, 'Generate the 3D terrain first', 'Farm Health needs the selected coordinates and terrain/drainage results before it can run.', true);
    return;
  }
  await runSpatiotemporalAnalysis(currentRegionId || 13, latestTerrainScores);
}

async function runSpatiotemporalAnalysis(regionId, terrainScores) {
  const section = document.getElementById('spatio-section');
  if (!section) return;

  const requestBody = buildFarmHealthRequest(regionId, terrainScores);
  if (!requestBody) {
    setFarmHealthLoading(false, 'Waiting for a completed 3D terrain scan', 'PAL-AI will automatically analyze the selected farm after terrain generation.');
    return;
  }

  const locationLabel = document.getElementById('farm-health-location-label');
  if (locationLabel) {
    const meta = getLongTermLocationMetadata();
    locationLabel.textContent = `${meta.locationLabel || `${requestBody.latitude.toFixed(4)}, ${requestBody.longitude.toFixed(4)}`} · ${requestBody.radius_km} km analysis area`;
  }

  setFarmHealthLoading(true, 'Analyzing local farm conditions…', 'Comparing recent local climate, usual seasonal conditions, crop stage, and the completed terrain scan.');
  const results = document.getElementById('farm-health-results');
  if (results && !farmHealthLastData) results.classList.add('hidden');

  try {
    const response = await fetch(`${API}/api/farm-condition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.detail || `Farm condition API error: ${response.status}`);
    }

    const data = await response.json();
    farmHealthLastData = data;
    latestSpatiotemporalData = data;
    if (typeof window._onSpatiotemporalData === 'function') window._onSpatiotemporalData(data);
    renderFarmHealthCondition(data);
    setFarmHealthLoading(false, 'Farm report is ready', 'Open the indicators below to understand the main concern and recommended actions.');

    document.querySelectorAll('[data-sub-target="terrain-farm-health"]').forEach(button => {
      button.classList.add('has-result');
    });
  } catch (error) {
    console.error('Farm Health analysis failed:', error);
    setFarmHealthLoading(false, 'Farm report could not be completed', String(error.message || error), true);
  }
}

function renderFarmHealthIndicator(key, item) {
  const score = Number(item?.score || 0);
  const scoreEl = document.getElementById(`fh-${key}-score`);
  const barEl = document.getElementById(`fh-${key}-bar`);
  const labelEl = document.getElementById(`fh-${key}-label`);
  const color = farmHealthScoreColor(score);
  if (scoreEl) {
    scoreEl.textContent = `${score.toFixed(0)}/100`;
    scoreEl.style.color = color;
  }
  if (barEl) {
    barEl.style.width = `${Math.max(2, Math.min(100, score))}%`;
    barEl.style.background = color;
  }
  if (labelEl) labelEl.textContent = item?.label || 'Estimated';
}

function renderFarmHealthMonthlyChart(months) {
  const wrap = document.getElementById('farm-health-monthly-chart');
  if (!wrap) return;

  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const currentMonth = new Date().getMonth() + 1;
  const normalized = Array.from({ length: 12 }, (_, index) => {
    const source = (months || []).find(item => Number(item.month) === index + 1) || {};
    return {
      month: index + 1,
      score: Math.max(0, Math.min(100, Number(source.score || 0))),
      label: source.label || 'Estimated'
    };
  });

  wrap.setAttribute(
    'aria-label',
    normalized.map(item => `${names[item.month - 1]} ${item.score.toFixed(0)} out of 100`).join(', ')
  );

  wrap.innerHTML = normalized.map(item => {
    const color = farmHealthScoreColor(item.score);
    const isCurrent = item.month === currentMonth;
    return `
      <article class="farm-health-month-bar ${isCurrent ? 'current' : ''}"
        style="--month-score:${item.score}%; --month-color:${color}"
        title="${names[item.month - 1]}: ${item.score.toFixed(0)}/100 · ${item.label}">
        <div class="farm-health-month-bar-track">
          <i class="farm-health-month-bar-fill"></i>
          <strong class="farm-health-month-bar-value">${item.score.toFixed(0)}</strong>
        </div>
        <span class="farm-health-month-bar-name">${names[item.month - 1]}</span>
        <small class="farm-health-month-bar-label">${item.label}</small>
      </article>`;
  }).join('');
}

function renderFarmHealthCondition(data) {
  const results = document.getElementById('farm-health-results');
  if (results) results.classList.remove('hidden');

  const score = Number(data?.condition?.overall_score || 0);
  const color = farmHealthScoreColor(score);
  const gauge = document.getElementById('farm-health-overall-gauge');
  if (gauge) {
    gauge.style.setProperty('--farm-score', `${Math.max(0, Math.min(100, score))}%`);
    gauge.style.setProperty('--farm-color', color);
  }
  setText('farm-health-overall-score', score.toFixed(0));
  setText('farm-health-status', data?.condition?.status || 'Estimated');
  const summary = document.getElementById('farm-health-summary');
  if (summary) {
    summary.textContent = `${data?.condition?.status || 'Estimated'} farm condition. ${data?.condition?.reason || ''}`.trim();
  }
  setText('farm-health-confidence', `Confidence: ${data?.observation?.confidence || 'Estimated'}`);
  setText('farm-health-observation-date', `Observation: ${data?.observation?.latest_date || 'Regional historical period'}`);
  setText('farm-health-main-concern', data?.condition?.main_concern || 'No dominant concern');
  setText('farm-health-main-reason', data?.condition?.reason || 'Maintain field observation and routine monitoring.');

  const stage = farmHealthStageLabel(data?.farm_context?.growth_stage);
  const days = data?.farm_context?.days_after_planting;
  setText('farm-health-stage-pill', `Growth stage: ${stage}${Number.isFinite(Number(days)) ? ` · ${days} days after planting` : ''}`);

  ['vegetation', 'moisture', 'heat', 'seasonal'].forEach(key => renderFarmHealthIndicator(key, data?.scores?.[key]));
  renderFarmHealthMonthlyChart(data?.monthly_outlook || []);

  const actions = document.getElementById('farm-health-action-list');
  if (actions) {
    actions.innerHTML = (data?.actions || []).map((action, index) => `
      <li><span>${index + 1}</span><p>${action}</p></li>`).join('');
  }

  const sourceBadge = document.getElementById('farm-health-source-badge');
  if (sourceBadge) {
    const local = data?.observation?.source_status === 'nasa-power';
    sourceBadge.classList.toggle('fallback', !local);
    sourceBadge.innerHTML = `
      <span>Analysis source</span>
      <strong>${local ? 'Local Climate + Terrain' : 'Regional Fallback + Terrain'}</strong>
      <small>${local ? 'Coordinate-specific NASA POWER conditions' : 'Live local climate was unavailable; fallback is clearly labelled'}</small>`;
  }

  const weather = data?.weather_summary || {};
  const details = document.getElementById('farm-health-weather-details');
  if (details) {
    const detailRows = [
      ['Average temperature', `${Number(weather.temperature_c || 0).toFixed(1)} °C`],
      ['Average maximum temperature', `${Number(weather.maximum_temperature_c || 0).toFixed(1)} °C`],
      ['30-day rainfall', `${Number(weather.rainfall_30d_mm || 0).toFixed(0)} mm`],
      ['Rainfall vs usual', `${Number(weather.rainfall_ratio || 0).toFixed(2)}×`],
      ['Relative humidity', `${Number(weather.humidity_pct || 0).toFixed(1)}%`],
      ['Wind speed', `${Number(weather.wind_speed_m_s || 0).toFixed(1)} m/s`],
      ['Solar energy', `${Number(weather.solar_kwh_m2_day || 0).toFixed(2)} kWh/m²/day`]
    ];
    details.innerHTML = detailRows.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
  }

  const sourceList = document.getElementById('farm-health-source-list');
  if (sourceList) {
    sourceList.innerHTML = (data?.data_sources || []).map(source => `
      <article><strong>${source.name}</strong><span>${source.status}</span><p>${source.detail}</p></article>`).join('');
  }
  setText('farm-health-limitations', data?.limitations || 'Field inspection is required before making major farm-management decisions.');

  const locationLabel = document.getElementById('farm-health-location-label');
  if (locationLabel) {
    locationLabel.textContent = `${data?.location?.label || `${data?.location?.latitude}, ${data?.location?.longitude}`} · ${data?.location?.radius_km || 5} km analysis area`;
  }

  if (latestTerrainScores) {
    renderTerrainYieldSummary(latestTerrainScores, data);
  }
}
