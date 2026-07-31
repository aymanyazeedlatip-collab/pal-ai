// terrain.js — PAL-AI 3D Terrain Analysis Module
// Uses Three.js for 3D rendering + OpenTopoData API for elevation

const Terrain = (() => {
  const TERRAIN_API =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://localhost:8000'
      : 'https://pal-ai-tupinhs.onrender.com';
  let scene, camera, renderer, controls, mesh, wireframeMesh;
  let resizeHandler = null;
  let animationId = null;
  let isWireframe = true;
  let isExaggerated = false;
  let isAnimating = true;
  let terrainData = null;
  let profileChart = null;
  let currentMode = 'suitability';
  let isRendererPaused = false;
  let waterOverlayFeatures = [];
  let waterOverlayRevision = 0;
  let waterLinesGroup = null;

  const GRID_RESOLUTION = 25;
  const TERRAIN_SIZE = 18;

  // Real-geometry water line overlay (rivers/streams/lakes), drawn as thin
  // 3D tubes (not flat GL lines) so they stay clearly visible and have
  // consistent visual width regardless of browser/GPU line-width support.
  const WATER_LINE_Y_OFFSET = 0.14;
  const WATER_LINE_COLOR = 0x3ea8ff;
  const WATER_LINE_RADIUS = 0.07;
  const WATER_AREA_OUTLINE_RADIUS = 0.055;
  // How far a water point is allowed to fall outside the scanned grid box
  // before it is dropped (as a fraction of GRID_RESOLUTION). Keeps rivers
  // that clip the edge of the scanned area from stretching far into space.
  const WATER_LINE_MARGIN_FRACTION = 0.18;


  // Adaptive vertical scaling.
  // BASE_EXAGGERATION is now stronger so hills/mountains are visible by default,
  // while EXAGGERATION remains available as an amplified inspection mode.
  const EXAGGERATION = 0.8;
  const BASE_EXAGGERATION = 0.5;

  let currentExaggeration = BASE_EXAGGERATION;

  // Color palettes per mode
  const COLOR_MAPS = {
    elevation: [
      { t: 0.0, r: 0.05, g: 0.18, b: 0.42 }, // deep water
      { t: 0.08, r: 0.13, g: 0.44, b: 0.71 }, // water
      { t: 0.15, r: 0.42, g: 0.68, b: 0.42 }, // lowland green
      { t: 0.30, r: 0.19, g: 0.64, b: 0.33 }, // mid green
      { t: 0.50, r: 0.50, g: 0.75, b: 0.31 }, // light green
      { t: 0.65, r: 0.62, g: 0.52, b: 0.30 }, // brown
      { t: 0.80, r: 0.55, g: 0.42, b: 0.25 }, // dark brown
      { t: 0.90, r: 0.72, g: 0.72, b: 0.72 }, // gray rock
      { t: 1.0, r: 1.00, g: 1.00, b: 1.00 }, // snow white
    ],
    slope: [
      { t: 0.0, r: 0.20, g: 0.80, b: 0.20 }, // flat = green
      { t: 0.25, r: 0.85, g: 0.85, b: 0.10 }, // gentle = yellow
      { t: 0.55, r: 1.00, g: 0.55, b: 0.00 }, // moderate = orange
      { t: 0.80, r: 0.90, g: 0.15, b: 0.10 }, // steep = red
      { t: 1.0, r: 0.60, g: 0.05, b: 0.05 }, // extreme = dark red
    ],
    aspect: [
      { t: 0.0, r: 1.0, g: 0.3, b: 0.3 }, // N
      { t: 0.25, r: 1.0, g: 0.9, b: 0.2 }, // E
      { t: 0.5, r: 0.3, g: 0.8, b: 1.0 }, // S
      { t: 0.75, r: 0.5, g: 0.3, b: 1.0 }, // W
      { t: 1.0, r: 1.0, g: 0.3, b: 0.3 }, // back to N
    ],
    soil: [
      { t: 0.0, r: 0.16, g: 0.46, b: 0.68 }, // waterlogging / high retention
      { t: 0.34, r: 0.20, g: 0.63, b: 0.38 }, // balanced drainage
      { t: 0.67, r: 0.88, g: 0.72, b: 0.22 }, // rapid drainage
      { t: 1.0, r: 0.82, g: 0.31, b: 0.18 }, // erosion / nutrient-loss risk
    ],
    suitability: [
      { t: 0.0, r: 0.78, g: 0.28, b: 0.24 }, // lighter red
      { t: 0.35, r: 0.82, g: 0.54, b: 0.24 }, // lighter orange
      { t: 0.60, r: 0.80, g: 0.74, b: 0.30 }, // lighter mustard
      { t: 0.80, r: 0.56, g: 0.74, b: 0.32 }, // lighter olive-green
      { t: 1.0, r: 0.24, g: 0.62, b: 0.34 }, // lighter green
    ],
  };

  function lerpColor(map, t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 0; i < map.length - 1; i++) {
      if (t <= map[i + 1].t) {
        const s = (t - map[i].t) / (map[i + 1].t - map[i].t);
        return {
          r: map[i].r + s * (map[i + 1].r - map[i].r),
          g: map[i].g + s * (map[i + 1].g - map[i].g),
          b: map[i].b + s * (map[i + 1].b - map[i].b),
        };
      }
    }
    return map[map.length - 1];
  }

  // ── DISABLED: synthetic DEM generation ──
  // PAL-AI must never render fake terrain. This function is intentionally left
  // in place (rather than deleted) so any accidental call fails loudly instead
  // of silently producing invented elevation data. Do not re-enable this path.
  function syntheticElevation() {
    throw new Error(
      'syntheticElevation() is disabled. PAL-AI terrain must be built only from real or interpolated DEM data.'
    );
  }
  function _unusedSyntheticElevationImpl(lat, lng, gridX, gridY, gridSize) {
    const seed = Math.sin(lat * 12.9898 + lng * 78.233) * 43758.5453;
    const rng = (n) => Math.abs(Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453) % 1;

    const nx = gridX / GRID_RESOLUTION;
    const ny = gridY / GRID_RESOLUTION;

    let elev = 0;
    let amp = 1;
    let freq = 1;
    let maxAmp = 0;

    for (let o = 0; o < 6; o++) {
      const ix = Math.floor(nx * freq * 7);
      const iy = Math.floor(ny * freq * 7);
      const fx = nx * freq * 7 - ix;
      const fy = ny * freq * 7 - iy;

      const n00 = rng(ix + iy * 137 + o * 1000);
      const n10 = rng(ix + 1 + iy * 137 + o * 1000);
      const n01 = rng(ix + (iy + 1) * 137 + o * 1000);
      const n11 = rng(ix + 1 + (iy + 1) * 137 + o * 1000);
      const bx = fx * fx * (3 - 2 * fx);
      const by = fy * fy * (3 - 2 * fy);
      const n = n00 + (n10 - n00) * bx + (n01 - n00) * by + (n00 - n10 - n01 + n11) * bx * by;

      elev += n * amp;
      maxAmp += amp;
      amp *= 0.52;
      freq *= 2.15;
    }

    elev = elev / maxAmp;

    // Add broader ridge/valley structure so fallback terrain does not look identical everywhere.
    const ridgeA = Math.pow(Math.abs(Math.sin((nx * 2.6 + lat * 0.09) * Math.PI)), 1.8);
    const ridgeB = Math.pow(Math.abs(Math.cos((ny * 2.2 + lng * 0.07) * Math.PI)), 2.1);
    const ridge = ridgeA * 0.55 + ridgeB * 0.45;

    // Deterministic location relief. This does not claim real topography; it only prevents
    // a fully flat backup model when real DEM is unavailable.
    const locationRelief = 65 + Math.abs(Math.sin(lat * 0.61 + lng * 0.37)) * 155;
    const localBase = Math.abs(Math.sin(lat * 1.19 - lng * 0.23)) * 110;
    const relief = (elev * 0.62 + ridge * 0.38) * locationRelief;

    return Math.max(0, localBase + relief + rng(lat * 100 + lng * 10) * 8);
  }

  function averageNeighborElevation(elevGrid, gx, gy, maxRadius = 6) {
    const N = GRID_RESOLUTION + 1;

    for (let radius = 1; radius <= maxRadius; radius++) {
      let sum = 0;
      let count = 0;

      for (let yy = gy - radius; yy <= gy + radius; yy++) {
        for (let xx = gx - radius; xx <= gx + radius; xx++) {
          if (yy < 0 || yy >= N || xx < 0 || xx >= N) continue;
          const idx = yy * N + xx;
          const v = elevGrid[idx];

          if (Number.isFinite(v)) {
            const dist = Math.hypot(xx - gx, yy - gy) || 1;
            const weight = 1 / dist;
            sum += v * weight;
            count += weight;
          }
        }
      }

      if (count > 0) return sum / count;
    }

    return null;
  }

  function demSourceLabel(meta) {
    const coverage = Number(meta?.demCoveragePct || 0);

    // NOTE: this is only ever called once coverage >= DEM_MIN_COVERAGE_PCT (85%).
    // Below that threshold, fetchElevations() blocks terrain generation entirely
    // (see the coverage check in fetchElevations), so a "synthetic" label is
    // never needed here.
    if (coverage >= 95) return `Real DEM (${coverage.toFixed(0)}% coverage)`;
    return `Real DEM with interpolated gaps (${coverage.toFixed(0)}% real coverage)`;
  }

  // Minimum % of real DEM points required before we will render anything.
  const DEM_MIN_COVERAGE_PCT = 85;
  // % of real DEM points at/above which we label the result as fully "Real DEM"
  // (small gaps still get interpolated, but are not called out in the label).
  const DEM_FULL_COVERAGE_PCT = 95;

  // Fetch a single elevation batch. A real-world 100-point OpenTopoData batch
  // has been measured taking ~40-45s to complete — the previous 26s timeout
  // was aborting valid, in-flight, successful requests before they finished.
  // This timeout is set well above that observed latency.
  async function fetchElevationBatchWithRetry(url, maxAttempts = 2) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 65000);

      try {
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (resp.ok) return resp;

        // Client errors other than "too many requests" won't be fixed by retrying.
        if (resp.status !== 429 && resp.status >= 400 && resp.status < 500) return resp;

        lastError = new Error(`Elevation API returned HTTP ${resp.status}`);
      } catch (e) {
        clearTimeout(timeoutId);
        lastError = e.name === 'AbortError' ? new Error('Elevation request timed out (65s)') : e;
      }

      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 800));
      }
    }

    throw lastError || new Error('Elevation batch request failed');
  }

  // ── Fetch DEM from OpenTopoData, with retry/backoff. No synthetic fallback. ──
  async function fetchElevations(lat, lng, gridKm) {
    const degPerKm = 0.009; // ~1km in degrees
    const half = (gridKm / 2) * degPerKm;
    const step = (gridKm * degPerKm) / GRID_RESOLUTION;

    const points = [];
    for (let gy = 0; gy <= GRID_RESOLUTION; gy++) {
      for (let gx = 0; gx <= GRID_RESOLUTION; gx++) {
        const pLat = lat - half + gy * step;
        const pLng = lng - half + gx * step;
        points.push({ lat: pLat, lng: pLng, gx, gy });
      }
    }

    const elevGrid = new Array((GRID_RESOLUTION + 1) * (GRID_RESOLUTION + 1));
    const realMask = new Array(elevGrid.length).fill(false);
    let realPointCount = 0;

    console.log('PAL-AI terrain DEM request:', {
      lat,
      lng,
      gridKm,
      gridResolution: GRID_RESOLUTION,
      requestedPoints: points.length
    });

    const BATCH_SIZE = 100;
    let consecutiveFailedBatches = 0;
    const MAX_CONSECUTIVE_FAILURES = 3;
    const totalBatches = Math.ceil(points.length / BATCH_SIZE);
    let batchIndex = 0;

    if (typeof showTerrainFetchProgress === 'function') {
      showTerrainFetchProgress({
        phase: 'preparing',
        batchIndex: 1,
        totalBatches,
        completedPoints: 0,
        activePoints: Math.min(BATCH_SIZE, points.length),
        totalPoints: points.length,
        realPointCount: 0,
        detail: 'Preparing the first real-elevation request.'
      });
    }

    for (let start = 0; start < points.length; start += BATCH_SIZE) {
      batchIndex++;
      const batchPoints = points.slice(start, start + BATCH_SIZE);

      // Only completed points count toward the progress value. The translucent
      // segment shows the batch currently being requested without claiming that
      // those points are already finished.
      if (typeof showTerrainFetchProgress === 'function') {
        showTerrainFetchProgress({
          phase: 'fetching',
          batchIndex,
          totalBatches,
          completedPoints: start,
          activePoints: batchPoints.length,
          totalPoints: points.length,
          realPointCount,
          detail: `Requesting ${batchPoints.length} points in the active batch. Cached points may return immediately; online points can take longer.`
        });
      } else if (typeof showTerrainStatus === 'function') {
        showTerrainStatus(
          `⏳ Fetching real elevation data — batch ${batchIndex}/${totalBatches}. ` +
          `${start}/${points.length} grid points processed; ${realPointCount} real DEM points received.`,
          'loading'
        );
      }
      if (typeof updateLoadingProgress === 'function') {
        const fetchPct = Math.round(18 + (batchIndex / totalBatches) * 58);
        updateLoadingProgress(
          fetchPct,
          `Fetching real DEM elevation data...\n` +
          `Batch ${batchIndex} of ${totalBatches}\n` +
          `Real points collected so far: ${realPointCount}/${start}\n` +
          `Large scans may take several minutes because elevation data is requested from OpenTopoData.`
        );
      }

      const batch = batchPoints
        .map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
        .join('|');

      const url = `${TERRAIN_API}/api/elevation-batch?locations=${encodeURIComponent(batch)}`;
      let batchFetchedFromNetwork = false;

      try {
        const resp = await fetchElevationBatchWithRetry(url, 2);

        if (resp.ok) {
          const json = await resp.json();
          batchFetchedFromNetwork = Number(json?.cache?.fetched || 0) > 0;

          if (json.results && json.results.length > 0) {
            let batchRealCount = 0;
            json.results.forEach((r, i) => {
              const p = batchPoints[i];
              const value = Number(r?.elevation);

              if (p && Number.isFinite(value)) {
                const idx = p.gy * (GRID_RESOLUTION + 1) + p.gx;
                elevGrid[idx] = value;
                realMask[idx] = true;
                realPointCount++;
                batchRealCount++;
              }
            });
            consecutiveFailedBatches = batchRealCount > 0 ? 0 : consecutiveFailedBatches + 1;
          } else {
            if (json.error) console.warn('Elevation batch returned an error payload:', json.error);
            consecutiveFailedBatches++;
          }
        } else {
          console.warn(`Elevation batch failed after retries: HTTP ${resp.status}`);
          consecutiveFailedBatches++;
        }
      } catch (e) {
        console.warn('Elevation batch request failed after retries:', e);
        consecutiveFailedBatches++;
      }

      // Fail fast: if the elevation API looks completely unreachable (several
      // batches in a row with zero real points), stop hammering it and let the
      // coverage check below report a clear error instead of taking 20+ minutes
      // to work through every remaining batch.
      if (consecutiveFailedBatches >= MAX_CONSECUTIVE_FAILURES && realPointCount === 0) {
        console.warn('Elevation API appears unreachable — aborting remaining batches early.');
        break;
      }

      const processedPointCount = Math.min(start + batchPoints.length, points.length);
      if (typeof showTerrainFetchProgress === 'function') {
        const hasNextBatch = batchIndex < totalBatches;
        showTerrainFetchProgress({
          phase: hasNextBatch ? 'fetching' : 'complete',
          batchIndex: hasNextBatch ? batchIndex + 1 : batchIndex,
          totalBatches,
          completedPoints: processedPointCount,
          activePoints: hasNextBatch ? Math.min(BATCH_SIZE, points.length - processedPointCount) : 0,
          totalPoints: points.length,
          realPointCount,
          detail: batchFetchedFromNetwork
            ? `Batch ${batchIndex} completed. Missing elevations were fetched online and saved to the local cache.`
            : `Batch ${batchIndex} completed using locally cached elevation data where available.`
        });
      }

      // OpenTopoData's public API allows ~1 request/second, so wait only when
      // this batch actually fetched new points from OpenTopoData. Fully cached
      // local SQLite batches skip the long pacing delay and return much faster.
      if (typeof updateLoadingProgress === 'function') {
        const completedPct = Math.round(22 + (batchIndex / totalBatches) * 58);
        updateLoadingProgress(
          completedPct,
          `Completed elevation batch ${batchIndex}/${totalBatches}.\n` +
          `Real DEM points collected: ${realPointCount}/${Math.min(start + BATCH_SIZE, points.length)}` +
          (batchFetchedFromNetwork ? `\nFetched missing points online and saved them to local cache.` : `\nLoaded from local elevation cache where available.`)
        );
      }
      await new Promise(resolve => setTimeout(resolve, batchFetchedFromNetwork ? 1100 : 60));
    }

    const totalPointCount = points.length;
    const demCoveragePct = totalPointCount ? (realPointCount / totalPointCount) * 100 : 0;

    if (typeof showTerrainFetchProgress === 'function') {
      showTerrainFetchProgress({
        phase: 'validating',
        batchIndex: totalBatches,
        totalBatches,
        completedPoints: totalPointCount,
        activePoints: 0,
        totalPoints: totalPointCount,
        realPointCount,
        detail: `Checking whether real DEM coverage meets the required ${DEM_MIN_COVERAGE_PCT}% threshold.`
      });
    }

    if (typeof updateLoadingProgress === 'function') {
      updateLoadingProgress(
        78,
        `Validating DEM coverage...\n` +
        `Real elevation points: ${realPointCount}/${points.length}\n` +
        `Required minimum real coverage: ${DEM_MIN_COVERAGE_PCT}%`
      );
    }

    console.log('PAL-AI terrain DEM summary:', {
      realPointCount,
      totalPointCount,
      demCoveragePct: demCoveragePct.toFixed(1)
    });

    // Hard gate: never render terrain built mostly from invented data.
    if (demCoveragePct < DEM_MIN_COVERAGE_PCT) {
      throw new Error(
        `Real elevation data coverage is too low. Terrain output was not generated. ` +
        `(${realPointCount}/${totalPointCount} real DEM points, ${demCoveragePct.toFixed(1)}%; ` +
        `${DEM_MIN_COVERAGE_PCT}% required.) This usually means OpenTopoData is rate-limiting ` +
        `or temporarily unreachable — wait a few seconds and try scanning again.`
      );
    }

    // Coverage is high enough to trust interpolation for the remaining gaps.
    // Search the full grid radius so a fill is always found from real neighbors —
    // never invented from scratch.
    let interpolatedCount = 0;

    points.forEach(p => {
      const idx = p.gy * (GRID_RESOLUTION + 1) + p.gx;

      if (Number.isFinite(elevGrid[idx])) return;

      const interpolated = averageNeighborElevation(elevGrid, p.gx, p.gy, GRID_RESOLUTION);

      if (Number.isFinite(interpolated)) {
        elevGrid[idx] = interpolated;
        interpolatedCount++;
      } else {
        // Should be unreachable once coverage >= DEM_MIN_COVERAGE_PCT, but never
        // silently invent terrain — fail loudly instead of guessing.
        throw new Error('Could not interpolate all elevation gaps from real DEM points.');
      }
    });

    const usedAPI = realPointCount > 0;
    const sourceMode = demCoveragePct >= DEM_FULL_COVERAGE_PCT ? 'real-dem' : 'partial-dem-interpolated';

    const minE = Math.min(...elevGrid);
    const maxE = Math.max(...elevGrid);

    if (typeof showTerrainFetchProgress === 'function') {
      showTerrainFetchProgress({
        phase: 'building',
        batchIndex: totalBatches,
        totalBatches,
        completedPoints: totalPointCount,
        activePoints: 0,
        totalPoints: totalPointCount,
        realPointCount,
        detail: `Real DEM coverage: ${demCoveragePct.toFixed(1)}%. Building the 3D surface from the validated grid.`
      });
    }

    if (typeof updateLoadingProgress === 'function') {
      updateLoadingProgress(
        88,
        `DEM validation passed.\n` +
        `Real coverage: ${demCoveragePct.toFixed(1)}%\n` +
        `Interpolated gaps: ${interpolatedCount}\n` +
        `Building 3D terrain surface...`
      );
    }

    console.log('PAL-AI terrain DEM summary (final):', {
      sourceMode,
      realPointCount,
      totalPointCount,
      demCoveragePct: demCoveragePct.toFixed(1),
      interpolatedCount,
      minE: Math.round(minE),
      maxE: Math.round(maxE),
      rangeE: Math.round(maxE - minE)
    });

    return {
      elevGrid,
      usedAPI,
      step,
      half,
      lat,
      lng,
      realPointCount,
      totalPointCount,
      demCoveragePct,
      interpolatedCount,
      syntheticCount: 0,
      fallbackFilledCount: interpolatedCount,
      sourceMode,
      sourceLabel: demSourceLabel({ demCoveragePct })
    };
  }

  // ── Compute slope + aspect ──
  function computeSlopeAspect(elevGrid, step) {
    const N = GRID_RESOLUTION + 1;
    const degPerM = 1 / 111000; // ~1m in degrees
    const slopeGrid = [];
    const aspectGrid = [];

    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        const e = (r, c) => {
          const ri = Math.min(Math.max(r, 0), N - 1);
          const ci = Math.min(Math.max(c, 0), N - 1);
          return elevGrid[ri * N + ci];
        };
        const stepM = step / degPerM;
        const dzdx = (e(gy, gx + 1) - e(gy, gx - 1)) / (2 * stepM);
        const dzdy = (e(gy + 1, gx) - e(gy - 1, gx)) / (2 * stepM);
        const slopeDeg = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * 180 / Math.PI;
        const aspect = (Math.atan2(-dzdy, dzdx) * 180 / Math.PI + 360) % 360;
        slopeGrid.push(slopeDeg);
        aspectGrid.push(aspect);
      }
    }
    return { slopeGrid, aspectGrid };
  }

  function applyDefaultTerrainCamera() {
    if (!camera) return;

    // Default north-up planning view:
    // Terrain coordinates use +X = east and +Z = north. Placing the camera
    // south of the grid (-Z) makes north appear toward the top of the screen,
    // matching the north-up Water Body Analyzer and Leaflet reference map.
    camera.position.set(0, 2.5, -7);
    camera.lookAt(0, 1.2, 0);

    if (controls) {
      controls.target.set(0, 1.2, 0);
      controls.autoRotate = false;
      controls.update();
    }
  }

  function disposeWebGLScene() {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }

    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
      resizeHandler = null;
    }

    if (controls) {
      controls.dispose();
      controls = null;
    }

    if (scene) {
      scene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();

        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(mat => mat.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
    }

    if (renderer) {
      renderer.dispose();
      renderer = null;
    }

    scene = null;
    camera = null;
    mesh = null;
    wireframeMesh = null;
    waterLinesGroup = null;
  }

  function getFreshTerrainCanvas() {
    const oldCanvas = document.getElementById('terrain-canvas');
    if (!oldCanvas) return null;

    // If a WebGL context failed/lost before, the safest recovery is a fresh canvas.
    const freshCanvas = oldCanvas.cloneNode(false);
    freshCanvas.id = 'terrain-canvas';
    freshCanvas.className = oldCanvas.className;
    oldCanvas.parentNode.replaceChild(freshCanvas, oldCanvas);

    return freshCanvas;
  }

  // ── Build Three.js scene ──
  function buildScene(canvas) {
    if (!window.WebGLRenderingContext) {
      throw new Error('WebGL is not supported or is disabled in this browser.');
    }

    // Always use a fresh canvas when creating a new renderer.
    // This avoids reusing a canvas whose WebGL context was lost during previous attempts.
    canvas = getFreshTerrainCanvas() || canvas;

    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 460;

    let newRenderer = null;

    try {
      newRenderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: true,
        powerPreference: 'low-power',
        failIfMajorPerformanceCaveat: false,
        preserveDrawingBuffer: false,
        precision: 'mediump'
      });
    } catch (err) {
      // Do not leave half-created scene state behind.
      renderer = null;
      scene = null;
      camera = null;
      controls = null;

      throw new Error(
        'Error creating WebGL context. Close other heavy tabs, open PAL-AI in a fresh browser tab, then try again. Original error: ' +
        (err && err.message ? err.message : err)
      );
    }

    renderer = newRenderer;
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    // Transparent renderer background so CSS gradient shows through.
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = false;

    scene = new THREE.Scene();

    // Keep scene transparent so the CSS space background behind the canvas remains visible.
    scene.background = null;

    // Dedicated group for the real-geometry water overlay (rivers/streams/lakes).
    // Cleared and rebuilt in rebuildWaterOverlayLines() whenever the terrain
    // surface changes or new water data arrives.
    waterLinesGroup = new THREE.Group();
    scene.add(waterLinesGroup);

    // Dark blue atmospheric fog, but not fully opaque.
    scene.fog = new THREE.FogExp2(0x07111f, 0.012);

    camera = new THREE.PerspectiveCamera(48, w / h, 0.1, 2000);
    camera.position.set(0, 9.5, -28);
    camera.lookAt(0, 1.2, 0);

    canvas.addEventListener('webglcontextlost', function (event) {
      event.preventDefault();
      console.warn('PAL-AI WebGL context lost.');

      if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }

      renderer = null;
    }, false);

    canvas.addEventListener('webglcontextrestored', function () {
      console.warn('PAL-AI WebGL context restored. Re-rendering terrain.');

      renderer = null;
      animationId = null;

      // The main app recovery guard will redraw charts/maps.
      // User can click Generate 3D Terrain again if the actual WebGL mesh needs full rebuilding.
      if (window.schedulePALAIVisualRecovery) {
        window.schedulePALAIVisualRecovery('webgl-restored');
      }
    }, false);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xb8c4d6, 0.5);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1f2a1f, 0.4);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 0.5);
    sunLight.position.set(8, 14, 10);
    sunLight.castShadow = false;
    scene.add(sunLight);

    // Star field background
    const starGeo = new THREE.BufferGeometry();
    const starVerts = [];
    for (let i = 0; i < 350; i++) {
      starVerts.push((Math.random() - 0.5) * 400, (Math.random() * 100), (Math.random() - 0.5) * 400);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starVerts, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, transparent: true, opacity: 0.45 });
    scene.add(new THREE.Points(starGeo, starMat));

    // OrbitControls
    if (!THREE.OrbitControls) {
      console.error("OrbitControls failed to load. Check the Three.js CDN script in index.html.");
    } else {
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0, 0);
      controls.update();

      controls.enabled = true;
      controls.enableDamping = true;
      controls.dampingFactor = 0.06;

      controls.enableRotate = true;
      controls.enablePan = true;
      controls.enableZoom = true;

      controls.screenSpacePanning = true;

      controls.minDistance = 2;
      controls.maxDistance = 120;
      controls.maxPolarAngle = Math.PI / 2.05;

      controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
      };

      controls.touches = {
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN
      };

      renderer.domElement.style.pointerEvents = "auto";

      renderer.domElement.addEventListener("wheel", function (e) {
        e.preventDefault();
      }, { passive: false });
    }

    resizeHandler = () => {
      if (!renderer || !camera) return;

      const canvasNow = document.getElementById('terrain-canvas');
      if (!canvasNow) return;

      const w2 = canvasNow.clientWidth || 800;
      const h2 = canvasNow.clientHeight || 460;

      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
      renderer.setSize(w2, h2, false);
    };

    window.addEventListener('resize', resizeHandler);
  }

  function normalizeWaterOverlayPoint(point) {
    if (!point || typeof point !== 'object') return null;

    const lat = Number(point.lat ?? point.latitude);
    const lon = Number(point.lon ?? point.lng ?? point.longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  }

  function sanitizeWaterOverlayGeometry(geometry) {
    if (!Array.isArray(geometry)) return [];
    return geometry.map(normalizeWaterOverlayPoint).filter(Boolean);
  }

  function extractWaterOverlayGeometries(feature) {
    const geometries = [];
    const main = sanitizeWaterOverlayGeometry(feature?.geometry);
    if (main.length >= 2) geometries.push(main);

    if (Array.isArray(feature?.members)) {
      feature.members.forEach(member => {
        const memberGeom = sanitizeWaterOverlayGeometry(member?.geometry);
        if (memberGeom.length >= 2) geometries.push(memberGeom);
      });
    }

    return geometries;
  }


  // ── Real-geometry water line overlay ──
  // Converts a lat/lng into the exact same fractional grid position used by
  // buildTerrainMesh(), so water lines line up with the mesh underneath them.
  function latLngToTerrainGrid(lat, lng) {
    if (!terrainData || !terrainData.step) return null;

    const gxFloat = (lng - (terrainData.lng - terrainData.half)) / terrainData.step;
    const gyFloat = (lat - (terrainData.lat - terrainData.half)) / terrainData.step;

    return { gxFloat, gyFloat };
  }

  function isWithinTerrainGridBounds(gxFloat, gyFloat) {
    const margin = GRID_RESOLUTION * WATER_LINE_MARGIN_FRACTION;
    return (
      gxFloat >= -margin && gxFloat <= GRID_RESOLUTION + margin &&
      gyFloat >= -margin && gyFloat <= GRID_RESOLUTION + margin
    );
  }

  // Bilinear interpolation of elevation at a fractional grid position.
  function bilinearElevationAt(gxFloat, gyFloat) {
    if (!terrainData || !Array.isArray(terrainData.elevGrid)) return null;

    const N = GRID_RESOLUTION + 1;
    const cgx = Math.max(0, Math.min(GRID_RESOLUTION, gxFloat));
    const cgy = Math.max(0, Math.min(GRID_RESOLUTION, gyFloat));

    const gx0 = Math.floor(cgx);
    const gy0 = Math.floor(cgy);
    const gx1 = Math.min(GRID_RESOLUTION, gx0 + 1);
    const gy1 = Math.min(GRID_RESOLUTION, gy0 + 1);
    const fx = cgx - gx0;
    const fy = cgy - gy0;

    const grid = terrainData.elevGrid;
    const e00 = Number(grid[gy0 * N + gx0]);
    const e10 = Number(grid[gy0 * N + gx1]);
    const e01 = Number(grid[gy1 * N + gx0]);
    const e11 = Number(grid[gy1 * N + gx1]);

    if (![e00, e10, e01, e11].every(Number.isFinite)) return null;

    const top = e00 + (e10 - e00) * fx;
    const bottom = e01 + (e11 - e01) * fx;
    return top + (bottom - top) * fy;
  }

  // Matches the vertical scale buildTerrainMesh() uses for the mesh surface,
  // so water lines sit on (not above/below) the visible terrain.
  function visualHeightForElevation(elevation) {
    if (!terrainData || !Number.isFinite(terrainData.metersPerVerticalUnit) || !Number.isFinite(elevation)) {
      return null;
    }

    const clamp = Number.isFinite(terrainData.vertClamp) ? terrainData.vertClamp : 6;
    const avgE = Number.isFinite(terrainData.meshAvgE) ? terrainData.meshAvgE : terrainData.avgE;
    let y = ((elevation - avgE) / terrainData.metersPerVerticalUnit) * currentExaggeration;
    y = Math.max(-clamp, Math.min(clamp, y));
    return y;
  }

  // True for polygon-style water bodies (lakes/reservoirs/ponds/riverbanks).
  // Mirrors app.js's isWaterAreaFeature() classification.
  function isWaterOverlayAreaFeature(feature) {
    const tags = feature?.tags || {};
    return !!(
      tags.natural === 'water' ||
      tags.water ||
      tags.landuse === 'reservoir' ||
      tags.waterway === 'riverbank'
    );
  }

  // Projects a real water geometry (array of {lat, lon}) into terrain-space
  // THREE.Vector3 points, following the terrain surface height. Points that
  // fall well outside the scanned grid are dropped, breaking the line into
  // separate segments rather than drawing a straight jump across the gap.
  function projectWaterGeometryToSegments(geometry) {
    const segments = [];
    let current = [];

    for (const point of geometry) {
      const g = latLngToTerrainGrid(point.lat, point.lon);

      if (!g || !isWithinTerrainGridBounds(g.gxFloat, g.gyFloat)) {
        if (current.length >= 2) segments.push(current);
        current = [];
        continue;
      }

      const elevation = bilinearElevationAt(g.gxFloat, g.gyFloat);
      const y = visualHeightForElevation(elevation);

      if (!Number.isFinite(y)) {
        if (current.length >= 2) segments.push(current);
        current = [];
        continue;
      }

      // Rotate only the water overlay by 180 degrees in terrain space so it
      // matches the orientation seen in the 2D Water Body Analyzer.
      const x = -((g.gxFloat / GRID_RESOLUTION - 0.5) * TERRAIN_SIZE);
      const z = -((g.gyFloat / GRID_RESOLUTION - 0.5) * TERRAIN_SIZE);

      current.push(new THREE.Vector3(x, y + WATER_LINE_Y_OFFSET, z));
    }

    if (current.length >= 2) segments.push(current);
    return segments;
  }

  function disposeGroupChildren(group) {
    if (!group) return;

    while (group.children.length) {
      const obj = group.children.pop();
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
  }

  // Rebuilds the water line overlay from waterOverlayFeatures using only
  // real geometry returned by the Water Body Analyzer backend. Draws nothing
  // if there is no water data — never invents rivers. Uses tube geometry
  // (real 3D width) rather than flat GL lines, since browsers/GPUs mostly
  // ignore LineBasicMaterial's linewidth and render 1px lines regardless.
  function rebuildWaterOverlayLines() {
    if (!waterLinesGroup) return;

    disposeGroupChildren(waterLinesGroup);

    if (!terrainData || !Array.isArray(waterOverlayFeatures) || !waterOverlayFeatures.length) {
      return;
    }

    // Unlit material so the water overlay reads as a consistent bright blue
    // regardless of scene lighting/mode, making it visible from the default view.
    const lineMaterial = new THREE.MeshBasicMaterial({
      color: WATER_LINE_COLOR,
      transparent: true,
      opacity: 0.95,
      depthTest: true
    });

    let drawnCount = 0;

    for (const feature of waterOverlayFeatures) {
      const geometries = extractWaterOverlayGeometries(feature);
      if (!geometries.length) continue;

      const isArea = isWaterOverlayAreaFeature(feature);
      const radius = isArea ? WATER_AREA_OUTLINE_RADIUS : WATER_LINE_RADIUS;

      for (const geometry of geometries) {
        const segments = projectWaterGeometryToSegments(geometry);

        for (const points of segments) {
          if (points.length < 2) continue;

          // Close polygon-style outlines (lakes/reservoirs) if not already closed.
          if (isArea && points[0].distanceTo(points[points.length - 1]) > 0.001) {
            points.push(points[0].clone());
          }

          const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.15);
          const tubularSegments = Math.max(1, Math.min(200, points.length * 4));
          const tubeGeom = new THREE.TubeGeometry(curve, tubularSegments, radius, 6, false);
          const tube = new THREE.Mesh(tubeGeom, lineMaterial);
          tube.renderOrder = 2;
          waterLinesGroup.add(tube);
          drawnCount++;
        }
      }
    }

    console.log('PAL-AI water overlay lines rendered:', {
      drawnCount,
      featureCount: waterOverlayFeatures.length,
      note: 'Drawn only from real Water Body Analyzer geometry.'
    });
  }

  // ── Build terrain geometry ──
  function buildTerrainMesh(elevGrid, slopeGrid, mode) {
    const N = GRID_RESOLUTION + 1;
    const SIZE = TERRAIN_SIZE;

    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const colors = [];
    const indices = [];

    // Clamp extreme elevation outliers so one bad DEM point does not create huge fake spikes.
    const sortedElev = [...elevGrid].filter(Number.isFinite).sort((a, b) => a - b);
    const p01 = sortedElev[Math.floor(sortedElev.length * 0.01)] ?? 0;
    const p99 = sortedElev[Math.floor(sortedElev.length * 0.99)] ?? 1;
    const safeElevGrid = elevGrid.map(e => Math.min(Math.max(Number(e), p01), p99));

    const minE = Math.min(...safeElevGrid);
    const maxE = Math.max(...safeElevGrid);
    const rangeE = Math.max(1, maxE - minE);
    const avgE = safeElevGrid.reduce((a, b) => a + b, 0) / safeElevGrid.length;
    const maxSlope = Math.max(...slopeGrid) || 1;

    // Adaptive vertical scale:
    // - plains remain subtle
    // - hills become noticeable
    // - mountains rise visibly without impossible spikes
    const targetVisualHeight = rangeE < 12
      ? 1.25
      : rangeE < 60
        ? 3.2
        : rangeE < 250
          ? 5.8
          : 8.5;

    const metersPerVerticalUnit = Math.max(4.5, rangeE / targetVisualHeight);
    const verticalClamp = rangeE < 20 ? 2.4 : rangeE < 120 ? 5.6 : 9.0;

    // Expose the exact vertical scale used for this mesh so the water line
    // overlay (built separately, after the mesh) can match terrain height.
    if (terrainData) {
      terrainData.metersPerVerticalUnit = metersPerVerticalUnit;
      terrainData.vertClamp = verticalClamp;
      // Use the same (outlier-clamped) average the mesh vertices use, not the
      // raw terrainData.avgE, so water line height matches the surface exactly.
      terrainData.meshAvgE = avgE;
    }

    console.log('PAL-AI terrain visual scale:', {
      mode,
      minE: Math.round(minE),
      maxE: Math.round(maxE),
      rangeE: Math.round(rangeE),
      avgE: Math.round(avgE),
      metersPerVerticalUnit: Number(metersPerVerticalUnit.toFixed(2)),
      currentExaggeration
    });

    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        const idx = gy * N + gx;
        const e = safeElevGrid[idx];
        const slope = Number(slopeGrid[idx] || 0);
        const tNorm = (e - minE) / rangeE;

        const x = (gx / GRID_RESOLUTION - 0.5) * SIZE;
        const z = (gy / GRID_RESOLUTION - 0.5) * SIZE;

        let y = ((e - avgE) / metersPerVerticalUnit) * currentExaggeration;
        y = Math.max(-verticalClamp, Math.min(verticalClamp, y));

        positions.push(x, y, z);

        let t;
        if (mode === 'elevation') {
          t = tNorm;
        } else if (mode === 'slope') {
          t = Math.min(slope / 45, 1);
        } else if (mode === 'aspect') {
          t = 0.5;
        } else if (mode === 'soil') {
          // Terrain-derived soil and drainage proxy. This is categorical guidance,
          // not a laboratory or official mapped soil classification.
          if (slope < 2.5 && tNorm < 0.38) t = 0.05;       // high retention / waterlogging tendency
          else if (slope < 6.5) t = 0.36;                 // balanced drainage
          else if (slope < 13) t = 0.69;                  // faster drainage / leaching
          else t = 0.96;                                  // erosion and shallow-soil risk
        } else if (mode === 'yield' || mode === 'suitability') {
          let slopeScore;
          if (slope < 3) slopeScore = 1.0;
          else if (slope < 8) slopeScore = 0.72;
          else if (slope < 15) slopeScore = 0.42;
          else slopeScore = 0.12;

          const elevationScore = 1 - Math.min(tNorm * 1.25, 1);
          t = Math.max(0, Math.min(1, slopeScore * 0.72 + elevationScore * 0.28));
        } else {
          t = tNorm;
        }

        const c = lerpColor(COLOR_MAPS[mode] || COLOR_MAPS.elevation, t);

        colors.push(c.r, c.g, c.b);
      }
    }

    for (let gy = 0; gy < GRID_RESOLUTION; gy++) {
      for (let gx = 0; gx < GRID_RESOLUTION; gx++) {
        const a = gy * N + gx;
        const b = gy * N + gx + 1;
        const c = (gy + 1) * N + gx;
        const d = (gy + 1) * N + gx + 1;
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide
    });

    return new THREE.Mesh(geometry, material);
  }

  function disposeMeshObject(obj) {
    if (!obj) return;
    if (scene) scene.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  }

  function createWireframeMeshFromCurrentGeometry() {
    if (!mesh) return null;

    const wfMat = new THREE.MeshBasicMaterial({
      color: 0xd9f99d,
      wireframe: true,
      transparent: true,
      opacity: isWireframe ? 0.55 : 0.0,
      depthTest: false
    });

    return new THREE.Mesh(mesh.geometry.clone(), wfMat);
  }

  function rebuildTerrainSurface(mode = currentMode) {
    if (!scene || !terrainData) return;

    currentMode = mode;

    disposeMeshObject(mesh);
    disposeMeshObject(wireframeMesh);

    mesh = buildTerrainMesh(terrainData.elevGrid, terrainData.slopeGrid, mode);
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    scene.add(mesh);

    wireframeMesh = createWireframeMeshFromCurrentGeometry();
    if (wireframeMesh) scene.add(wireframeMesh);

    // Rebuild the real-geometry water lines to match the freshly built mesh
    // (height scale, exaggeration, and current waterOverlayFeatures).
    rebuildWaterOverlayLines();

    updateTerrainOverlayInfo();
  }

  function updateTerrainOverlayInfo() {
    if (!terrainData) return;

    const avgSlope = terrainData.slopeGrid.reduce((a, b) => a + b, 0) / terrainData.slopeGrid.length;
    const aspectNames = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const avgAspect = terrainData.aspectGrid.reduce((a, b) => a + b, 0) / terrainData.aspectGrid.length;
    const range = terrainData.maxE - terrainData.minE;

    const elevEl = document.getElementById('toi-elev');
    const slopeEl = document.getElementById('toi-slope');
    const aspectEl = document.getElementById('toi-aspect');
    const rangeEl = document.getElementById('toi-range');
    const sourceEl = document.getElementById('toi-source');
    const waterEl = document.getElementById('toi-water');

    if (elevEl) elevEl.textContent = `Elevation: ${Math.round(terrainData.avgE)}m avg`;
    if (slopeEl) slopeEl.textContent = `Slope: ${avgSlope.toFixed(1)}° avg`;
    if (aspectEl) aspectEl.textContent = `Aspect: ${aspectNames[Math.round(avgAspect / 45) % 8]}`;
    if (rangeEl) rangeEl.textContent = `Range: ${Math.round(terrainData.minE)}–${Math.round(terrainData.maxE)}m (${Math.round(range)}m)`;
    if (sourceEl) sourceEl.textContent = `DEM Source: ${terrainData.sourceLabel}`;
    if (waterEl) {
      waterEl.textContent = terrainData.waterFeatureCount > 0
        ? `🔵 Mapped water bodies: ${terrainData.waterFeatureCount} feature(s) shown as blue overlay`
        : 'Water overlay: none detected yet';
    }
  }

  function setWaterFeatures(waterBodies = []) {
    waterOverlayFeatures = Array.isArray(waterBodies) ? waterBodies : [];
    waterOverlayRevision += 1;

    if (!terrainData || !scene) return;

    terrainData.waterFeatureCount = waterOverlayFeatures.length;
    terrainData.waterOverlayRevision = waterOverlayRevision;

    console.log('PAL-AI terrain water overlay updated:', {
      waterFeatureCount: waterOverlayFeatures.length,
      note: 'Visual water overlay only; not measured bathymetry.'
    });

    rebuildTerrainSurface(currentMode);
    renderOnce();
  }

  // ── Public API ──
  async function init(lat, lng, gridKm, mode) {
    currentMode = mode;
    const canvas = document.getElementById('terrain-canvas');
    const placeholder = document.getElementById('terrain-placeholder');
    if (!canvas) return;

    placeholder.style.display = 'none';

    if (!scene || !renderer || !camera) {
      buildScene(canvas);
    }

    // Clear old terrain and any water overlay from the previous run.
    disposeMeshObject(mesh);
    disposeMeshObject(wireframeMesh);
    mesh = null;
    wireframeMesh = null;
    waterOverlayFeatures = [];
    waterOverlayRevision += 1;

    // Fetch elevation data.
    const result = await fetchElevations(lat, lng, gridKm);
    const { elevGrid, slopeGrid, aspectGrid } = { ...result, ...computeSlopeAspect(result.elevGrid, result.step) };

    const minE = Math.min(...elevGrid);
    const maxE = Math.max(...elevGrid);
    const avgE = elevGrid.reduce((a, b) => a + b, 0) / elevGrid.length;

    terrainData = {
      elevGrid,
      slopeGrid,
      aspectGrid,
      lat,
      lng,
      gridKm,
      step: result.step,
      half: result.half,
      gridResolution: GRID_RESOLUTION,
      minE,
      maxE,
      avgE,
      elevRange: maxE - minE,
      usedAPI: result.usedAPI,
      realPointCount: result.realPointCount,
      totalPointCount: result.totalPointCount,
      demCoveragePct: result.demCoveragePct,
      interpolatedCount: result.interpolatedCount,
      syntheticCount: result.syntheticCount,
      fallbackFilledCount: result.fallbackFilledCount,
      sourceMode: result.sourceMode,
      sourceLabel: result.sourceLabel,
      waterFeatureCount: 0,
      waterOverlayRevision
    };

    updateLegend(mode);
    rebuildTerrainSurface(mode);
    applyDefaultTerrainCamera();

    console.log('PAL-AI terrain mesh added:', {
      vertices: mesh?.geometry?.attributes?.position?.count,
      sceneChildren: scene.children.length,
      meshVisible: mesh?.visible,
      demSource: terrainData.sourceLabel,
      minE: Math.round(minE),
      maxE: Math.round(maxE),
      rangeE: Math.round(maxE - minE)
    });

    // Force camera to frame the terrain after mesh creation.
    camera.position.set(0, 13, -24);
    camera.lookAt(0, 0, 0);

    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }


    // Start animation
    if (!animationId) animate();

    return terrainData;
  }

  function animate() {
    if (isRendererPaused || document.hidden) {
      animationId = null;
      return;
    }

    // Stop safely if WebGL objects were reset or failed.
    if (!renderer || !scene || !camera) {
      animationId = null;
      return;
    }

    animationId = requestAnimationFrame(animate);

    try {
      if (controls) controls.update();

      if (controls) {
        controls.autoRotate = !!isAnimating;
        controls.autoRotateSpeed = 0.5;
      }

      // Update compass using screen-projected true north (+Z in terrain space).
      if (camera && controls && typeof THREE !== 'undefined') {
        const compassArrow = document.getElementById('terrain-compass-arrow');
        if (compassArrow) {
          const target = controls.target.clone();
          const northPoint = target.clone().add(new THREE.Vector3(0, 0, 1));
          const projectedTarget = target.clone().project(camera);
          const projectedNorth = northPoint.project(camera);
          const dx = projectedNorth.x - projectedTarget.x;
          const dy = projectedNorth.y - projectedTarget.y;
          const angle = Math.atan2(dx, -dy) * 180 / Math.PI;
          compassArrow.style.transform = `rotate(${Number.isFinite(angle) ? angle : 0}deg)`;
        }
      }

      renderer.render(scene, camera);
    } catch (err) {
      console.warn('Terrain render paused after renderer error:', err);
      animationId = null;
    }
  }

  function renderOnce() {
    if (!renderer || !scene || !camera) return;

    try {
      if (controls) controls.update();
      renderer.render(scene, camera);
    } catch (err) {
      console.warn('Terrain renderOnce failed:', err);
    }
  }

  function pauseRenderer() {
    isRendererPaused = true;

    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }

  function resumeRenderer() {
    if (!renderer || !scene || !camera) return;

    isRendererPaused = false;
    renderOnce();

    if (!animationId) {
      animate();
    }
  }

  function resetCamera() {
    applyDefaultTerrainCamera();
  }

  function toggleWireframe() {
    if (!wireframeMesh) return;
    isWireframe = !isWireframe;
    wireframeMesh.material.opacity = isWireframe ? 0.55 : 0.0;
  }

  function toggleExaggeration() {
    if (!mesh || !terrainData) return;
    isExaggerated = !isExaggerated;
    currentExaggeration = isExaggerated ? EXAGGERATION : BASE_EXAGGERATION;
    rebuildTerrainSurface(currentMode);
    renderOnce();
  }

  function toggleAnimation() {
    isAnimating = !isAnimating;
  }

  function updateMode(mode) {
    if (!terrainData) return;
    currentMode = mode;
    rebuildTerrainSurface(mode);
    updateLegend(mode);
    renderOnce();
  }

  function updateLegend(mode) {
    const legends = {
      suitability: 'Planting Suitability',
      yield: 'Planting Suitability',
      elevation: 'Elevation (m)',
      slope: 'Slope (0° – 45°+)',
      aspect: 'Aspect (N/E/S/W)',
      soil: 'Soil & Drainage Proxy'
    };

    const title = document.querySelector('.tl-title');
    const bar = document.querySelector('.tl-bar');
    const min = document.getElementById('tl-min');
    const max = document.getElementById('tl-max');

    if (title) title.textContent = legends[mode] || 'Planting Suitability';

    if (!bar) return;

    if (mode === 'suitability' || mode === 'yield') {
      bar.style.background = 'linear-gradient(to right, #c84a3f, #d08a3d, #c8b54a, #8fba52, #3b9957)';
      if (min) min.textContent = 'Poor';
      if (max) max.textContent = 'Best';
    } else if (mode === 'slope') {
      bar.style.background = 'linear-gradient(to right, #466b4b, #77743a, #7a5630, #5b2525)';
      if (min) min.textContent = 'Flat';
      if (max) max.textContent = 'Steep';
    } else if (mode === 'aspect') {
      bar.style.background = 'linear-gradient(to right, #744040, #80773a, #35636f, #4a3b72, #744040)';
      if (min) min.textContent = 'N';
      if (max) max.textContent = 'N';
    } else if (mode === 'soil') {
      bar.style.background = 'linear-gradient(to right, #2875ad 0 24%, #339f61 24% 50%, #e0b837 50% 74%, #d14f2e 74% 100%)';
      if (min) min.textContent = 'Waterlog';
      if (max) max.textContent = 'Erosion';
    } else {
      bar.style.background = 'linear-gradient(to right,#1e3a5f,#2f6f8f,#466b4b,#77743a,#7a5630,#d1d5db)';
      if (terrainData) {
        if (min) min.textContent = Math.round(terrainData.minE) + 'm';
        if (max) max.textContent = Math.round(terrainData.maxE) + 'm';
      }
    }
  }


  function normalizeDirectSoilEvidence(input = {}) {
    const texture = String(input.texture || '').trim();
    const rawPH = input.pH;
    const rawOrganicMatter = input.organicMatter;
    const pH = rawPH === null || rawPH === undefined || rawPH === '' ? NaN : Number(rawPH);
    const organicMatter = rawOrganicMatter === null || rawOrganicMatter === undefined || rawOrganicMatter === ''
      ? NaN
      : Number(rawOrganicMatter);
    const drainage = String(input.drainage || '').trim();
    const source = ['laboratory', 'map', 'field', 'terrain'].includes(input.source) ? input.source : 'terrain';
    return {
      texture: texture && texture.toLowerCase() !== 'unknown' ? texture : '',
      pH: Number.isFinite(pH) && pH >= 3.5 && pH <= 9.5 ? pH : null,
      organicMatter: Number.isFinite(organicMatter) && organicMatter >= 0 && organicMatter <= 20 ? organicMatter : null,
      drainage: drainage && drainage.toLowerCase() !== 'unknown' ? drainage : '',
      source,
      testDate: String(input.testDate || '').trim(),
      cropType: String(input.cropType || 'inbred').trim() || 'inbred'
    };
  }

  function getSoilEvidenceMetadata(evidence, hasDirectEvidence) {
    if (!hasDirectEvidence) {
      return {
        sourceLabel: 'PAL-AI terrain inference',
        confidence: 'Low to Moderate',
        confidenceScore: 45
      };
    }
    if (evidence.source === 'laboratory') {
      return { sourceLabel: 'Laboratory soil test + terrain context', confidence: 'High', confidenceScore: 90 };
    }
    if (evidence.source === 'map') {
      return { sourceLabel: 'Official/published soil map + terrain context', confidence: 'Moderate to High', confidenceScore: 76 };
    }
    if (evidence.source === 'field') {
      return { sourceLabel: 'Farmer/field observation + terrain context', confidence: 'Moderate', confidenceScore: 63 };
    }
    return { sourceLabel: 'User-entered values + terrain context', confidence: 'Moderate', confidenceScore: 60 };
  }

  function getWaterRetentionClass(texture) {
    const t = String(texture || '').toLowerCase();
    const hasClay = t.includes('clay');
    const hasSand = t.includes('sand');
    if (hasClay && hasSand) return 'Variable / Moderate to High';
    if (hasClay || t.includes('silty clay')) return 'High';
    if (t.includes('loam')) return 'Moderate to High';
    if (hasSand || t.includes('rock') || t.includes('gravel')) return 'Low';
    return 'Moderate';
  }

  function getDrainageClass(score) {
    const value = Number(score || 0);
    if (value >= 82) return 'Good';
    if (value >= 65) return 'Moderate';
    if (value >= 48) return 'Slow';
    return 'Poor';
  }

  function buildSoilInterpretation(profile) {
    const texture = String(profile.soilTexture || '').toLowerCase();
    const drainage = String(profile.effectiveDrainage || '').toLowerCase();
    const hasMeasuredPH = profile.measuredPH !== null && profile.measuredPH !== undefined && profile.measuredPH !== '';
    const pH = hasMeasuredPH ? Number(profile.measuredPH) : NaN;
    const limitations = [];
    const recommendations = [];
    const mixedSandClay = texture.includes('sand') && texture.includes('clay');

    if (mixedSandClay && !profile.hasDirectEvidence) {
      limitations.push('The terrain model indicates a broad sandy-loam-to-clay range; exact field texture remains uncertain.');
      recommendations.push('Confirm texture with a field ribbon test or laboratory particle-size analysis before final water and fertilizer planning.');
    } else if (texture.includes('clay')) {
      limitations.push('Compaction and prolonged saturation may restrict root aeration when the field remains excessively wet.');
      recommendations.push('Use controlled drainage and avoid heavy field traffic while the soil is saturated.');
      recommendations.push('Incorporate rice straw compost or other mature organic matter to improve aggregation.');
    } else if (texture.includes('sand') || texture.includes('rock') || texture.includes('gravel')) {
      limitations.push('Low water and nutrient retention can increase drought stress and fertilizer leaching.');
      recommendations.push('Use smaller, split fertilizer applications and more frequent irrigation where water is available.');
      recommendations.push('Increase stable organic matter to improve water-holding and nutrient-retention capacity.');
    } else {
      limitations.push('Soil structure and nutrient status remain uncertain without direct field or laboratory measurements.');
      recommendations.push('Maintain organic residues and inspect soil structure before final land preparation.');
    }

    if (drainage.includes('poor') || drainage.includes('waterlog') || drainage.includes('slow')) {
      limitations.push('Slow drainage or waterlogging may increase seedling stress and root disease risk.');
      recommendations.push('Maintain functional field drains and avoid continuous deep flooding during establishment.');
    }
    if (drainage.includes('rapid')) {
      limitations.push('Rapid drainage and runoff may reduce irrigation efficiency and nutrient retention.');
      recommendations.push('Use contour-aligned field layout, bund maintenance, and split nutrient applications.');
    }
    if (profile.avgSlope > 8) {
      limitations.push('Slope increases erosion and surface nutrient-loss risk.');
      recommendations.push('Use contour farming, vegetative strips, or terracing where appropriate.');
    }
    if (Number.isFinite(pH)) {
      if (pH < 5.5) {
        limitations.push('Measured acidity may reduce phosphorus availability and increase aluminum-related stress.');
        recommendations.push('Confirm lime requirement through a laboratory recommendation before applying dolomite or lime.');
      } else if (pH > 7.2) {
        limitations.push('Alkaline conditions may reduce zinc and micronutrient availability.');
        recommendations.push('Verify zinc status and avoid unnecessary liming.');
      }
    } else {
      recommendations.push('Obtain a laboratory pH and nutrient test before deciding exact fertilizer or lime rates.');
    }

    if (Number.isFinite(profile.organicMatter)) {
      if (profile.organicMatter < 2) {
        limitations.push('Entered organic matter is low, which can limit structure, nutrient buffering, and water retention.');
        recommendations.push('Increase decomposed organic inputs gradually and monitor soil response.');
      } else if (profile.organicMatter >= 3.5) {
        recommendations.push('Maintain the existing organic-matter level through residue recycling and balanced nutrient management.');
      }
    }

    const unique = values => [...new Set(values)].slice(0, 5);
    return { limitations: unique(limitations), recommendations: unique(recommendations) };
  }

  function estimateRiceSoilSuitability(profile) {
    const texture = String(profile.soilTexture || '').toLowerCase();
    const drainage = String(profile.effectiveDrainage || '').toLowerCase();
    const cropType = String(profile.cropType || 'inbred');
    let score = 68;

    if (texture.includes('clay') || texture.includes('clay loam') || texture.includes('silty clay')) score += 16;
    else if (texture.includes('loam')) score += 10;
    else if (texture.includes('sand') || texture.includes('rock') || texture.includes('gravel')) score -= 16;

    if (drainage.includes('moderate') || drainage.includes('slow')) score += cropType === 'upland' ? -3 : 8;
    if (drainage.includes('poor') || drainage.includes('waterlog')) score -= 8;
    if (drainage.includes('rapid')) score += cropType === 'upland' ? 6 : -10;
    if (profile.avgSlope > 12) score -= 18;
    else if (profile.avgSlope > 7) score -= 8;

    const hasMeasuredPH = profile.measuredPH !== null && profile.measuredPH !== undefined && profile.measuredPH !== '';
    const pH = hasMeasuredPH ? Number(profile.measuredPH) : NaN;
    if (Number.isFinite(pH)) {
      if (pH >= 5.5 && pH <= 7.0) score += 8;
      else if (pH < 4.8 || pH > 7.8) score -= 12;
      else score -= 4;
    }

    score = Math.max(10, Math.min(100, Math.round(score)));
    return {
      score,
      label: score >= 82 ? 'Highly Suitable' : score >= 68 ? 'Suitable' : score >= 52 ? 'Moderately Suitable' : 'Conditionally Suitable'
    };
  }

  // ── Scoring Mathematics ──
  function computeScores(data, directSoilInput = {}) {
    const { elevGrid, slopeGrid, aspectGrid, minE, maxE, avgE } = data;
    const N = elevGrid.length;

    // --- Slope scoring ---
    const avgSlope = slopeGrid.reduce((a, b) => a + b, 0) / N;
    const flatFraction = slopeGrid.filter(s => s < 3).length / N;  // < 3° is ideal
    const mildFraction = slopeGrid.filter(s => s >= 3 && s < 8).length / N;
    const steepFraction = slopeGrid.filter(s => s >= 15).length / N;

    // Slope score: flat is best for paddy rice, max penalty at >15°
    let slopeScore = 100;
    if (avgSlope > 2) slopeScore -= Math.min(50, (avgSlope - 2) * 4);
    slopeScore -= steepFraction * 30;
    slopeScore = Math.max(0, Math.min(100, slopeScore));

    // --- Elevation scoring ---
    // Rice optimal: 0–600m, degrades above 1000m
    let elevScore = 100;
    if (avgE > 600) elevScore -= Math.min(50, (avgE - 600) / 20);
    if (avgE > 1000) elevScore -= Math.min(30, (avgE - 1000) / 25);
    elevScore = Math.max(0, Math.min(100, elevScore));

    // --- Aspect scoring ---
    // SE/S facing is best for sun exposure in PH
    const idealAspects = aspectGrid.filter(a => a >= 100 && a <= 220).length / N;
    const aspectScore = 50 + idealAspects * 50;

    // --- Drainage (from elevation range + slope) ---
    const elevRange = maxE - minE;
    let drainageScore = 100;
    if (flatFraction > 0.7) drainageScore -= 20; // too flat = waterlogging risk
    if (avgSlope > 10) drainageScore -= 15; // too steep = erosion risk
    drainageScore = Math.max(30, Math.min(100, drainageScore));

    // --- Topography composite score ---
    const topoScore = Math.round(
      slopeScore * 0.40 +
      elevScore * 0.30 +
      aspectScore * 0.15 +
      drainageScore * 0.15
    );

    // --- Soil inference and evidence reconciliation ---
    // The probable soil group remains a terrain-position estimate. Direct user
    // information can improve texture, pH, organic matter, and drainage evidence,
    // but never converts terrain inference into a laboratory-confirmed soil group.
    let inferredSoilGroup, inferredFertility, inferredPH, inferredTexture;
    if (avgE < 50 && avgSlope < 3) {
      inferredSoilGroup = "Hydric Paddy Soil (Aquic)";
      inferredFertility = "High"; inferredPH = "5.5 – 6.5"; inferredTexture = "Clay / Clay Loam";
    } else if (avgE < 200 && avgSlope < 5) {
      inferredSoilGroup = "Alluvial / Fluvisol";
      inferredFertility = "High"; inferredPH = "5.8 – 7.0"; inferredTexture = "Sandy Loam to Clay";
    } else if (avgE < 500 && avgSlope < 10) {
      inferredSoilGroup = "Cambisol / Inceptisol";
      inferredFertility = "Moderate"; inferredPH = "5.0 – 6.5"; inferredTexture = "Loam to Clay Loam";
    } else if (avgE < 1000) {
      inferredSoilGroup = "Oxisol / Ultisol (Upland)";
      inferredFertility = "Low"; inferredPH = "4.5 – 5.5"; inferredTexture = "Clay (Weathered)";
    } else {
      inferredSoilGroup = "Entisol / Lithosol (Highland)";
      inferredFertility = "Very Low"; inferredPH = "4.2 – 5.0"; inferredTexture = "Rocky / Sandy";
    }

    const soilEvidence = normalizeDirectSoilEvidence(directSoilInput);
    const hasDirectEvidence = Boolean(
      soilEvidence.texture || soilEvidence.pH !== null || soilEvidence.organicMatter !== null || soilEvidence.drainage
    );
    const evidenceMeta = getSoilEvidenceMetadata(soilEvidence, hasDirectEvidence);
    const resolvedTexture = soilEvidence.texture || inferredTexture;
    const effectiveDrainage = soilEvidence.drainage || getDrainageClass(drainageScore);
    const soilPHDisplay = soilEvidence.pH !== null ? soilEvidence.pH.toFixed(1) : inferredPH;
    const waterRetention = getWaterRetentionClass(resolvedTexture);
    const resolvedFertility = soilEvidence.organicMatter !== null
      ? (soilEvidence.organicMatter >= 3.5 ? 'High' : soilEvidence.organicMatter >= 2 ? 'Moderate' : 'Low')
      : inferredFertility;
    const soilProfileBase = {
      soilType: inferredSoilGroup,
      soilGroup: inferredSoilGroup,
      soilFertility: resolvedFertility,
      inferredFertility,
      soilpH: soilPHDisplay,
      inferredPH,
      measuredPH: soilEvidence.pH,
      soilTexture: resolvedTexture,
      inferredTexture,
      textureSource: soilEvidence.texture ? evidenceMeta.sourceLabel : 'PAL-AI terrain inference',
      drainageScore,
      terrainDrainageClass: getDrainageClass(drainageScore),
      observedDrainage: soilEvidence.drainage || '',
      effectiveDrainage,
      waterRetention,
      organicMatter: soilEvidence.organicMatter,
      source: soilEvidence.source,
      sourceLabel: evidenceMeta.sourceLabel,
      confidence: evidenceMeta.confidence,
      confidenceScore: evidenceMeta.confidenceScore,
      testDate: soilEvidence.testDate,
      hasDirectEvidence,
      cropType: soilEvidence.cropType,
      avgSlope
    };
    const riceSuitability = estimateRiceSoilSuitability(soilProfileBase);
    const interpretation = buildSoilInterpretation(soilProfileBase);
    const soilProfile = {
      ...soilProfileBase,
      riceSuitabilityScore: riceSuitability.score,
      riceSuitability: riceSuitability.label,
      limitations: interpretation.limitations,
      recommendations: interpretation.recommendations
    };

    // --- Irrigation potential ---
    const elevVariance = elevGrid.reduce((sum, e) => sum + Math.pow(e - avgE, 2), 0) / N;
    const elevStdDev = Math.sqrt(elevVariance);
    let irrigationScore = 100;
    if (avgSlope > 5) irrigationScore -= Math.min(40, avgSlope * 3);
    if (avgE > 800) irrigationScore -= 30;
    if (flatFraction < 0.3) irrigationScore -= 20;
    irrigationScore = Math.max(10, Math.min(100, irrigationScore));

    const irrigationType = irrigationScore > 75 ? "Gravity-fed ideal" :
      irrigationScore > 50 ? "Pump irrigation viable" :
        irrigationScore > 30 ? "Difficult — rainfed only" : "Not recommended";

    // --- Yield impact calculation ---
    // Mathematical modifier: how much terrain affects yield vs ideal flat paddy
    // Based on slope penalty function from IRRI slope-yield research
    const slopeModifier = Math.exp(-0.035 * avgSlope);
    const elevationModifier = avgE < 600 ? 1.0 : Math.exp(-0.001 * (avgE - 600));
    const aspectModifier = 0.88 + (idealAspects * 0.12);
    const drainageModifier = drainageScore / 100 * 0.2 + 0.8;

    const overallModifier = slopeModifier * elevationModifier * aspectModifier * drainageModifier;
    const yieldImpactScore = Math.round(overallModifier * 100);

    return {
      topoScore,
      yieldImpactScore,
      overallModifier: overallModifier.toFixed(3),
      details: {
        elevation: {
          avgE,
          minE: data.minE,
          maxE: data.maxE,
          elevRange,
          elevScore,
          demSourceLabel: data.sourceLabel || (data.usedAPI ? 'Real DEM' : 'Unknown DEM source'),
          demCoveragePct: data.demCoveragePct || 0,
          fallbackFilledCount: data.fallbackFilledCount || 0
        },
        slope: { avgSlope, flatFraction, steepFraction, mildFraction, slopeScore },
        soil: soilProfile,
        irrigation: { irrigationScore, irrigationType, elevVariance: elevStdDev.toFixed(1) }
      }
    };
  }

  // ── Profile chart data ──
  function getCrossSection() {
    if (!terrainData) return [];
    const { elevGrid } = terrainData;
    const N = GRID_RESOLUTION + 1;
    const midRow = Math.floor(N / 2);
    return Array.from({ length: N }, (_, gx) => elevGrid[midRow * N + gx]);
  }

  return {
    init,
    resetCamera,
    toggleWireframe,
    toggleExaggeration,
    toggleAnimation,
    updateMode,
    setWaterFeatures,
    computeScores,
    getCrossSection,
    disposeWebGLScene,
    pauseRenderer,
    resumeRenderer,
    renderOnce,
    getData: () => terrainData
  };
})();

// Expose Terrain on window so app.js recovery guards can call it reliably.
window.Terrain = Terrain;
