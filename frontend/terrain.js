// terrain.js — PAL-AI 3D Terrain Analysis Module
// Uses Three.js for 3D rendering + OpenTopoData API for elevation

const Terrain = (() => {
  const TERRAIN_API =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://localhost:8000'
      : 'https://pal-ai-1.onrender.com';
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

  const GRID_RESOLUTION = 45;
  const TERRAIN_SIZE = 18;

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

  // ── Generate synthetic DEM using multi-octave, coordinate-seeded relief ──
  // This is not real DEM. It is used only as a last-resort visual backup when
  // OpenTopoData/SRTM does not return usable elevation values.
  function syntheticElevation(lat, lng, gridX, gridY, gridSize) {
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

    if (coverage >= 95) return `Real SRTM DEM (${coverage.toFixed(0)}% coverage)`;
    if (coverage > 0) return `Partial SRTM DEM + interpolated fallback (${coverage.toFixed(0)}% real coverage)`;
    return 'Synthetic fallback terrain only';
  }

  // ── Fetch DEM from OpenTopoData (or fall back to synthetic) ──
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

    try {
      const BATCH_SIZE = 100;

      for (let start = 0; start < points.length; start += BATCH_SIZE) {
        const batchPoints = points.slice(start, start + BATCH_SIZE);

        const batch = batchPoints
          .map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
          .join('|');

        const url = `${TERRAIN_API}/api/elevation-batch?locations=${encodeURIComponent(batch)}`;

        const resp = await Promise.race([
          fetch(url),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000))
        ]);

        if (resp.ok) {
          const json = await resp.json();

          if (json.results && json.results.length > 0) {
            json.results.forEach((r, i) => {
              const p = batchPoints[i];
              const value = Number(r?.elevation);

              if (p && Number.isFinite(value)) {
                const idx = p.gy * (GRID_RESOLUTION + 1) + p.gx;
                elevGrid[idx] = value;
                realMask[idx] = true;
                realPointCount++;
              }
            });
          }
        }

        // Avoid hammering the free elevation API.
        await new Promise(resolve => setTimeout(resolve, 60));
      }
    } catch (e) {
      console.warn('OpenTopoData failed or timed out. Filling missing points with interpolation/fallback.', e);
    }

    let interpolatedCount = 0;
    let syntheticCount = 0;

    points.forEach(p => {
      const idx = p.gy * (GRID_RESOLUTION + 1) + p.gx;

      if (elevGrid[idx] !== undefined && elevGrid[idx] !== null && Number.isFinite(elevGrid[idx])) return;

      const interpolated = realPointCount > 0
        ? averageNeighborElevation(elevGrid, p.gx, p.gy, 7)
        : null;

      if (Number.isFinite(interpolated)) {
        elevGrid[idx] = interpolated;
        interpolatedCount++;
      } else {
        elevGrid[idx] = syntheticElevation(lat, lng, p.gx, p.gy, gridKm);
        syntheticCount++;
      }
    });

    const totalPointCount = points.length;
    const demCoveragePct = totalPointCount ? (realPointCount / totalPointCount) * 100 : 0;
    const usedAPI = realPointCount > 0;
    const sourceMode = demCoveragePct >= 95
      ? 'real-dem'
      : demCoveragePct > 0
        ? 'partial-dem'
        : 'synthetic-fallback';

    const minE = Math.min(...elevGrid);
    const maxE = Math.max(...elevGrid);

    console.log('PAL-AI terrain DEM summary:', {
      sourceMode,
      realPointCount,
      totalPointCount,
      demCoveragePct: demCoveragePct.toFixed(1),
      interpolatedCount,
      syntheticCount,
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
      syntheticCount,
      fallbackFilledCount: interpolatedCount + syntheticCount,
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

    // Default cinematic planning view:
    // x = left/right, y = height, z = zoom distance
    camera.position.set(0, 2.5, 7);
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

    // Dark blue atmospheric fog, but not fully opaque.
    scene.fog = new THREE.FogExp2(0x07111f, 0.012);

    camera = new THREE.PerspectiveCamera(48, w / h, 0.1, 2000);
    camera.position.set(0, 9.5, 28);
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

  function waterOverlayIntensity(feature) {
    const tags = feature?.tags || {};
    const pointCount = Array.isArray(feature?.geometry) ? feature.geometry.length : 0;

    if (tags.water === 'lake' || tags.natural === 'water' || tags.landuse === 'reservoir') return Math.min(1, 0.72 + pointCount / 260);
    if (tags.waterway === 'river' || tags.waterway === 'riverbank') return 0.82;
    if (tags.waterway === 'stream') return 0.46;
    if (tags.waterway === 'canal' || tags.waterway === 'drain' || tags.waterway === 'ditch') return 0.38;
    return Math.min(0.72, 0.35 + pointCount / 300);
  }

  function waterOverlayRadiusKm(feature, gridKm) {
    const tags = feature?.tags || {};
    const scale = Math.max(0.65, Math.min(1.35, Number(gridKm || 5) / 5));

    if (tags.water === 'lake' || tags.natural === 'water' || tags.landuse === 'reservoir') return 0.18 * scale;
    if (tags.waterway === 'river' || tags.waterway === 'riverbank') return 0.12 * scale;
    if (tags.waterway === 'stream') return 0.07 * scale;
    if (tags.waterway === 'canal' || tags.waterway === 'drain' || tags.waterway === 'ditch') return 0.06 * scale;
    return 0.08 * scale;
  }

  function approxDistanceKm(lat1, lng1, lat2, lng2) {
    const kmLat = (lat2 - lat1) * 111.32;
    const midLat = ((lat1 + lat2) / 2) * Math.PI / 180;
    const kmLng = (lng2 - lng1) * 111.32 * Math.cos(midLat);
    return Math.hypot(kmLat, kmLng);
  }

  function buildWaterOverlaySamples() {
    if (!terrainData || !Array.isArray(waterOverlayFeatures) || !waterOverlayFeatures.length) return [];

    const samples = [];
    const maxSamples = 850;

    for (const feature of waterOverlayFeatures) {
      const geometries = extractWaterOverlayGeometries(feature);
      if (!geometries.length) continue;

      const intensity = waterOverlayIntensity(feature);
      const radiusKm = waterOverlayRadiusKm(feature, terrainData.gridKm);

      for (const geometry of geometries.slice(0, 24)) {
        const step = Math.max(1, Math.ceil(geometry.length / 85));

        for (let i = 0; i < geometry.length; i += step) {
          const point = geometry[i];
          samples.push({ lat: point.lat, lon: point.lon, intensity, radiusKm });
          if (samples.length >= maxSamples) return samples;
        }
      }
    }

    return samples;
  }

  function waterInfluenceAtPoint(pLat, pLng, elevation, minE, rangeE, slope, waterSamples) {
    let influence = 0;

    // Sea/coastal visual proxy: DEM water surfaces are usually near the lowest elevation,
    // but this is only a visual planning aid and not measured bathymetry.
    if (minE <= 3 && elevation <= Math.max(3, minE + Math.max(1.5, rangeE * 0.035)) && slope <= 6) {
      influence = Math.max(influence, 0.46);
    }

    for (const sample of waterSamples) {
      const distance = approxDistanceKm(pLat, pLng, sample.lat, sample.lon);
      if (distance > sample.radiusKm) continue;

      const t = 1 - (distance / sample.radiusKm);
      influence = Math.max(influence, t * sample.intensity);

      if (influence >= 0.96) break;
    }

    return Math.max(0, Math.min(1, influence));
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
    const waterSamples = buildWaterOverlaySamples();

    console.log('PAL-AI terrain visual scale:', {
      mode,
      minE: Math.round(minE),
      maxE: Math.round(maxE),
      rangeE: Math.round(rangeE),
      avgE: Math.round(avgE),
      metersPerVerticalUnit: Number(metersPerVerticalUnit.toFixed(2)),
      currentExaggeration,
      waterSamples: waterSamples.length
    });

    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        const idx = gy * N + gx;
        const e = safeElevGrid[idx];
        const slope = Number(slopeGrid[idx] || 0);
        const tNorm = (e - minE) / rangeE;

        const x = (gx / GRID_RESOLUTION - 0.5) * SIZE;
        const z = (gy / GRID_RESOLUTION - 0.5) * SIZE;

        const pLat = terrainData
          ? terrainData.lat - terrainData.half + gy * terrainData.step
          : 0;
        const pLng = terrainData
          ? terrainData.lng - terrainData.half + gx * terrainData.step
          : 0;

        let y = ((e - avgE) / metersPerVerticalUnit) * currentExaggeration;
        y = Math.max(-verticalClamp, Math.min(verticalClamp, y));

        const waterInfluence = terrainData
          ? waterInfluenceAtPoint(pLat, pLng, e, minE, rangeE, slope, waterSamples)
          : 0;

        if (waterInfluence > 0.06) {
          // Visual-only water depression. This does NOT represent measured bathymetry.
          y -= Math.min(1.05, 0.22 + waterInfluence * 0.92) * currentExaggeration;
        }

        positions.push(x, y, z);

        let t;
        if (mode === 'elevation') {
          t = tNorm;
        } else if (mode === 'slope') {
          t = Math.min(slope / 45, 1);
        } else if (mode === 'aspect') {
          t = 0.5;
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

        let c = lerpColor(COLOR_MAPS[mode] || COLOR_MAPS.elevation, t);

        if (waterInfluence > 0.06) {
          const shallow = { r: 0.20, g: 0.65, b: 0.88 };
          const deep = { r: 0.04, g: 0.25, b: 0.70 };
          c = {
            r: shallow.r + (deep.r - shallow.r) * waterInfluence,
            g: shallow.g + (deep.g - shallow.g) * waterInfluence,
            b: shallow.b + (deep.b - shallow.b) * waterInfluence
          };
        }

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
        ? `Water overlay: ${terrainData.waterFeatureCount} mapped feature(s), visual aid only`
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
    camera.position.set(0, 13, 24);
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

      // Update compass
      if (camera && controls) {
        const dx = camera.position.x - controls.target.x;
        const dz = camera.position.z - controls.target.z;
        const angle = Math.atan2(dx, dz) * 180 / Math.PI;
        const compass = document.getElementById('terrain-compass');
        if (compass) compass.style.transform = `rotate(${-angle}deg)`;
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
      aspect: 'Aspect (N/E/S/W)'
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
    } else {
      bar.style.background = 'linear-gradient(to right,#1e3a5f,#2f6f8f,#466b4b,#77743a,#7a5630,#d1d5db)';
      if (terrainData) {
        if (min) min.textContent = Math.round(terrainData.minE) + 'm';
        if (max) max.textContent = Math.round(terrainData.maxE) + 'm';
      }
    }
  }


  // ── Scoring Mathematics ──
  function computeScores(data) {
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

    // --- Soil inference from elevation + slope ──
    // Philippine soil classes inferred from terrain
    let soilType, soilFertility, soilpH, soilTexture;
    if (avgE < 50 && avgSlope < 3) {
      soilType = "Hydric Paddy Soil (Aquic)";
      soilFertility = "High"; soilpH = "5.5 – 6.5"; soilTexture = "Clay / Clay Loam";
    } else if (avgE < 200 && avgSlope < 5) {
      soilType = "Alluvial / Fluvisol";
      soilFertility = "High"; soilpH = "5.8 – 7.0"; soilTexture = "Sandy Loam to Clay";
    } else if (avgE < 500 && avgSlope < 10) {
      soilType = "Cambisol / Inceptisol";
      soilFertility = "Moderate"; soilpH = "5.0 – 6.5"; soilTexture = "Loam to Clay Loam";
    } else if (avgE < 1000) {
      soilType = "Oxisol / Ultisol (Upland)";
      soilFertility = "Low"; soilpH = "4.5 – 5.5"; soilTexture = "Clay (Weathered)";
    } else {
      soilType = "Entisol / Lithosol (Highland)";
      soilFertility = "Very Low"; soilpH = "4.2 – 5.0"; soilTexture = "Rocky / Sandy";
    }

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
          demSourceLabel: data.sourceLabel || (data.usedAPI ? 'Real DEM' : 'Synthetic fallback'),
          demCoveragePct: data.demCoveragePct || 0,
          fallbackFilledCount: data.fallbackFilledCount || 0
        },
        slope: { avgSlope, flatFraction, steepFraction, mildFraction, slopeScore },
        soil: { soilType, soilFertility, soilpH, soilTexture, drainageScore },
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
